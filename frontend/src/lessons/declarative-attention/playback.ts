import type {
  DABeat,
  DACommand,
  DeclarativeAttentionPod,
  MemoryState,
  NarrationCue,
  SpotlightTarget,
  VisualCue,
} from './types'
import { applyCommand, describeState, initialState, nextRead, replayThrough } from './simulation'

export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export interface PlaybackSnapshot {
  state: MemoryState
  beatIndex: number
  caption: string
  playing: boolean
  visual: VisualCue | null
  declaration: string | null
  prefilledSlots: number
  checkpoint: string | null
  completed: boolean
  /** What the phrase being spoken points at; null lights the whole scene. */
  spotlight: SpotlightTarget[] | null
}

const cuesOf = (beat: DABeat): NarrationCue[] => beat.cues ?? [{ text: beat.text, spotlight: [] }]
/** Silent reading time for one phrase, roughly 15 characters per second. */
const readingMs = (text: string) => Math.max(1200, (text.length / 15) * 1000)

/** Resume preserves state; only explicit seek/replay reconstructs a checkpoint. */
export class LessonPlayback {
  private snapshot: PlaybackSnapshot
  private listeners = new Set<() => void>()
  private run = new AbortController()
  private cursor = { beat: 0, command: 0 }
  private serial = 0

