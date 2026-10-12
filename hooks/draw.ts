import type { Call } from '../types'

// Raster yardımcıları: her hücre [glif, ön renk, arka renk]; Grid hem Raster'ın
// base64 hücrelerini hem de Raster'sız yüzeyler için düz metni taşır.
export type Cell = [glyph: string, fg: number, bg: number]
export type Grid = { columns: number; rows: number; cells: string; text: string }

export const DEFAULT = 0x01000000
const DIM = 0x3d3846
export const RED = 0xe01b24

export const grid = (rows: Cell[][]): Grid => {
  const columns = Math.max(1, rows[0]?.length ?? 0)
  const words = new Uint32Array(columns * rows.length * 3)
  rows.flat().forEach(([g, fg, bg], i) => words.set([g.codePointAt(0)!, fg, bg], i * 3))
  return {
    columns,
    rows: rows.length,
    // toBase64 ortamda var, es2023 lib'inde tanımı yok
    cells: (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64(),
    text: rows.map(r => r.map(c => c[0]).join('')).join('\n'),
  }
}

const mix = (a: number, b: number, t: number) =>
  [16, 8, 0].reduce((c, s) => c | (Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s), 0)

// 0 yeşil → 0.5 sarı → 1 kırmızı
export const heat = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? mix(0x33d17a, 0xf6d32d, x * 2) : mix(0xf6d32d, RED, (x - 0.5) * 2)
}

export const gauge = (percent: number, width: number): Grid =>
  grid([
    Array.from({ length: width }, (_, i): Cell =>
      ((i + 0.5) / width) * 100 < percent ? ['█', heat(i / Math.max(1, width - 1)), DEFAULT] : ['░', DIM, DEFAULT],
    ),
  ])

export const toolColor = (tool: string) =>
  /^(Edit|Write|NotebookEdit|MultiEdit)$/.test(tool) ? 0x57e389
  : /^(Read|Glob|Grep|LS)$/.test(tool) ? 0x62a0ea
  : /^(Bash|PowerShell)$/.test(tool) ? 0xffa348
  : /^(Agent|Task)$/.test(tool) ? 0xc061cb
  : /^Web/.test(tool) ? 0x2ec27e
  : 0x9a9996

// Zaman çizelgesi: satır = ajan, sütun = [t0, t1] aralığının dilimi.
export const gantt = (lanes: Call[][], t0: number, t1: number, width: number): Grid => {
  const span = Math.max(1, t1 - t0)
  const col = (t: number) => Math.min(width - 1, Math.max(0, Math.floor(((t - t0) / span) * width)))
  return grid(
    lanes.map(lane => {
      const row: Cell[] = Array.from({ length: width }, () => ['·', DIM, DEFAULT])
      for (const c of lane) {
        for (let x = col(c.startedAt); x <= col(c.endedAt ?? t1); x++) {
          row[x] = ['█', c.isError ? RED : toolColor(c.tool), DEFAULT]
        }
      }
      return row
    }),
  )
}

