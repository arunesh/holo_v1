import { useCallback, useEffect, useRef, useState } from 'react'
import { synthesizeSpeech, transcribeSpeech, fetchVoiceStatus } from '../api'

// Voice I/O with graceful degradation:
//  - TTS: backend ElevenLabs proxy if a key is set, else browser speechSynthesis.
//  - STT: backend ElevenLabs proxy if available, else browser SpeechRecognition.
export function useVoice() {
  const [recording, setRecording] = useState(false)
  const [serverVoice, setServerVoice] = useState({ tts: false, stt: false })
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const audioEl = useRef<HTMLAudioElement | null>(null)
  const recognition = useRef<any>(null)

  useEffect(() => {
    fetchVoiceStatus().then(setServerVoice)
    audioEl.current = new Audio()
  }, [])

  // --- speak: resolves once playback has finished (true if anything was spoken) ---
  const speak = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text) return false
      if (serverVoice.tts) {
        const url = await synthesizeSpeech(text)
        const el = audioEl.current
        if (url && el) {
          el.src = url
          const finished = waitForAudioEnd(el, text)
          try {
            await el.play()
            return await finished
          } catch {
            return browserSpeak(text)
          }
        }
      }
      return browserSpeak(text)
    },
    [serverVoice.tts],
  )

  const stopSpeaking = useCallback(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    if (audioEl.current && !audioEl.current.paused) audioEl.current.pause()
  }, [])

  // --- listen (returns a transcript) ---
  const listen = useCallback(async (): Promise<string> => {
    // Prefer backend STT via MediaRecorder when available.
    if (serverVoice.stt && navigator.mediaDevices?.getUserMedia) {
      return new Promise<string>(async (resolve) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          const mr = new MediaRecorder(stream)
          mediaRecorder.current = mr
          chunks.current = []
          mr.ondataavailable = (e) => chunks.current.push(e.data)
          mr.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop())
            setRecording(false)
            const blob = new Blob(chunks.current, { type: 'audio/webm' })
            const text = await transcribeSpeech(blob)
            resolve(text ?? '')
          }
          mr.start()
          setRecording(true)
        } catch {
          resolve(await browserListen(setRecording, recognition))
        }
      })
    }
    // Browser fallback (Web Speech API).
    return browserListen(setRecording, recognition)
  }, [serverVoice.stt])

  const stop = useCallback(() => {
    if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
      mediaRecorder.current.stop()
    }
    if (recognition.current) {
      recognition.current.stop()
    }
  }, [])

  return { speak, stopSpeaking, listen, stop, recording, serverVoice }
}

// Generous upper bound on how long speaking `text` could take, so a stalled
// utterance or audio element can never wedge callers awaiting completion.
function speechCapMs(text: string) {
  return 4000 + text.length * 120
}

function waitForAudioEnd(el: HTMLAudioElement, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (spoke: boolean) => {
      window.clearTimeout(cap)
      el.removeEventListener('ended', onDone)
      el.removeEventListener('pause', onDone)
      el.removeEventListener('error', onError)
      resolve(spoke)
    }
    const onDone = () => settle(true)
    const onError = () => settle(false)
    const cap = window.setTimeout(onDone, speechCapMs(text))
    el.addEventListener('ended', onDone)
    el.addEventListener('pause', onDone)
    el.addEventListener('error', onError)
  })
}

function browserSpeak(text: string): Promise<boolean> {
  if (!('speechSynthesis' in window)) return Promise.resolve(false)
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.02
    u.pitch = 1.0
    const cap = window.setTimeout(() => resolve(true), speechCapMs(text))
    u.onend = () => {
      window.clearTimeout(cap)
      resolve(true)
    }
    u.onerror = () => {
      window.clearTimeout(cap)
      resolve(false)
    }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  })
}

function browserListen(
  setRecording: (b: boolean) => void,
  ref: React.MutableRefObject<any>,
): Promise<string> {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR) return Promise.resolve('')
  return new Promise<string>((resolve) => {
    const rec = new SR()
    ref.current = rec
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (e: any) => resolve(e.results[0][0].transcript)
    rec.onerror = () => resolve('')
    rec.onend = () => setRecording(false)
    rec.start()
    setRecording(true)
  })
}
