import { useCallback, useEffect, useRef, useState } from 'react'
import { synthesizeSpeech, transcribeSpeech, fetchVoiceStatus } from '../../api'
import { browserListen, browserSpeak, playAudio } from './voicePlayback'

/** Owns capture and speech lifetimes. Stop capture submits; cancel discards it. */
export function useLessonVoice() {
  const [recording, setRecording] = useState(false)
  const [serverVoice, setServerVoice] = useState({ tts: false, stt: false })
  const audio = useRef<HTMLAudioElement | null>(null)
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const recognition = useRef<any>(null)
  const speechRequest = useRef<AbortController | null>(null)
  const captureRequest = useRef<AbortController | null>(null)
  const selectedVoice = useRef<SpeechSynthesisVoice | null>(null)
  const disposed = useRef(false)

  const stopSpeaking = useCallback(() => {
    speechRequest.current?.abort()
    audio.current?.pause()
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])
  const cancelListening = useCallback(() => {
    captureRequest.current?.abort()
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop()
    recognition.current?.abort?.()
    setRecording(false)
  }, [])
  useEffect(() => {
    disposed.current = false
    const status = new AbortController()
    const timeout = setTimeout(() => status.abort(), 10000)
    fetchVoiceStatus(status.signal)
      .then((value) => {
        if (!disposed.current) setServerVoice(value)
      })
      .finally(() => clearTimeout(timeout))
    audio.current = new Audio()
    const selectVoice = () => {
      if (selectedVoice.current || !('speechSynthesis' in window)) return
      const voices = window.speechSynthesis.getVoices()
      selectedVoice.current =
        voices.find((voice) => voice.lang.startsWith('en') && voice.localService) ??
        voices.find((voice) => voice.lang.startsWith('en')) ??
        voices[0] ??
        null
    }
    selectVoice()
    window.speechSynthesis?.addEventListener('voiceschanged', selectVoice)
    return () => {
      disposed.current = true
      status.abort()
      clearTimeout(timeout)
      stopSpeaking()
      cancelListening()
      window.speechSynthesis?.removeEventListener('voiceschanged', selectVoice)
    }
  }, [stopSpeaking, cancelListening])

  const speak = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text || disposed.current) return false
      stopSpeaking()
      const request = new AbortController()
      speechRequest.current = request
      const timer = setTimeout(() => request.abort(), 20000)
      try {
        if (serverVoice.tts) {
          let url: string | null = null
          try {
            url = await synthesizeSpeech(text, request.signal)
          } catch {
            if (request.signal.aborted) return false
          }
          if (url) {
            clearTimeout(timer)
            try {
              if (disposed.current || request.signal.aborted) return false
              if (audio.current && (await playAudio(audio.current, url, text, request.signal)))
                return true
            } finally {
              URL.revokeObjectURL(url)
            }
          }
        }
        clearTimeout(timer)
        if (disposed.current || request.signal.aborted) return false
        return await browserSpeak(text, request.signal, selectedVoice.current)
      } finally {
        clearTimeout(timer)
      }
    },
    [serverVoice.tts, stopSpeaking],
  )

  const listen = useCallback(async (): Promise<string> => {
    cancelListening()
    const request = new AbortController()
    captureRequest.current = request
    const { signal } = request
    if (disposed.current) return ''
    if (!serverVoice.stt || !navigator.mediaDevices?.getUserMedia)
      return browserListen(setRecording, recognition, signal)
    return new Promise((resolve) => {
      let stream: MediaStream | null = null
      let finished = false
      const finish = (text = '') => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        signal.removeEventListener('abort', cancel)
        stream?.getTracks().forEach((track) => track.stop())
        if (!disposed.current) setRecording(false)
        resolve(text)
      }
      const cancel = () => {
        if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop()
        finish()
      }
      const timeout = setTimeout(() => request.abort(), 60000)
      signal.addEventListener('abort', cancel, { once: true })
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((acquired) => {
          stream = acquired
          // Permission may resolve long after cancel/unmount: never start a late recorder.
          if (signal.aborted || disposed.current || finished) {
            stream.getTracks().forEach((track) => track.stop())
            finish()
            return
          }
          const recorder = new MediaRecorder(stream)
          const chunks: Blob[] = []
          mediaRecorder.current = recorder
          recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data)
          }
          recorder.onerror = () => finish()
          recorder.onstop = async () => {
            stream?.getTracks().forEach((track) => track.stop())
            if (!disposed.current) setRecording(false)
            if (signal.aborted || disposed.current) {
              finish()
              return
            }
            try {
              finish(
                (await transcribeSpeech(
                  new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }),
                  signal,
                )) ?? '',
              )
            } catch {
              finish()
            }
          }
          recorder.start()
          setRecording(true)
        })
        .catch(() => finish())
    })
  }, [serverVoice.stt, cancelListening])

  const stop = useCallback(() => {
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop()
    recognition.current?.stop?.()
  }, [])
  return { speak, stopSpeaking, listen, stop, cancelListening, recording, serverVoice }
}
