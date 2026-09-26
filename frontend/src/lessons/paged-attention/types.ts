/** A toy KV cache allocator, not a vLLM deployment or GPU telemetry. */
export type AllocMode = 'contiguous' | 'paged'
export type Stage = 'empty' | 'weights' | 'pool'

export interface RequestSpec {
  id: string
  prompt: string[]
  /** One scripted output per sample; more than one means parallel sampling. */
  outputs: string[][]
  /** Maximum sequence length; contiguous allocation reserves this up front. */
  max_tokens: number
  color: string
}

export interface ModelSpec {
  name: string
  layers: number
  hidden_size: number
  bytes_per_value: number
}

export interface PagedConfig {
  block_size: number
  num_blocks: number
  /** Order in which free physical blocks are handed out, so replays are deterministic. */
  allocation_order: number[]
  model: ModelSpec
  requests: RequestSpec[]
}

export type PACommand =
  | { op: 'paStage'; args: { stage: Stage } }
  | { op: 'paMode'; args: { mode: AllocMode } }
  | { op: 'paAdmit'; args: { request: string } }
  | { op: 'paDecode'; args: Record<string, never> }
  | { op: 'paFinish'; args: { request: string } }

/** The workload is a log, so switching allocators replays the same requests. */
export type WorkloadOp =
  | { op: 'admit'; request: string }
  | { op: 'decode' }
  | { op: 'finish'; request: string }

export interface PagedState {
  stage: Stage
  mode: AllocMode
  log: WorkloadOp[]
}

export type RequestStatus = 'pending' | 'running' | 'waiting' | 'swapped' | 'finished'
export type SlotKind = 'token' | 'reserved' | 'internal' | 'external' | 'free'

export interface Slot {
  kind: SlotKind
  request: string | null
  token: string | null
}

export interface BlockInfo {
  id: number
  request: string | null
  refs: number
  filled: number
}

export interface SequenceView {
  id: string
  request: string
  sample: number
  tokens: string[]
  /** Paged: physical block per logical block. */
  blocks: number[]
  /** Contiguous: first reserved slot. */
  start: number
}

export interface Stats {
  tokens: number
  reserved: number
  internal: number
  external: number
  free: number
  /** Share of occupied KV memory that holds real tokens; null when nothing is occupied. */
  utilization: number | null
  running: number
  waiting: number
  swapped: number
}

/** What the last workload op did, in slot/block terms, for animation. */
export interface Effects {
  reads: number[]
  writes: number[]
  copies: { from: number; to: number }[]
  swapOut: { request: string; slots: number[] }[]
  swapIn: { request: string; slots: number[] }[]
  admitted: string[]
  waited: string[]
  freed: number[]
}

export interface Layout {
  mode: AllocMode
  status: Record<string, RequestStatus>
  sequences: SequenceView[]
  slots: Slot[]
  blocks: BlockInfo[]
  /** Blocks held in CPU RAM per swapped request. */
  swappedBlocks: Record<string, number>
  stats: Stats
  effects: Effects
}

/** Scene parts a spoken phrase can point at. `r-X` is request X's memory. */
export type SpotlightTarget =
  | 'gpu'
  | 'compute'
  | 'l2'
  | 'memory'
  | 'weights'
  | 'pool'
  | 'pcie'
  | 'host'
  | 'queue'
  | 'tables'
  | 'swap'
  | 'meter'
  | `r-${string}`

export interface NarrationCue {
  text: string
  spotlight: SpotlightTarget[]
}

export interface PABeat {
  id: string
  title: string
  /** The cue texts joined; kept for chapters, tutor context and tests. */
  text: string
  cues?: NarrationCue[]
  commands: PACommand[]
  hold_ms: number
  checkpoint?: 'waste' | 'next-block' | 'cow'
  emphasis?: boolean
}

export interface PagedAttentionPod {
  id: string
  title: string
  topic: string
  description: string
  scene: { type: 'paged-kv'; params: PagedConfig }
  narration: PABeat[]
  affordances: { op: string; description: string; args?: Record<string, string> }[]
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Transient presentation, separate from the committed simulation state. */
export interface VisualCue {
  kind: 'weights' | 'prompt' | 'write' | 'read' | 'copy' | 'swap-out' | 'swap-in' | 'emphasis'
  durationMs: number
  slot?: number
  effects?: Effects
  /** Colour of the prompt that is travelling. */
  color?: string
  /** Owner colour per slot, from whichever side of the step owns it. */
  slotColors?: (string | null)[]
  serial: number
}
