import type {
  AllocMode,
  BlockInfo,
  Effects,
  Layout,
  PABeat,
  PACommand,
  PagedConfig,
  PagedState,
  RequestSpec,
  RequestStatus,
  Slot,
  Stage,
  WorkloadOp,
} from './types'

export const STAGES: Stage[] = ['empty', 'weights', 'pool']
export const MAX_LOG = 200

export function initialState(): PagedState {
  return { stage: 'empty', mode: 'contiguous', log: [] }
}

export function stageReached(state: PagedState, stage: Stage): boolean {
  return STAGES.indexOf(state.stage) >= STAGES.indexOf(stage)
}

/** Keys + values, across every layer: OPT-13B needs 2 × 5120 × 40 × 2 B = 800 KB. */
export function kvBytesPerToken(config: PagedConfig): number {
  const { hidden_size, layers, bytes_per_value } = config.model
  return 2 * hidden_size * layers * bytes_per_value
}

export const requestSpec = (config: PagedConfig, id: string): RequestSpec | undefined =>
  config.requests.find((spec) => spec.id === id)

/** Parallel samples of request D are D1, D2; a single-sample request keeps its own name. */
export const sequenceName = (spec: RequestSpec, sample: number) =>
  spec.outputs.length > 1 ? `${spec.id}${sample + 1}` : spec.id

const finalLength = (spec: RequestSpec, sample: number) =>
  Math.min(spec.max_tokens, spec.prompt.length + spec.outputs[sample].length)

interface Seq {
  id: string
  request: string
  sample: number
  tokens: string[]
  blocks: number[]
  start: number
}

interface Swapped {
  request: string
  seqs: Seq[]
  /** Block contents keyed by local index; seq.blocks point at these indices. */
  blockTokens: string[][]
}

const noEffects = (): Effects => ({
  reads: [],
  writes: [],
  copies: [],
  swapOut: [],
  swapIn: [],
  admitted: [],
  waited: [],
  freed: [],
})

/** Mutable only inside one replay; callers see the pure `simulate`. */
class Machine {
  readonly size: number
  readonly B: number
  blockTokens: string[][]
  refs: number[]
  owner: (string | null)[]
  slotOwner: (string | null)[]
  seqs: Seq[] = []
  status = new Map<string, RequestStatus>()
  arrival: string[] = []
  queue: string[] = []
  swapped: Swapped[] = []
  effects = noEffects()

  constructor(
    readonly mode: AllocMode,
    readonly config: PagedConfig,
  ) {
    this.B = config.block_size
    this.size = config.num_blocks * config.block_size
    this.blockTokens = Array.from({ length: config.num_blocks }, () => [])
    this.refs = Array(config.num_blocks).fill(0)
    this.owner = Array(config.num_blocks).fill(null)
    this.slotOwner = Array(this.size).fill(null)
    for (const spec of config.requests) this.status.set(spec.id, 'pending')
  }

  private spec(id: string) {
    return requestSpec(this.config, id)!
  }
  private seqsOf(request: string) {
    return this.seqs.filter((seq) => seq.request === request)
  }
  /** Slot holding token `position` of a sequence. */
  private slotOf(seq: Seq, position: number) {
    return this.mode === 'paged'
      ? seq.blocks[Math.floor(position / this.B)] * this.B + (position % this.B)
      : seq.start + position
  }
  private freeBlocks() {
    const order = [
      ...this.config.allocation_order,
      ...Array.from({ length: this.config.num_blocks }, (_, i) => i),
    ]
    return [...new Set(order)].filter(
      (id) => id >= 0 && id < this.config.num_blocks && this.refs[id] === 0,
    )
  }
  private allocBlock(request: string): number | null {
    const [id] = this.freeBlocks()
    if (id === undefined) return null
    this.refs[id] = 1
    this.owner[id] = request
    this.blockTokens[id] = []
    return id
  }
  private releaseBlock(id: number) {
    for (let offset = 0; offset < this.blockTokens[id].length; offset++)
      this.effects.freed.push(id * this.B + offset)
    this.refs[id] = 0
    this.owner[id] = null
    this.blockTokens[id] = []
  }
  /** First fit: the start of `length` free slots in a row, or -1. */
  private findRun(length: number) {
    let run = 0
    for (let slot = 0; slot < this.size; slot++) {
      run = this.slotOwner[slot] === null ? run + 1 : 0
      if (run === length) return slot - length + 1
    }
    return -1
  }

