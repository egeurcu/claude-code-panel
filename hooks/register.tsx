import { atom, read, update } from 'claude-code'
import type { Register, SessionUsage, Timer } from 'claude-code'

import type { Call, Shell, Usage } from '../types'
import { MOODS, RED, gantt, gauge, grid, heat, minis, mood, pixels, toolColor } from './draw'
import type { Grid } from './draw'
import { ago, lastLine, outputFileOf, parseNotification, parseSessions, resetLabel, toolStats } from './info'
import type { SessionRow } from './info'
import { CODE, codeTab } from './code'
import { T } from './i18n'
import type { Lang } from './i18n'
import { SYSTEM, systemTab } from './system'

const PANE = 'panel'
const SESSIONS = 'oturumlar'
const OPEN = { id: PANE, title: 'Panel', columns: 56 } // columns: sağdaki dock genişliği (tam ekranda)
// Sekmeler açılış sırasıyla dizilir: Panel · Code · System · Sessions; sonda Panel yeniden açılıp öne alınır
const TABS = [OPEN, { id: CODE, title: 'Code', columns: 56 }, { id: SYSTEM, title: 'System', columns: 56 }, { id: SESSIONS, title: 'Sessions', columns: 56 }]

const calls = atom({ plugin: 'panel', key: 'calls' } as const, [])
const files = atom({ plugin: 'panel', key: 'files' } as const, {})
const shells = atom({ plugin: 'panel', key: 'shells' } as const, [])
const usage = atom({ plugin: 'panel', key: 'usage' } as const, null)
const turn = atom({ plugin: 'panel', key: 'turn' } as const, null)
const mascotOn = atom({ plugin: 'panel', key: 'mascotOn' } as const, true)
const graphifyBusy = atom({ plugin: 'panel', key: 'graphifyBusy' } as const, false)
const lang = atom({ plugin: 'panel', key: 'lang' } as const, 'tr')

const EDITS = /^(Edit|Write|NotebookEdit|MultiEdit)$/
const SHELLS = /^(Bash|PowerShell)$/
const ACTIVE = new Set(['pending', 'running', 'waiting'])
const ICON: Record<string, string> = { pending: '◌', running: '●', waiting: '◌', idle: '○', completed: '✓', failed: '✗', killed: '■' }

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
const base = (p: string) => p.split(/[\\/]/).pop() ?? p
const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
const pathOf = (e: any): string | undefined => e.file_path ?? e.notebook_path
const targetOf = (e: any) => {
  const p = pathOf(e)
  return p ? base(p) : String(e.command ?? e.pattern ?? e.description ?? e.url ?? e.query ?? e.skill ?? '')
}
const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
const dur = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : mmss(ms))
const toUsage = (u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): Usage => {
  const five = u.rateLimits.find(r => r.kind === 'five_hour')
  const seven = u.rateLimits.find(r => r.kind === 'seven_day')
  return {
    percent: u.context.percent ?? 0,
    tokens: u.context.tokens ?? 0,
    window: u.context.window,
    fiveHour: five?.percentUsed,
    sevenDay: seven?.percentUsed,
    fiveHourResetsAt: five?.resetsAt,
    sevenDayResetsAt: seven?.resetsAt,
    costUsd: u.cost?.usd,
  }
}
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
// Tırnaklanmış yolları Geri Dönüşüm Kutusu'na taşıyan pwsh betiği (olmayan yol atlanır)
const recycle = (quoted: string[]) =>
  'Add-Type -AssemblyName Microsoft.VisualBasic; $fs = [Microsoft.VisualBasic.FileIO.FileSystem]; ' +
  `foreach ($p in @(${quoted.join(',')})) { ` +
  "if (Test-Path -LiteralPath $p -PathType Leaf) { $fs::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } " +
  "elseif (Test-Path -LiteralPath $p -PathType Container) { $fs::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } }"

