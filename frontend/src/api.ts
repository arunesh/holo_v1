import type { Pod, PodSummary, InferenceData } from './types'
import { AUTH_PROTOCOL, loadSession, signOutEverywhere } from './auth/session'

/** Every API call carries the session token; a rejected token returns the app to login. */
async function apiFetch(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const token = loadSession()?.token
  const r = await fetch(path, {
    ...init,
    headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (r.status === 401) signOutEverywhere()
  return r
}

/** Tutor sockets offer the token as a subprotocol, keeping it out of URLs and logs. */
export function openSocket(path: string): WebSocket {
  const token = loadSession()?.token
  return new WebSocket(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`,
    token ? [AUTH_PROTOCOL, token] : [AUTH_PROTOCOL],
  )
}

export async function fetchPods(): Promise<PodSummary[]> {
  const r = await apiFetch('/api/pods')
  if (!r.ok) throw new Error('failed to load pods')
  return r.json()
}

export async function fetchPod(id: string): Promise<Pod> {
  const r = await apiFetch(`/api/pods/${id}`)
  if (!r.ok) throw new Error('failed to load pod')
  return r.json()
}

export async function runInference(text: string, podId = 'gpt2'): Promise<InferenceData> {
  const r = await apiFetch('/api/gpt2/forward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, pod_id: podId }),
  })
  if (!r.ok) throw new Error('inference failed')
  return r.json()
}

// Text-to-speech via the backend ElevenLabs proxy. Returns an audio blob URL,
// or null if the server has no key configured (caller falls back to Web Speech).
export async function synthesizeSpeech(text: string, signal?: AbortSignal): Promise<string | null> {
  const r = await apiFetch('/api/tts', {
    signal,
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
export async function transcribeSpeech(audio: Blob, signal?: AbortSignal): Promise<string | null> {
  const form = new FormData()
  form.append('audio', audio, 'audio.webm')
  const r = await apiFetch('/api/stt', { method: 'POST', body: form, signal })
  if (r.status === 204) return null
  if (!r.ok) return null
  const data = await r.json()
  return data.text ?? null
}

export async function fetchVoiceStatus(signal?: AbortSignal): Promise<{ tts: boolean; stt: boolean }> {
  try {
    const r = await apiFetch('/api/voice/status', {signal})
    if (!r.ok) return { tts: false, stt: false }
    return r.json()
  } catch {
    return { tts: false, stt: false }
  }
}

export async function generatePod(youtubeUrl: string): Promise<{ id: string }> {
  const r = await apiFetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ youtube_url: youtubeUrl }),
  })
  if (!r.ok) throw new Error('generation failed')
  return r.json()
}