  private tryStart(request: string): boolean {
    const spec = this.spec(request)
    const samples = spec.outputs.length
    if (this.mode === 'paged') {
      const need = Math.ceil(spec.prompt.length / this.B)
      if (this.freeBlocks().length < need) return false
      const blocks = Array.from({ length: need }, () => this.allocBlock(request)!)
      spec.prompt.forEach((token, i) => {
        this.blockTokens[blocks[Math.floor(i / this.B)]].push(token)
        this.effects.writes.push(blocks[Math.floor(i / this.B)] * this.B + (i % this.B))
      })
      // Every sample maps its prompt to the same physical blocks.
      for (const id of blocks) this.refs[id] = samples
      for (let sample = 0; sample < samples; sample++)
        this.seqs.push({
          id: sequenceName(spec, sample),
          request,
          sample,
          tokens: [...spec.prompt],
          blocks: [...blocks],
          start: -1,
        })
    } else {
      // Each sample needs its own maximum-length chunk and its own copy of the prompt.
      const starts: number[] = []
      for (let sample = 0; sample < samples; sample++) {
        const start = this.findRun(spec.max_tokens)
        if (start < 0) {
          for (const s of starts) this.slotOwner.fill(null, s, s + spec.max_tokens)
          return false
        }
        this.slotOwner.fill(sequenceName(spec, sample), start, start + spec.max_tokens)
        starts.push(start)
      }
      starts.forEach((start, sample) => {
        this.seqs.push({
          id: sequenceName(spec, sample),
          request,
          sample,
          tokens: [...spec.prompt],
          blocks: [],
          start,
        })
        spec.prompt.forEach((_, i) => this.effects.writes.push(start + i))
      })
    }
    this.status.set(request, 'running')
    this.effects.admitted.push(request)
    return true
  }

  admit(request: string) {
    const spec = requestSpec(this.config, request)
    if (!spec || this.status.get(request) !== 'pending') return
    this.arrival.push(request)
    // First come, first served: nobody jumps the queue or a preempted request.
    if (this.queue.length || this.swapped.length || !this.tryStart(request)) {
      this.queue.push(request)
      this.status.set(request, 'waiting')
      this.effects.waited.push(request)
    }
  }

  /** The latest arrival is preempted first, all or nothing, and swapped to CPU RAM. */
  private swapOut(request: string) {
    const seqs = this.seqsOf(request)
    const ids = [...new Set(seqs.flatMap((seq) => seq.blocks))]
    const slots = ids.flatMap((id) => this.blockTokens[id].map((_, offset) => id * this.B + offset))
    this.swapped.push({
      request,
      seqs: seqs.map((seq) => ({ ...seq, blocks: seq.blocks.map((id) => ids.indexOf(id)) })),
      blockTokens: ids.map((id) => [...this.blockTokens[id]]),
    })
    for (const id of ids) this.releaseBlock(id)
    this.effects.freed = this.effects.freed.filter((slot) => !slots.includes(slot))
    this.seqs = this.seqs.filter((seq) => seq.request !== request)
    this.status.set(request, 'swapped')
    this.effects.swapOut.push({ request, slots })
  }

  /** A block for `request`, preempting later arrivals if the pool is full. */
  private ensureBlock(request: string): number | null {
    for (;;) {
      const id = this.allocBlock(request)
      if (id !== null) return id
      const victim = [...this.arrival].reverse().find((r) => this.status.get(r) === 'running')
      if (!victim) return null
      this.swapOut(victim)
      if (victim === request) return null
    }
  }

  decode() {
    const reads = new Set<number>()
    for (const request of this.arrival) {
      for (const seq of this.seqsOf(request)) {
        if (this.status.get(request) !== 'running') break
        const spec = this.spec(request)
        const length = seq.tokens.length
        if (length >= finalLength(spec, seq.sample)) continue
        const token = spec.outputs[seq.sample][length - spec.prompt.length]
        // Attention reads every earlier token of this sequence first.
        for (let i = 0; i < length; i++) reads.add(this.slotOf(seq, i))
        if (this.mode === 'paged') {
          const filled = length - (seq.blocks.length - 1) * this.B
          if (filled < this.B) {
            const last = seq.blocks[seq.blocks.length - 1]
            if (this.refs[last] > 1) {
              // Copy-on-write: the shared block is copied before this sample writes.
              const copy = this.ensureBlock(request)
              if (copy === null) break
              this.refs[last]--
              this.blockTokens[copy] = [...this.blockTokens[last]]
              seq.blocks[seq.blocks.length - 1] = copy
              this.effects.copies.push({ from: last, to: copy })
            }
          } else {
            const block = this.ensureBlock(request)
            if (block === null) break
            seq.blocks.push(block)
          }
          this.blockTokens[seq.blocks[seq.blocks.length - 1]].push(token)
        }
        seq.tokens.push(token)
        this.effects.writes.push(this.slotOf(seq, length))
      }
    }
    this.effects.reads = [...reads]
  }

