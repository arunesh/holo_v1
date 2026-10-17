import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { PodSummary } from '../../types'
import { useLessonVoice } from '../declarative-attention/useLessonVoice'
import CheckpointCard from '../declarative-attention/CheckpointCard'
import type { ConversationTurn, FACommand, FlashAttentionPod } from './types'
import { ALGORITHM_LABEL, ALGORITHMS, canStep, runOf, stageReached } from './simulation'
import useLessonPlayback from './useLessonPlayback'
import { askTutor } from './tutor'
import { CHECKPOINTS } from './checkpoints'
import { COLORS } from './geometry'
import FlashStage from './FlashStage'
import TrafficInspector from './TrafficInspector'
import '../declarative-attention/lesson.css'
import './lesson.css'

const FlashSpatial = lazy(() => import('./FlashSpatial'))
class SpatialBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export default function FlashAttentionLesson({
  pod,
  catalogue,
  onSelect,
  onSignOut,
}: {
  pod: FlashAttentionPod
  catalogue: PodSummary[]
  onSelect: (id: string) => void
  onSignOut: () => void
}) {
  const config = pod.scene.params
  const voice = useLessonVoice()
  const voiceEnabled = useRef(true)
  const speech = useRef(voice.speak)
  speech.current = voice.speak
  const speak = useCallback(
    (text: string) => (voiceEnabled.current ? speech.current(text) : Promise.resolve(false)),
    [],
  )
  const lesson = useLessonPlayback(pod, speak, voice.stopSpeaking)
  const [question, setQuestion] = useState('')
  const [thinking, setThinking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [view, setView] = useState<'spatial' | 'diagram'>('spatial')
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [practice, setPractice] = useState<string | null>(null)
  const [history, setHistory] = useState<ConversationTurn[]>([])
  const historyRef = useRef<ConversationTurn[]>([])
  const guideElement = useRef<HTMLElement>(null)
  const sceneElement = useRef<HTMLElement>(null)
  const showScene = () =>
    requestAnimationFrame(() => {
      const scene = sceneElement.current
      if (!scene) return
      scene.style.scrollMarginTop = `${(guideElement.current?.offsetHeight ?? 100) + 12}px`
      scene.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' })
    })
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setReducedMotion(preference.matches)
    preference.addEventListener('change', changed)
    return () => preference.removeEventListener('change', changed)
  }, [])
  const request = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      request.current?.abort()
    },
    [],
  )

  const interrupt = () => {
    request.current?.abort()
    setThinking(false)
    lesson.stop()
    voice.cancelListening()
  }
  const run = (commands: FACommand[]) => {
    interrupt()
    lesson.explore(commands)
  }
  const ask = async (text: string) => {
    if (!text.trim()) return
    interrupt()
    const controller = new AbortController()
    request.current = controller
    setQuestion('')
    setThinking(true)
    try {
      const response = await askTutor(
        pod.id,
        text.trim(),
        lesson.current.current,
        controller.signal,
        historyRef.current,
        config,
      )
      if (controller.signal.aborted) return
      setThinking(false)
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: text.trim() },
        // Command-only replies have no narration; history turns must be non-empty.
        { role: 'assistant', content: response.text.trim() || '(Updated the scene.)' },
      ].slice(-12) as ConversationTurn[]
      setHistory(historyRef.current)
      await lesson.explore(response.commands, response.text)
    } catch (error) {
      if (!controller.signal.aborted)
        lesson.setCaption(error instanceof Error ? error.message : 'Tutor unavailable.')
    } finally {
      if (!controller.signal.aborted) setThinking(false)
    }
  }
  const microphone = async () => {
    if (voice.recording) {
      voice.stop()
      return
    }
    interrupt()
    const controller = new AbortController()
    request.current = controller
    const transcript = await voice.listen()
    if (controller.signal.aborted) return
    if (transcript) await ask(transcript)
    else lesson.setCaption('No speech captured. You can try again or type your question.')
  }
  const action = (go: () => void) => {
    interrupt()
    go()
  }
  const flashRun = runOf(lesson.state, config)
  const ready = stageReached(lesson.state, 'inputs')
  const busy = !!lesson.visual || !!lesson.declaration
  const stepping = canStep(lesson.state, config) && !busy
  const tiled = lesson.state.mode !== 'standard'
  const sceneProps = {
    state: lesson.state,
    run: flashRun,
    config,
    cue: lesson.visual,
    declaration: lesson.declaration,
  }
  const checkpoint = lesson.checkpoint || practice
  const guiding = lesson.playing
  return (
    <main className="da-lesson">
      <header className="da-header">
        <a className="da-brand" href="?lesson=gpt2">
          ✦ HOLODECK
        </a>
        <span className="da-divider" />
        <select
          aria-label="Choose lesson"
          value={pod.id}
          onChange={(event) => {
            interrupt()
            onSelect(event.target.value)
          }}
        >
          {catalogue.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <span className="da-simulation-badge">KERNEL SIMULATION</span>
        <button
          className="da-signout"
          onClick={() => {
            interrupt()
            onSignOut()
          }}
        >
          Sign out
        </button>
      </header>
      <section className="da-title-row">
        <div>
          <div className="da-kicker">FLASHATTENTION / IO-AWARE EXACT ATTENTION</div>
          <h1>
            Same math. <span>Fewer trips to memory.</span>
          </h1>
          <p>Watch every number cross between HBM and SRAM, and see tiling keep the N × N matrix on chip.</p>
        </div>
        <a
          className="da-paper"
          href="https://arxiv.org/abs/2205.14135"
          target="_blank"
          rel="noreferrer"
        >
          Read the paper ↗<small>arXiv:2205.14135 · NeurIPS 2022</small>
        </a>
      </section>
      <section className="da-guide" ref={guideElement}>
        <div className="da-caption" aria-live="polite">
          <span className="da-kicker">
            {thinking
              ? 'THE TUTOR IS THINKING · YOUR SCENE IS HELD'
              : checkpoint
                ? 'PAUSED FOR YOUR PREDICTION · CHECK BELOW THE SCENE'
                : 'THE GUIDE'}
          </span>
          <p>{lesson.caption}</p>
        </div>
        <div className="da-transport">
          <button
            className="da-primary"
            disabled={!!checkpoint || lesson.completed}
            onClick={() =>
              lesson.playing
                ? interrupt()
                : action(() => {
                    lesson.play()
                    showScene()
                  })
            }
          >
            {lesson.playing
              ? 'Ⅱ Pause'
              : lesson.completed
                ? 'Lesson complete'
                : lesson.beatIndex < 0
                  ? '▶ Start lesson'
                  : '▶ Continue'}
          </button>
          {!guiding && (
            <>
              <button
                disabled={!!checkpoint || lesson.completed}
                onClick={() => action(() => lesson.step())}
              >
                Step →
              </button>
              <button
                onClick={() =>
                  action(() => {
                    setPractice(null)
                    lesson.replay()
                  })
                }
              >
                Replay chapter
              </button>
              <button
                onClick={() =>
                  action(() => {
                    setPractice(null)
                    lesson.restart()
                  })
                }
              >
                ↺ Restart
              </button>
            </>
          )}
          <button
            onClick={() => {
              const next = !muted
              setMuted(next)
              voiceEnabled.current = !next
              if (next) voice.stopSpeaking()
            }}
            aria-pressed={muted}
          >
            {muted ? 'Voice off' : 'Voice on'}
          </button>
          {(thinking || voice.recording) && <button onClick={interrupt}>Cancel</button>}
        </div>
      </section>
      <section className={`da-workspace ${ready ? '' : 'da-workspace-solo'}`} ref={sceneElement}>
        <div className="da-diagram-panel">
          <div className="da-stage-heading">
            <span>
              {lesson.beatIndex < 0
                ? 'THE MEMORY HIERARCHY'
                : `${String(lesson.beatIndex + 1).padStart(2, '0')} / ${pod.narration[lesson.beatIndex].title}`}
            </span>
            <span className="da-stage-status">
              {ready
                ? `${ALGORITHM_LABEL[lesson.state.mode].toUpperCase()} · STEP ${flashRun.pc}/${flashRun.total}`
                : 'INPUTS NOT LOADED'}
            </span>
          </div>
          {!guiding && (
            <div className="da-view-controls">
              <button aria-pressed={view === 'spatial'} onClick={() => setView('spatial')}>
                Spatial view
              </button>
              <button aria-pressed={view === 'diagram'} onClick={() => setView('diagram')}>
                Diagram · every value
              </button>
            </div>
          )}
          {view === 'diagram' ? (
            <FlashStage {...sceneProps} />
          ) : (
            <SpatialBoundary
              fallback={
                <>
                  <p>Spatial view unavailable. The diagram and all controls still work.</p>
                  <FlashStage {...sceneProps} />
                </>
              }
            >
              <Suspense fallback={<div className="da-loading">Opening the spatial GPU…</div>}>
                <FlashSpatial
                  {...sceneProps}
                  reducedMotion={reducedMotion}
                  spotlight={lesson.spotlight}
                  guiding={guiding}
                />
              </Suspense>
            </SpatialBoundary>
          )}
          {!guiding && (
            <div className="da-legend">
              <span style={{ color: COLORS.q }}>■ Q</span>
              <span style={{ color: COLORS.k }}>■ K</span>
              <span style={{ color: COLORS.v }}>■ V</span>
              <span style={{ color: COLORS.o }}>■ O</span>
              <span style={{ color: COLORS.stats }}>■ m, ℓ (softmax statistics)</span>
              <span style={{ color: COLORS.s }}>■ S scores</span>
              <span style={{ color: COLORS.p }}>■ P probabilities</span>
              <span>Moving squares = values crossing the HBM bus · timing illustrative</span>
            </div>
          )}
        </div>
        {ready && (
          <TrafficInspector
            run={flashRun}
            config={config}
            animating={busy}
            spotlit={!!lesson.spotlight?.includes('meter')}
          />
        )}
      </section>
      {ready && !guiding && (
        <section className="da-experiment" aria-label="Attention experiment">
          <div className="da-mode-buttons">
            {ALGORITHMS.map((value) => (
              <button
                key={value}
                className={lesson.state.mode === value ? 'selected' : ''}
                aria-pressed={lesson.state.mode === value}
                onClick={() => run([{ op: 'faMode', args: { mode: value } }])}
              >
                {ALGORITHM_LABEL[value]}
              </button>
            ))}
          </div>
          <button
            className="da-primary"
            disabled={!stepping}
            onClick={() => run([{ op: 'faStep', args: {} }])}
          >
            One step →
          </button>
          <button disabled={!stepping} onClick={() => run([{ op: 'faRun', args: { until: 'tile' } }])}>
            {tiled ? 'Finish tile' : 'Finish row block'}
          </button>
          <button disabled={!stepping} onClick={() => run([{ op: 'faRun', args: { until: 'pass' } }])}>
            {tiled ? 'Finish K, V block' : 'Finish kernel'}
          </button>
          <button disabled={!stepping} onClick={() => run([{ op: 'faRun', args: { until: 'end' } }])}>
            Run to the end
          </button>
          <button onClick={() => run([{ op: 'faStage', args: { stage: 'inputs' } }])}>
            Reset run
          </button>
          <button
            onClick={() => {
              interrupt()
              setPractice('materialize')
            }}
          >
            Check my understanding
          </button>
          <span className="da-hint">Switch algorithm to rerun the same Q, K and V another way.</span>
        </section>
      )}
      {checkpoint && (
        <CheckpointCard
          key={checkpoint}
          id={checkpoint}
          checkpoints={CHECKPOINTS}
          onContinue={() => {
            setPractice(null)
            lesson.resolveCheckpoint()
            lesson.play()
            showScene()
          }}
        />
      )}
      {!guiding && (
        <nav className="da-chapters" aria-label="Lesson chapters">
          {pod.narration.map((beat, index) => (
            <button
              key={beat.id}
              aria-current={index === lesson.beatIndex ? 'step' : undefined}
              title={beat.title}
              onClick={() =>
                action(() => {
                  setPractice(null)
                  lesson.goTo(index)
                  showScene()
                })
              }
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              {beat.title}
            </button>
          ))}
        </nav>
      )}
      {!guiding && lesson.beatIndex >= 0 && (
        <section className="da-narrator">
          <form
            className="da-ask"
            onSubmit={(event) => {
              event.preventDefault()
              ask(question)
            }}
          >
            <input
              aria-label="Ask the FlashAttention tutor"
              placeholder="Ask: “Why does K stay in SRAM while Q streams through?”"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={4000}
              disabled={thinking}
            />
            <button
              type="button"
              aria-label={voice.recording ? 'Stop recording' : 'Ask by voice'}
              onClick={microphone}
            >
              {voice.recording ? '■ Stop mic' : 'Microphone'}
            </button>
            <button type="submit" disabled={thinking || !question.trim()}>
              Ask the tutor ↗
            </button>
          </form>
          {history.length > 0 && (
            <details className="da-conversation">
              <summary>Conversation · {history.length / 2} recent exchanges</summary>
              {history.map((turn, i) => (
                <p key={i}>
                  <strong>{turn.role === 'user' ? 'You' : 'Tutor'}:</strong> {turn.content}
                </p>
              ))}
            </details>
          )}
        </section>
      )}
      {!guiding && (
        <footer className="da-footnote">
          <span>PAPER RESULT, NOT THIS SIMULATION</span> On GPT-2 medium attention, FlashAttention cut HBM
          traffic from 40.3 GB to 4.4 GB and runtime from 41.7 ms to 7.3 ms, despite more FLOPs. Block-sparse
          FlashAttention ran 2–4× faster than FlashAttention.
        </footer>
      )}
    </main>
  )
}
