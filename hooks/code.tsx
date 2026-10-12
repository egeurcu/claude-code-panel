import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { ScriptRun } from '../types'

import { twoStep } from './confirm'
import { T } from './i18n'
import { ago } from './info'
import { parseLog, parseNumstat, parsePid, parseStatus, parseTodos, rankTodos, scriptsOf, stripAnsi, todoPrompt } from './parse'
import type { Commit, GitFile, GitHead, RankedTodo } from './parse'

export const CODE = 'code'
// Oturumun kendi istemcisi ve girişiyle çalışır: claude.ai abonelik kotasından düşer
const HAIKU = 'claude-haiku-5-5'
const scripts = atom({ plugin: 'panel', key: 'scripts' } as const, {})
const lang = atom({ plugin: 'panel', key: 'lang' } as const, 'tr')

type Snapshot = {
  git: { head: GitHead; files: GitFile[]; commits: Commit[] } | { error: string }
  scripts: string[]
}

const oneLine = (s: string, max = 120) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}


const STATUS: Record<string, [string, string]> = {
  '??': ['+', 'success'],
  A: ['A', 'success'],
  M: ['M', 'warning'],
  D: ['D', 'error'],
  R: ['R', 'suggestion'],
}
const statusOf = (code: string) => STATUS[code] ?? STATUS[code.trim()[0] ?? ''] ?? [code.trim() || '·', 'subtle']