  private schedule() {
    // Preempted requests come back first, in arrival order.
    while (this.swapped.length) {
      const entry = this.swapped[0]
      if (this.freeBlocks().length < entry.blockTokens.length) return
      const ids = entry.blockTokens.map((tokens) => {
        const id = this.allocBlock(entry.request)!
        this.blockTokens[id] = [...tokens]
        return id
      })
      for (const seq of entry.seqs) {
        seq.blocks = seq.blocks.map((local) => ids[local])
        this.seqs.push(seq)
      }
      for (const id of ids)
        this.refs[id] = entry.seqs.filter((seq) => seq.blocks.includes(id)).length
      this.swapped.shift()
      this.status.set(entry.request, 'running')
      this.effects.swapIn.push({
        request: entry.request,
        slots: ids.flatMap((id) => this.blockTokens[id].map((_, offset) => id * this.B + offset)),
      })
    }
    while (this.queue.length && this.tryStart(this.queue[0])) this.queue.shift()
  }

  finish(request: string) {
    const status = this.status.get(request)
    if (status === 'running') {
      if (this.mode === 'paged')
        for (const id of new Set(this.seqsOf(request).flatMap((seq) => seq.blocks)))
          this.releaseBlock(id)
      else
        for (const seq of this.seqsOf(request)) {
          const spec = this.spec(request)
          for (let slot = seq.start; slot < seq.start + spec.max_tokens; slot++) {
            if (slot < seq.start + seq.tokens.length) this.effects.freed.push(slot)
            this.slotOwner[slot] = null
          }
        }
      this.seqs = this.seqs.filter((seq) => seq.request !== request)
    } else if (status === 'waiting') this.queue = this.queue.filter((r) => r !== request)
    else if (status === 'swapped') this.swapped = this.swapped.filter((s) => s.request !== request)
    else return
    this.status.set(request, 'finished')
    this.schedule()
  }

  apply(op: WorkloadOp) {
    this.effects = noEffects()
    if (op.op === 'admit') this.admit(op.request)
    else if (op.op === 'decode') this.decode()
    else this.finish(op.request)
  }

  layout(): Layout {
    const slots: Slot[] = Array.from({ length: this.size }, () => ({
      kind: 'free',
      request: null,
      token: null,
    }))
    if (this.mode === 'paged') {
      for (let id = 0; id < this.config.num_blocks; id++) {
        if (!this.refs[id]) continue
        const tokens = this.blockTokens[id]
        // Empty slots are reserved if a sequence ending here will still write them.
        const future = Math.max(
          0,
          ...this.seqs
            .filter((seq) => seq.blocks[seq.blocks.length - 1] === id)
            .map((seq) => finalLength(this.spec(seq.request), seq.sample) - seq.tokens.length),
        )
        for (let offset = 0; offset < this.B; offset++)
          slots[id * this.B + offset] = {
            kind:
              offset < tokens.length
                ? 'token'
                : offset < tokens.length + future
                  ? 'reserved'
                  : 'internal',
            request: this.owner[id],
            token: tokens[offset] ?? null,
          }
      }
    } else {
      for (const seq of this.seqs) {
        const spec = this.spec(seq.request)
        const final = finalLength(spec, seq.sample)
        for (let i = 0; i < spec.max_tokens; i++)
          slots[seq.start + i] = {
            kind: i < seq.tokens.length ? 'token' : i < final ? 'reserved' : 'internal',
            request: seq.request,
            token: seq.tokens[i] ?? null,
          }
      }
      // Free gaps too short for the request at the head of the queue can't be used.
      const head = this.queue[0] && this.spec(this.queue[0])
      if (head) {
        let start = 0
        for (let slot = 0; slot <= this.size; slot++) {
          if (slot < this.size && slots[slot].kind === 'free') continue
          if (slot - start < head.max_tokens)
            for (let i = start; i < slot; i++) slots[i] = { ...slots[i], kind: 'external' }
          start = slot + 1
        }
      }
    }
    const count = (kind: Slot['kind']) => slots.filter((slot) => slot.kind === kind).length
    const tokens = count('token')
    const reserved = count('reserved')
    const internal = count('internal')
    const external = count('external')
    const occupied = tokens + reserved + internal + external
    const statuses = [...this.status.values()]
    const blocks: BlockInfo[] = this.refs.map((refs, id) => ({
      id,
      request: this.owner[id],
      refs,
      filled: this.blockTokens[id].length,
    }))
    return {
      mode: this.mode,
      status: Object.fromEntries(this.status),
      sequences: [...this.seqs]
        .sort(
          (a, b) =>
            this.arrival.indexOf(a.request) - this.arrival.indexOf(b.request) ||
            a.sample - b.sample,
        )
        .map(({ id, request, sample, tokens, blocks, start }) => ({
          id,
          request,
          sample,
          tokens,
          blocks,
          start,
        })),
      slots,
      blocks,
      swappedBlocks: Object.fromEntries(
        this.swapped.map((entry) => [entry.request, entry.blockTokens.length]),
      ),
      stats: {
        tokens,
        reserved,
        internal,
        external,
        free: count('free'),
        utilization: occupied ? tokens / occupied : null,
        running: statuses.filter((s) => s === 'running').length,
        waiting: statuses.filter((s) => s === 'waiting').length,
        swapped: statuses.filter((s) => s === 'swapped').length,
      },
      effects: this.effects,
    }
  }
}

