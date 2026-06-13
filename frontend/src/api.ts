import type { Pod, PodSummary, InferenceData } from './types'

export async function fetchPods(): Promise<PodSummary[]> {
  const r = await fetch('/api/pods')
  if (!r.ok) throw new Error('failed to load pods')
  return r.json()
}

export async function fetchPod(id: string): Promise<Pod> {
  const r = await fetch(`/api/pods/${id}`)
  if (!r.ok) throw new Error('failed to load pod')
  return r.json()
}

export async function runInference(text: string, podId = 'gpt2'): Promise<InferenceData> {
  const r = await fetch('/api/gpt2/forward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, pod_id: podId }),
  })
  if (!r.ok) throw new Error('inference failed')
  return r.json()
}

// Text-to-speech via the backend ElevenLabs proxy. Returns an audio blob URL,
// or null if the server has no key configured (caller falls back to Web Speech).
export async function synthesizeSpeech(text: string): Promise<string | null> {
  const r = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (r.status === 204) return null // no key configured
  if (!r.ok) return null
  const blob = await r.blob()
  return URL.createObjectURL(blob)
}

// Speech-to-text via backend ElevenLabs proxy. Returns transcript or null if unavailable.
export async function transcribeSpeech(audio: Blob): Promise<string | null> {
  const form = new FormData()
  form.append('audio', audio, 'audio.webm')
  const r = await fetch('/api/stt', { method: 'POST', body: form })
  if (r.status === 204) return null
  if (!r.ok) return null
  const data = await r.json()
  return data.text ?? null
}

export async function fetchVoiceStatus(): Promise<{ tts: boolean; stt: boolean }> {
  try {
    const r = await fetch('/api/voice/status')
    if (!r.ok) return { tts: false, stt: false }
    return r.json()
  } catch {
    return { tts: false, stt: false }
  }
}

export async function generatePod(youtubeUrl: string): Promise<{ id: string }> {
  const r = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ youtube_url: youtubeUrl }),
  })
  if (!r.ok) throw new Error('generation failed')
  return r.json()
}
