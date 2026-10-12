import { expect, test } from 'claude-code/testing'

import { MOODS, gauge, minis, mood, pixels } from './draw'
import { outputFileOf, parseNotification, parseSessions, toolStats } from './info'

test('gösterge %0 boş, %100 dolu; Ditto kareleri eşit boyutta', async () => {
  expect(gauge(0, 10).text).toBe('░'.repeat(10))
  expect(gauge(100, 10).text).toBe('█'.repeat(10))
  for (const m of Object.values(MOODS)) {
    for (const f of m.frames) expect(f.map(r => r.length)).toEqual(Array(m.frames[0]!.length).fill(30))
  }
  // beklerken üst boşluk kırpılır, çalışırken uzanma payı kalır
  expect(pixels(MOODS.idle.frames[0]!).length).toBe(11)
  expect(pixels(MOODS.work.frames[0]!).length).toBe(14)
  expect(minis(2).map(r => r.length)).toEqual(Array(6).fill(17))

  // dönüşen Ditto: ana döngüde çalışan araca göre biçim
  const call = (tool: string, extra = {}) => ({ id: tool, tool, target: '', startedAt: 0, ...extra })
  expect(mood([call('Bash')], 0, true, 10)).toBe('shell')
  expect(mood([call('Edit')], 0, true, 10)).toBe('edit')
  expect(mood([call('Read', { endedAt: 9000 })], 0, true, 10_000)).toBe('read') // 1,5 sn tutulur
  expect(mood([call('Read', { endedAt: 1000 })], 0, true, 10_000)).toBe('work')
  expect(mood([call('Bash', { agentId: 'sub' })], 0, true, 10)).toBe('work') // subagent'ın aracı değil
})

test('bildirim, çıktı yolu, araç istatistiği ve oturum listesi çözümlenir', async () => {
  const note = '<task-notification>\n<task-id>b1</task-id>\n<output-file>C:\\T\\tasks\\b1.output</output-file>\n<status>failed</status>'
  expect(parseNotification(note)).toEqual({ id: 'b1', status: 'failed', outputFile: 'C:\\T\\tasks\\b1.output' })
  expect(parseNotification('merhaba')).toBeUndefined()
  expect(outputFileOf('Output is being written to: C:\\T\\tasks\\b1.output', 'b1')).toBe('C:\\T\\tasks\\b1.output')

  const stats = toolStats(
    [
      { id: '1', tool: 'Read', target: '', startedAt: 0, endedAt: 100 },
      { id: '2', tool: 'Bash', target: '', startedAt: 0, endedAt: 5000, isError: true },
      { id: '3', tool: 'Read', target: '', startedAt: 0, endedAt: 100 },
    ],
    9999,
  )
  expect(stats).toEqual([
    { tool: 'Bash', count: 1, ms: 5000, errors: 1 },
    { tool: 'Read', count: 2, ms: 200, errors: 0 },
  ])

  const line = (o: object) => JSON.stringify(o)
  const history = [
    line({ display: '/resume', timestamp: 1, project: 'C:\\a', sessionId: 'A' }),
    line({ display: 'Excel alanı ekle', timestamp: 2, project: 'C:\\a', sessionId: 'A' }),
    line({ display: 'eski', timestamp: 5, project: 'C:\\b', sessionId: 'B' }),
    line({ display: 'silinmiş', timestamp: 9, project: 'C:\\c', sessionId: 'GONE' }),
  ].join('\n')
  expect(parseSessions(history, new Set(['A', 'B']))).toEqual([
    { id: 'B', project: 'C:\\b', title: 'eski', lastAt: 5, prompts: 1 },
    { id: 'A', project: 'C:\\a', title: 'Excel alanı ekle', lastAt: 2, prompts: 2 },
  ])
})

const PANE = {
  plugin: 'panel', component: 'Pane', requestId: 'panel',
  props: { title: 'Panel', isFocused: false, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const run = (command: string) =>
  ({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } }) as any

test('hatalı araç akışta ✗ olur, Ditto panelde erir ve butonla gizlenir', async ($, on) => {
  on('tool.call', (_$, e: any) =>
    e.command === 'git push' ? ({ isError: true, result: null, text: 'rejected' } as any) : ({ result: 'ok' } as any),
  )
  let now = 1_000_000
  on('clock.now', () => ({ value: (now += 500) }) as any)
  on('agent.list', () => ({ value: [] }) as any)
  on('session.cwd', () => ({ value: 'C:/x' }) as any)
  on('fs.exists', () => ({ value: false }) as any)
  on('store.set', () => ({ value: undefined }) as any)
  on('clock.every', () => ({ value: undefined }) as any) // Ditto animasyonu testte dönmesin

  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
  await $.tool.call({ tool: 'Bash', command: 'git push' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface } as any)
    expect(await pane.find({ text: 'Ajanlar' })).toBeDefined()
    expect(await pane.find({ text: /✗ Bash/ })).toBeDefined()
    expect(await pane.find({ text: /eridi/ })).toBeDefined()
    expect(await pane.find({ text: 'Araç istatistiği' })).toBeDefined()
    await pane.unmount()
  }

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await pane.press({ key: 'ditto' })
  expect(await pane.find({ text: /eridi/ })).toBeUndefined()
  expect(await pane.find({ key: 'ditto' })).toMatchObject({ props: { label: "Ditto'yu göster" } })
})

