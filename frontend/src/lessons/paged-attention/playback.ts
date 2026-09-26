import type {
  Effects,
  NarrationCue,
  PABeat,
  PACommand,
  PagedAttentionPod,
  PagedState,
  SpotlightTarget,
  VisualCue,
} from './types'
import { applyCommand, describeState, initialState, layoutOf, replayThrough, requestSpec } from './simulation'
import { wait } from '../declarative-attention/playback'

export interface PlaybackSnapshot {
  state: PagedState
  beatIndex: number
  caption: string
  playing: boolean
  visual: VisualCue | null
  declaration: string | null
  checkpoint: string | null
  completed: boolean
  /** What the phrase being spoken points at; null lights the whole scene. */
  spotlight: SpotlightTarget[] | null
}

const cuesOf = (beat: PABeat): NarrationCue[] => beat.cues ?? [{ text: beat.text, spotlight: [] }]
/** Silent reading time for one phrase, roughly 15 characters per second. */
const readingMs = (text: string) => Math.max(1200, (text.length / 15) * 1000)

/** Resume preserves state; only explicit seek/replay reconstructs a checkpoint. */
export class LessonPlayback {
  private snapshot: PlaybackSnapshot
  private listeners = new Set<() => void>()
  private run = new AbortController()
  private cursor = { beat: 0, command: 0 }
  private serial = 0
  /** A step whose packets are still moving; stop() commits it at once. */
  private pending: PagedState | null = null

  constructor(
    private pod: PagedAttentionPod,
    private speak: (text: string) => Promise<boolean>,
    private stopSpeaking: () => void,
    private sleep = wait,
  ) {
    this.snapshot = {
      state: initialState(),
      beatIndex: -1,
      caption:
        'LLM servers run out of memory long before they run out of compute. See where the KV cache goes, and how paging fixes it.',
      playing: false,
      visual: null,
      declaration: null,
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
    // An interrupted step still happened: settle into it before anyone reads the state.
    const pending = this.pending
    this.pending = null
    this.patch({
      ...(pending ? { state: pending } : {}),
      playing: false,
      visual: null,
      declaration: null,
      spotlight: null,
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
    extra: Partial<VisualCue> = {},
  ) {
    if (signal.aborted) return
    this.patch({ visual: { kind, durationMs, ...extra, serial: ++this.serial } })
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
  /** Packets for one step: reads, evictions and copies happen before new tokens land. */
  private async animate(effects: Effects, slotColors: (string | null)[], signal: AbortSignal) {
    const extra = { effects, slotColors }
    const config = this.pod.scene.params
    if (effects.reads.length) await this.cue('read', 1100, signal, extra)
    if (effects.swapOut.length) await this.cue('swap-out', 1400, signal, extra)
    if (effects.copies.length) await this.cue('copy', 900, signal, extra)
    for (const request of effects.admitted)
      await this.cue('prompt', 750, signal, { color: requestSpec(config, request)?.color })
    if (effects.writes.length) await this.cue('write', 750, signal, extra)
  }
  private async perform(command: PACommand, signal: AbortSignal) {
    if (signal.aborted) return
    const config = this.pod.scene.params
    const before = this.snapshot.state
    const next = applyCommand(before, command, config)
    if (next === before) return
    if (command.op === 'paMode') {
      this.patch({
        declaration: next.mode === 'paged' ? 'allocator: paged blocks' : 'allocator: contiguous chunks',
      })
      await this.sleep(900, signal)
      if (signal.aborted) return
      this.patch({ state: next, declaration: null })
      await this.sleep(500, signal)
      return
    }
    if (command.op === 'paStage') {
      this.patch({ state: next })
      if (next.stage === 'weights')
        for (let slot = 0; slot < 4 && !signal.aborted; slot++)
          await this.cue('weights', 600, signal, { slot })
      else await this.sleep(350, signal)
      return
    }
    const earlier = layoutOf(before, config)
    const later = layoutOf(next, config)
    const colorOf = (request: string | null) =>
      request ? (requestSpec(config, request)?.color ?? null) : null
    const slotColors = later.slots.map(
      (slot, i) => colorOf(slot.request) ?? colorOf(earlier.slots[i].request),
    )
    if (command.op === 'paFinish') {
      // Memory is freed first; anything that swaps in or starts then fills it.
      this.patch({ state: next })
      if (later.effects.swapIn.length)
        await this.cue('swap-in', 1400, signal, { effects: later.effects, slotColors })
      await this.animate({ ...later.effects, reads: [] }, slotColors, signal)
      if (!signal.aborted) await this.sleep(300, signal)
      return
    }
    // Tokens appear as their packets land.
    this.pending = next
    await this.animate(later.effects, slotColors, signal)
    if (this.pending !== next) return
    this.pending = null
    this.patch({ state: next })
    await this.sleep(300, signal)
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
        // Workload steps commit even if interrupted, so resume must not repeat them.
        if (command.op !== 'paMode') this.cursor.command++
        await this.perform(command, signal)
        if (signal.aborted) return
        if (command.op === 'paMode') this.cursor.command++
      }
      if (signal.aborted) return
      if (beat.emphasis) await this.cue('emphasis', 1300, signal)
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
  explore = async (commands: PACommand[], text?: string) => {
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
    this.patch({ state: initialState(), beatIndex: -1, checkpoint: null, completed: false })
    await this.play()
  }
  step = () => this.play(true)
}