export const codeTab = (on: On) => {
  let cache: { cwd: string; at: number; loading: boolean; data?: Snapshot } | undefined
  const diffs = new Map<string, string>() // açık dosya → diff metni
  let scriptsOpen = false
  let todos: { busy?: boolean; items?: RankedTodo[]; note?: string; all?: boolean } = {}
  const procs = new Map<string, AsyncGenerator<unknown, unknown>>()
  const confirm = twoStep()

  on('ui.render', { component: 'Pane', requestId: CODE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const [cwd, now, runs, l] = await Promise.all([$.session.cwd(), $.clock.now(), read($, scripts), read($, lang)])
    const t = T[l]
    const width = Math.max(24, e.props.bodyColumns)

    // Komut çıktılarını okur ($ yalnızca kancanın içinde, $.isim.metot biçiminde kullanılabilir)
    const load = async (): Promise<Snapshot> => {
      const git = (args: string[]) => $.process.run(['git', ...args], { cwd, timeoutMs: 15_000 })
      const pkgPath = `${cwd}/package.json`
      const pkg = (await $.fs.exists(pkgPath)) ? await $.fs.read(pkgPath) : ''
      const st = await git(['status', '--porcelain=v1', '-b']).catch(err => ({ exitCode: -1, stdout: '', stderr: String(err) }))
      if (st.exitCode !== 0) {
        return { git: { error: /not a git repository/i.test(st.stderr) ? t.notRepo : `git: ${oneLine(st.stderr)}` }, scripts: scriptsOf(pkg) }
      }
      const [ns, log] = await Promise.all([git(['diff', 'HEAD', '--numstat']), git(['log', '-5', '--format=%h%x09%ct%x09%s'])])
      const { head, files } = parseStatus(st.stdout)
      const counts = parseNumstat(ns.stdout)
      return { git: { head, files: files.map(f => ({ ...f, ...counts.get(f.path) })), commits: parseLog(log.stdout) }, scripts: scriptsOf(pkg) }
    }

    // 10 sn önbellek; yenileme arka planda, bitince yeniden çizilir
    if (!cache || cache.cwd !== cwd || (!cache.loading && now - cache.at > 10_000)) {
      const mine = { cwd, at: now, loading: true, data: cache?.cwd === cwd ? cache.data : undefined }
      cache = mine
      void load()
        .then(data => {
          mine.data = data
        })
        .finally(() => {
          mine.loading = false
          $.ui.invalidate('ui.render')
        })
    }
    const refresh = () => {
      cache = undefined
      diffs.clear()
      $.ui.invalidate('ui.render')
    }

    const toggleDiff = async (f: GitFile) => {
      if (diffs.delete(f.path)) return $.ui.invalidate('ui.render')
      let text = ''
      if (f.code === '??') {
        // izlenmeyen dosya: içeriği eklenmiş satırlar olarak göster
        const body = await $.fs.read(`${cwd}/${f.path}`).catch(() => '')
        const lines = body.split(/\r?\n/).slice(0, 60)
        text = lines.length ? [`@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => '+' + l)].join('\n') : ''
      } else {
        const r = await $.process.run(['git', 'diff', 'HEAD', '--', f.path], { cwd, timeoutMs: 15_000 })
        text = r.stdout.split(/\r?\n/).slice(4, 84).join('\n') // dosya başlığı satırları atlanır
      }
      diffs.set(f.path, text)
      $.ui.invalidate('ui.render')
    }

    // Bir script'in kaydını değiştirir (kayıt yoksa dokunmaz)
    const patch = (name: string, f: (s: ScriptRun) => ScriptRun) =>
      update($, scripts, r => (r[name] ? { ...r, [name]: f(r[name]) } : r))
    const start = (name: string) => {
      void (async () => {
        const startedAt = await $.clock.now()
        const fresh: ScriptRun = { status: 'running', startedAt, lines: [] }
        await update($, scripts, r => ({ ...r, [name]: fresh }))
        // pwsh kendi PID'ini yazar: durdururken npm + node ağacının tamamı bu PID'ten öldürülür
        const quoted = `'${name.replace(/'/g, "''")}'`
        const proc = $.process.spawn({ argv: ['pwsh', '-NoProfile', '-Command', `Write-Output ('__PID=' + $PID); npm run ${quoted}`], cwd })
        procs.set(name, proc)
        let rest = ''
        try {
          for await (const { text } of proc) {
            const pid = parsePid(text)
            const parts = (rest + text).split(/\r?\n|\r/)
            rest = parts.pop() ?? ''
            const lines = parts.map(l => stripAnsi(l).trim()).filter(l => l && !l.startsWith('__PID='))
            await patch(name, s => ({ ...s, pid: s.pid ?? pid, lines: [...s.lines, ...lines].slice(-8) }))
          }
          const { code } = await proc.result
          await patch(name, s => ({ ...s, code, status: s.status === 'killed' ? 'killed' : code === 0 ? 'done' : 'failed' }))
        } catch (err) {
          await patch(name, s => ({ ...s, status: s.status === 'killed' ? 'killed' : 'failed', lines: [...s.lines, oneLine(String(err))].slice(-8) }))
        } finally {
          procs.delete(name)
        }
      })()
    }
    const stop = async (name: string) => {
      const pid = (await read($, scripts))[name]?.pid
      await patch(name, s => ({ ...s, status: 'killed' }))
      if (pid) await $.process.run(['taskkill', '/PID', String(pid), '/T', '/F']).catch(() => undefined)
      await procs.get(name)?.return(undefined)
    }

    const scan = async () => {
      todos = { busy: true }
      $.ui.invalidate('ui.render')
      try {
        const r = await $.process.run(['git', 'grep', '-n', '-I', '-E', 'TODO|FIXME|HACK|XXX'], { cwd, timeoutMs: 30_000 })
        const found = parseTodos(r.stdout).slice(0, 150)
        if (!found.length) {
          todos = { items: [], note: r.exitCode > 1 ? `git grep: ${oneLine(r.stderr)}` : t.noTodos }
          return
        }
        const res = await $.model.complete({ model: HAIKU, prompt: todoPrompt(found, t.todoLang), maxTokens: 8000, timeoutMs: 120_000 })
        todos = res.isAnswered
          ? { items: rankTodos(res.text, found) }
          : { items: rankTodos('', found), note: t.haikuNoAnswer(res.reason) }
      } catch (err) {
        todos = { note: t.scanFailed(oneLine(String(err))) }
      } finally {
        $.ui.invalidate('ui.render')
      }
    }

    const data = cache.data
    const git = data?.git
    const names = data?.scripts ?? []
    const running = names.filter(n => runs[n]?.status === 'running')
    const scriptRow = (name: string) => {
      const s = runs[name]
      const isRunning = s?.status === 'running'
      const armed = confirm.isArmed(`stop-${name}`)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            {isRunning ? (
              <Text color="warning">● {name}</Text>
            ) : (
              <Button key={`run-${name}`} plain label={t.run(name)} onPress={() => start(name)}>
                <Text color="success">▶</Text> {name}
              </Button>
            )}
            {isRunning && (
              <Text dimColor>
                {ago(now - s.startedAt, l)}
                {s.pid ? ` · PID ${s.pid}` : ''}
              </Text>
            )}
            {isRunning && (
              <Button key={`stop-${name}`} plain label={t.stop(name)} onPress={() => (confirm.press(`stop-${name}`) ? stop(name) : $.ui.invalidate('ui.render'))}>
                <Text color="error">{armed ? t.stopArmed : t.stopButton}</Text>
              </Button>
            )}
            {!isRunning && s && (
              <Text dimColor>
                {s.status === 'done' ? t.finished : s.status === 'killed' ? t.stopped : t.exit(String(s.code ?? '?'))}
              </Text>
            )}
          </Box>
          {s && s.lines.length > 0 && (isRunning || scriptsOpen) && (
            <Box flexDirection="column" paddingLeft={2}>
              {s.lines.slice(isRunning ? -4 : -2).map(l => (
                <Text dimColor wrap="truncate-end">
                  {l}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    const shownTodos = todos.items ? (todos.all ? todos.items : todos.items.slice(0, 12)) : []

    return (
      <Box flexDirection="column" gap={1}>
        {/* Git */}
        <Box flexDirection="column">
          {!git ? (
            <Text dimColor>{t.gitLoading}</Text>
          ) : 'error' in git ? (
            <Text dimColor>{git.error}</Text>
          ) : (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text bold color="#b860e0">
                  ⎇ {git.head.branch}
                </Text>
                {git.head.upstream && <Text dimColor>→ {git.head.upstream}</Text>}
                {git.head.ahead > 0 && <Text color="success">↑{git.head.ahead}</Text>}
                {git.head.behind > 0 && <Text color="warning">↓{git.head.behind}</Text>}
                <Button key="git-refresh" plain dimColor label={t.refresh} onPress={refresh} />
              </Box>
              {git.files.length === 0 && <Text dimColor>{t.noChanges}</Text>}
              {git.files.slice(0, 25).map(f => {
                const [mark, color] = statusOf(f.code)
                const diff = diffs.get(f.path)
                return (
                  <Box flexDirection="column">
                    <Button key={`f-${f.path}`} plain label={f.path} onPress={() => toggleDiff(f)}>
                      <Text color={color}>{mark}</Text> {oneLine(f.path, width - 16)}
                      {f.added !== undefined && <Text color="success"> +{f.added}</Text>}
                      {f.removed !== undefined && <Text color="error"> −{f.removed}</Text>}
                    </Button>
                    {diff !== undefined &&
                      (diff ? <Code source={diff} format="diff" path={f.path} wrap="truncate-end" /> : <Text dimColor>{t.noDiff}</Text>)}
                  </Box>
                )
              })}
              {git.files.length > 25 && <Text dimColor>{t.moreFiles(git.files.length - 25)}</Text>}
              {git.commits.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                  {git.commits.map(c => (
                    <Text wrap="truncate-end">
                      <Text color="#b860e0">{c.hash}</Text> {c.subject} <Text dimColor>{ago(now - c.at, l)}</Text>
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* Komutlar: varsayılan kapalı; çalışanlar her zaman görünür */}
        {names.length > 0 && (
          <Box flexDirection="column">
            <Button key="scripts" plain label={t.scripts} onPress={() => ((scriptsOpen = !scriptsOpen), $.ui.invalidate('ui.render'))}>
              <Text bold>
                {scriptsOpen ? '▾' : '▸'} {t.scripts} ({names.length})
              </Text>
              {running.length > 0 && <Text color="warning"> · {t.running(running.length)}</Text>}
            </Button>
            {(scriptsOpen ? names : running).map(scriptRow)}
          </Box>
        )}

        {/* TODO avcısı: Haiku 5.5 önem sırasına dizer */}
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold>{t.todoHunter}</Text>
            {todos.busy ? (
              <Text color="warning">{t.scanning}</Text>
            ) : (
              <Button key="todo-scan" plain label={t.scan} onPress={scan}>
                <Text color="#b860e0">{t.scan}</Text>
              </Button>
            )}
          </Box>
          {todos.note && <Text dimColor>{todos.note}</Text>}
          {!todos.items && !todos.busy && !todos.note && <Text dimColor>{t.todoIntro}</Text>}
          {shownTodos.map((td, i) => (
            <Button
              key={`todo-${i}`}
              plain
              label={`${td.file}:${td.line}`}
              onPress={() => $.prompt.fill({ text: t.fixTodo(`${td.file}:${td.line}`, td.text) })}
            >
              <Text color={td.priority === 3 ? 'error' : td.priority === 2 ? 'warning' : 'subtle'}>{['·  ', '!  ', '!! ', '!!!'][td.priority]}</Text>{' '}
              {oneLine(td.summary, width - 30)} <Text dimColor>{oneLine(`${td.file}:${td.line}`, 26)}</Text>
            </Button>
          ))}
          {todos.items && todos.items.length > 12 && (
            <Button key="todo-all" plain dimColor label={t.more(todos.items.length - 12)} onPress={() => ((todos.all = !todos.all), $.ui.invalidate('ui.render'))}>
              {todos.all ? t.less : t.more(todos.items.length - 12)}
            </Button>
          )}
        </Box>
      </Box>
    )
  })
}
