import { useCallback, useRef } from 'react'
import { usePodStore } from '../state/podStore'
import { runCommands, sleep } from '../engine/affordances'

// Drives the authored narration track ("watch like a video"): for each beat it
// runs the beat's affordance commands, speaks the text, and waits before the next.
export function useNarration(speak: (t: string) => void) {
  const cancelled = useRef(false)

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
        speak(beat.text)
        // pace roughly to spoken length
        const dwell = Math.max(2200, beat.text.length * 55)
        const step = 100
        for (let t = 0; t < dwell; t += step) {
          if (cancelled.current) break
          await sleep(step)
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
    usePodStore.getState().setPlaying(false)
  }, [])

  const restart = useCallback(() => {
    cancelled.current = true
    const s = usePodStore.getState()
    s.reset()
    s.setBeatIndex(-1)
    setTimeout(() => playFrom(0), 50)
  }, [playFrom])

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
