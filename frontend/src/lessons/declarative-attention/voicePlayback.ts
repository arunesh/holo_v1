const speechCapMs = (text: string) => 4000 + text.length * 120

export function playAudio(
  element: HTMLAudioElement,
  url: string,
  text: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (spoken = false) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      element.removeEventListener('ended', ended)
      element.removeEventListener('error', cancel)
      element.removeEventListener('pause', cancel)
      signal.removeEventListener('abort', cancel)
      element.pause()
      element.removeAttribute('src')
      resolve(spoken)
    }
    const ended = () => finish(true)
    const cancel = () => finish(false)
    const timeout = setTimeout(cancel, speechCapMs(text))
    element.addEventListener('ended', ended)
    element.addEventListener('error', cancel)
    element.addEventListener('pause', cancel)
    signal.addEventListener('abort', cancel, { once: true })
    element.src = url
    element.play().catch(cancel)
  })
}

export function browserSpeak(
  text: string,
  signal: AbortSignal,
  voice: SpeechSynthesisVoice | null,
): Promise<boolean> {
  if (!('speechSynthesis' in window) || signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.02
    utterance.pitch = 1
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    }
    let settled = false
    const finish = (spoken = false) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', cancel)
      utterance.onend = null
      utterance.onerror = null
      resolve(spoken)
    }
    const cancel = () => {
      finish()
      window.speechSynthesis.cancel()
    }
    const timeout = setTimeout(cancel, speechCapMs(text))
    signal.addEventListener('abort', cancel, { once: true })
    utterance.onend = () => finish(true)
    utterance.onerror = () => finish()
    window.speechSynthesis.speak(utterance)
  })
}

export function browserListen(
  setRecording: (value: boolean) => void,
  ref: { current: any },
  signal: AbortSignal,
): Promise<string> {
  const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!Recognition || signal.aborted) return Promise.resolve('')
  return new Promise((resolve) => {
    const recognition = new Recognition()
    ref.current = recognition
    let settled = false
    const finish = (text = '') => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', cancel)
      recognition.onresult = recognition.onerror = recognition.onend = null
      recognition.stop()
      if (ref.current === recognition) ref.current = null
      setRecording(false)
      resolve(text)
    }
    const cancel = () => finish()
    const timeout = setTimeout(cancel, 60000)
    signal.addEventListener('abort', cancel, { once: true })
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event: any) => finish(event.results?.[0]?.[0]?.transcript || '')
    recognition.onerror = cancel
    recognition.onend = cancel
    try {
      recognition.start()
      setRecording(true)
    } catch {
      finish()
    }
  })
}
