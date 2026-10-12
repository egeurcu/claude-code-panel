// Code ve System sekmelerinin komut çıktısı ayrıştırıcıları (saf, test edilebilir)

export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

// --- Git ---------------------------------------------------------------------

export type GitHead = { branch: string; upstream?: string; ahead: number; behind: number }
export type GitFile = { path: string; code: string; added?: number; removed?: number }

// `git status --porcelain=v1 -b`: ilk satır "## main...origin/main [ahead 2, behind 1]"
export const parseStatus = (text: string): { head: GitHead; files: GitFile[] } => {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const first = (lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : '').replace(/^(No commits yet on |Initial commit on )/, '')
  const counts = /\[(.*)\]$/.exec(first)?.[1] ?? ''
  const [branch, upstream] = first.replace(/\s*\[.*\]$/, '').split('...')
  const ahead = Number(/ahead (\d+)/.exec(counts)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(counts)?.[1] ?? 0)
  const files = lines.map(l => {
    const code = l.slice(0, 2)
    const rest = l.slice(3)
    const path = rest.includes(' -> ') ? rest.split(' -> ')[1]! : rest
    return { path: path.replace(/^"|"$/g, ''), code }
  })
  return { head: { branch: branch || '?', upstream, ahead, behind }, files }
}

// `git diff HEAD --numstat`: "12\t3\tpath" (ikili dosyada "-\t-\tpath")
export const parseNumstat = (text: string) => {
  const map = new Map<string, { added?: number; removed?: number }>()
  for (const l of text.split(/\r?\n/)) {
    const [a, r, ...p] = l.split('\t')
    if (!p.length) continue
    const path = p.join('\t').replace(/^.*=> /, '').replace(/[{}]/g, '')
    map.set(path, { added: a === '-' ? undefined : Number(a), removed: r === '-' ? undefined : Number(r) })
  }
  return map
}

export type Commit = { hash: string; subject: string; at: number }
// `git log -5 --format=%h%x09%ct%x09%s`
export const parseLog = (text: string): Commit[] =>
  text
    .split(/\r?\n/)
    .filter(Boolean)
    .map(l => {
      const [hash, ct, ...s] = l.split('\t')
      return { hash: hash ?? '', at: Number(ct) * 1000, subject: s.join('\t') }
    })

// --- Komutlar ---------------------------------------------------------------

export const parsePid = (text: string) => {
  const m = /__PID=(\d+)/.exec(text)
  return m ? Number(m[1]) : undefined
}

export const scriptsOf = (packageJson: string): string[] => {
  try {
    const s = JSON.parse(packageJson)?.scripts
    return s && typeof s === 'object' ? Object.keys(s) : []
  } catch {
    return []
  }
}

// --- TODO avcısı -------------------------------------------------------------

export type Todo = { file: string; line: number; text: string }
export type RankedTodo = Todo & { priority: number; summary: string }

// `git grep -n -I -E "TODO|FIXME|HACK|XXX"`: "yol:satır:metin"
export const parseTodos = (text: string): Todo[] =>
  text
    .split(/\r?\n/)
    .map(l => /^(.+?):(\d+):(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({ file: m[1]!, line: Number(m[2]), text: m[3]!.trim() }))

export const todoPrompt = (todos: Todo[], language = 'Türkçe') =>
  [
    'Aşağıda bir kod tabanındaki TODO/FIXME/HACK/XXX satırları numaralı olarak var.',
    'Her biri için önem derecesi ver (3 = hata/güvenlik/veri kaybı riski, 2 = eksik özellik, 1 = temizlik/kozmetik)',
    `ve en fazla 8 kelimelik bir özet yaz; özet dili: ${language}.`,
    'Yalnızca JSON dizi döndür, başka hiçbir şey yazma: [{"i": numara, "p": 1-3, "s": "özet"}]',
    '',
    ...todos.map((t, i) => `${i}. ${t.file}:${t.line} ${t.text.slice(0, 200)}`),
  ].join('\n')

// Haiku yanıtı: metindeki ilk JSON dizi; bozuksa ya da eksikse kalanlar özetsiz, öncelik 0
export const rankTodos = (reply: string, todos: Todo[]): RankedTodo[] => {
  let rows: any[] = []
  try {
    rows = JSON.parse(/\[[\s\S]*\]/.exec(reply)?.[0] ?? '[]')
  } catch {
    rows = []
  }
  const by = new Map<number, { p: number; s: string }>()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (Number.isInteger(r?.i) && todos[r.i]) by.set(r.i, { p: Math.min(3, Math.max(1, Number(r.p) || 1)), s: String(r.s ?? '') })
  }
  return todos
    .map((t, i) => ({ ...t, priority: by.get(i)?.p ?? 0, summary: by.get(i)?.s || t.text }))
    .sort((a, b) => b.priority - a.priority)
}