// Ditto: elle çizilmiş piksel yorum; iki piksel satırı bir hücre (▀ / ▄).
const PAL: Record<string, number> = { o: 0xb860e0, k: 0x383838, h: 0xf8f8f8, e: 0x383838, m: 0x383838, w: 0x7fd4ff, g: 0xead2f7, d: 0x8a40b8 }
// Referans GIF'in 4 karesi, 1 GIF pikseli = 1 Raster pikseli (30×28 → 30 sütun × 14 satır):
// sola yatma, ezilme, yayılma, uzanma. e = göz, m = ağız.
const LEAN = [
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '.....kkk....kkk...............',
  '....khhok..koook..............',
  '...kohhhokkoooook.............',
  '..kooohhoooooooookk...........',
  '..kooooooooooooooookkkk.......',
  '.koooooooooooooooooooook......',
  '.kooooooooooooooooooooook.....',
  '.kooooooooooeooooooooooook....',
  '..kooooooooooooooooooooook....',
  '..kooooooooooooooooeoooook....',
  '...kooooooooooooooooooook.....',
  '...koooooooommmoooooooook.....',
  '....koooooooooommmooooook.....',
  '....koooooooooooooooooook.....',
  '....kooooooooooooooooooook....',
  '....kooooooooooooooooooook....',
  '...kooooooooooooooooooooook...',
  '...koooooooooooooooooooooook..',
  '..kooooooooooooooooooooooook..',
  '..kooooooooooooooooooooooook..',
  '..kooooooooooooooooooooooook..',
  '...koooooooooookkkkkkooookk...',
  '....kkkkkkkkkkk......kkkk.....',
]
const SQUAT = [
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '....kk........................',
  '..kkookk....kkkk..............',
  '.kooooookkkkhhookk............',
  '.koooooooohhhhooook...........',
  'kooooooooohhoooooookk..kkk....',
  'kooooooooooooooooooookkoook...',
  'kooooooooooooooooooooooooook..',
  'kooooooooooooooooooooooooook..',
  '.kooooooooooeooooooooooooook..',
  '.kooooooooooooooooeoooooook...',
  '.kkoooooooooooooooooooooook...',
  '..koooooooooooooooooooooook...',
  '..kkoooooooommmmmmoooooooook..',
  '...koooooooooooooooooooooook..',
  '...kooooooooooooooooooooooook.',
  '...koooooooooooooooooooooooook',
  '..kooooooooooooooooooooooooook',
  '..kooooooooooooooooooooooooook',
  '.koooooooooooooooooooooooooook',
  '.koooooooooooooooooooooooooook',
  '..kooooookkkkkkkkkkkooooooook.',
  '...kkkkkk...........kkkkkkkk..',
]
const SPREAD = [
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '........................kk....',
  '...............kkkk...kkookk..',
  '.............kkooookkkooooook.',
  '............koohhoooooooooook.',
  '.....kkk..kkohhhhooooooooooook',
  '....koookkooohhooooooooooooook',
  '...koooooooooooooooooooooooook',
  '...kooooooooooooooooooooooook.',
  '...koooooooooooooeooooooooook.',
  '..kooooooooeoooooooooooooook..',
  '..kooooooooooooooooooooooook..',
  '..koooooooooooooooooooooook...',
  '.koooooooooommmmmmooooooook...',
  '.kooooooooooooooooooooooook...',
  'kooooooooooooooooooooooooook..',
  'koooooooooooooooooooooooooook.',
  'koooooooooooooooooooooooooook.',
  'koooooooooooooooooooooooooook.',
  '.kkoooooooookkkkkkkkkooooook..',
  '...kkkkkkkkk.........kkkkkk...',
]
const REACH = [
  '..............................',
  '.......................kkkk...',
  '......................kooook..',
  '.....................kooooook.',
  '...............kkk...kooooook.',
  '..............koookkkoooooook.',
  '.............koohhooooooooook.',
  '...........kkohhhhooooooooook.',
  '........kkkooohhooooooooooook.',
  '......kkooooooooooooooooooook.',
  '.....koooooooooooooooooooook..',
  '....kooooooooooooeoooooooook..',
  '....kooooooooooooooooooooook..',
  '....koooooeoooooooooooooook...',
  '.....kooooooooooooooooooook...',
  '.....kooooooooommmooooooook...',
  '.....koooooommmooooooooook....',
  '.....koooooooooooooooooook....',
  '....kooooooooooooooooooook....',
  '....kooooooooooooooooooook....',
  '...koooooooooooooooooooook....',
  '...koooooooooooooooooooook....',
  '..koooooooooooooooooooooook...',
  '..koooooooooooooooooooooook...',
  '..kooooooooooooooooooooooook..',
  '..kooooooooooooooooooooooook..',
  '...kkooookkkkkooooooooooook...',
  '.....kkkk.....kkkkkkkkkkkk....',
]
const BLINK = SQUAT.map(r => r.replaceAll('e', 'o'))
const PUDDLE = [
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '.........kkkkkkkkkkk..........',
  '......kkkoooohhoooookkk.......',
  '....kkoooooooooooooooookk.....',
  '..kkooooooeooooooeooooooookk..',
  '.kooooooooommmmmmoooooooooook.',
  'kooooooooooooooooooooooooooook',
  'kooooooooooooooooooooooooooook',
  '.kkkkkkkkkkkkkkkkkkkkkkkkkkkk.',
]
const MINI = ['.kk.kk..', 'kohkook.', 'koeooeok', 'koommook', 'kooooook', '.kkkkkk.']

