import type {
  Algorithm,
  FABeat,
  FACommand,
  FlashConfig,
  FlashState,
  Matrix,
  Op,
  Region,
  Run,
  RunUntil,
  SramView,
  Stage,
  TileStatus,
} from './types'

export const STAGES: Stage[] = ['hardware', 'inputs']
export const ALGORITHMS: Algorithm[] = ['standard', 'flash', 'block-sparse']
export const ALGORITHM_LABEL: Record<Algorithm, string> = {
  standard: 'Standard attention',
  flash: 'FlashAttention',
  'block-sparse': 'Block-sparse FlashAttention',
}
/** Shown on the board while an algorithm is selected. */
export const ALGORITHM_DECLARATION: Record<Algorithm, string> = {
  standard: 'algorithm 0: three kernels',
  flash: 'algorithm 1: one fused kernel',
  'block-sparse': 'algorithm 5: skip zero tiles',
}

export function initialState(): FlashState {
  return { stage: 'hardware', mode: 'standard', pc: 0 }
}

export function stageReached(state: FlashState, stage: Stage): boolean {
  return STAGES.indexOf(state.stage) >= STAGES.indexOf(stage)
}

/** Algorithm 1 line 1: B_c = ⌈M / 4d⌉, B_r = min(⌈M / 4d⌉, d). */
export function blockSizes(config: FlashConfig) {
  const N = config.seq_len
  const Bc = Math.ceil(config.sram_size / (4 * config.head_dim))
  const Br = Math.min(Bc, config.head_dim)
  return { Bc, Br, Tr: Math.ceil(N / Br), Tc: Math.ceil(N / Bc) }
}

export function maskDensity(config: FlashConfig): number {
  const cells = config.block_mask.flat()
  return cells.filter(Boolean).length / cells.length
}

/** Mulberry32: tiny, seedable and identical in every browser and in Node. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const inputCache = new WeakMap<FlashConfig, { Q: Matrix; K: Matrix; V: Matrix }>()
/** Q, K, V with one decimal place in [-1.5, 1.5], so every number fits in a cell. */
export function inputs(config: FlashConfig) {
  let cached = inputCache.get(config)
  if (!cached) {
    const next = random(config.seed)
    const matrix = () =>
      Array.from({ length: config.seq_len }, () =>
        Array.from({ length: config.head_dim }, () => Math.round(next() * 30 - 15) / 10),
      )
    cached = { Q: matrix(), K: matrix(), V: matrix() }
    inputCache.set(config, cached)
  }
  return cached
}

const dot = (a: number[], b: number[]) => a.reduce((sum, x, k) => sum + x * b[k], 0)
/** A · Bᵀ: rows of A against rows of B. */
const timesTransposed = (A: Matrix, B: Matrix): Matrix => A.map((row) => B.map((col) => dot(row, col)))
/** A · B. */
const times = (A: Matrix, B: Matrix): Matrix =>
  A.map((row) => B[0].map((_, c) => row.reduce((sum, x, k) => sum + x * B[k][c], 0)))
const softmaxRow = (row: number[]) => {
  const max = Math.max(...row)
  const e = row.map((x) => Math.exp(x - max))
  const sum = e.reduce((a, b) => a + b, 0)
  return e.map((x) => x / sum)
}

const size = (region: Region) =>
  (region.rows[1] - region.rows[0]) * (region.cols[1] - region.cols[0])
const region = (matrix: Region['matrix'], rows: [number, number], cols: [number, number]): Region => ({
  matrix,
  rows,
  cols,
})

