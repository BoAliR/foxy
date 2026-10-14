export type StageRow = { title: string; done: number; total: number; state: 'done' | 'now' | 'later' }
export type OpenList = { head: string; kind: 'doing' | 'owner' | 'todo'; items: string[]; more: number }
export type FoxyView = {
  text: string
  board: string
  status: string
  goal: string
  percent: number
  done: number
  waits: number
  ours: number
  now: string
  stages: StageRow[]
  lists: OpenList[]
  updated: string
  focus?: string
  isFocusSide?: boolean
}
export type SubTask = { t: string; s: string; who?: string }
export type Task = { t: string; s: string; note: string; sub?: SubTask[] }
export type TaskStage = { title: string; items: Task[] }
export type Agent = { key: string; name: string; cli: string; done: number; total: number; tokens: number; isActive: boolean; costume?: string; session?: string }
export type Frog = { line: string; act: 'idle' | 'jump' | 'tongue' | 'spin' | 'big' | 'dance'; frame: number; isBig: boolean; said: number }
export type Note = { id: number; from: string; text: string; at: number }
export type Mate = { name: string; on: boolean; got: number; seen: number }
export type Mark = { local: string; title: string; place?: string }
export type Convo = { local: string; cli: string; title: string; place: string; lastMs: number }
export type Tale = { line: string; text: string }
export type Picked = { stage: string; filter: string; tab?: string; open?: string; seen?: string }

declare module 'claude-code' {
  interface PluginState {
    foxy: { view: FoxyView; look: 'colour' | 'plain'; tasks: TaskStage[]; picked: Picked; bar: 'on' | 'off'; side: Task[]; crew: Agent[]; frog: Frog; remote: string[]; smart: string[]; notes: Note[]; tales: Record<string, string>; tale: Tale; den: string; marks: Mark[]; convos: Convo[]; told: number; blessed: number; adhan: number; past: string; mates: Mate[] }
  }
}