// Ter damlası: sağ üstte 2 piksel, y'den başlayarak
const sweat = (rows: string[], y: number) =>
  rows.map((r, i) => (i === y || i === y + 1 ? r.slice(0, 27) + 'w' + r.slice(28) : r))

// Dönüşen Ditto: araç çalışırken o aracın şekli, yüzü üstünde (2 kare; 30×28, çalışma kareleriyle aynı boy)
const TERMINAL = [
  [
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '...kkkkkkkkkkkkkkkkkkkkkkkk...',
    '..kooooooooooooooooooooooook..',
    '.koddddddddddddddddddddddddok.',
    '.koddhddhddhdddddddddddddddok.',
    '.koddddddddddddddddddddddddok.',
    '.kooooooooooooooooooooooooook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggdgggggggggggggggggggook.',
    '.koogggdggggggggggggggggggook.',
    '.kooggdggdddggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggegggggegggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.koogggggggggmmmmmggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooooooooooooooooooooooooook.',
    '..kooooooooooooooooooooooook..',
    '...koooookkkkkkkkkkkoooookk...',
    '....kkkkk...........kkkkk.....',
  ],
  [
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '...kkkkkkkkkkkkkkkkkkkkkkkk...',
    '..kooooooooooooooooooooooook..',
    '.koddddddddddddddddddddddddok.',
    '.koddhddhddhdddddddddddddddok.',
    '.koddddddddddddddddddddddddok.',
    '.kooooooooooooooooooooooooook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggdgggggggggggggggggggook.',
    '.koogggdggggggggggggggggggook.',
    '.kooggdgggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggegggggegggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.koogggggggggmmmmmggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooggggggggggggggggggggggook.',
    '.kooooooooooooooooooooooooook.',
    '..kooooooooooooooooooooooook..',
    '...koooookkkkkkkkkkkoooookk...',
    '....kkkkk...........kkkkk.....',
  ],
]
const PENCIL = [
  [
    '....................kddk......',
    '...................kddddk.....',
    '..................kddddddk....',
    '.................kooddddddk...',
    '................kooooddddddk..',
    '...............kooooooddddddk.',
    '..............kooooooooddddddk',
    '.............koooooooooodddddk',
    '............koooooooooooodddk.',
    '...........koooooooooooooodk..',
    '..........koooooooooooooook...',
    '.........koooooooooooooook....',
    '........koooooooooooooook.....',
    '.......koooooooooooooook......',
    '......kooooeoooooeooook.......',
    '.....koooooooooooooook........',
    '....koooooooooooooook.........',
    '...koooooooommmmmook..........',
    '..kgooooooooooooook...........',
    '..kggooooooooooook............',
    '..kgggooooooooook.............',
    '..kggggooooooook..............',
    '..kkggggooooook...............',
    '..kkkggggooook................',
    '..kkkkggggook.................',
    '..kkkkkggggk..................',
    '...kkkkkkkk...................',
    'ddd...........................',
  ],
  [
    '.....................kddk.....',
    '....................kddddk....',
    '...................kddddddk...',
    '..................kooddddddk..',
    '.................kooooddddddk.',
    '................kooooooddddddk',
    '...............koooooooodddddd',
    '..............kooooooooooddddd',
    '.............koooooooooooodddk',
    '............koooooooooooooodk.',
    '...........koooooooooooooook..',
    '..........koooooooooooooook...',
    '.........koooooooooooooook....',
    '........koooooooooooooook.....',
    '.......kooooeoooooeooook......',
    '......koooooooooooooook.......',
    '.....koooooooooooooook........',
    '....koooooooommmmmook.........',
    '...kgooooooooooooook..........',
    '...kggooooooooooook...........',
    '...kgggooooooooook............',
    '...kggggooooooook.............',
    '...kkggggooooook..............',
    '...kkkggggooook...............',
    '...kkkkggggook................',
    '...kkkkkggggk.................',
    '....kkkkkkkk..................',
    'dddddd........................',
  ],
]
const LENS = [
  [
    '..............................',
    '.........kkkkkkk..............',
    '.......kkoooooookk............',
    '......koooooooooook...........',
    '.....koooooooooooook..........',
    '....kooooogggggoooook.........',
    '...kooooghgggggggooook........',
    '...koooghgggggggggoook........',
    '..koooohggggggggggooook.......',
    '..kooogggggggggggggoook.......',
    '..koooggggegggeggggoook.......',
    '..kooogggggggggggggoook.......',
    '..kooogggggggggggggoook.......',
    '..koooggggmmmmmggggoook.......',
    '..koooogggggggggggooook.......',
    '...kooogggggggggggoook........',
    '...koooogggggggggooook........',
    '....kooooogggggoooooook.......',
    '.....koooooooooooooooook......',
    '......koooooooooooooooook.....',
    '.......kkoooooookkoooooook....',
    '.........kkkkkkk..koooooook...',
    '...................koooooook..',
    '....................koooooook.',
    '.....................koooooook',
    '......................kooooook',
    '.......................kooook.',
    '........................kook..',
  ],
  [
    '..............................',
    '........kkkkkkk...............',
    '......kkoooooookk.............',
    '.....koooooooooook............',
    '....koooooooooooook...........',
    '...kooooogggggoooook..........',
    '..kooooghgggggggooook.........',
    '..koooghgggggggggoook.........',
    '.koooohggggggggggooook........',
    '.kooogggggggggggggoook........',
    '.koooggggegggeggggoook........',
    '.kooogggggggggggggoook........',
    '.kooogggggggggggggoook........',
    '.koooggggmmmmmggggoook........',
    '.koooogggggggggggooook........',
    '..kooogggggggggggoook.........',
    '..koooogggggggggooook.........',
    '...kooooogggggoooooook........',
    '....koooooooooooooooook.......',
    '.....koooooooooooooooook......',
    '......kkoooooookkoooooook.....',
    '........kkkkkkk..koooooook....',
    '..................koooooook...',
    '...................koooooook..',
    '....................koooooook.',
    '.....................kooooook.',
    '......................kooook..',
    '.......................kook...',
  ],
]
const GLOBE = [
  [
    '..............................',
    '..............................',
    '............kkkkkkk...........',
    '..........kkodddddokk.........',
    '........kkooodooodoookk.......',
    '.......koooodooooodooook......',
    '......kooohodooooodoooook.....',
    '.....kooohodooooooodoooook....',
    '.....kddhddddddddddddddddk....',
    '....koooooodooooooodooooook...',
    '....koooooodooooooodooooook...',
    '...kooooooodooooooodoooooook..',
    '...kooooooodooooooodoooooook..',
    '...kooooooooeoooooeooooooook..',
    '...koooooooooooooooooooooook..',
    '...koooooooooooooooooooooook..',
    '...kooooooodommmmmodoooooook..',
    '...kooooooodooooooodoooooook..',
    '....koooooodooooooodooooook...',
    '....koooooodooooooodooooook...',
    '.....kdddddddddddddddddddk....',
    '.....kooooodooooooodoooook....',
    '......kooooodooooodoooook.....',
    '.......koooodooooodooook......',
    '........kkooodooodoookk.......',
    '..........kkodddddokk.........',
    '............kkkkkkk...........',
    '..............................',
  ],
  [
    '..............................',
    '..............................',
    '............kkkkkkk...........',
    '..........kkdddddddkk.........',
    '........kkdddooooodddkk.......',
    '.......kodddooooooodddok......',
    '......koodhoooooooooddook.....',
    '.....koodhoooooooooooddook....',
    '.....kddhddddddddddddddddk....',
    '....kooodooooooooooooodoook...',
    '....kooddoooooooooooooddook...',
    '...koooddoooooooooooooddoook..',
    '...kooodooooooooooooooodoook..',
    '...kooodooooeoooooeoooodoook..',
    '...kooodooooooooooooooodoook..',
    '...kooodooooooooooooooodoook..',
    '...kooodooooommmmmooooodoook..',
    '...koooddoooooooooooooddoook..',
    '....kooddoooooooooooooddook...',
    '....kooodooooooooooooodoook...',
    '.....kdddddddddddddddddddk....',
    '.....kooddoooooooooooddook....',
    '......kooddoooooooooddook.....',
    '.......kodddooooooodddok......',
    '........kkdddooooodddkk.......',
    '..........kkdddddddkk.........',
    '............kkkkkkk...........',
    '..............................',
  ],
]