/** The paper's algorithm as a list of ops; a run is a prefix of it. */
function compile(config: FlashConfig, mode: Algorithm): Op[] {
  const N = config.seq_len
  const d = config.head_dim
  const { Bc, Br, Tr, Tc } = blockSizes(config)
  const rowsOf = (i: number): [number, number] => [i * Br, Math.min(N, (i + 1) * Br)]
  const colsOf = (j: number): [number, number] => [j * Bc, Math.min(N, (j + 1) * Bc)]
  const width = (span: [number, number]) => span[1] - span[0]
  const all: [number, number] = [0, N]
  const head: [number, number] = [0, d]
  const one: [number, number] = [0, 1]
  const ops: Op[] = []
  if (mode === 'standard') {
    // Algorithm 0, one row block at a time. Each kernel reads its inputs once:
    // the most generous count for standard attention.
    const op = (phase: Op['phase'], i: number, reads: Region[], writes: Region[], flops: number, line: string) =>
      ops.push({ phase, i, j: -1, reads, writes, flops, algorithm: 0, line })
    for (let i = 0; i < Tr; i++)
      op('std-qk', i, [region('Q', rowsOf(i), head), ...(i ? [] : [region('K', all, head)])],
        [region('S', rowsOf(i), all)], 2 * width(rowsOf(i)) * N * d, '1')
    for (let i = 0; i < Tr; i++)
      op('std-softmax', i, [region('S', rowsOf(i), all)], [region('P', rowsOf(i), all)], 0, '2')
    for (let i = 0; i < Tr; i++)
      op('std-pv', i, [region('P', rowsOf(i), all), ...(i ? [] : [region('V', all, head)])],
        [region('O', rowsOf(i), head)], 2 * width(rowsOf(i)) * N * d, '3')
    return ops
  }
  const sparse = mode === 'block-sparse'
  // Line numbers of Algorithm 1, or of Algorithm 5 for the block-sparse variant.
  const lines: Partial<Record<Op['phase'], string>> = sparse
    ? { 'load-kv': '6', skip: '8', 'load-q': '9', qk: '10', softmax: '12–13', pv: '15', store: '15–16' }
    : { 'load-kv': '6', 'load-q': '8', qk: '9', softmax: '10–11', pv: '12', store: '12–13' }
  const algorithm = sparse ? 5 : 1
  const op = (phase: Op['phase'], i: number, j: number, reads: Region[], writes: Region[], flops: number) =>
    ops.push({ phase, i, j, reads, writes, flops, algorithm, line: lines[phase] ?? '' })
  for (let j = 0; j < Tc; j++) {
    // K_j and V_j are loaded once per column, even if every tile in it is skipped.
    op('load-kv', -1, j, [region('K', colsOf(j), head), region('V', colsOf(j), head)], [], 0)
    for (let i = 0; i < Tr; i++) {
      if (sparse && !config.block_mask[i]?.[j]) {
        op('skip', i, j, [], [], 0)
        continue
      }
      const rows = rowsOf(i)
      const tile = 2 * width(rows) * width(colsOf(j)) * d
      op('load-q', i, j, [region('Q', rows, head), region('O', rows, head), region('l', rows, one), region('m', rows, one)], [], 0)
      op('qk', i, j, [], [], tile)
      op('softmax', i, j, [], [], 0)
      op('pv', i, j, [], [], tile)
      op('store', i, j, [], [region('O', rows, head), region('l', rows, one), region('m', rows, one)], 0)
    }
  }
  return ops
}

const programs = new WeakMap<FlashConfig, Partial<Record<Algorithm, Op[]>>>()
export function programOf(config: FlashConfig, mode: Algorithm): Op[] {
  let perConfig = programs.get(config)
  if (!perConfig) programs.set(config, (perConfig = {}))
  return (perConfig[mode] ??= compile(config, mode))
}

/**
 * Closed-form HBM accesses (values read + written) under the same counting rule as the
 * simulation. Standard: 4Nd + 4N². FlashAttention: K and V once (2Nd), plus T_c passes
 * that each load Q, O, ℓ, m and store O, ℓ, m: N(3d + 4) per pass. Block-sparse scales
 * the passes by the fraction of nonzero tiles (Proposition 4).
 */
export function hbmAccesses(mode: Algorithm, N: number, d: number, M: number, density = 1): number {
  if (mode === 'standard') return 4 * N * d + 4 * N * N
  const Tc = Math.ceil(N / Math.ceil(M / (4 * d)))
  return 2 * N * d + (mode === 'flash' ? 1 : density) * Tc * N * (3 * d + 4)
}

/** Paper scale for the "scale it up" table: d = 64, M ≈ 100 KB of fp16 values. */
export const PAPER_SCALE = { head_dim: 64, sram_bytes: 100 * 1024, bytes_per_value: 2 }
export function paperScale(N: number, density: number) {
  const { head_dim: d, sram_bytes, bytes_per_value: bytes } = PAPER_SCALE
  const M = sram_bytes / bytes
  return {
    N,
    standard: hbmAccesses('standard', N, d, M) * bytes,
    flash: hbmAccesses('flash', N, d, M) * bytes,
    sparse: hbmAccesses('block-sparse', N, d, M, density) * bytes,
    /** S and P, each N × N, held in HBM by standard attention. */
    scores: 2 * N * N * bytes,
  }
}

