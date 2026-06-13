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

  // --- speak ---
  const speak = useCallback(
    async (text: string) => {
      if (!text) return
      if (serverVoice.tts) {
        const url = await synthesizeSpeech(text)
        if (url && audioEl.current) {
          audioEl.current.src = url
          await audioEl.current.play().catch(() => browserSpeak(text))
          return
        }
      }
      browserSpeak(text)
    },
    [serverVoice.tts],
  )

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

  return { speak, listen, stop, recording, serverVoice }
}

function browserSpeak(text: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 1.02
  u.pitch = 1.0
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
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
