export type Call = {
  id: string
  tool: string
  target: string
  agentId?: string
  startedAt: number
  endedAt?: number
  isError?: boolean
}
export type FileTouch = { edits: number; lastAt: number }
export type Usage = {
  percent: number
  tokens: number
  window: number
  fiveHour?: number
  sevenDay?: number
  fiveHourResetsAt?: string
  sevenDayResetsAt?: string
  costUsd?: number
}
export type Turn = { id: string; startedAt: number; endedAt?: number }
export type Shell = {
  id: string
  command: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'completed' | 'failed' | 'killed'
  outputFile?: string
}

export type ScriptRun = {
  status: 'running' | 'done' | 'failed' | 'killed'
  startedAt: number
  pid?: number
  code?: number | null
  lines: string[]
}

declare module 'claude-code' {
  interface PluginState {
    panel: {
      scripts: Record<string, ScriptRun>
      calls: Call[]
      files: Record<string, FileTouch>
      shells: Shell[]
      usage: Usage | null
      turn: Turn | null
      mascotOn: boolean
      graphifyBusy: boolean
      lang: 'tr' | 'en'
    }
  }
}
