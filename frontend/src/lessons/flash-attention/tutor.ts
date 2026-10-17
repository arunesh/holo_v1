import type { ConversationTurn, FACommand, FlashConfig, FlashState } from './types'
import {
  ALGORITHMS,
  blockSizes,
  describeOp,
  hbmAccesses,
  maskDensity,
  rescaledRows,
  runOf,
} from './simulation'
import { openSocket } from '../../api'

export function validateCommands(value: unknown): FACommand[] {
  if (!Array.isArray(value) || value.length > 6) throw new Error('Invalid tutor commands.')
  for (const command of value) {
    if (!command || typeof command !== 'object' || !command.args || typeof command.args !== 'object')
      throw new Error('Invalid tutor command.')
    const { op, args } = command
    if (op === 'faStage' && ['hardware', 'inputs'].includes(args.stage)) continue
    if (op === 'faMode' && ALGORITHMS.includes(args.mode)) continue
    if (op === 'faStep' && !Object.keys(args).length) continue
    if (op === 'faRun' && ['tile', 'pass', 'end'].includes(args.until)) continue
    throw new Error('The tutor returned an unsupported scene action. Your scene is unchanged.')
  }
  return value as FACommand[]
}

/** What the tutor sees: the scene plus the numbers the frontend computed. */
export function tutorScene(state: FlashState, config: FlashConfig) {
  const run = runOf(state, config)
  const { Bc, Br, Tr, Tc } = blockSizes(config)
  const N = config.seq_len
  const d = config.head_dim
  const density = maskDensity(config)
  // Rows of the whole sequence, 0-based, so they match the config.
  const rescaled = rescaledRows(run).map((entry) => ({ ...entry, row: run.op!.i * Br + entry.row }))
  return {
    stage: state.stage,
    mode: state.mode,
    step: run.pc,
    steps: run.total,
    lastOp: run.op ? describeOp(run.op) : null,
    nextOp: run.next ? describeOp(run.next) : null,
    blocks: { Bc, Br, Tr, Tc },
    tiles: run.tiles.flat().reduce<Record<string, number>>((counts, status) => {
      counts[status] = (counts[status] ?? 0) + 1
      return counts
    }, {}),
    computed: {
      ...run.counters,
      moved: run.counters.reads + run.counters.writes,
      fullRun: {
        standard: hbmAccesses('standard', N, d, config.sram_size),
        flash: hbmAccesses('flash', N, d, config.sram_size),
        blockSparse: hbmAccesses('block-sparse', N, d, config.sram_size, density),
      },
      maskDensity: density,
      rescaledRows: rescaled,
      check: run.check,
    },
  }
}

/** Browser transport only. A cancelled/old request never mutates a new scene. */
export function askTutor(
  podId: string,
  query: string,
  scene: FlashState,
  signal: AbortSignal,
  history: ConversationTurn[],
  config: FlashConfig,
): Promise<{ text: string; commands: FACommand[] }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled'))
      return
    }
    const ws = openSocket(`/ws/session/${encodeURIComponent(podId)}`)
    let text = ''
    let commands: FACommand[] = []
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      ws.close()
      if (error) reject(error)
      else resolve({ text, commands })
    }
    const cancel = () => finish(new Error('Cancelled'))
    const timer = setTimeout(
      () => finish(new Error('The tutor timed out. The lesson still works.')),
      100000,
    )
    signal.addEventListener('abort', cancel, { once: true })
    ws.onopen = () => {
      if (!settled)
        ws.send(
          JSON.stringify({
            query,
            scene: { ...tutorScene(scene, config), conversation: history.slice(-12) },
          }),
        )
    }
    ws.onerror = () => finish(new Error('Could not connect to the tutor. The lesson still works.'))
    ws.onclose = () => {
      if (!settled) finish(new Error('Tutor connection closed. Try again.'))
    }
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'narration') {
          if (typeof message.text !== 'string' || text.length + message.text.length > 1200)
            throw new Error('Invalid narration')
          text += message.text
        }
        if (message.type === 'commands') commands = validateCommands(message.commands)
        if (message.type === 'done') finish()
        if (message.type === 'error')
          finish(new Error('The tutor could not complete this request.'))
      } catch {
        finish(new Error('Invalid tutor response.'))
      }
    }
  })
}
