import { useCallback, useEffect, useRef } from 'react'
import { usePodStore } from '../state/podStore'
import { applyCommand } from '../engine/affordances'
import type { Command } from '../types'

// Snapshot of current scene state sent to the backend so Claude knows what the
// user is currently looking at when it composes its response.
function sceneSnapshot() {
  const s = usePodStore.getState()
  return {
    focus: s.focus,
    highlightedBlock: s.highlightedBlock,
    attention: s.attention,
    activations: s.activations,
    precision: s.precision,
    inputText: s.inputText,
    hasInference: !!s.inference,
    tokens: s.inference?.tokens ?? [],
  }
}

// Connects to the backend live-session WebSocket. Exposes `ask(query)` which
// returns spoken narration text (so the caller can TTS it) and applies any
// affordance commands Claude emits to the live scene.
export function useSession(podId: string | null, onSpeak: (text: string) => void) {
  const ws = useRef<WebSocket | null>(null)
  const pending = useRef<((text: string) => void) | null>(null)
  const accumulated = useRef<string>('')

  useEffect(() => {
    if (!podId) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const sock = new WebSocket(`${proto}://${location.host}/ws/session/${podId}`)
    ws.current = sock

    sock.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data)
      const store = usePodStore.getState()
      switch (msg.type) {
        case 'thinking':
          store.patch({ thinking: true })
          break
        case 'narration':
          accumulated.current += (accumulated.current ? ' ' : '') + msg.text
          store.patch({ captions: msg.text })
          break
        case 'commands':
          for (const c of msg.commands as Command[]) await applyCommand(c)
          break
        case 'done': {
          store.patch({ thinking: false })
          const text = accumulated.current.trim()
          accumulated.current = ''
          if (text) {
            store.pushMessage({ role: 'assistant', text })
            onSpeak(text)
          }
          pending.current?.(text)
          pending.current = null
          break
        }
        case 'error':
          store.patch({ thinking: false, captions: `⚠ ${msg.message}` })
          pending.current?.('')
          pending.current = null
          break
      }
    }
    sock.onclose = () => {
      if (ws.current === sock) ws.current = null
    }
    return () => sock.close()
  }, [podId, onSpeak])

  const ask = useCallback((query: string) => {
    return new Promise<string>((resolve) => {
      const sock = ws.current
      if (!sock || sock.readyState !== WebSocket.OPEN) {
        resolve('')
        return
      }
      usePodStore.getState().pushMessage({ role: 'user', text: query })
      accumulated.current = ''
      pending.current = resolve
      sock.send(JSON.stringify({ query, scene: sceneSnapshot() }))
    })
  }, [])

  return { ask }
}