/** softmax(QKᵀ)V directly, optionally with the block mask applied as −∞. */
export function reference(config: FlashConfig, masked: boolean): Matrix {
  const { Q, K, V } = inputs(config)
  const { Br, Bc } = blockSizes(config)
  const S = timesTransposed(Q, K).map((row, r) =>
    row.map((x, c) =>
      masked && !config.block_mask[Math.floor(r / Br)][Math.floor(c / Bc)] ? -Infinity : x,
    ),
  )
  return times(S.map(softmaxRow), V)
}

const maxDifference = (A: Matrix, B: Matrix) =>
  Math.max(...A.flatMap((row, r) => row.map((x, c) => Math.abs(x - B[r][c]))))

function execute(config: FlashConfig, mode: Algorithm, pc: number): Run {
  const N = config.seq_len
  const d = config.head_dim
  const { Q, K, V } = inputs(config)
  const { Br, Bc, Tr, Tc } = blockSizes(config)
  const program = programOf(config, mode)
  const filled = (rows: number, cols: number, value: number): Matrix =>
    Array.from({ length: rows }, () => Array(cols).fill(value))
  const hbm = {
    S: filled(N, N, NaN),
    P: filled(N, N, NaN),
    // Algorithm 1 line 2: O = 0, ℓ = 0, m = −∞.
    O: filled(N, d, 0),
    l: Array(N).fill(0) as number[],
    m: Array(N).fill(-Infinity) as number[],
    oWritten: Array(N).fill(false) as boolean[],
  }
  const tiles: TileStatus[][] = Array.from({ length: Tr }, (_, i) =>
    Array.from({ length: Tc }, (_, j) =>
      mode === 'block-sparse' && !config.block_mask[i][j] ? 'masked' : 'pending',
    ),
  )
  const counters = { reads: 0, writes: 0, quadratic: 0, flops: 0 }
  // Not narrowed to null: the loop below reassigns it.
  let sram = null as SramView | null
  const rowSlice = (i: number) => [i * Br, Math.min(N, (i + 1) * Br)] as const
  const colSlice = (j: number) => [j * Bc, Math.min(N, (j + 1) * Bc)] as const

  for (const op of program.slice(0, pc)) {
    for (const r of op.reads) {
      counters.reads += size(r)
      if (r.matrix === 'S' || r.matrix === 'P') counters.quadratic += size(r)
    }
    for (const w of op.writes) {
      counters.writes += size(w)
      if (w.matrix === 'S' || w.matrix === 'P') counters.quadratic += size(w)
    }
    counters.flops += op.flops
    const [r0, r1] = op.i >= 0 ? rowSlice(op.i) : [0, 0]
    const [c0, c1] = op.j >= 0 ? colSlice(op.j) : [0, 0]
    switch (op.phase) {
      case 'std-qk': {
        const rows = timesTransposed(Q.slice(r0, r1), K)
        rows.forEach((row, k) => (hbm.S[r0 + k] = row))
        sram = { i: op.i, j: -1, Q: Q.slice(r0, r1), strip: { kind: 'S', rows } }
        break
      }
      case 'std-softmax': {
        const rows = hbm.S.slice(r0, r1).map(softmaxRow)
        rows.forEach((row, k) => (hbm.P[r0 + k] = row))
        sram = { i: op.i, j: -1, strip: { kind: 'P', rows } }
        break
      }
      case 'std-pv': {
        const P = hbm.P.slice(r0, r1)
        const out = times(P, V)
        out.forEach((row, k) => {
          hbm.O[r0 + k] = row
          hbm.oWritten[r0 + k] = true
        })
        sram = { i: op.i, j: -1, O: out, strip: { kind: 'P', rows: P } }
        break
      }
      case 'load-kv':
        sram = { i: -1, j: op.j, K: K.slice(c0, c1), V: V.slice(c0, c1) }
        break
      case 'skip':
        sram = { i: op.i, j: op.j, K: sram?.K, V: sram?.V }
        tiles[op.i][op.j] = 'skipped'
        break
      case 'load-q':
        sram = {
          i: op.i,
          j: op.j,
          K: sram?.K,
          V: sram?.V,
          Q: Q.slice(r0, r1),
          O: hbm.O.slice(r0, r1).map((row) => [...row]),
          l: hbm.l.slice(r0, r1),
          m: hbm.m.slice(r0, r1),
        }
        tiles[op.i][op.j] = 'active'
        break
      case 'qk':
        sram = { ...sram!, S: timesTransposed(sram!.Q!, sram!.K!) }
        break
      case 'softmax': {
        const { S, m, l } = sram!
        const mt = S!.map((row) => Math.max(...row))
        const Pt = S!.map((row, r) => row.map((x) => Math.exp(x - mt[r])))
        const lt = Pt.map((row) => row.reduce((a, b) => a + b, 0))
        const mNew = m!.map((x, r) => Math.max(x, mt[r]))
        const scale = m!.map((x, r) => Math.exp(x - mNew[r]))
        const lNew = l!.map((x, r) => scale[r] * x + Math.exp(mt[r] - mNew[r]) * lt[r])
        sram = { ...sram!, mt, Pt, lt, mNew, lNew, scale }
        break
      }
      case 'pv': {
        // Line 12: O ← diag(ℓ_new)⁻¹ (diag(ℓ) e^(m − m_new) O + e^(m̃ − m_new) P̃ V).
        const { O, l, scale, mt, mNew, lNew, Pt, V: Vj } = sram!
        const PV = times(Pt!, Vj!)
        const next = O!.map((row, r) =>
          row.map(
            (x, c) =>
              (l![r] * scale![r] * x + Math.exp(mt![r] - mNew![r]) * PV[r][c]) / lNew![r],
          ),
        )
        sram = { ...sram!, O: next }
        break
      }
      case 'store': {
        const { O, lNew, mNew } = sram!
        O!.forEach((row, k) => {
          hbm.O[r0 + k] = [...row]
          hbm.l[r0 + k] = lNew![k]
          hbm.m[r0 + k] = mNew![k]
          hbm.oWritten[r0 + k] = true
        })
        sram = { ...sram!, l: lNew, m: mNew }
        tiles[op.i][op.j] = 'done'
        break
      }
    }
  }
  const done = pc >= program.length
  let check: Run['check'] = null
  if (done) {
    const masked = mode === 'block-sparse'
    check = {
      maxError: maxDifference(hbm.O, reference(config, masked)),
      reference: masked ? 'masked' : 'dense',
      denseGap: masked ? maxDifference(hbm.O, reference(config, false)) : null,
    }
  }
  return {
    mode,
    pc,
    total: program.length,
    op: pc > 0 ? program[pc - 1] : null,
    next: program[pc] ?? null,
    hbm,
    sram,
    tiles,
    counters,
    done,
    check,
  }
}

