import type { On } from 'claude-code'

import { atom, read, update } from 'claude-code'

import { twoStep } from './confirm'
import { T } from './i18n'
import type { Lang } from './i18n'
import { parseContainers, parseListeners } from './parse'
import type { Container, Listener } from './parse'

export const SYSTEM = 'system'

// Dinleyen TCP portları + sahibi sürecin adı ve komut satırı, tek pwsh çağrısında, her zaman JSON dizi
const LISTENERS =
  '$p=@{}; Get-CimInstance Win32_Process | ForEach-Object { $p[[int]$_.ProcessId]=$_ }; ' +
  'ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -State Listen | Select-Object -Property LocalPort,OwningProcess -Unique | ' +
  'ForEach-Object { $x=$p[[int]$_.OwningProcess]; [pscustomobject]@{ port=$_.LocalPort; pid=$_.OwningProcess; name=$x.Name; cmd=$x.CommandLine } })'
const DOCKER_DESKTOP = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'

const lang = atom({ plugin: 'panel', key: 'lang' } as const, 'tr')
const LANGS: [Lang, string][] = [['tr', 'Türkçe'], ['en', 'English']]

type Docker = { containers: Container[] } | { down: 'missing' | 'stopped'; detail: string }
type Snapshot = { listeners: Listener[]; docker: Docker }

const oneLine = (s: string, max = 120) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}