test('arka plan shell: sonuçla eklenir, bildirimle biter', async ($, on) => {
  on('tool.call', () =>
    ({
      result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
      text: 'Command running in background with ID: b1. Output is being written to: C:\\T\\tasks\\b1.output',
    }) as any,
  )
  let now = 1_000_000
  on('clock.now', () => ({ value: (now += 500) }) as any)
  on('agent.list', () => ({ value: [] }) as any)
  on('session.cwd', () => ({ value: 'C:/x' }) as any)
  on('fs.exists', (_$, e: any) => ({ value: String(e.path).endsWith('b1.output') }) as any)
  on('fs.stat', () => ({ value: { kind: 'file', size: 20, mtimeMs: 0, isLink: false } }) as any)
  on('fs.read', () => ({ value: 'derleniyor\n\x1b[32m42/100 test\x1b[0m\n' }) as any)
  on('prompt.submit', (_$, e: any) => ({ text: e.text }) as any)
  on('clock.every', () => ({ value: undefined }) as any)

  await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true } as any)
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await pane.find({ text: /npm test/ })).toBeDefined()
  expect(await pane.find({ text: /42\/100 test/ })).toBeDefined()
  await pane.unmount()

  await $.prompt.submit({
    text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>',
    origin: { kind: 'task-notification' },
    wait: false,
  } as any)
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await pane.find({ text: /arka planda/ })).toBeUndefined()
  expect(await pane.find({ text: /npm test/ })).toBeDefined()
})

test('sessions: gruplu liste, yeni PowerShell sekmesi, onaylı silme', async ($, on) => {
  const line = (o: object) => JSON.stringify(o)
  on('env.get', (_$, e: any) => ({ value: e.name === 'WT_PROFILE_ID' ? '{574e775e-4f2a-5b96-ac1e-a2962a402336}' : 'C:/u' }) as any)
  on('clock.now', () => ({ value: 10 * 3_600_000 }) as any)
  on('session.id', () => ({ value: 'CUR' }) as any)
  on('fs.exists', () => ({ value: true }) as any)
  on('fs.list', (_$, e: any) =>
    ({
      value: String(e.path).endsWith('projects')
        ? [{ name: 'C--a', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
        : ['A.jsonl', 'CUR.jsonl', 'U.jsonl', 'R.jsonl'].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
    }) as any,
  )
  on('fs.read', () =>
    ({
      value: [
        line({ display: 'Excel alanı ekle', timestamp: 3_600_000, project: 'C:\\x\\luwi', sessionId: 'A' }),
        line({ display: 'panel', timestamp: 9 * 3_600_000, project: 'C:\\x\\luwi', sessionId: 'CUR' }),
        line({ display: '/resume', timestamp: 2 * 3_600_000, project: 'C:\\x\\luwi', sessionId: 'U' }),
        // son 1 saatte kullanılmış: toplu temizliğe girmez
        line({ display: '/model', timestamp: 9.5 * 3_600_000, project: 'C:\\x\\luwi', sessionId: 'R' }),
      ].join('\n'),
    }) as any,
  )
  const argv: string[][] = []
  on('process.run', (_$, e: any) => (argv.push([...e.argv]), { value: { exitCode: 0, stdout: '', stderr: '' } }) as any)

  const pane = await $.ui.mount({
    plugin: 'panel', surface: 'terminal', component: 'Pane', requestId: 'oturumlar',
    props: { title: 'Sessions', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as any)
  expect(await pane.find({ text: 'luwi' })).toBeDefined()
  expect(await pane.find({ text: /açık/ })).toBeDefined()
  await pane.press({ key: 's-A' })
  expect(argv).toEqual([['pwsh', '-NoProfile', '-Command', "& wt.exe -w 0 nt -p '{574e775e-4f2a-5b96-ac1e-a2962a402336}' -d 'C:\\x\\luwi' pwsh -NoExit -Command claude --resume A"]])
  // proje başlığı aç/kapa
  await pane.press({ key: 'p-C:\\x\\luwi' })
  expect(await pane.find({ key: 's-A' })).toBeUndefined()
  await pane.press({ key: 'p-C:\\x\\luwi' })
  expect(await pane.find({ key: 's-A' })).toBeDefined()

  // tek silme: × önce onay sorar, Vazgeç hiçbir şey silmez
  argv.length = 0
  await pane.press({ key: 'del-A' })
  expect(await pane.find({ text: /silinsin mi/ })).toBeDefined()
  await pane.press({ key: 'del-no' })
  expect(argv).toEqual([])
  await pane.press({ key: 'del-A' })
  await pane.press({ key: 'del-yes' })
  expect(argv[0]!.slice(0, 3)).toEqual(['pwsh', '-NoProfile', '-Command'])
  expect(argv[0]![3]).toContain("'C:\\u\\.claude\\projects\\C--a\\A.jsonl'")
  expect(argv[0]![3]).toContain('SendToRecycleBin')

  // toplu temizlik: yalnızca eski başlıksız oturum (U); R yeni, CUR bu oturum
  argv.length = 0
  await pane.press({ key: 'clean' })
  expect(await pane.find({ text: /1 başlıksız oturum silinsin mi/ })).toBeDefined()
  await pane.press({ key: 'del-yes' })
  expect(argv[0]![3]).toContain('U.jsonl')
  expect(argv[0]![3]).not.toContain('R.jsonl')
  expect(argv[0]![3]).not.toContain('CUR.jsonl')
})

test('/panel paneli açar ve kapatır', async ($, on) => {
  const open = new Set<string>()
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true })) }) as any)
  on('ui.open', (_$, e: any) => (open.add(e.id), { value: { isPlaced: true } }) as any)
  on('ui.close', (_$, e: any) => (open.delete(e.id), { value: undefined }) as any)
  expect((await $.command.run(run('panel'))).text).toBe('Panel açıldı.')
  expect((await $.command.run(run('panel'))).text).toBe('Panel kapandı.')
})
