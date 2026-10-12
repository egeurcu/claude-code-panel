import type { Call, Shell } from '../types'
import { T } from './i18n'
import type { Lang } from './i18n'

// Arka plan görevinin bitiş bildirimi: <task-id>…</task-id> … <status>…</status>
export const parseNotification = (text: string): { id: string; status: Shell['status']; outputFile?: string } | undefined => {
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]
  if (!id) return undefined
  const raw = /<status>([^<]+)<\/status>/.exec(text)?.[1] ?? 'completed'
  const status = raw === 'failed' || raw === 'killed' ? raw : 'completed'
  return { id, status, outputFile: /<output-file>([^<]+)<\/output-file>/.exec(text)?.[1] }
}

// Bash sonucunun model metnindeki çıktı dosyası yolu (…\tasks\<id>.output), varsa
export const outputFileOf = (text: string | undefined, id: string) =>
  text ? new RegExp(`([A-Za-z]:\\\\[^\\s"'<>]*?${id}\\.output)`).exec(text)?.[1] : undefined

// Bir çıktının son dolu satırı (ANSI renk kodları temizlenir)
export const lastLine = (text: string) =>
  text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n|\r/)
    .map(l => l.trim())
    .filter(Boolean)
    .pop() ?? ''

export type ToolStat = { tool: string; count: number; ms: number; errors: number }
export const toolStats = (calls: Call[], now: number): ToolStat[] => {
  const by = new Map<string, ToolStat>()
  for (const c of calls) {
    const s = by.get(c.tool) ?? { tool: c.tool, count: 0, ms: 0, errors: 0 }
    s.count += 1
    s.ms += (c.endedAt ?? now) - c.startedAt
    s.errors += c.isError ? 1 : 0
    by.set(c.tool, s)
  }
  return [...by.values()].sort((a, b) => b.ms - a.ms)
}

export type SessionRow = { id: string; project: string; title: string; lastAt: number; prompts: number }
// ~/.claude/history.jsonl: her prompt bir satır { display, timestamp, project, sessionId }.
// Yalnızca transcript'i duran (devam ettirilebilir) oturumlar, en yeniden eskiye.
export const parseSessions = (history: string, resumable: Set<string>, limit = 30): SessionRow[] => {
  const by = new Map<string, SessionRow>()
  for (const line of history.split('\n')) {
    let h: any
    try {
      h = JSON.parse(line)
    } catch {
      continue
    }
    if (!h?.sessionId || !resumable.has(h.sessionId)) continue
    const s = by.get(h.sessionId) ?? { id: h.sessionId, project: String(h.project ?? ''), title: '', lastAt: 0, prompts: 0 }
    s.prompts += 1
    s.lastAt = Math.max(s.lastAt, Number(h.timestamp) || 0)
    const text = String(h.display ?? '').replace(/\s+/g, ' ').trim()
    if (!s.title && text && !text.startsWith('/')) s.title = text
    by.set(h.sessionId, s)
  }
  return [...by.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, limit)
}

export const ago = (ms: number, lang: Lang = 'tr') => {
  const t = T[lang]
  return ms < 120_000 ? t.now
    : ms < 3_600_000 ? `${Math.round(ms / 60_000)} ${t.min}`
    : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)} ${t.hour}`
    : ms < 172_800_000 ? t.yesterday
    : `${Math.round(ms / 86_400_000)} ${t.day}`
}

// Limitin sıfırlanma anı: 24 saat içindeyse saat, değilse gün + saat
export const resetLabel = (iso: string | undefined, now: number, lang: Lang = 'tr') => {
  const d = iso ? new Date(iso) : undefined
  if (!d || Number.isNaN(d.getTime())) return ''
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.getTime() - now < 86_400_000 ? hm : `${T[lang].days[d.getDay()]} ${hm}`
}
