/** The diagram is a protocol simulation, not telemetry from a physical GPU. */
export type AttentionMode = 'global' | 'focus' | 'local'
export type Stage = 'empty' | 'weights' | 'request' | 'prefill' | 'decode'

export interface Chunk {
  id: number
  label: string
  tokens: number
  color: string
}

export interface MemoryConfig {
  chunks: Chunk[]
  scaffold_tokens: number
  kv_heads: number
  head_dimension: number
  bytes_per_value: number
}

export type DACommand =
  | { op: 'daStage'; args: { stage: Stage } }
  | { op: 'daMode'; args: { mode: AttentionMode; chunks?: number[] } }
  | { op: 'daDecode'; args: { text: string } }

/** Scene parts a spoken phrase can point at. `c<N>` is the seat of chunk N. */
export type SpotlightTarget =
  | 'gpu'
  | 'compute'
  | 'l2'
  | 'memory'
  | 'weights'
  | 'seats'
  | 'sys'
  | 'docs'
  | `c${number}`
  | 'reply'
  | 'pcie'
  | 'host'
  | 'meter'

export interface NarrationCue {
  text: string
  spotlight: SpotlightTarget[]
}

export interface DABeat {
  id: string
  title: string
  /** The cue texts joined; kept for chapters, tutor context and tests. */
  text: string
  cues?: NarrationCue[]
  commands: DACommand[]
  hold_ms: number
  checkpoint?: 'read-set' | 'residency' | 'local'
  emphasis?: boolean
}

export interface DeclarativeAttentionPod {
  id: string
  title: string
  topic: string
  description: string
  scene: { type: 'gpu-memory'; params: MemoryConfig }
  narration: DABeat[]
  affordances: { op: string; description: string; args?: Record<string, string> }[]
}

export interface ReadEvent {
  id: number
  mode: AttentionMode
  chunkIds: number[]
  responseTokens: number
  readTokens: number
  fullTokens: number
  readBytes: number
  fullBytes: number
  fraction: number
  durationMs: number
  text: string
}

export interface MemoryState {
  stage: Stage
  mode: AttentionMode
  focusedChunks: number[]
  responseTokens: number
  events: ReadEvent[]
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Transient presentation, separate from the committed simulation state. */
export interface VisualCue {
  kind: 'weights' | 'input' | 'write' | 'read' | 'response' | 'residency'
  slot?: number
  durationMs: number
  event?: ReadEvent
  serial: number
}