export type Mood = 'idle' | 'work' | 'error' | 'sweat' | 'shell' | 'edit' | 'read' | 'web'

// Bir durumun karelerini ortak üst boşluklarından kırpar (alta hizalı kalır): beklerken
// Ditto uzanma payı kadar boşluk taşımaz; durum değişince Raster yeniden boyutlanır.
const trim = (frames: string[][]) => {
  const top = Math.min(...frames.map(f => f.findIndex(r => /[^.]/.test(r))))
  return frames.map(f => f.slice(top))
}

export const MOODS: Record<Mood, { ms: number; frames: string[][] }> = {
  idle: { ms: 400, frames: trim([SQUAT, SQUAT, SQUAT, SQUAT, SPREAD, SQUAT, SQUAT, BLINK]) },
  work: { ms: 110, frames: trim([LEAN, SQUAT, SPREAD, REACH]) },
  error: { ms: 0, frames: trim([PUDDLE]) },
  sweat: { ms: 500, frames: trim([sweat(SQUAT, 4), sweat(SQUAT, 6)]) },
  shell: { ms: 450, frames: TERMINAL },
  edit: { ms: 300, frames: PENCIL },
  read: { ms: 400, frames: LENS },
  web: { ms: 450, frames: GLOBE },
}

const FORMS: [RegExp, Mood][] = [
  [/^(Bash|PowerShell)$/, 'shell'],
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/, 'edit'],
  [/^(Read|Grep|Glob|LS)$/, 'read'],
  [/^Web/, 'web'],
]
const formOf = (tool: string) => FORMS.find(([re]) => re.test(tool))?.[1]

