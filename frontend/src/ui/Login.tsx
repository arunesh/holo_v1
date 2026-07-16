import { useEffect, useRef, useState } from 'react'
import { signInWithGoogle, googleConfigured } from '../auth/session'
import type { SessionUser } from '../auth/session'
import { GoogleIcon } from './icons'
import './login.css'

// The gate into the holodeck. The card is wired into a live constellation:
// hovering or pressing a sign-in control feeds a forward pass through the
// network — signing in is the first input token.
export default function Login({ onSignIn }: { onSignIn: (u: SessionUser) => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const firePulse = useRef<() => void>(() => {})

  const onGoogle = async () => {
    if (!googleConfigured) {
      setNote({
        text: 'Google sign-in needs a client ID on this deployment (VITE_GOOGLE_CLIENT_ID). Guest access opens the same holodeck.',
      })
      return
    }
    setBusy(true)
    setNote(null)
    firePulse.current()
    try {
      onSignIn(await signInWithGoogle())
    } catch {
      setNote({ text: 'Google sign-in did not complete. Try again, or continue as guest.', error: true })
    } finally {
      setBusy(false)
    }
  }

  const onEnterSession = () => {
    firePulse.current()
    setBusy(true)
    // let the pulse travel before the scene swap
    window.setTimeout(() => onSignIn({ name: 'Guest', provider: 'guest' }), 650)
  }

  return (
    <div className="login">
      <NeuralCanvas firePulse={firePulse} />
      <main className="login-card">
        <div className="login-eyebrow">HOLODECK</div>
        <h1>
          Step <em>inside</em> the video.
        </h1>
        <p className="login-sub">
          Holodeck turns a video into a place. Fly through the ideas while they play, ask
          questions out loud, and steer where it goes.
        </p>
        <button
          className="session-tile"
          onClick={onEnterSession}
          onMouseEnter={() => firePulse.current()}
          disabled={busy}
        >
          <span className="session-label">
            <span className="live-dot" />
            LIVE SESSION
          </span>
          <span className="session-title">
            Step into the Transformer
            <span className="session-arrow">→</span>
          </span>
          <span className="session-desc">
            Ride a GPT-2 forward pass — attention heads, MLPs, and next-token predictions in
            real space.
          </span>
          <span className="session-meta">
            <span>GPT-2 SMALL</span>
            <span>12 LAYERS</span>
            <span>124M PARAMS</span>
          </span>
        </button>
        <p className="more-sessions">More sessions docking soon.</p>
        <div className="login-or">OR</div>
        <button
          className="g-btn"
          onClick={onGoogle}
          onMouseEnter={() => firePulse.current()}
          disabled={busy}
        >
          <GoogleIcon />
          Continue with Google
        </button>
        {note && <p className={`login-note ${note.error ? 'login-err' : ''}`}>{note.text}</p>}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Background constellation: layered nodes + edges, with forward-pass pulses.

type Node = { x: number; y: number; r: number; phase: number; li: number }
type Edge = { a: Node; b: Node }

const LAYERS = 7
const PASS_MS = 2600

function NeuralCanvas({ firePulse }: { firePulse: React.MutableRefObject<() => void> }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    let raf = 0
    let W = 0
    let H = 0
    let layers: Node[][] = []
    let edges: Edge[] = []
    let pulses: number[] = [] // start timestamps
    let lastAuto = performance.now()

    function build() {
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const x0 = W < 720 ? W * 0.08 : Math.min(W * 0.36, 560)
      const x1 = W - Math.max(48, W * 0.04)
      layers = []
      for (let i = 0; i < LAYERS; i++) {
        const n = i === LAYERS - 1 ? 3 : 6 + ((i * 5) % 4)
        const col: Node[] = []
        for (let j = 0; j < n; j++) {
          col.push({
            x: x0 + ((x1 - x0) * i) / (LAYERS - 1) + (Math.random() - 0.5) * 34,
            y: H * (0.12 + (0.76 * (j + 0.5)) / n) + (Math.random() - 0.5) * 28,
            r: 1.6 + Math.random() * 2.2,
            phase: Math.random() * Math.PI * 2,
            li: i,
          })
        }
        layers.push(col)
      }
      edges = []
      for (let i = 0; i < LAYERS - 1; i++) {
        for (const a of layers[i]) {
          const targets = [...layers[i + 1]]
            .sort(() => Math.random() - 0.5)
            .slice(0, 2 + Math.floor(Math.random() * 2))
          for (const b of targets) edges.push({ a, b })
        }
      }
    }

    const drift = (n: Node, t: number) => n.y + Math.sin(t * 0.45 + n.phase) * 3.5

    function draw(now: number) {
      const t = now / 1000
      ctx.clearRect(0, 0, W, H)

      // edges
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(126,160,255,0.09)'
      ctx.beginPath()
      for (const e of edges) {
        ctx.moveTo(e.a.x, drift(e.a, t))
        ctx.lineTo(e.b.x, drift(e.b, t))
      }
      ctx.stroke()

      // pulse wavefronts
      pulses = pulses.filter((start) => now - start < PASS_MS + 700)
      for (const start of pulses) {
        const p = ((now - start) / PASS_MS) * (LAYERS - 1)
        for (const e of edges) {
          const local = p - e.a.li
          if (local <= 0 || local >= 1) continue
          const ya = drift(e.a, t)
          const yb = drift(e.b, t)
          const px = e.a.x + (e.b.x - e.a.x) * local
          const py = ya + (yb - ya) * local
          // lit segment behind the wavefront
          ctx.strokeStyle = 'rgba(126,160,255,0.30)'
          ctx.beginPath()
          ctx.moveTo(e.a.x, ya)
          ctx.lineTo(px, py)
          ctx.stroke()
          // ember tip
          ctx.fillStyle = 'rgba(255,179,92,0.9)'
          ctx.beginPath()
          ctx.arc(px, py, 1.8, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // nodes (+ activation bloom when a wavefront passes their layer)
      for (const col of layers) {
        for (const n of col) {
          const y = drift(n, t)
          let bloom = 0
          for (const start of pulses) {
            const p = ((now - start) / PASS_MS) * (LAYERS - 1)
            bloom = Math.max(bloom, Math.exp(-((p - n.li) ** 2) / 0.06))
          }
          if (bloom > 0.02) {
            const last = n.li === LAYERS - 1
            ctx.fillStyle = last
              ? `rgba(255,179,92,${0.5 * bloom})`
              : `rgba(93,211,158,${0.4 * bloom})`
            ctx.beginPath()
            ctx.arc(n.x, y, n.r * (2 + 5 * bloom), 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.fillStyle = 'rgba(174,191,255,0.75)'
          ctx.beginPath()
          ctx.arc(n.x, y, n.r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    function loop(now: number) {
      if (now - lastAuto > 4600) {
        lastAuto = now
        pulses.push(now)
      }
      draw(now)
      raf = requestAnimationFrame(loop)
    }

    firePulse.current = () => {
      if (reduced) return
      const now = performance.now()
      if (pulses.length < 3) {
        pulses.push(now)
        lastAuto = now
      }
    }

    build()
    if (reduced) {
      draw(performance.now())
    } else {
      raf = requestAnimationFrame(loop)
    }

    const onResize = () => {
      build()
      if (reduced) draw(performance.now())
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      firePulse.current = () => {}
    }
  }, [firePulse])

  return <canvas ref={ref} className="login-canvas" />
}
