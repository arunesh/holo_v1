import type { ConversationTurn, PACommand, PagedConfig, PagedState } from './types'
import { kvBytesPerToken, layoutOf } from './simulation'
import { openSocket } from '../../api'

export function validateCommands(value: unknown, config: PagedConfig): PACommand[] {
  if (!Array.isArray(value) || value.length > 6) throw new Error('Invalid tutor commands.')
  const requests = new Set(config.requests.map((spec) => spec.id))
  for (const command of value) {
    if (!command || typeof command !== 'object' || !command.args || typeof command.args !== 'object')
      throw new Error('Invalid tutor command.')
    const { op, args } = command
    if (op === 'paStage' && ['empty', 'weights', 'pool'].includes(args.stage)) continue
    if (op === 'paMode' && ['contiguous', 'paged'].includes(args.mode)) continue
    if (op === 'paDecode') continue
    if ((op === 'paAdmit' || op === 'paFinish') && requests.has(args.request)) continue
    throw new Error('The tutor returned an unsupported scene action. Your scene is unchanged.')
  }
  return value as PACommand[]
}

/** What the tutor sees: the scene plus the numbers the frontend computed. */
export function tutorScene(state: PagedState, config: PagedConfig) {
  const layout = layoutOf(state, config)
  return {
    stage: state.stage,
    mode: state.mode,
    requests: layout.status,
    sequences: layout.sequences.map(({ id, tokens, blocks, start }) => ({
      id,
      length: tokens.length,
      recent: tokens.slice(-4),
      ...(state.mode === 'paged' ? { blocks } : { start }),
    })),
    sharedBlocks: layout.blocks.filter((block) => block.refs > 1).map(({ id, refs }) => ({ id, refs })),
    swappedBlocks: layout.swappedBlocks,
    computed: { ...layout.stats, kvBytesPerToken: kvBytesPerToken(config) },
  }
}

/** Browser transport only. A cancelled/old request never mutates a new scene. */
export function askTutor(
  podId: string,
  query: string,
  scene: PagedState,
  signal: AbortSignal,
  history: ConversationTurn[],
  config: PagedConfig,
): Promise<{ text: string; commands: PACommand[] }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled'))
      return
    }
    const ws = openSocket(`/ws/session/${encodeURIComponent(podId)}`)
    let text = ''
    let commands: PACommand[] = []
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
        if (message.type === 'commands') commands = validateCommands(message.commands, config)
        if (message.type === 'done') finish()
        if (message.type === 'error')
          finish(new Error('The tutor could not complete this request.'))
      } catch {
        finish(new Error('Invalid tutor response.'))
      }
    }
  })
}
