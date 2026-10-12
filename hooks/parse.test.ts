import { expect, test } from 'claude-code/testing'

import { ago, resetLabel } from './info'
import { labelOf, parseContainers, parseListeners, parseLog, parseNumstat, parsePid, parseStatus, parseTodos, rankTodos, scriptsOf, todoPrompt } from './parse'

test('git çıktıları ayrıştırılır', async () => {
  const st = parseStatus('## main...origin/main [ahead 2, behind 1]\n M src/a.ts\n?? yeni.md\nR  eski.ts -> yeni.ts\n')
  expect(st.head).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
  expect(st.files.map(f => [f.code, f.path])).toEqual([[' M', 'src/a.ts'], ['??', 'yeni.md'], ['R ', 'yeni.ts']])
  expect(parseStatus('## No commits yet on dev\n').head).toEqual({ branch: 'dev', upstream: undefined, ahead: 0, behind: 0 })
  expect(parseStatus('## feature/x.y\n').head.branch).toBe('feature/x.y')

  const ns = parseNumstat('12\t3\tsrc/a.ts\n-\t-\tlogo.png\n')
  expect(ns.get('src/a.ts')).toEqual({ added: 12, removed: 3 })
  expect(ns.get('logo.png')).toEqual({ added: undefined, removed: undefined })

  expect(parseLog('a1b2c3d\t1700000000\tfix: login\ttab\n')).toEqual([{ hash: 'a1b2c3d', at: 1_700_000_000_000, subject: 'fix: login\ttab' }])
})

test('komutlar, PID ve TODO ayrıştırılır', async () => {
  expect(scriptsOf('{"scripts":{"dev":"vite","build":"tsc"}}')).toEqual(['dev', 'build'])
  expect(scriptsOf('bozuk')).toEqual([])
  expect(parsePid('__PID=4321\r\n> vite')).toBe(4321)
  expect(parsePid('vite')).toBeUndefined()

  const todos = parseTodos('src/a.ts:12:  // TODO: token süresi\nb.py:3:# FIXME veri kaybı\n')
  expect(todos).toEqual([
    { file: 'src/a.ts', line: 12, text: '// TODO: token süresi' },
    { file: 'b.py', line: 3, text: '# FIXME veri kaybı' },
  ])
  const ranked = rankTodos('İşte: [{"i":1,"p":3,"s":"Veri kaybı riski"},{"i":0,"p":1,"s":"Token süresi"}]', todos)
  expect(ranked.map(t => [t.priority, t.summary])).toEqual([[3, 'Veri kaybı riski'], [1, 'Token süresi']])
  // bozuk yanıt: ham satırlar, öncelik 0
  expect(rankTodos('üzgünüm', todos).map(t => [t.priority, t.summary])).toEqual([[0, '// TODO: token süresi'], [0, '# FIXME veri kaybı']])
})

test('dinleyen portlar ve docker ayrıştırılır', async () => {
  expect(labelOf('"C:\\Program Files\\nodejs\\node.exe" C:\\x\\luwi-admin\\node_modules\\vite\\bin\\vite.js')).toBe('luwi-admin')
  expect(labelOf('python.exe C:\\x\\api\\main.py --reload')).toBe('api/main.py')
  expect(labelOf(null)).toBe('')

  const ls = parseListeners(
    JSON.stringify([
      { port: 5173, pid: 10, name: 'node.exe', cmd: 'node C:\\x\\web\\node_modules\\vite\\bin\\vite.js' },
      { port: 3000, pid: 10, name: 'node.exe', cmd: 'node C:\\x\\web\\node_modules\\vite\\bin\\vite.js' },
      { port: 27017, pid: 20, name: 'mongod.exe', cmd: null },
      { port: 135, pid: 30, name: 'svchost.exe', cmd: null },
    ]),
  )
  expect(ls.map(l => [l.name, l.kind, l.ports, l.label])).toEqual([
    ['svchost', 'other', [135], ''],
    ['node', 'dev', [3000, 5173], 'web'],
    ['mongod', 'db', [27017], ''],
  ])
  expect(parseListeners('{"port":80,"pid":5,"name":"nginx.exe","cmd":null}').map(l => l.kind)).toEqual(['dev'])

  expect(parseContainers('{"ID":"ab","Names":"db","Image":"postgres:16","State":"running","Status":"Up 2 hours","Ports":"5432/tcp"}\nuyarı\n')).toEqual([
    { id: 'ab', name: 'db', image: 'postgres:16', state: 'running', status: 'Up 2 hours', ports: '5432/tcp' },
  ])
})

test('zaman ve sıfırlanma etiketleri dile göre yazılır', async () => {
  expect(ago(5 * 60_000)).toBe('5 dk')
  expect(ago(5 * 60_000, 'en')).toBe('5 min')
  expect(ago(3 * 86_400_000, 'en')).toBe('3 d')
  const monday = new Date(2026, 9, 12, 9, 5).toISOString() // 12 Ekim 2026 Pazartesi
  expect(resetLabel(monday, 0, 'tr')).toBe('Pzt 09:05')
  expect(resetLabel(monday, 0, 'en')).toBe('Mon 09:05')
  expect(todoPrompt([{ file: 'a.ts', line: 1, text: 'TODO' }], 'English')).toContain('English')
})
