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
import { useLessonVoice } from './useLessonVoice'
import type { AttentionMode, ConversationTurn, DeclarativeAttentionPod } from './types'
import { nextRead, residentBytes, selectedChunkIds, stageReached } from './simulation'
import useLessonPlayback from './useLessonPlayback'
import { askTutor } from './tutor'
import GpuStage from './GpuStage'
import MemoryInspector from './MemoryInspector'
import CheckpointCard from './CheckpointCard'
import './lesson.css'

const GpuSpatial = lazy(() => import('./GpuSpatial'))
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

export default function DeclarativeAttentionLesson({
  pod,
  catalogue,
  onSelect,
  onSignOut,
}: {
  pod: DeclarativeAttentionPod
  catalogue: PodSummary[]
  onSelect: (id: string) => void
  onSignOut: () => void
}) {
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
  const [comparison, setComparison] = useState<{
    mode: string
    fraction: number
    resident: number
  } | null>(null)
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
  const mode = (next: AttentionMode) => {
    interrupt()
    lesson.explore([{ op: 'daMode', args: { mode: next, chunks: lesson.state.focusedChunks } }])
  }
  const toggleChunk = (id: number) => {
    interrupt()
    const existing = lesson.state.mode === 'focus' ? lesson.state.focusedChunks : []
    const chunks = existing.includes(id)
      ? existing.filter((chunk) => chunk !== id)
      : [...existing, id]
    lesson.explore([{ op: 'daMode', args: { mode: chunks.length ? 'focus' : 'local', chunks } }])
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
        pod.scene.params,
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
  const ready = stageReached(lesson.state, 'prefill')
  const selected = selectedChunkIds(lesson.state, pod.scene.params)
  const action = (run: () => void) => {
    interrupt()
    run()
  }
  const sceneProps = {
    state: lesson.state,
    config: pod.scene.params,
    cue: lesson.visual,
    declaration: lesson.declaration,
    prefilledSlots: lesson.prefilledSlots,
    onChunk: toggleChunk,
  }
  const checkpoint = lesson.checkpoint || practice
  const currentRead = nextRead(lesson.state, pod.scene.params)
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
        <span className="da-simulation-badge">PROTOCOL SIMULATION</span>
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
          <div className="da-kicker">DECLARATIVE ATTENTION / BYTES ON THE BUS</div>
          <h1>
            Read less KV. <span>Move no KV.</span>
          </h1>
          <p>Change what attention reads. Watch what stays resident.</p>
        </div>
        <a
          className="da-paper"
          href="https://arxiv.org/abs/2609.02737"
          target="_blank"
          rel="noreferrer"
        >
          Read the paper ↗<small>arXiv:2609.02737</small>
        </a>
      </section>
      <section className="da-guide" ref={guideElement}>
        <div className="da-caption" aria-live="polite">
          <span className="da-kicker">
            {thinking
              ? 'GROK IS THINKING · YOUR SCENE IS HELD'
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
                onClick={() =>
                  action(() => {
                    lesson.step()
                  })
                }
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
                ? 'THE HARDWARE'
                : `${String(lesson.beatIndex + 1).padStart(2, '0')} / ${pod.narration[lesson.beatIndex].title}`}
            </span>
            <span className="da-stage-status">
              {ready ? 'KV RESIDENT' : 'KV EMPTY'} · {lesson.state.mode.toUpperCase()}
            </span>
          </div>
          {!guiding && (
            <div className="da-view-controls">
              <button aria-pressed={view === 'spatial'} onClick={() => setView('spatial')}>
                Spatial view
              </button>
              <button aria-pressed={view === 'diagram'} onClick={() => setView('diagram')}>
                Diagram · low power
              </button>
            </div>
          )}
          {view === 'diagram' ? (
            <GpuStage {...sceneProps} />
          ) : (
            <SpatialBoundary
              fallback={
                <>
                  <p>Spatial view unavailable. The diagram and all controls still work.</p>
                  <GpuStage {...sceneProps} />
                </>
              }
            >
              <Suspense fallback={<div className="da-loading">Opening the spatial GPU…</div>}>
                <GpuSpatial
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
              <span style={{ color: '#ffb35c' }}>● weights</span>
              <span style={{ color: '#aeb8cb' }}>● SYS · instructions + question</span>
              <span style={{ color: '#e98772' }}>● documents C1–C4</span>
              <span style={{ color: '#5dd39e' }}>● reply so far</span>
              <span>Moving dots = data being read or written · timing illustrative</span>
            </div>
          )}
        </div>
        {ready && (
          <MemoryInspector
            state={lesson.state}
            config={pod.scene.params}
            animating={!!lesson.visual}
            spotlit={!!lesson.spotlight?.includes('meter')}
          />
        )}
      </section>
      {ready && !guiding && (
      <section className="da-experiment" aria-label="Attention experiment">
        <div className="da-mode-buttons">
          {(['global', 'focus', 'local'] as AttentionMode[]).map((value) => (
            <button
              key={value}
              disabled={!ready}
              className={lesson.state.mode === value ? 'selected' : ''}
              aria-pressed={lesson.state.mode === value}
              onClick={() => mode(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="da-chunk-buttons">
          {pod.scene.params.chunks.map((chunk) => (
            <button
              key={chunk.id}
              disabled={!ready}
              aria-label={`Toggle ${chunk.label}`}
              aria-pressed={selected.includes(chunk.id)}
              style={{ borderColor: selected.includes(chunk.id) ? chunk.color : undefined }}
              onClick={() => toggleChunk(chunk.id)}
            >
              {chunk.label}
            </button>
          ))}
        </div>
        <button
          className="da-primary"
          disabled={
            !ready || !!lesson.visual || !!lesson.declaration || lesson.state.events.length >= 128
          }
          onClick={() =>
            action(() => {
              lesson.explore([
                { op: 'daDecode', args: { text: `Token ${lesson.state.responseTokens + 1}` } },
              ])
            })
          }
        >
          Decode one token →
        </button>
        {lesson.state.events.length >= 128 && (
          <span className="da-hint">
            128-step experiment complete. Replay chapter 4 to start a fresh comparison.
          </span>
        )}
        <button
          disabled={!ready}
          onClick={() =>
            setComparison({
              mode: lesson.state.mode,
              fraction: currentRead.fraction,
              resident: residentBytes(lesson.state, pod.scene.params),
            })
          }
        >
          Save comparison
        </button>
        <button
          onClick={() => {
            interrupt()
            setPractice('residency')
          }}
        >
          Check my understanding
        </button>
      </section>
      )}
      {comparison && (
        <p className="da-comparison" role="status">
          Saved {comparison.mode}: {(comparison.fraction * 100).toFixed(1)}% read → now{' '}
          {(currentRead.fraction * 100).toFixed(1)}%. Resident KV{' '}
          {comparison.resident === residentBytes(lesson.state, pod.scene.params)
            ? 'unchanged'
            : 'grew with the reply'}
          . <button onClick={() => setComparison(null)}>Clear comparison</button>
        </p>
      )}
      {checkpoint && (
        <CheckpointCard
          key={checkpoint}
          id={checkpoint}
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
            aria-label="Ask the DA tutor"
            placeholder="Ask: “Why does local still read some KV?”"
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
            Ask Grok ↗
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
          <span>PAPER RESULT, NOT THIS SIMULATION</span> Gemma-4-31B: 52.0% fewer attended tokens
          during decoding · −1.27 percentage points accuracy across 15 tasks. Not a measured GPU
          speedup.
        </footer>
      )}
    </main>
  )
}