const runs = new WeakMap<FlashConfig, WeakMap<FlashState, Run>>()
/** Memoized per state object: React renders call this freely. */
export function runOf(state: FlashState, config: FlashConfig): Run {
  let perConfig = runs.get(config)
  if (!perConfig) runs.set(config, (perConfig = new WeakMap()))
  let run = perConfig.get(state)
  if (!run) perConfig.set(state, (run = execute(config, state.mode, state.pc)))
  return run
}

/** Rows (local to the tile) whose running max rose in the last softmax step, with the shrink factor. */
export function rescaledRows(run: Run) {
  const sram = run.sram
  if (run.op?.phase !== 'softmax' || !sram?.scale || !sram.m || !sram.mNew) return []
  return sram.scale.flatMap((factor, r) =>
    Number.isFinite(sram.m![r]) && factor < 1
      ? [{ row: r, mOld: sram.m![r], mNew: sram.mNew![r], factor }]
      : [],
  )
}

/** An op that completes one unit of work: a tile (or skipped tile), or a standard row block. */
const endsTile = (op: Op) => op.phase === 'store' || op.phase === 'skip' || op.phase.startsWith('std-')
/** Where a pass starts: a new K/V column, or a new standard kernel. */
const startsPass = (op: Op, previous: Op) =>
  op.phase === 'load-kv' || (op.phase.startsWith('std-') && op.phase !== previous.phase)

