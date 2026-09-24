import type { DACommand, DABeat, MemoryConfig, MemoryState, ReadEvent, Stage } from './types'

export const STAGES: Stage[] = ['empty', 'weights', 'request', 'prefill', 'decode']

export function initialState(config?: MemoryConfig): MemoryState {
  const firstFocus =
    config?.chunks.find((chunk) => chunk.id === 3)?.id ?? config?.chunks[0]?.id ?? 3
  return {
    stage: 'empty',
    mode: 'global',
    focusedChunks: [firstFocus],
    responseTokens: 0,
    events: [],
  }
}

export function stageReached(state: MemoryState, stage: Stage): boolean {
  return STAGES.indexOf(state.stage) >= STAGES.indexOf(stage)
}

/** One global-attention layer: keys + values, for each KV head and dimension. */
export function bytesPerToken(config: MemoryConfig): number {
  return 2 * config.kv_heads * config.head_dimension * config.bytes_per_value
}

export function selectedChunkIds(state: MemoryState, config: MemoryConfig): number[] {
  if (state.mode === 'local') return []
  if (state.mode === 'global') return config.chunks.map((chunk) => chunk.id)
  return config.chunks
    .filter((chunk) => state.focusedChunks.includes(chunk.id))
    .map((chunk) => chunk.id)
}

export function nextRead(state: MemoryState, config: MemoryConfig, text = 'next token'): ReadEvent {
  const chunkIds = selectedChunkIds(state, config)
  // Compare at the SAME decode position. Response KV grows in both baselines.
  const alwaysRead = config.scaffold_tokens + state.responseTokens
  const fullTokens = alwaysRead + config.chunks.reduce((total, chunk) => total + chunk.tokens, 0)
  const readTokens =
    alwaysRead +
    config.chunks
      .filter((chunk) => chunkIds.includes(chunk.id))
      .reduce((total, chunk) => total + chunk.tokens, 0)
  const fraction = readTokens / fullTokens
  return {
    id: state.events.length + 1,
    mode: state.mode,
    chunkIds,
    responseTokens: state.responseTokens,
    readTokens,
    fullTokens,
    readBytes: readTokens * bytesPerToken(config),
    fullBytes: fullTokens * bytesPerToken(config),
    fraction,
    durationMs: Math.round(550 + 1850 * fraction),
    text,
  }
}

export function residentBytes(state: MemoryState, config: MemoryConfig): number {
  if (!stageReached(state, 'prefill')) return 0
  const tokens =
    config.scaffold_tokens + state.responseTokens + config.chunks.reduce((n, c) => n + c.tokens, 0)
  return tokens * bytesPerToken(config)
}

/** No mutable global state: reset, replay and tests all use the same reducer. */
export function applyCommand(
  state: MemoryState,
  command: DACommand,
  config: MemoryConfig,
): MemoryState {
  switch (command.op) {
    case 'daStage':
      if (!STAGES.includes(command.args.stage)) return state
      if (command.args.stage === 'empty') return initialState(config)
      if (STAGES.indexOf(command.args.stage) < STAGES.indexOf(state.stage))
        return { ...initialState(config), stage: command.args.stage }
      return { ...state, stage: command.args.stage }
    case 'daMode': {
      if (!['global', 'focus', 'local'].includes(command.args.mode)) return state
      const chunks = [...new Set(command.args.chunks ?? state.focusedChunks)].filter((id) =>
        config.chunks.some((chunk) => chunk.id === id),
      )
      if (command.args.mode === 'focus' && chunks.length === 0) return state
      // Global and local ignore the selection; keep it so Focus can restore it.
      return {
        ...state,
        mode: command.args.mode,
        focusedChunks: chunks.length ? chunks : state.focusedChunks,
      }
    }
    case 'daDecode': {
      if (!stageReached(state, 'prefill') || state.events.length >= 128) return state
      const event = nextRead(state, config, command.args.text)
      return {
        ...state,
        stage: 'decode',
        responseTokens: state.responseTokens + 1,
        events: [...state.events, event],
      }
    }
  }
}

export function replayThrough(beats: DABeat[], index: number, config: MemoryConfig): MemoryState {
  return beats
    .slice(0, index + 1)
    .reduce(
      (state, beat) =>
        beat.commands.reduce((current, command) => applyCommand(current, command, config), state),
      initialState(config),
    )
}

export function describeState(state: MemoryState, config: MemoryConfig): string {
  if (!stageReached(state, 'prefill'))
    return 'The KV cache is not built yet. Open chapter 4, Build the KV cache, to start experimenting.'
  const names = config.chunks
    .filter((chunk) => selectedChunkIds(state, config).includes(chunk.id))
    .map((chunk) => chunk.label)
  const selected = names.length ? names.join(' + ') : 'no documents'
  return `${state.mode === 'local' ? 'Local' : state.mode === 'focus' ? 'Focus' : 'Global'} reads SYS, ${selected}, and the ${state.responseTokens} reply token${state.responseTokens === 1 ? '' : 's'} so far. Every document stays in its seat.`
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`
}
