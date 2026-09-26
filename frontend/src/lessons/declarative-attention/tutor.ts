import type { ConversationTurn, DACommand, MemoryConfig, MemoryState } from './types'
import { nextRead, residentBytes } from './simulation'
import { openSocket } from '../../api'

export function validateCommands(value: unknown, config: MemoryConfig): DACommand[] {
  if (!Array.isArray(value) || value.length > 6) throw new Error('Invalid tutor commands.')
  const validIds = new Set(config.chunks.map((chunk) => chunk.id))
  for (const command of value) {
    if (
      !command ||
      typeof command !== 'object' ||
      !command.args ||
      typeof command.args !== 'object'
    )
      throw new Error('Invalid tutor command.')
    const { op, args } = command
    if (
      op === 'daStage' &&
      ['empty', 'weights', 'request', 'prefill', 'decode'].includes(args.stage)
    )
      continue
    if (op === 'daDecode' && typeof args.text === 'string' && args.text.length <= 80) continue
    if (
      op === 'daMode' &&
      ['global', 'focus', 'local'].includes(args.mode) &&
      Array.isArray(args.chunks) &&
      args.chunks.length <= 8 &&
      args.chunks.every((id: unknown) => typeof id === 'number' && validIds.has(id)) &&
      (args.mode !== 'focus' || args.chunks.length > 0)
    )
      continue
    throw new Error('The tutor returned an unsupported scene action. Your scene is unchanged.')
  }
  return value as DACommand[]
}

/** Browser transport only. A cancelled/old request never mutates a new scene. */
export function askTutor(
  podId: string,
  query: string,
  scene: MemoryState,
  signal: AbortSignal,
  history: ConversationTurn[],
  config: MemoryConfig,
): Promise<{ text: string; commands: DACommand[] }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled'))
      return
    }
    const ws = openSocket(`/ws/session/${encodeURIComponent(podId)}`)
    let text = ''
    let commands: DACommand[] = []
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
            scene: {
              ...scene,
              events: scene.events.slice(-8),
              computed: {
                nextRead: nextRead(scene, config),
                residentBytes: residentBytes(scene, config),
              },
              conversation: history.slice(-12),
            },
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
