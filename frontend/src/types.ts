// Shared types — these mirror the backend pydantic Pod schema (backend/app/schemas/pod.py).

export interface SceneParams {
  n_layers: number
  n_heads: number
  d_model: number
  d_mlp: number
  vocab_size: number
  context: number
  model_name: string
}

export interface PodScene {
  type: string // "transformer"
  params: SceneParams
  default_input: string
}

export interface Beat {
  id: string
  text: string
  commands: Command[]
}

export interface AffordanceDef {
  op: string
  description: string
  args?: Record<string, string>
}

export interface Pod {
  id: string
  title: string
  topic: string
  description: string
  scene: PodScene
  narration: Beat[]
  affordances: AffordanceDef[]
}

export interface PodSummary {
  id: string
  title: string
  topic: string
  description: string
}

// ---- Affordance command vocabulary (one shared language for authored beats + Claude) ----
export type FocusTarget =
  | 'overview'
  | 'embeddings'
  | 'block'
  | 'attention'
  | 'mlp'
  | 'head'
  | 'unembed'
  | 'token'

export interface Command {
  op:
    | 'focusOn'
    | 'highlightBlock'
    | 'highlightHead'
    | 'showActivations'
    | 'hideActivations'
    | 'showAttention'
    | 'hideAttention'
    | 'setPrecision'
    | 'runInference'
    | 'annotate'
    | 'reset'
  args?: Record<string, any>
}

// ---- Live scene state derived by applying commands ----
export interface Focus {
  target: FocusTarget
  index?: number // block index
  head?: number
  tokenIndex?: number
}

export interface AttentionView {
  visible: boolean
  block: number
  head: number | null // null => averaged over heads
}

export interface ActivationView {
  visible: boolean
  target: 'block' | 'mlp' | 'residual'
  index: number
  mode: 'color' | 'values'
}

// ---- Real model data returned by /api/gpt2/forward ----
export interface InferenceData {
  model: string
  tokens: string[]
  n_layers: number
  n_heads: number
  // per-layer residual-stream activation norms per token: [layer][token]
  residual_norms: number[][]
  // attention weights: [layer][head][query][key]
  attention: number[][][][]
  // sampled hidden values for the inspector: [layer] -> first N dims of token 0
  sample_values: number[][]
  // top next-token predictions
  predictions: { token: string; prob: number }[]
}