// Çalışan subagent başına küçük bir Ditto kopyası (yan yana)
export const minis = (n: number) => MINI.map(r => Array(n).fill(r).join('.'))

export const mood = (calls: Call[], contextPercent: number, isWorking: boolean, now = 0): Mood => {
  const isRunning = calls.some(c => c.endedAt === undefined)
  const last = calls.findLast(c => c.endedAt !== undefined)
  if (!isRunning && last?.isError) return 'error'
  // Ana döngünün çalışan (ya da 1,5 sn içinde biten) aracına dönüşür; hızlı araçlarda titremez
  const main = calls.findLast(c => !c.agentId && (c.endedAt === undefined || now - c.endedAt < 1500))
  const form = main && (isWorking || isRunning) ? formOf(main.tool) : undefined
  if (form) return form
  if (isWorking || isRunning) return 'work'
  return contextPercent >= 90 ? 'sweat' : 'idle'
}

export const pixels = (px: string[]): Cell[][] => {
  const out: Cell[][] = []
  for (let y = 0; y < px.length; y += 2) {
    out.push(
      [...px[y]!].map((t, x): Cell => {
        const top = PAL[t]
        const bottom = PAL[px[y + 1]?.[x] ?? '.']
        if (top === undefined) return bottom === undefined ? [' ', DEFAULT, DEFAULT] : ['▄', bottom, DEFAULT]
        return ['▀', top, bottom ?? DEFAULT]
      }),
    )
  }
  return out
}