// --- Sunucular ---------------------------------------------------------------

export type Listener = { pid: number; name: string; ports: number[]; label: string; kind: 'dev' | 'db' | 'other' }

const DEV = /^(node|python\d*|pythonw|py|dotnet|java|javaw|php|php-cgi|deno|bun|ruby|go|uvicorn|gunicorn|nginx|httpd|caddy|vite|esbuild)$/i
const DB = /^(mongod|sqlservr|postgres|mysqld|mariadbd|redis-server|memurai|elasticsearch|clickhouse)$/i

// Komut satırından okunur bir etiket: script'in klasörü ya da node_modules'tan önceki proje adı
export const labelOf = (cmd: string | null | undefined) => {
  if (!cmd) return ''
  const tokens = (cmd.match(/"[^"]+"|\S+/g) ?? []).slice(1).map(t => t.replace(/^"|"$/g, ''))
  const path = tokens.find(t => /[\\/]/.test(t) && !/^-/.test(t))
  if (!path) return tokens.join(' ').slice(0, 40)
  const parts = path.split(/[\\/]/).filter(Boolean)
  const nm = parts.indexOf('node_modules')
  if (nm > 0) return parts[nm - 1]!
  return /\.\w+$/.test(parts.at(-1) ?? '') ? `${parts.at(-2) ?? ''}/${parts.at(-1)}` : (parts.at(-1) ?? '')
}

// pwsh çıktısı: [{ port, pid, name, cmd }] (tek kayıtta dizi değil nesne gelir)
export const parseListeners = (json: string): Listener[] => {
  let rows: any
  try {
    rows = JSON.parse(json || '[]')
  } catch {
    return []
  }
  const by = new Map<number, Listener>()
  for (const r of Array.isArray(rows) ? rows : [rows]) {
    const pid = Number(r?.pid)
    if (!pid) continue
    const name = String(r.name ?? '?').replace(/\.exe$/i, '')
    const l = by.get(pid) ?? { pid, name, ports: [], label: labelOf(r.cmd), kind: DEV.test(name) ? 'dev' : DB.test(name) ? 'db' : 'other' }
    if (!l.ports.includes(Number(r.port))) l.ports.push(Number(r.port))
    by.set(pid, l)
  }
  return [...by.values()].map(l => ({ ...l, ports: l.ports.sort((a, b) => a - b) })).sort((a, b) => a.ports[0]! - b.ports[0]!)
}

// --- Docker ------------------------------------------------------------------

export type Container = { id: string; name: string; image: string; state: string; status: string; ports: string }

// `docker ps -a --format "{{json .}}"`: satır başına bir JSON
export const parseContainers = (text: string): Container[] =>
  text
    .split(/\r?\n/)
    .filter(l => l.trim().startsWith('{'))
    .flatMap(l => {
      try {
        const c = JSON.parse(l)
        return [{ id: c.ID, name: c.Names, image: c.Image, state: c.State, status: c.Status, ports: c.Ports ?? '' }]
      } catch {
        return []
      }
    })