export const systemTab = (on: On) => {
  let cache: { at: number; loading: boolean; data?: Snapshot } | undefined
  let otherOpen = false
  const logs = new Map<string, string[]>() // açık konteyner → son log satırları
  const confirm = twoStep()

  on('ui.render', { component: 'Pane', requestId: SYSTEM }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [now, l] = await Promise.all([$.clock.now(), read($, lang)])
    const t = T[l]
    const width = Math.max(24, e.props.bodyColumns)

    // Komut çıktılarını okur ($ yalnızca kancanın içinde, $.isim.metot biçiminde kullanılabilir)
    const load = async (): Promise<Snapshot> => {
      const [ps, dk] = await Promise.all([
        $.process.run(['pwsh', '-NoProfile', '-Command', LISTENERS], { timeoutMs: 30_000 }).catch(() => ({ exitCode: -1, stdout: '[]', stderr: '' })),
        $.process.run(['docker', 'ps', '-a', '--format', '{{json .}}'], { timeoutMs: 15_000 }).catch(err => ({ exitCode: -2, stdout: '', stderr: String(err) })),
      ])
      const docker: Docker =
        dk.exitCode === 0
          ? { containers: parseContainers(dk.stdout) }
          : { down: dk.exitCode === -2 ? 'missing' : 'stopped', detail: oneLine(dk.stderr) }
      return { listeners: parseListeners(ps.stdout), docker }
    }

    // 30 sn önbellek; yenileme arka planda (pwsh yaklaşık 1 sn sürer)
    if (!cache || (!cache.loading && now - cache.at > 30_000)) {
      const mine = { at: now, loading: true, data: cache?.data }
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
      $.ui.invalidate('ui.render')
    }

    const kill = async (x: Listener) => {
      if (!confirm.press(`kill-${x.pid}`)) return $.ui.invalidate('ui.render')
      const r = await $.process.run(['taskkill', '/PID', String(x.pid), '/T', '/F']).catch(err => ({ exitCode: -1, stdout: '', stderr: String(err) }))
      $.ui.toast(r.exitCode === 0 ? t.stoppedToast(`${x.name} (PID ${x.pid})`) : t.stopFailed(oneLine(r.stderr || r.stdout)))
      refresh()
    }
    const dockerDo = async (args: string[], done: string) => {
      const r = await $.process.run(['docker', ...args], { timeoutMs: 60_000 }).catch(err => ({ exitCode: -1, stdout: '', stderr: String(err) }))
      $.ui.toast(r.exitCode === 0 ? done : `docker: ${oneLine(r.stderr)}`)
      refresh()
    }
    const toggleLogs = async (c: Container) => {
      if (logs.delete(c.id)) return $.ui.invalidate('ui.render')
      const r = await $.process.run(['docker', 'logs', '--tail', '15', c.id], { timeoutMs: 15_000 }).catch(() => undefined)
      logs.set(c.id, `${r?.stdout ?? ''}\n${r?.stderr ?? ''}`.split(/\r?\n/).filter(Boolean).slice(-15))
      $.ui.invalidate('ui.render')
    }
    const setLang = async (code: Lang) => {
      await update($, lang, () => code)
      await $.store.set('lang', code)
      $.ui.invalidate('ui.render') // diğer sekmeler de yeni dille çizilsin
    }
    const startDesktop = async () => {
      await $.process.run(['pwsh', '-NoProfile', '-Command', `Start-Process '${DOCKER_DESKTOP}'`]).catch(() => undefined)
      $.ui.toast(t.desktopStarting)
    }

    const data = cache.data
    const groups: [string, Listener[]][] = data
      ? [
          [t.dev, data.listeners.filter(x => x.kind === 'dev')],
          [t.db, data.listeners.filter(x => x.kind === 'db')],
        ]
      : []
    // Diğer: yalnızca 49152 altı portu olanlar (üstü Windows'un geçici RPC portları)
    const other = data?.listeners.filter(x => x.kind === 'other' && x.ports.some(p => p < 49152)) ?? []

    const row = (x: Listener, killable: boolean) => {
      const ports = x.ports.map(p => `:${p}`).join(' ')
      return (
        <Box flexDirection="row" gap={1} paddingLeft={2}>
          <Text color="#b860e0">{ports}</Text>
          <Text>{x.name}</Text>
          <Text dimColor wrap="truncate-end">
            {oneLine(x.label, Math.max(6, width - ports.length - x.name.length - 18))}
          </Text>
          {killable && (
            <Button key={`kill-${x.pid}`} plain label={t.stop(x.name)} onPress={() => kill(x)}>
              <Text color="error">{confirm.isArmed(`kill-${x.pid}`) ? t.sure : '■'}</Text>
            </Button>
          )}
        </Box>
      )
    }

    const docker = data?.docker
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold>{t.servers}</Text>
            {cache.loading && <Text dimColor>{t.refreshing}</Text>}
            <Button key="sys-refresh" plain dimColor label={t.refresh} onPress={refresh} />
          </Box>
          {!data && <Text dimColor>{t.readingPorts}</Text>}
          {groups.map(([title, list]) =>
            list.length === 0 ? null : (
              <Box flexDirection="column">
                <Text color="subtle">{title}</Text>
                {list.map(x => row(x, true))}
              </Box>
            ),
          )}
          {data && groups.every(([, g]) => g.length === 0) && <Text dimColor>{t.noServers}</Text>}
          {other.length > 0 && (
            <Box flexDirection="column">
              <Button key="other" plain label={t.other} onPress={() => ((otherOpen = !otherOpen), $.ui.invalidate('ui.render'))}>
                <Text color="subtle">
                  {otherOpen ? '▾' : '▸'} {t.other} ({other.length})
                </Text>
              </Button>
              {otherOpen && other.map(x => row(x, false))}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Docker</Text>
          {!docker ? (
            <Text dimColor>{t.reading}</Text>
          ) : 'down' in docker ? (
            docker.down === 'missing' ? (
              <Text dimColor>{t.dockerMissing}</Text>
            ) : (
              <Box flexDirection="row" gap={1}>
                <Text dimColor>{t.dockerDown}</Text>
                <Button key="docker-desktop" plain label={t.startDesktop} onPress={startDesktop}>
                  <Text color="success">{t.startDesktop}</Text>
                </Button>
              </Box>
            )
          ) : docker.containers.length === 0 ? (
            <Text dimColor>{t.noContainers}</Text>
          ) : (
            docker.containers.map(c => {
              const up = c.state === 'running'
              const log = logs.get(c.id)
              return (
                <Box flexDirection="column" paddingLeft={2}>
                  <Box flexDirection="row" gap={1}>
                    <Text color={up ? 'success' : 'subtle'}>{up ? '●' : '○'}</Text>
                    <Text>{c.name}</Text>
                    <Text dimColor wrap="truncate-end">
                      {oneLine(`${c.image} · ${c.status}${c.ports ? ` · ${c.ports}` : ''}`, Math.max(8, width - c.name.length - 24))}
                    </Text>
                    {up ? (
                      <Button key={`dstop-${c.id}`} plain label={t.stop(c.name)} onPress={() => (confirm.press(`dstop-${c.id}`) ? dockerDo(['stop', c.id], t.stoppedToast(c.name)) : $.ui.invalidate('ui.render'))}>
                        <Text color="error">{confirm.isArmed(`dstop-${c.id}`) ? t.sure : '■'}</Text>
                      </Button>
                    ) : (
                      <Button key={`dstart-${c.id}`} plain label={t.start(c.name)} onPress={() => dockerDo(['start', c.id], t.startedToast(c.name))}>
                        <Text color="success">▶</Text>
                      </Button>
                    )}
                    <Button key={`dlog-${c.id}`} plain dimColor label={t.logs(c.name)} onPress={() => toggleLogs(c)}>
                      ≡
                    </Button>
                  </Box>
                  {log && (
                    <Box flexDirection="column" paddingLeft={2}>
                      {log.length === 0 && <Text dimColor>{t.noLogs}</Text>}
                      {log.map(line => (
                        <Text dimColor wrap="truncate-end">
                          {line}
                        </Text>
                      ))}
                    </Box>
                  )}
                </Box>
              )
            })
          )}
        </Box>

        <Box flexDirection="row" gap={1}>
          <Text bold>Dil · Language</Text>
          {LANGS.map(([code, name]) => (
            <Button key={`lang-${code}`} plain label={name} onPress={() => setLang(code)}>
              <Text color={l === code ? '#b860e0' : undefined} dimColor={l !== code}>
                {l === code ? '●' : '○'} {name}
              </Text>
            </Button>
          ))}
        </Box>
      </Box>
    )
  })
}
