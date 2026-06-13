import * as THREE from 'three'
import type { Focus, SceneParams } from '../types'

// Single source of truth for where everything lives in 3D space.
// Both the scene geometry and the camera rig import from here so they never drift.

export const BLOCK_SPACING = 7
export const BLOCK_WIDTH = 3.4
export const BLOCK_HEIGHT = 5
export const HEAD_SIZE = 0.5
export const TOKEN_Y = -4.2
export const TOKEN_SPACING = 1.6

export const embeddingsX = () => 0
export const blockX = (i: number) => (i + 1) * BLOCK_SPACING
export const unembedX = (params: SceneParams) => (params.n_layers + 1) * BLOCK_SPACING

// Center of the whole pipeline (used to recentre the world near the origin).
export const pipelineCenterX = (params: SceneParams) => unembedX(params) / 2

// Z position of attention head `h` within a block (heads spread along Z).
export function headZ(h: number, n_heads: number): number {
  const span = (n_heads - 1) * (HEAD_SIZE + 0.18)
  return h * (HEAD_SIZE + 0.18) - span / 2
}

// Sub-layer Y positions inside a block.
export const ATTN_Y = -1.1
export const MLP_Y = 1.6

export interface CameraTarget {
  target: THREE.Vector3
  // camera offset from target (direction * distance)
  offset: THREE.Vector3
}

// Map the current focus onto a camera target + framing.
export function focusToCamera(focus: Focus, params: SceneParams): CameraTarget {
  const cx = pipelineCenterX(params)
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

  switch (focus.target) {
    case 'overview':
      return {
        target: v(cx, 0.5, 0),
        offset: v(0, 6, Math.max(26, params.n_layers * 3.2)),
      }
    case 'embeddings':
      return { target: v(embeddingsX(), 0, 0), offset: v(-4, 3, 12) }
    case 'unembed':
      return { target: v(unembedX(params), 0, 0), offset: v(4, 3, 12) }
    case 'block': {
      const i = focus.index ?? 0
      return { target: v(blockX(i), 0.4, 0), offset: v(0, 3, 11) }
    }
    case 'attention': {
      const i = focus.index ?? 0
      return { target: v(blockX(i), ATTN_Y, 0), offset: v(-2.5, 1.6, 7) }
    }
    case 'mlp': {
      const i = focus.index ?? 0
      return { target: v(blockX(i), MLP_Y, 0), offset: v(2.5, 2, 7) }
    }
    case 'head': {
      const i = focus.index ?? 0
      const h = focus.head ?? 0
      return { target: v(blockX(i), ATTN_Y, headZ(h, params.n_heads)), offset: v(0, 1.2, 4) }
    }
    case 'token': {
      const t = focus.tokenIndex ?? 0
      return { target: v(t * TOKEN_SPACING, TOKEN_Y, 0), offset: v(0, 3, 9) }
    }
    default:
      return { target: v(cx, 0.5, 0), offset: v(0, 6, 28) }
  }
}

// Map a normalized value [0,1] to a perceptual blue -> cyan -> yellow -> red ramp.
export function activationColor(t: number): THREE.Color {
  const x = Math.max(0, Math.min(1, t))
  const stops: [number, [number, number, number]][] = [
    [0.0, [0.05, 0.1, 0.45]],
    [0.35, [0.1, 0.65, 0.85]],
    [0.65, [0.95, 0.85, 0.2]],
    [1.0, [0.92, 0.2, 0.15]],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]
    const [b, cb] = stops[i + 1]
    if (x >= a && x <= b) {
      const f = (x - a) / (b - a || 1)
      return new THREE.Color(
        ca[0] + (cb[0] - ca[0]) * f,
        ca[1] + (cb[1] - ca[1]) * f,
        ca[2] + (cb[2] - ca[2]) * f,
      )
    }
  }
  return new THREE.Color(0.9, 0.2, 0.15)
}