  constructor(
    private pod: DeclarativeAttentionPod,
    private speak: (text: string) => Promise<boolean>,
    private stopSpeaking: () => void,
    private sleep = wait,
  ) {
    this.snapshot = {
      state: initialState(pod.scene.params),
      beatIndex: -1,
      caption:
        'Long prompts make language models slow. Look inside a GPU to see why, and how a model can read less.',
      playing: false,
      visual: null,
      declaration: null,
      prefilledSlots: 0,
      checkpoint: null,
      completed: false,
      spotlight: null,
    }
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private patch(patch: Partial<PlaybackSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  setCaption = (caption: string) => this.patch({ caption })
  stop = () => {
    this.run.abort()
    this.stopSpeaking()
    // Interrupted visuals settle into committed state; resume cannot duplicate tokens.
    this.patch({
      playing: false,
      visual: null,
      declaration: null,
      spotlight: null,
      prefilledSlots: ['prefill', 'decode'].includes(this.snapshot.state.stage)
        ? this.pod.scene.params.chunks.length + 1
        : 0,
    })
  }
  private begin() {
    this.stop()
    this.run = new AbortController()
    return this.run.signal
  }
  private async cue(
    kind: VisualCue['kind'],
    durationMs: number,
    signal: AbortSignal,
    slot?: number,
    event?: VisualCue['event'],
  ) {
    if (signal.aborted) return
    this.patch({ visual: { kind, durationMs, slot, event, serial: ++this.serial } })
    await this.sleep(durationMs, signal)
    if (!signal.aborted) this.patch({ visual: null })
  }
  private async say(text: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false
    return new Promise((resolve) => {
      const finish = (spoken = false) => {
        signal.removeEventListener('abort', cancel)
        resolve(spoken)
      }
      const cancel = () => finish(false)
      signal.addEventListener('abort', cancel, { once: true })
      this.speak(text).then(finish, () => finish(false))
    })
  }
  private async perform(command: DACommand, signal: AbortSignal) {
    if (signal.aborted) return
    const config = this.pod.scene.params
    const before = this.snapshot.state
    if (command.op === 'daMode') {
      const chunks = command.args.chunks ?? before.focusedChunks
      const tag =
        command.args.mode === 'focus'
          ? `<focus magic_chunks="${chunks.join(',')}">`
          : `<${command.args.mode}>`
      this.patch({ declaration: tag })
      await this.sleep(1000, signal)
      if (signal.aborted) return
      this.patch({ state: applyCommand(before, command, config), declaration: null })
      await this.sleep(550, signal)
      return
    }
    const next = applyCommand(before, command, config)
    if (next === before) return
    this.patch({ state: next })
    if (command.op === 'daDecode') {
      const event = nextRead(before, config, command.args.text)
      await this.cue('read', event.durationMs, signal, undefined, event)
      await this.cue('response', 450, signal, undefined, event)
    } else if (command.args.stage === 'weights') {
      for (let slot = 0; slot < 4 && !signal.aborted; slot++)
        await this.cue('weights', 650, signal, slot)
    } else if (command.args.stage === 'prefill') {
      this.patch({ prefilledSlots: 0 })
      for (let slot = 0; slot <= config.chunks.length && !signal.aborted; slot++) {
        await this.cue('input', 650, signal, slot)
        await this.cue('write', 500, signal, slot)
        if (!signal.aborted) this.patch({ prefilledSlots: slot + 1 })
      }
    } else await this.sleep(350, signal)
  }
  play = async (oneBeat = false) => {
    if (this.snapshot.checkpoint || this.snapshot.completed) return
    const signal = this.begin()
    this.patch({ playing: true })
    while (this.cursor.beat < this.pod.narration.length && !signal.aborted) {
      const index = this.cursor.beat
      const beat = this.pod.narration[index]
      const [first] = cuesOf(beat)
      this.patch({
        beatIndex: index,
        caption: first.text,
        spotlight: first.spotlight.length ? first.spotlight : null,
      })
      while (this.cursor.command < beat.commands.length && !signal.aborted) {
        const command = beat.commands[this.cursor.command]
        if (command.op !== 'daMode') this.cursor.command++
        await this.perform(command, signal)
        if (signal.aborted) return
        if (command.op === 'daMode') this.cursor.command++
      }
      if (signal.aborted) return
      if (beat.emphasis) await this.cue('residency', 1300, signal)
      if (signal.aborted) return
      let spoken = true
      for (const cue of cuesOf(beat)) {
        this.patch({ caption: cue.text, spotlight: cue.spotlight.length ? cue.spotlight : null })
        const voiced = await this.say(cue.text, signal)
        if (signal.aborted) return
        spoken &&= voiced
        await this.sleep(voiced ? 250 : readingMs(cue.text), signal)
        if (signal.aborted) return
      }
      await this.sleep(spoken ? Math.max(500, beat.hold_ms) : 900, signal)
      if (signal.aborted) return
      this.patch({ spotlight: null })
      this.cursor = { beat: index + 1, command: 0 }
      if (beat.checkpoint) {
        this.patch({ checkpoint: beat.checkpoint, playing: false })
        return
      }
      if (oneBeat) break
    }
    if (!signal.aborted)
      this.patch({ playing: false, completed: this.cursor.beat >= this.pod.narration.length })
  }
  /** Direct experiments hold the guide at the next chapter without rewinding. */
  explore = async (commands: DACommand[], text?: string) => {
    const signal = this.begin()
    if (this.snapshot.beatIndex >= 0)
      this.cursor = { beat: this.snapshot.beatIndex + 1, command: 0 }
    this.patch({ checkpoint: null, spotlight: null })
    for (const command of commands) await this.perform(command, signal)
    if (signal.aborted) return
    this.patch({ caption: text || describeState(this.snapshot.state, this.pod.scene.params) })
    if (text) await this.say(text, signal)
  }
  resolveCheckpoint = () => this.patch({ checkpoint: null })
  goTo = async (index: number) => {
    this.stop()
    const safeIndex = Math.max(0, Math.min(this.pod.narration.length - 1, index))
    const state = replayThrough(this.pod.narration, safeIndex - 1, this.pod.scene.params)
    this.cursor = { beat: safeIndex, command: 0 }
    this.patch({ state, checkpoint: null, completed: false })
    await this.play(true)
  }
  replay = () => this.goTo(Math.max(0, this.snapshot.beatIndex))
  restart = async () => {
    this.stop()
    this.cursor = { beat: 0, command: 0 }
    this.patch({
      state: initialState(this.pod.scene.params),
      beatIndex: -1,
      checkpoint: null,
      completed: false,
    })
    await this.play()
  }
  step = () => this.play(true)
}
