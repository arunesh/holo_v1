/** A toy attention kernel with counted HBM traffic, not GPU telemetry. */
export type Algorithm = 'standard' | 'flash' | 'block-sparse'
export type Stage = 'hardware' | 'inputs'
export type RunUntil = 'tile' | 'pass' | 'end'

export interface FlashConfig {
  /** N: tokens, one row of Q, K, V each. */
  seq_len: number
  /** d: numbers per row (head dimension). */
  head_dim: number
  /** M: values the on-chip SRAM holds; block sizes follow from it (Algorithm 1 line 1). */
  sram_size: number
  /** Seeds the deterministic Q, K, V. */
  seed: number
  /** T_r × T_c; 0 means block-sparse attention skips that tile. */
  block_mask: number[][]
}

export type FACommand =
  | { op: 'faStage'; args: { stage: Stage } }
  | { op: 'faMode'; args: { mode: Algorithm } }
  | { op: 'faStep'; args: Record<string, never> }
  | { op: 'faRun'; args: { until: RunUntil } }

/** The run is a program, so `pc` alone says how far it got. */
export interface FlashState {
  stage: Stage
  mode: Algorithm
  pc: number
}

export type MatrixName = 'Q' | 'K' | 'V' | 'S' | 'P' | 'O' | 'l' | 'm'

/** Rows [from, to) and columns [from, to) of one HBM matrix. */
export interface Region {
  matrix: MatrixName
  rows: [number, number]
  cols: [number, number]
}

export type Phase =
  | 'std-qk'
  | 'std-softmax'
  | 'std-pv'
  | 'load-kv'
  | 'load-q'
  | 'qk'
  | 'softmax'
  | 'pv'
  | 'store'
  | 'skip'

/** One line of Algorithm 0, 1 or 5. */
export interface Op {
  phase: Phase
  /** Query (row) block, or -1. */
  i: number
  /** Key/value (column) block, or -1. */
  j: number
  reads: Region[]
  writes: Region[]
  /** Multiply-adds in matmuls, counted as 2 FLOPs each. */
  flops: number
  /** Algorithm number and line(s) in the paper. */
  algorithm: 0 | 1 | 5
  line: string
}

export type Matrix = number[][]

/** What sits in SRAM after the last op; absent fields are not loaded. */
export interface SramView {
  i: number
  j: number
  Q?: Matrix
  K?: Matrix
  V?: Matrix
  O?: Matrix
  l?: number[]
  m?: number[]
  S?: Matrix
  /** P̃ = exp(S − m̃), unnormalised. */
  Pt?: Matrix
  mt?: number[]
  lt?: number[]
  mNew?: number[]
  lNew?: number[]
  /** e^(m − m_new) per row: how much the running output shrinks. */
  scale?: number[]
  /** Standard attention: the row block of S or P being produced. */
  strip?: { kind: 'S' | 'P'; rows: Matrix }
}

export type TileStatus = 'pending' | 'active' | 'done' | 'masked' | 'skipped'

export interface Counters {
  reads: number
  writes: number
  /** Values of S or P that crossed the HBM bus. */
  quadratic: number
  flops: number
}

export interface Check {
  /** Largest |O − reference| over every output value. */
  maxError: number
  reference: 'dense' | 'masked'
  /** Block-sparse only: largest |O − dense attention|. */
  denseGap: number | null
}

export interface Run {
  mode: Algorithm
  pc: number
  total: number
  op: Op | null
  next: Op | null
  hbm: {
    /** NaN where nothing has been written. */
    S: Matrix
    P: Matrix
    O: Matrix
    l: number[]
    m: number[]
    /** Rows of O written at least once. */
    oWritten: boolean[]
  }
  sram: SramView | null
  tiles: TileStatus[][]
  counters: Counters
  done: boolean
  check: Check | null
}

/** Scene parts a spoken phrase can point at. */
export type SpotlightTarget =
  | 'gpu'
  | 'hbm'
  | 'sram'
  | 'bus'
  | 'q'
  | 'k'
  | 'v'
  | 'o'
  | 'stats'
  | 'scores'
  | 'tile'
  | 'meter'

export interface NarrationCue {
  text: string
  spotlight: SpotlightTarget[]
}

export interface FABeat {
  id: string
  title: string
  /** The cue texts joined; kept for chapters, tutor context and tests. */
  text: string
  cues?: NarrationCue[]
  commands: FACommand[]
  hold_ms: number
  checkpoint?: 'materialize' | 'rescale' | 'sparse'
  emphasis?: boolean
}

export interface FlashAttentionPod {
  id: string
  title: string
  topic: string
  description: string
  scene: { type: 'flash-tiles'; params: FlashConfig }
  narration: FABeat[]
  affordances: { op: string; description: string; args?: Record<string, string> }[]
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Transient presentation, separate from the committed simulation state. */
export interface VisualCue {
  kind: 'boot' | 'load' | 'store' | 'compute' | 'skip' | 'emphasis'
  durationMs: number
  op?: Op
  serial: number
}
