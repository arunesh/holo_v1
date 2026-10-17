import type {
  FABeat,
  FACommand,
  FlashAttentionPod,
  FlashState,
  NarrationCue,
  Op,
  SpotlightTarget,
  VisualCue,
} from './types'
import {
  ALGORITHM_DECLARATION,
  applyCommand,
  describeState,
  initialState,
  programOf,
  replayThrough,
} from './simulation'
import { wait } from '../declarative-attention/playback'

export interface PlaybackSnapshot {
  state: FlashState
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

const cuesOf = (beat: FABeat): NarrationCue[] => beat.cues ?? [{ text: beat.text, spotlight: [] }]
/** Silent reading time for one phrase, roughly 15 characters per second. */
const readingMs = (text: string) => Math.max(1200, (text.length / 15) * 1000)
/** A long run is compressed to about this long, however many ops it has. */
const RUN_BUDGET_MS = 7000
const CUE_MS = { load: 1100, compute: 800, store: 1100, skip: 700 }
type OpCue = keyof typeof CUE_MS
/** Loads land before compute; standard kernels read, then write. */
const cuesFor = (op: Op): OpCue[] =>
  op.phase === 'skip'
    ? ['skip']
    : [
        ...(op.reads.length ? (['load'] as const) : []),
        ...(op.flops || op.phase === 'softmax' ? (['compute'] as const) : []),
        ...(op.writes.length ? (['store'] as const) : []),
      ]

/** Resume preserves state; only explicit seek/replay reconstructs a checkpoint. */
export class LessonPlayback {
  private snapshot: PlaybackSnapshot
  private listeners = new Set<() => void>()
  private run = new AbortController()
  private cursor = { beat: 0, command: 0 }
  private serial = 0
  /** A run whose packets are still moving; stop() commits it at once. */
  private pending: FlashState | null = null

  constructor(
    private pod: FlashAttentionPod,
    private speak: (text: string) => Promise<boolean>,
    private stopSpeaking: () => void,
    private sleep = wait,
  ) {
    this.snapshot = {
      state: initialState(),
      beatIndex: -1,
      caption:
        'Attention is slow because of memory, not math. Watch where every number travels, and how tiling keeps the N × N matrix on chip.',
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
    // An interrupted run still happened: settle into it before anyone reads the state.
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
  /** `scale` speeds up long runs. */
  private async animate(op: Op, scale: number, signal: AbortSignal) {
    for (const kind of cuesFor(op))
      await this.cue(kind, Math.max(40, Math.round(CUE_MS[kind] * scale)), signal, { op })
  }
  private async perform(command: FACommand, signal: AbortSignal) {
    if (signal.aborted) return
    const config = this.pod.scene.params
    const before = this.snapshot.state
    const next = applyCommand(before, command, config)
    if (next === before) return
    if (command.op === 'faMode') {
      this.patch({ declaration: ALGORITHM_DECLARATION[next.mode] })
      await this.sleep(900, signal)
      if (signal.aborted) return
      this.patch({ state: next, declaration: null })
      await this.sleep(500, signal)
      return
    }
    if (command.op === 'faStage') {
      this.patch({ state: next })
      if (next.stage === 'inputs') await this.cue('boot', 1200, signal)
      else await this.sleep(350, signal)
      return
    }
    // Each op commits as its packets land; a stop commits the whole run.
    this.pending = next
    const ops = programOf(config, before.mode).slice(before.pc, next.pc)
    const fullMs = ops.reduce(
      (sum, op) => sum + cuesFor(op).reduce((total, kind) => total + CUE_MS[kind], 0),
      0,
    )
    const scale = ops.length > 1 ? Math.min(0.5, RUN_BUDGET_MS / fullMs) : 1
    for (let k = 0; k < ops.length; k++) {
      await this.animate(ops[k], scale, signal)
      if (this.pending !== next) return
      this.patch({ state: k === ops.length - 1 ? next : { ...before, pc: before.pc + k + 1 } })
    }
    this.pending = null
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
        // Runs commit even if interrupted, so resume must not repeat them.
        if (command.op !== 'faMode') this.cursor.command++
        await this.perform(command, signal)
        if (signal.aborted) return
        if (command.op === 'faMode') this.cursor.command++
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
  explore = async (commands: FACommand[], text?: string) => {
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