/** The program counter after running until the end of the current tile, pass, or run. */
export function runTarget(state: FlashState, until: RunUntil, config: FlashConfig): number {
  const program = programOf(config, state.mode)
  if (state.pc >= program.length || until === 'end') return program.length
  for (let k = state.pc; k < program.length; k++) {
    const next = program[k + 1]
    if (until === 'tile' && endsTile(program[k])) return k + 1
    if (until === 'pass' && (!next || startsPass(next, program[k]))) return k + 1
  }
  return program.length
}

export function canStep(state: FlashState, config: FlashConfig): boolean {
  return state.stage === 'inputs' && state.pc < programOf(config, state.mode).length
}

/** No mutable global state: reset, replay and tests all use the same reducer. */
export function applyCommand(state: FlashState, command: FACommand, config: FlashConfig): FlashState {
  switch (command.op) {
    case 'faStage': {
      const stage = command.args.stage
      if (stage === 'hardware') return initialState()
      // Loading the inputs always starts a fresh run.
      if (stage === 'inputs') return { ...state, stage, pc: 0 }
      return state
    }
    case 'faMode':
      if (!ALGORITHMS.includes(command.args.mode) || command.args.mode === state.mode) return state
      return { ...state, mode: command.args.mode, pc: 0 }
    case 'faStep':
      return canStep(state, config) ? { ...state, pc: state.pc + 1 } : state
    case 'faRun': {
      if (!canStep(state, config) || !['tile', 'pass', 'end'].includes(command.args.until)) return state
      return { ...state, pc: runTarget(state, command.args.until, config) }
    }
  }
  return state
}

export function replayThrough(beats: FABeat[], index: number, config: FlashConfig): FlashState {
  return beats
    .slice(0, index + 1)
    .reduce(
      (state, beat) =>
        beat.commands.reduce((current, command) => applyCommand(current, command, config), state),
      initialState(),
    )
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'
/** 1-based block index as subscript digits, the way the paper writes Q₁, K₂. */
export const sub = (index: number) =>
  String(index + 1)
    .split('')
    .map((digit) => SUBSCRIPT[Number(digit)])
    .join('')

/** What an op does, in the paper's notation. */
export function describeOp(op: Op): string {
  const i = sub(op.i)
  const j = sub(op.j)
  switch (op.phase) {
    case 'std-qk':
      return `S = QKᵀ for query block ${op.i + 1}, written to HBM`
    case 'std-softmax':
      return `Read S rows, P = softmax(S), write P to HBM`
    case 'std-pv':
      return `Read P rows${op.i ? '' : ' and V'}, O = PV, write O to HBM`
    case 'load-kv':
      return `Load K${j}, V${j} from HBM to SRAM`
    case 'skip':
      return `Mask is 0 for tile (${op.i + 1}, ${op.j + 1}): skip it`
    case 'load-q':
      return `Load Q${i}, O${i}, ℓ${i}, m${i} from HBM to SRAM`
    case 'qk':
      return `On chip: S${i}${j} = Q${i}K${j}ᵀ`
    case 'softmax':
      return `On chip: m̃ = rowmax(S), P̃ = exp(S − m̃), ℓ̃ = rowsum(P̃)`
    case 'pv':
      return `On chip: O${i} ← (ℓ·e^(m−mnew)·O${i} + e^(m̃−mnew)·P̃V${j}) / ℓnew`
    case 'store':
      return `Write O${i}, ℓ${i}, m${i} back to HBM`
  }
}

export const opTraffic = (op: Op) => ({
  reads: op.reads.reduce((sum, r) => sum + size(r), 0),
  writes: op.writes.reduce((sum, w) => sum + size(w), 0),
})

export function describeState(state: FlashState, config: FlashConfig): string {
  if (!stageReached(state, 'inputs'))
    return 'Q, K and V are not in HBM yet. Open chapter 2, Q, K and V live in HBM, to start experimenting.'
  const run = runOf(state, config)
  const moved = run.counters.reads + run.counters.writes
  const label = ALGORITHM_LABEL[state.mode]
  if (run.done && run.check)
    return `${label} finished: ${moved.toLocaleString()} values crossed the HBM bus, and O matches ${run.check.reference === 'masked' ? 'masked' : 'standard'} attention to ${run.check.maxError.toExponential(0)}.`
  if (!run.pc) return `${label} is ready. Step through it, or run a tile, a pass, or the whole thing.`
  return `${label}: step ${run.pc} of ${run.total}. ${moved.toLocaleString()} values have crossed the HBM bus so far.`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${Math.round(bytes / 1024)} KiB`
}
