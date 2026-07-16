import { useCallback, useEffect, useRef } from 'react'
import { usePodStore } from '../state/podStore'
import { runCommands, sleep } from '../engine/affordances'

// Drives the authored narration track ("watch like a video"): for each beat it
// runs the beat's affordance commands, speaks the text, and waits for the speech
// to finish before the next.
export function useNarration(speak: (t: string) => Promise<boolean>, stopSpeaking: () => void) {
  const cancelled = useRef(false)

  // The playback loop is a free-running async function; unmounting (e.g. sign-out)
  // doesn't stop it on its own, so cancel it and silence any current speech.
  useEffect(
    () => () => {
      cancelled.current = true
      stopSpeaking()
      usePodStore.getState().setPlaying(false)
    },
    [stopSpeaking],
  )

  const playFrom = useCallback(
    async (startIndex: number) => {
      const store = usePodStore.getState()
      const pod = store.pod
      if (!pod) return
      cancelled.current = false
      store.setPlaying(true)

      for (let i = startIndex; i < pod.narration.length; i++) {
        if (cancelled.current) break
        const beat = pod.narration[i]
        store.setBeatIndex(i)
        store.patch({ captions: beat.text })
        await runCommands(beat.commands, 300)
        const spoke = await speak(beat.text)
        if (cancelled.current) break
        if (spoke) {
          // brief breath between beats
          await sleep(400)
        } else {
          // no TTS available — pace roughly to reading length instead
          const dwell = Math.max(2200, beat.text.length * 55)
          const step = 100
          for (let t = 0; t < dwell; t += step) {
            if (cancelled.current) break
            await sleep(step)
          }
        }
      }
      if (!cancelled.current) usePodStore.getState().setBeatIndex(pod.narration.length - 1)
      usePodStore.getState().setPlaying(false)
    },
    [speak],
  )

  const play = useCallback(() => {
    const s = usePodStore.getState()
    playFrom(Math.max(0, s.beatIndex + (s.beatIndex >= s.pod!.narration.length - 1 ? -s.beatIndex : 1)))
  }, [playFrom])

  const pause = useCallback(() => {
    cancelled.current = true
    stopSpeaking()
    usePodStore.getState().setPlaying(false)
  }, [stopSpeaking])

  const restart = useCallback(() => {
    cancelled.current = true
    stopSpeaking()
    const s = usePodStore.getState()
    s.reset()
    s.setBeatIndex(-1)
    setTimeout(() => playFrom(0), 50)
  }, [playFrom, stopSpeaking])

  const step = useCallback(async () => {
    const s = usePodStore.getState()
    if (!s.pod) return
    const next = Math.min(s.beatIndex + 1, s.pod.narration.length - 1)
    const beat = s.pod.narration[next]
    s.setBeatIndex(next)
    s.patch({ captions: beat.text })
    await runCommands(beat.commands, 250)
    speak(beat.text)
  }, [speak])

  return { play, pause, restart, step }
}