/** Replays the workload under one allocator; effects describe the final op only. */
export function simulate(log: WorkloadOp[], mode: AllocMode, config: PagedConfig): Layout {
  const machine = new Machine(mode, config)
  for (const op of log) machine.apply(op)
  return machine.layout()
}

const layouts = new WeakMap<PagedConfig, WeakMap<PagedState, Layout>>()
/** Memoized per state object: React renders call this freely. */
export function layoutOf(state: PagedState, config: PagedConfig): Layout {
  let perConfig = layouts.get(config)
  if (!perConfig) layouts.set(config, (perConfig = new WeakMap()))
  let layout = perConfig.get(state)
  if (!layout) perConfig.set(state, (layout = simulate(state.log, state.mode, config)))
  return layout
}

function workloadOp(command: PACommand): WorkloadOp | null {
  if (command.op === 'paAdmit') return { op: 'admit', request: command.args.request }
  if (command.op === 'paDecode') return { op: 'decode' }
  if (command.op === 'paFinish') return { op: 'finish', request: command.args.request }
  return null
}

/** No mutable global state: reset, replay and tests all use the same reducer. */
export function applyCommand(
  state: PagedState,
  command: PACommand,
  config: PagedConfig,
): PagedState {
  switch (command.op) {
    case 'paStage': {
      const stage = command.args.stage
      if (!STAGES.includes(stage)) return state
      if (stage === 'empty') return initialState()
      // Opening the pool always starts from an empty workload.
      if (stage === 'pool') return { ...state, stage, log: [] }
      return STAGES.indexOf(stage) < STAGES.indexOf(state.stage)
        ? { ...state, stage, log: [] }
        : { ...state, stage }
    }
    case 'paMode':
      if (!['contiguous', 'paged'].includes(command.args.mode) || command.args.mode === state.mode)
        return state
      return { ...state, mode: command.args.mode }
  }
  const op = workloadOp(command)
  if (!op || state.stage !== 'pool' || state.log.length >= MAX_LOG) return state
  const layout = layoutOf(state, config)
  if (op.op === 'admit' && layout.status[op.request] !== 'pending') return state
  if (op.op === 'finish' && !['running', 'waiting', 'swapped'].includes(layout.status[op.request]))
    return state
  if (op.op === 'decode' && !canDecode(state, config)) return state
  return { ...state, log: [...state.log, op] }
}

/** Some running sequence still has scripted tokens to write. */
export function canDecode(state: PagedState, config: PagedConfig): boolean {
  if (state.stage !== 'pool') return false
  return layoutOf(state, config).sequences.some(
    (seq) => seq.tokens.length < finalLength(requestSpec(config, seq.request)!, seq.sample),
  )
}

/** The next request that hasn't arrived yet, in config order. */
export function nextPending(state: PagedState, config: PagedConfig): string | null {
  const status = layoutOf(state, config).status
  return config.requests.find((spec) => status[spec.id] === 'pending')?.id ?? null
}

export function replayThrough(beats: PABeat[], index: number, config: PagedConfig): PagedState {
  return beats
    .slice(0, index + 1)
    .reduce(
      (state, beat) =>
        beat.commands.reduce((current, command) => applyCommand(current, command, config), state),
      initialState(),
    )
}

export function describeState(state: PagedState, config: PagedConfig): string {
  if (!stageReached(state, 'pool'))
    return 'The KV cache pool is not open yet. Open chapter 3, The KV cache, to start experimenting.'
  const { stats } = layoutOf(state, config)
  const use =
    stats.utilization === null
      ? 'Nothing is allocated yet.'
      : `${(stats.utilization * 100).toFixed(0)}% of allocated KV memory holds real tokens.`
  const queue = stats.waiting
    ? ` ${stats.waiting} waiting.`
    : stats.swapped
      ? ` ${stats.swapped} swapped to CPU.`
      : ''
  return `${state.mode === 'paged' ? 'Paged' : 'Contiguous'} allocation: ${stats.running} request${stats.running === 1 ? '' : 's'} running.${queue} ${use}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${Math.round(bytes / 1024)} KiB`
}
