import { useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { usePodStore } from './state/podStore'
import { fetchPods, fetchPod } from './api'
import ModelScene from './scene/ModelScene'
import CameraRig from './scene/CameraRig'
import ValueInspector from './ui/ValueInspector'
import { useVoice } from './voice/useVoice'
import { useSession } from './ai/useSession'
import { useNarration } from './ui/useNarration'
import { MicIcon, SendIcon } from './ui/icons'
import type { SessionUser } from './auth/session'

export default function App({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const pods = usePodStore((s) => s.pods)
  const pod = usePodStore((s) => s.pod)
  const playing = usePodStore((s) => s.playing)
  const thinking = usePodStore((s) => s.thinking)
  const captions = usePodStore((s) => s.captions)
  const inputText = usePodStore((s) => s.inputText)

  const [query, setQuery] = useState('')

  const { speak, stopSpeaking, listen, stop, recording, serverVoice } = useVoice()
  const { ask } = useSession(pod?.id ?? null, speak)
  const { play, pause, restart, step } = useNarration(speak, stopSpeaking)

  // Load catalogue, then auto-open the first pod.
  useEffect(() => {
    fetchPods().then((list) => {
      usePodStore.getState().setPods(list)
      if (list.length) loadPod(list[0].id)
    })
  }, [])

  const loadPod = useCallback(async (id: string) => {
    usePodStore.getState().setLoadingPod(true)
    try {
      const p = await fetchPod(id)
      usePodStore.getState().setPod(p)
    } finally {
      usePodStore.getState().setLoadingPod(false)
    }
  }, [])

  const onAsk = useCallback(
    async (text: string) => {
      const q = text.trim()
      if (!q) return
      setQuery('')
      pause()
      await ask(q)
    },
    [ask, pause],
  )

  const onMic = useCallback(async () => {
    if (recording) {
      stop()
      return
    }
    const transcript = await listen()
    if (transcript) await onAsk(transcript)
  }, [recording, listen, stop, onAsk])

  return (
    <div className="app">
      <div className="canvas-wrap">
        <Canvas camera={{ position: [0, 8, 40], fov: 50 }} dpr={[1, 2]}>
          <color attach="background" args={['#05060a']} />
          <fog attach="fog" args={['#05060a', 40, 130]} />
          {pod && <ModelScene params={pod.scene.params} />}
          <CameraRig />
        </Canvas>
      </div>

      {/* top-left: title + pod picker */}
      <div className="hud top-left">
        <div className="panel">
          <div className="title">
            Holodeck
            <span className="badge">{serverVoice.tts ? 'ElevenLabs' : 'Web Speech'}</span>
          </div>
          <div className="subtitle">{pod ? pod.title : 'Loading…'}</div>
          <div className="pod-list">
            {pods.map((p) => (
              <button
                key={p.id}
                className={`pod-item ${pod?.id === p.id ? 'active' : ''}`}
                onClick={() => loadPod(p.id)}
              >
                {p.title}
              </button>
            ))}
          </div>
          <div className="user-row">
            {user.picture ? (
              <img className="avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="avatar avatar-fallback">{user.name[0]?.toUpperCase()}</span>
            )}
            <span className="user-name">{user.name}</span>
            <button className="linklike" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* top-right: inspector */}
      <div className="hud top-right">
        <div className="panel">
          <ValueInspector />
        </div>
      </div>

      {/* bottom-center: captions + transport + ask */}
      <div className="hud bottom-center">
        {(captions || thinking) && (
          <div className="panel captions">
            {thinking ? <span className="thinking">thinking…</span> : captions}
          </div>
        )}
        <div className="panel controls">
          {playing ? (
            <button onClick={pause}>⏸ Pause</button>
          ) : (
            <button className="primary" onClick={play}>
              ▶ Play
            </button>
          )}
          <button onClick={step}>⏭ Step</button>
          <button onClick={restart}>↺ Restart</button>
          <span className="spacer" />
        </div>
        <div className="panel ask-row">
          <input
            value={query}
            placeholder='Ask: "zoom into layer 5 attention" or "run the model on: the cat sat"'
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAsk(query)}
          />
          <button
            className={`icon-btn mic ${recording ? 'recording' : ''}`}
            title={recording ? 'Stop recording' : 'Ask by voice'}
            aria-label={recording ? 'Stop recording' : 'Ask by voice'}
            onClick={onMic}
          >
            <MicIcon />
          </button>
          <button className="ask-btn" onClick={() => onAsk(query)}>
            Ask
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
