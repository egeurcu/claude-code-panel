import { expect, test } from 'claude-code/testing'

const pane = (requestId: string) =>
  ({
    plugin: 'panel', surface: 'terminal', component: 'Pane', requestId,
    props: { title: requestId, isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  }) as any

const ok = (stdout = '', exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr } }) as any

test('Code: git, diff, komutlar (varsayılan kapalı) ve TODO avcısı', async ($, on) => {
  const runs: string[][] = []
  on('session.cwd', () => ({ value: 'C:/p' }) as any)
  on('clock.now', () => ({ value: 2_000_000_000_000 }) as any)
  on('fs.exists', () => ({ value: true }) as any)
  on('fs.read', () => ({ value: '{"scripts":{"dev":"vite","build":"tsc"}}' }) as any)
  on('process.run', (_$, e: any) => {
    const a: string[] = e.argv
    runs.push(a)
    const cmd = a.slice(0, 3).join(' ')
    if (cmd === 'git status --porcelain=v1') return ok('## main...origin/main [ahead 1]\n M a.ts\n')
    if (a.join(' ') === 'git diff HEAD --numstat') return ok('3\t1\ta.ts\n')
    if (a[1] === 'log') return ok('abc1234\t1999999000\tfix: giriş\n')
    if (a.join(' ') === 'git diff HEAD -- a.ts') return ok('diff --git a/a.ts b/a.ts\nindex 1..2\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-eski\n+yeni\n')
    if (a[1] === 'grep') return ok('a.ts:2:// TODO token\nb.ts:9:// FIXME veri\n')
    return ok()
  })
  // test kiti butonun başlattığı akışın bitmesini bekler: script hemen hata koduyla biter
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: '__PID=777\r\nVITE hazır\r\n' }
    return { value: { code: 1, signal: null } }
  } as any)
  on('model.complete', () => ({ value: { isAnswered: true, text: '[{"i":1,"p":3,"s":"Veri kaybı"},{"i":0,"p":1,"s":"Token"}]', usage: {} } }) as any)
  const fills: string[] = []
  on('prompt.fill', (_$, e: any) => (fills.push(e.text), { isFilled: true }) as any)

  let ui = await $.ui.mount(pane('code'))
  await ui.unmount()
  ui = await $.ui.mount(pane('code')) // ilk çizim git'i arka planda okur, ikincisi sonucu gösterir
  expect(await ui.find({ text: /main/ })).toBeDefined()
  expect(await ui.find({ text: /fix: giriş/ })).toBeDefined()

  // dosyaya bas → diff açılır
  await ui.press({ key: 'f-a.ts' })
  expect(await ui.find({ type: 'Code' })).toBeDefined()

  // komutlar varsayılan kapalı
  expect(await ui.find({ key: 'run-dev' })).toBeUndefined()
  await ui.press({ key: 'scripts' })
  await ui.press({ key: 'run-dev' })
  expect(await ui.find({ text: /VITE hazır/ })).toBeDefined()
  expect(await ui.find({ text: /çıkış 1/ })).toBeDefined()

  // TODO avcısı: Haiku sıralar, satıra basınca prompt doldurulur
  await ui.press({ key: 'todo-scan' })
  expect(await ui.find({ text: /Veri kaybı/ })).toBeDefined()
  await ui.press({ key: 'todo-0' })
  expect(fills).toEqual(["b.ts:9 içindeki TODO'yu çöz: // FIXME veri"])
})

test('System: gruplu portlar, iki adımlı durdurma, Docker kapalı', async ($, on) => {
  const runs: string[][] = []
  const stored: [string, unknown][] = []
  on('store.set', (_$, e: any) => (stored.push([e.key, e.value]), { value: undefined }) as any)
  on('ui.toast', () => ({ value: undefined }) as any)
  on('clock.now', () => ({ value: 1000 }) as any)
  on('process.run', (_$, e: any) => {
    const a: string[] = e.argv
    runs.push(a)
    if (a[0] === 'pwsh')
      return ok(
        JSON.stringify([
          { port: 5173, pid: 10, name: 'node.exe', cmd: 'node C:\\x\\web\\node_modules\\vite\\bin\\vite.js' },
          { port: 135, pid: 30, name: 'svchost.exe', cmd: null },
        ]),
      )
    if (a[0] === 'docker') return ok('', 1, 'failed to connect to the docker API')
    return ok()
  })
  let ui = await $.ui.mount(pane('system'))
  await ui.unmount()
  ui = await $.ui.mount(pane('system'))
  expect(await ui.find({ text: /:5173/ })).toBeDefined()
  expect(await ui.find({ text: /web/ })).toBeDefined()
  expect(await ui.find({ text: /svchost/ })).toBeUndefined() // Diğer kapalı
  expect(await ui.find({ key: 'docker-desktop' })).toBeDefined()

  await ui.press({ key: 'kill-10' })
  expect(runs.some(a => a[0] === 'taskkill')).toBe(false)
  await ui.press({ key: 'kill-10' })
  expect(runs.find(a => a[0] === 'taskkill')).toEqual(['taskkill', '/PID', '10', '/T', '/F'])

  // dil seçimi: İngilizce'ye geçer ve kalıcı olarak saklanır
  expect(await ui.find({ text: /Sunucular/ })).toBeDefined()
  await ui.press({ key: 'lang-en' })
  expect(await ui.find({ text: /Servers/ })).toBeDefined()
  expect(stored).toEqual([['lang', 'en']])
})
