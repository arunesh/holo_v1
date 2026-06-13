import { create } from 'zustand'
import type {
  Pod,
  PodSummary,
  Focus,
  AttentionView,
  ActivationView,
  InferenceData,
  Command,
} from '../types'

export interface SessionMessage {
  role: 'user' | 'assistant'
  text: string
}

interface PodState {
  // catalogue
  pods: PodSummary[]
  pod: Pod | null
  loadingPod: boolean

  // live scene state (mutated by affordance commands)
  focus: Focus
  highlightedBlock: number | null
  attention: AttentionView
  activations: ActivationView
  precision: number
  annotation: string

  // narration ("video mode")
  playing: boolean
  beatIndex: number

  // real model data
  inputText: string
  inference: InferenceData | null
  inferenceLoading: boolean

  // AI session
  thinking: boolean
  messages: SessionMessage[]
  captions: string

  // setters
  setPods: (p: PodSummary[]) => void
  setPod: (p: Pod | null) => void
  setLoadingPod: (b: boolean) => void
  patch: (partial: Partial<PodState>) => void
  setFocus: (f: Focus) => void
  setPlaying: (b: boolean) => void
  setBeatIndex: (n: number) => void
  setInference: (d: InferenceData | null) => void
  pushMessage: (m: SessionMessage) => void
  reset: () => void
}

const defaultFocus: Focus = { target: 'overview' }
const defaultAttention: AttentionView = { visible: false, block: 0, head: null }
const defaultActivations: ActivationView = {
  visible: false,
  target: 'block',
  index: 0,
  mode: 'color',
}

export const usePodStore = create<PodState>((set) => ({
  pods: [],
  pod: null,
  loadingPod: false,

  focus: defaultFocus,
  highlightedBlock: null,
  attention: defaultAttention,
  activations: defaultActivations,
  precision: 2,
  annotation: '',

  playing: false,
  beatIndex: -1,

  inputText: '',
  inference: null,
  inferenceLoading: false,

  thinking: false,
  messages: [],
  captions: '',

  setPods: (pods) => set({ pods }),
  setPod: (pod) =>
    set({
      pod,
      inputText: pod?.scene.default_input ?? '',
      focus: defaultFocus,
      highlightedBlock: null,
      attention: defaultAttention,
      activations: defaultActivations,
      annotation: '',
      beatIndex: -1,
      playing: false,
      messages: [],
      captions: '',
    }),
  setLoadingPod: (loadingPod) => set({ loadingPod }),
  patch: (partial) => set(partial),
  setFocus: (focus) => set({ focus }),
  setPlaying: (playing) => set({ playing }),
  setBeatIndex: (beatIndex) => set({ beatIndex }),
  setInference: (inference) => set({ inference }),
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  reset: () =>
    set({
      focus: defaultFocus,
      highlightedBlock: null,
      attention: defaultAttention,
      activations: defaultActivations,
      annotation: '',
      precision: 2,
    }),
}))

// Convenience: number of transformer blocks for the current pod.
export const blockCount = (pod: Pod | null) => pod?.scene.params.n_layers ?? 0
export const headCount = (pod: Pod | null) => pod?.scene.params.n_heads ?? 0

export type { Command }