export const register: Register = on => {
  let tick: Timer | undefined
  let anim: { key: string; i: number; timer?: Timer } | undefined
  let sessionList: { rows: SessionRow[]; dirs: Map<string, string>; root: string; current: string; at: number } | undefined // 2 dk önbellek, Yenile ile tazelenir
  let openProjects: Set<string> | undefined
  const fullProjects = new Set<string>()
  let asking: string | undefined // silme onayı bekleyen oturum id'si ya da 'untitled'
  codeTab(on)
  systemTab(on)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'panel', description: 'Toggle panel · Paneli aç/kapat' })
    const saved = await $.store.get('mascotOn')
    if (typeof saved === 'boolean') await update($, mascotOn, () => saved)
    const savedLang = await $.store.get('lang')
    if (savedLang === 'tr' || savedLang === 'en') await update($, lang, () => savedLang as Lang)
    const u = toUsage(await $.session.usage())
    await update($, usage, () => u)
    void (async () => {
      for (const tab of TABS) await $.ui.open(tab)
      await $.ui.open(OPEN)
    })()

    return next(e)
  })

  on('command.run', { command: 'panel' }, async $ => {
    const t = T[await read($, lang)]
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      for (const tab of TABS) await $.ui.close({ id: tab.id })
      return { text: t.panelClosed }
    }
    for (const tab of TABS) await $.ui.open(tab)
    await $.ui.open(OPEN)
    return { text: t.panelOpened }
  })

  on('ui.close', { id: PANE }, ($, e, next) => {
    anim?.timer?.cancel()
    anim = undefined
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const u = toUsage(e)
    await update($, usage, () => u)

    return next(e)
  })

  // Arka plan görevinin bitiş bildirimi: ilgili shell'i kapat
  on('prompt.submit', async ($, e, next) => {
    const done = e.origin.kind === 'task-notification' ? parseNotification(e.text) : undefined
    if (done) {
      const endedAt = await $.clock.now()
      await update($, shells, list =>
        list.map(s =>
          s.id === done.id ? { ...s, status: done.status, endedAt, outputFile: s.outputFile ?? done.outputFile } : s,
        ),
      )
    }

    return next(e)
  })

  // Ana tur: açık tur yokken başlayan ilk tur; subagent turları ana turun içinde kalır.
  on('turn.start', async ($, e, next) => {
    const current = await read($, turn)
    if (!current || current.endedAt !== undefined) {
      const startedAt = await $.clock.now()
      await update($, turn, () => ({ id: e.turnId, startedAt }))
      tick?.cancel()
      tick = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const current = await read($, turn)
    if (current?.id === e.turnId && current.endedAt === undefined) {
      const endedAt = await $.clock.now()
      await update($, turn, t => (t ? { ...t, endedAt } : t))
      tick?.cancel()
      tick = undefined
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const call: Call = {
      id: e.tool_use_id ?? `${e.tool}-${startedAt}`,
      tool: e.tool,
      target: oneLine(targetOf(e), 60),
      agentId: e.agentId,
      startedAt,
    }
    await update($, calls, list => [...list, call].slice(-500))
    let isError = true
    try {
      const ran = await next(e)
      isError = ran.deny !== undefined || ran.isError === true
      // Arka plana alınan shell: kimliği sonuçta gelir, bitişi task-notification ile
      const bg: string | undefined = SHELLS.test(e.tool) ? (ran.result as any)?.backgroundTaskId : undefined
      if (bg) {
        const shell: Shell = {
          id: bg,
          command: oneLine(String((e as any).command ?? ''), 200),
          startedAt,
          status: 'running',
          outputFile: outputFileOf(ran.text, bg),
        }
        await update($, shells, list => [...list.filter(s => s.id !== bg), shell].slice(-30))
      }
      const stopped: string | undefined = e.tool === 'TaskStop' && !isError ? ((e as any).task_id ?? (e as any).shell_id) : undefined
      if (stopped) {
        const endedAt = await $.clock.now()
        await update($, shells, list => list.map(s => (s.id === stopped ? { ...s, status: 'killed', endedAt } : s)))
      }
      return ran
    } finally {
      const endedAt = await $.clock.now()
      await update($, calls, list => list.map(c => (c.id === call.id ? { ...c, endedAt, isError } : c)))
      const path = pathOf(e)
      if (!isError && path && EDITS.test(e.tool)) {
        await update($, files, f => ({ ...f, [path]: { edits: (f[path]?.edits ?? 0) + 1, lastAt: endedAt } }))
      }
    }
  }).catch(($, e, next) => next(e)) // gözlemci: kayıt bozulsa da araç çağrısı aynen sürer

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const Raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined
    const pic = (key: string, g: Grid) =>
      Raster ? <Raster key={key} columns={g.columns} rows={g.rows} cells={g.cells} /> : <Text>{g.text}</Text>

    const [showDitto, list, touched, bgShells, u, t, busy, agents, now, cwd, l] = await Promise.all([
      read($, mascotOn),
      read($, calls),
      read($, files),
      read($, shells),
      read($, usage),
      read($, turn),
      read($, graphifyBusy),
      $.agent.list(),
      $.clock.now(),
      $.session.cwd(),
      read($, lang),
    ])
    const s_ = T[l]
    // Tur zaman çizelgesi: ana döngü + bu turda araç çağıran ajanlar
    const t0 = t?.startedAt ?? now
    const t1 = t?.endedAt ?? now
    const inTurn = list.filter(c => c.startedAt >= t0)
    const laneIds = [undefined, ...new Set(inTurn.flatMap(c => (c.agentId ? [c.agentId] : [])))].slice(0, 7)
    const laneName = (id?: string) => (id ? oneLine(agents.find(a => a.id === id)?.type ?? id, 10) : s_.main)
    const firstSeen = (id: string) => list.find(c => c.agentId === id)?.startedAt
    const shown = [...agents].sort((a, b) => Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status))).slice(0, 8)

    // graphify-out varsa: grafikten sonra düzenlenen dosyalar
    const graph = `${cwd}/graphify-out/graph.json`
    const graphMtime = (await $.fs.exists(graph)) ? (await $.fs.stat(graph)).mtimeMs : undefined
    const stale =
      graphMtime === undefined
        ? 0
        : Object.entries(touched).filter(([p, f]) => f.lastAt > graphMtime && norm(p).startsWith(norm(cwd))).length
    const runGraphify = async () => {
      await update($, graphifyBusy, () => true)
      try {
        const r = await $.process.run(['graphify', 'update', '.', '--force'], { cwd, timeoutMs: 600_000 })
        $.ui.toast(r.exitCode === 0 ? s_.graphifyDone : s_.graphifyFailed(oneLine(r.stderr, 160)))
      } catch (err) {
        $.ui.toast(s_.graphifyFailed(oneLine(String(err), 160)))
      } finally {
        await update($, graphifyBusy, () => false)
      }
    }

    // Shell'ler: ön planda çalışan Bash/PowerShell çağrıları + arka plan shell'leri
    const foreground = list.filter(c => SHELLS.test(c.tool) && c.endedAt === undefined)
    const running = bgShells.filter(s => s.status === 'running')
    const finished = bgShells.filter(s => s.status !== 'running').slice(-3)
    const tails = await Promise.all(
      running.map(async s => {
        if (!s.outputFile || !(await $.fs.exists(s.outputFile))) return ''
        if ((await $.fs.stat(s.outputFile)).size > 1_000_000) return ''
        return lastLine(await $.fs.read(s.outputFile))
      }),
    )

    const width = Math.max(20, e.props.bodyColumns)
    const copies = Math.min(2, agents.filter(a => ACTIVE.has(a.status)).length)
    const moodKey = mood(list, u?.percent ?? 0, t !== null && t.endedAt === undefined, now)
    const m = MOODS[moodKey]

    // Ditto: aynı ruh hali sürerken zamanlayıcı yeniden kurulmaz
    let sprite: Grid | undefined
    if (showDitto) {
      const frames = m.frames.map(f => grid(pixels(f)))
      if (anim?.key !== moodKey) {
        anim?.timer?.cancel()
        const a: NonNullable<typeof anim> = { key: moodKey, i: 0 }
        if (frames.length > 1) {
          a.timer = $.clock.every(m.ms, () => {
            a.i = (a.i + 1) % frames.length
            // panel kapanmış ya da yeniden çiziliyorsa kare düşer; red yakalanır
            $.ui.blit({ requestId: PANE, key: 'ditto', cells: frames[a.i]!.cells }).catch(() => {})
          })
        }
        anim = a
      }
      sprite = frames[anim.i % frames.length]
    } else {
      anim?.timer?.cancel()
      anim = undefined
    }

    // Ditto çizilirken göstergeler onun yanındaki dar sütuna geçer: etiket satırı + altında bar
    const side = sprite && Raster ? Math.max(10, width - sprite.columns - 2) : width
    const stacked = side < width
    const gw = Math.max(6, Math.min(40, width - 26))
    const meter = (label: string, pct: number | undefined, extra = '') =>
      pct === undefined ? null : stacked ? (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            {label} <Text color={hex(heat(pct / 100))}>{Math.round(pct)}%</Text> <Text dimColor>{extra}</Text>
          </Text>
          {pic(`g-${label}`, gauge(pct, side))}
        </Box>
      ) : (
        <Box flexDirection="row" gap={1}>
          <Text>{label.padEnd(8)}</Text>
          {pic(`g-${label}`, gauge(pct, gw))}
          <Text color={hex(heat(pct / 100))}>{`${Math.round(pct)}%`.padStart(4)}</Text>
          <Text dimColor>{extra}</Text>
        </Box>
      )
    const toggleDitto = async () => {
      await update($, mascotOn, () => !showDitto)
      await $.store.set('mascotOn', !showDitto)
    }
    const dittoLine = <Text color={m.frames.length === 1 ? hex(RED) : '#b860e0'}>{s_.mood[moodKey]}</Text>
    const stats = (
      <Box flexDirection="column">
        {showDitto && dittoLine}
        {sprite && Raster && copies > 0 && (
          <Box flexDirection="row" gap={1}>
            {pic('minis', grid(pixels(minis(copies))))}
            <Text dimColor>{s_.copies(copies)}</Text>
          </Box>
        )}
        {meter('Context', u?.percent, u ? `${k(u.tokens)}/${k(u.window)}` : '')}
        {meter(s_.fiveHour, u?.fiveHour, resetLabel(u?.fiveHourResetsAt, now, l))}
        {meter(s_.sevenDay, u?.sevenDay, resetLabel(u?.sevenDayResetsAt, now, l))}
        <Text wrap="truncate-end">
          {stacked ? `${s_.turn} ` : s_.turn.padEnd(9)}
          {t ? `⏱ ${mmss(t1 - t0)} · ${s_.tools(inTurn.length)}${t.endedAt ? ` · ${s_.done}` : ''}` : s_.noTurn}
          {u?.costUsd !== undefined ? ` · $${u.costUsd.toFixed(2)}` : ''}
        </Text>
        <Button key="ditto" plain label={showDitto ? s_.hideDitto : s_.showDitto} onPress={toggleDitto}>
          <Text color="#b860e0" dimColor={!showDitto}>
            ●
          </Text>
        </Button>
      </Box>
    )

    const stats2 = toolStats(list, now).slice(0, 5)

    return (
      <Box flexDirection="column" gap={1}>
        {sprite && Raster ? (
          <Box flexDirection="row" gap={2}>
            <Raster key="ditto" columns={sprite.columns} rows={sprite.rows} cells={sprite.cells} />
            <Box flexDirection="column" width={side}>
              {stats}
            </Box>
          </Box>
        ) : (
          stats
        )}

        <Box flexDirection="column">
          <Text bold>{s_.agents}</Text>
          {shown.length === 0 && <Text dimColor>{s_.noAgents}</Text>}
          {shown.map(a => {
            const now_ = list.findLast(c => c.agentId === a.id && c.endedAt === undefined)
            const since = firstSeen(a.id)
            return (
              <Text color={a.status === 'failed' ? hex(RED) : undefined} dimColor={!ACTIVE.has(a.status)} wrap="truncate-end">
                {a.parentId ? '  ' : ''}
                {ICON[a.status] ?? '·'} {a.type} · {oneLine(a.description, 40)}
                {since ? ` · ${dur((ACTIVE.has(a.status) ? now : (list.findLast(c => c.agentId === a.id)?.endedAt ?? now)) - since)}` : ''}
                {now_ ? ` → ${now_.tool} ${now_.target}` : ''}
              </Text>
            )
          })}
        </Box>

        <Box flexDirection="column">
          <Text bold>{s_.shells}</Text>
          {foreground.length + bgShells.length === 0 && <Text dimColor>{s_.noShells}</Text>}
          {foreground.map(c => (
            <Text wrap="truncate-end">
              <Text color="warning">●</Text> {c.target} <Text dimColor>· {dur(now - c.startedAt)} · {s_.foreground}</Text>
            </Text>
          ))}
          {running.map((s, i) => (
            <Box flexDirection="column">
              <Text wrap="truncate-end">
                <Text color="warning">●</Text> {s.command} <Text dimColor>· {dur(now - s.startedAt)} · {s_.background}</Text>
              </Text>
              {tails[i] ? (
                <Text dimColor wrap="truncate-end">
                  {'  └ '}
                  {tails[i]}
                </Text>
              ) : null}
            </Box>
          ))}
          {finished.map(s => (
            <Text dimColor wrap="truncate-end">
              <Text color={s.status === 'completed' ? 'success' : hex(RED)}>{ICON[s.status]}</Text> {s.command} ·{' '}
              {dur((s.endedAt ?? now) - s.startedAt)}
            </Text>
          ))}
        </Box>

        {inTurn.length > 0 && (
          <Box flexDirection="column">
            <Text bold>{s_.timeline}</Text>
            <Box flexDirection="row" gap={1}>
              <Box flexDirection="column">
                {laneIds.map(id => (
                  <Text dimColor>{laneName(id).padEnd(10)}</Text>
                ))}
              </Box>
              {pic('gantt', gantt(laneIds.map(id => inTurn.filter(c => c.agentId === id)), t0, t1, Math.max(6, width - 12)))}
            </Box>
          </Box>
        )}

        <Box flexDirection="column">
          <Text bold>{s_.flow}</Text>
          {list.length === 0 && <Text dimColor>{s_.noCalls}</Text>}
          {list.slice(-6).map(c => (
            <Text wrap="truncate-end">
              <Text color={c.endedAt === undefined ? 'warning' : c.isError ? hex(RED) : hex(toolColor(c.tool))}>
                {c.endedAt === undefined ? '●' : c.isError ? '✗' : '✓'} {c.tool.padEnd(8)}
              </Text>{' '}
              {c.target.padEnd(28).slice(0, 28)}{' '}
              <Text dimColor>{dur((c.endedAt ?? now) - c.startedAt)}</Text>
            </Text>
          ))}
        </Box>

        {stats2.length > 0 && (
          <Box flexDirection="column">
            <Text bold>{s_.toolStats}</Text>
            {stats2.map(s => (
              <Text wrap="truncate-end">
                <Text color={hex(toolColor(s.tool))}>{s.tool.padEnd(12)}</Text>
                {`${s.count}×`.padStart(5)} {dur(s.ms).padStart(7)}
                {s.errors ? <Text color={hex(RED)}> {s.errors}✗</Text> : ''}
              </Text>
            ))}
          </Box>
        )}

        {Object.keys(touched).length > 0 && (
          <Box flexDirection="column">
            <Text bold>{s_.files} ({Object.keys(touched).length})</Text>
            {Object.entries(touched)
              .sort((a, b) => b[1].lastAt - a[1].lastAt)
              .slice(0, 6)
              .map(([p, f]) => (
                <Text wrap="truncate-end">
                  {base(p).padEnd(28)} <Text dimColor>{s_.edits(f.edits)}</Text>
                </Text>
              ))}
          </Box>
        )}

        {graphMtime !== undefined && (
          <Box flexDirection="row" gap={1}>
            <Text bold>Graphify</Text>
            {busy ? (
              <Text color="warning">{s_.updating}</Text>
            ) : stale === 0 ? (
              <Text color="success">{s_.upToDate}</Text>
            ) : (
              <Text color="warning">{s_.changed(stale)}</Text>
            )}
            {!busy && <Button key="graphify" label={s_.update} onPress={runGraphify} />}
          </Box>
        )}
      </Box>
    )
  })

  // Sessions: tüm dizinlerdeki devam ettirilebilir oturumlar; tıklayınca yeni PowerShell sekmesinde açılır
  on('ui.render', { component: 'Pane', requestId: SESSIONS }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [now, l] = await Promise.all([$.clock.now(), read($, lang)])
    const t = T[l]
    if (!sessionList || now - sessionList.at > 120_000) {
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
      const root = `${home}/.claude/projects`
      const dirs = new Map<string, string>() // oturum id'si → transcript'in proje klasörü
      for (const dir of (await $.fs.exists(root)) ? await $.fs.list(root) : []) {
        if (dir.kind !== 'dir') continue
        for (const f of await $.fs.list(`${root}/${dir.name}`)) {
          if (f.kind === 'file' && f.name.endsWith('.jsonl')) dirs.set(f.name.slice(0, -6), dir.name)
        }
      }
      const historyPath = `${home}/.claude/history.jsonl`
      const history = (await $.fs.exists(historyPath)) ? await $.fs.read(historyPath) : ''
      sessionList = { rows: parseSessions(history, new Set(dirs.keys()), 500), dirs, root, current: await $.session.id(), at: now }
    }
    const { rows, dirs, root, current } = sessionList
    const width = Math.max(24, e.props.bodyColumns)

    const openTab = async (s: SessionRow) => {
      try {
        const r = await $.process.run(
          ['wt.exe', '-w', '0', 'nt', '-d', s.project, 'pwsh', '-NoExit', '-Command', 'claude', '--resume', s.id],
          { timeoutMs: 15_000 },
        )
        $.ui.toast(r.exitCode === 0 ? t.opened(base(s.project)) : t.openFailed(oneLine(r.stderr || String(r.exitCode), 120)))
      } catch (err) {
        $.ui.toast(t.openFailed(oneLine(String(err), 120)))
      }
    }
    const refresh = () => {
      sessionList = undefined
      $.ui.invalidate('ui.render')
    }
    const ask = (what: string | undefined) => {
      asking = what
      $.ui.invalidate('ui.render')
    }
    // Transcript (.jsonl) + yanındaki aynı adlı klasör Geri Dönüşüm Kutusu'na taşınır: geri alınabilir
    const trash = async (ids: string[]) => {
      asking = undefined
      const ok = ids.filter(id => id !== current && dirs.has(id))
      const paths = ok
        .flatMap(id => [`${root}/${dirs.get(id)}/${id}.jsonl`, `${root}/${dirs.get(id)}/${id}`])
        .map(p => `'${p.replace(/\//g, '\\').replace(/'/g, "''")}'`)
      try {
        // komut satırı sınırı: 100 yollu parçalar
        for (let i = 0; i < paths.length; i += 100) {
          const r = await $.process.run(['pwsh', '-NoProfile', '-Command', recycle(paths.slice(i, i + 100))], { timeoutMs: 120_000 })
          if (r.exitCode !== 0) throw new Error(r.stderr || `exit ${r.exitCode}`)
        }
        $.ui.toast(t.deleted(ok.length))
      } catch (err) {
        $.ui.toast(t.deleteFailed(oneLine(String(err), 120)))
      }
      refresh()
    }
    const confirmRow = (question: string, ids: string[]) => (
      <Box flexDirection="row" gap={1} paddingLeft={2}>
        <Text color="warning" wrap="truncate-end">
          {question}
        </Text>
        <Button key="del-yes" plain label={t.yes} onPress={() => trash(ids)}>
          <Text color="error">[{t.yes}]</Text>
        </Button>
        <Button key="del-no" plain label={t.no} onPress={() => ask(undefined)}>
          [{t.no}]
        </Button>
      </Box>
    )

    // Başlıksız: yalnızca slash komutu girilmiş. Son 1 saattekiler başka terminalde açık olabilir, dokunulmaz.
    const untitled = rows.filter(s => !s.title && s.id !== current && now - s.lastAt > 3_600_000)

    // Proje dizinine göre gruplu (en yeni oturumu olan proje üstte), proje başına en çok 5 satır
    const groups = new Map<string, SessionRow[]>()
    for (const s of rows) groups.set(s.project, [...(groups.get(s.project) ?? []), s])
    const PER = 5
    // Açık projeler: ilk çizimde yalnızca en yeni proje açık; '+N daha' ile tamamı gösterilenler
    const open = (openProjects ??= new Set(rows.slice(0, 1).map(s => s.project)))
    const flip = (set: Set<string>, project: string) => {
      if (!set.delete(project)) set.add(project)
      $.ui.invalidate('ui.render')
    }
    const titleWidth = width - 2 - 7 - 2 // girinti + sağa yaslı zaman + ×

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Button key="refresh" plain dimColor label={t.refresh} onPress={refresh} />
          {untitled.length > 0 &&
            (asking === 'untitled' ? (
              confirmRow(t.askClean(untitled.length), untitled.map(s => s.id))
            ) : (
              <Button key="clean" plain label={t.cleanUntitled(untitled.length)} onPress={() => ask('untitled')}>
                <Text color="warning">{t.cleanUntitled(untitled.length)}</Text>
              </Button>
            ))}
        </Box>
        {rows.length === 0 && <Text dimColor>{t.noSessions}</Text>}
        {[...groups].map(([project, list]) => (
          <Box flexDirection="column">
            <Button key={`p-${project}`} plain label={base(project) || project} onPress={() => flip(open, project)}>
              <Text bold color="#b860e0">
                {open.has(project) ? '▾' : '▸'} {base(project) || project}
              </Text>
              <Text dimColor>
                {'  '}
                {t.sessions(list.length)} · {ago(now - list[0]!.lastAt, l)}
              </Text>
            </Button>
            {open.has(project) &&
              list.slice(0, fullProjects.has(project) ? list.length : PER).map(s => {
              if (asking === s.id) return confirmRow(t.askDelete(oneLine(s.title || t.untitled, Math.max(8, width - 30))), [s.id])
              const title = oneLine(s.title || t.untitled, titleWidth).padEnd(titleWidth)
              const when = (s.id === current ? t.open : ago(now - s.lastAt, l)).padStart(6)
              return s.id === current ? (
                <Box paddingLeft={2}>
                  <Text wrap="truncate-end">
                    <Text color="#b860e0">{title}</Text>
                    <Text color="#b860e0"> {when}</Text>
                  </Text>
                </Box>
              ) : (
                <Box flexDirection="row" paddingLeft={2}>
                  <Button key={`s-${s.id}`} plain label={s.title || s.id} onPress={() => openTab(s)}>
                    {title}
                    <Text dimColor> {when}</Text>
                  </Button>
                  <Button key={`del-${s.id}`} plain dimColor label={t.deleteLabel(s.title || s.id)} onPress={() => ask(s.id)}>
                    {' ×'}
                  </Button>
                </Box>
              )
            })}
            {open.has(project) && list.length > PER && (
              <Box paddingLeft={2}>
                <Button key={`more-${project}`} plain dimColor label={t.more(list.length - PER)} onPress={() => flip(fullProjects, project)}>
                  {fullProjects.has(project) ? t.less : t.more(list.length - PER)}
                </Button>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
