import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { DeclarativeAttentionPod } from './types'
import { LessonPlayback } from './playback'

export default function useLessonPlayback(
  pod: DeclarativeAttentionPod,
  speak: (text: string) => Promise<boolean>,
  stopSpeaking: () => void,
) {
  const playback = useMemo(
    () => new LessonPlayback(pod, speak, stopSpeaking),
    [pod, speak, stopSpeaking],
  )
  const snapshot = useSyncExternalStore(playback.subscribe, playback.getSnapshot)
  const current = useRef(snapshot.state)
  current.current = snapshot.state
  useEffect(() => () => playback.stop(), [playback])
  return {
    ...snapshot,
    current,
    stop: playback.stop,
    setCaption: playback.setCaption,
    play: () => playback.play(),
    step: playback.step,
    restart: playback.restart,
    replay: playback.replay,
    goTo: playback.goTo,
    explore: playback.explore,
    resolveCheckpoint: playback.resolveCheckpoint,
  }
}
