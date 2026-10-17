import type { Algorithm, FlashConfig, MatrixName, Region, SpotlightTarget, VisualCue } from './types'
import type { Point } from '../declarative-attention/geometry'
import { around, cameraPreset, world, type CameraPreset } from '../declarative-attention/camera'
import { blockSizes } from './simulation'

export { pointAlong, type Point } from '../declarative-attention/geometry'

export const COLORS = {
  q: '#7fa8ff',
  k: '#e7bf63',
  v: '#47d9c2',
  o: '#c49bff',
  stats: '#f07aa0',
  s: '#ff8a5c',
  p: '#ffd36e',
  negative: '#5b6b8c',
  hbm: '#de6476',
  sram: '#589dd6',
  bus: '#67728d',
  masked: '#2a2433',
  cell: '#1a1622',
}
export const MATRIX_COLOR: Record<MatrixName, string> = {
  Q: COLORS.q,
  K: COLORS.k,
  V: COLORS.v,
  O: COLORS.o,
  l: COLORS.stats,
  m: COLORS.stats,
  S: COLORS.s,
  P: COLORS.p,
}

type Box = [number, number, number, number]
/** Board frames [left, top, right, bottom] in the shared 1000 × 470 board space. */
export const GPU_BOX: Box = [26, 46, 974, 446]
export const HBM_BOX: Box = [44, 84, 504, 432]
export const BUS_BOX: Box = [514, 150, 550, 390]
export const SRAM_BOX: Box = [560, 84, 956, 432]

/** HBM cell size; one cell is one value. */
export const HBM_CELL = 7
/** SRAM cell size; big enough to print the value. */
export const SRAM_CELL = 18
const HBM_TOP = 156

export interface Layout {
  hbm: Record<'Q' | 'KT' | 'S' | 'V' | 'O' | 'l' | 'm', Box>
  sram: Record<'Q' | 'KT' | 'V' | 'S' | 'O' | 'm' | 'l' | 'strip', Box>
}

const layouts = new WeakMap<FlashConfig, Layout>()
/** Matrix frames for this config: N and d set the HBM shapes, B_r and B_c the SRAM tiles. */
export function layoutOf(config: FlashConfig): Layout {
  let layout = layouts.get(config)
  if (layout) return layout
  const N = config.seq_len * HBM_CELL
  const d = config.head_dim * HBM_CELL
  const { Br, Bc } = blockSizes(config)
  const s = SRAM_CELL
  const at = (x: number, y: number, w: number, h: number): Box => [x, y, x + w, y + h]
  const qx = 88
  const sx = qx + d + 8
  const vx = sx + N + 16
  const ox = vx + d + 16
  // SRAM: Q_i | S_ij under K_jᵀ | O_i under V_j, with m and ℓ beside O_i.
  const rowY = 280
  const tileX = 580
  const sTileX = tileX + config.head_dim * s + 8
  const oTileX = sTileX + Bc * s + 16
  layout = {
    hbm: {
      Q: at(qx, HBM_TOP, d, N),
      KT: at(sx, HBM_TOP - d - 6, N, d),
      S: at(sx, HBM_TOP, N, N),
      V: at(vx, HBM_TOP, d, N),
      O: at(ox, HBM_TOP, d, N),
      l: at(ox + d + 16, HBM_TOP, HBM_CELL, N),
      m: at(ox + d + 32, HBM_TOP, HBM_CELL, N),
    },
    sram: {
      Q: at(tileX, rowY, config.head_dim * s, Br * s),
      KT: at(sTileX, rowY - config.head_dim * s - 8, Bc * s, config.head_dim * s),
      S: at(sTileX, rowY, Bc * s, Br * s),
      V: at(oTileX, rowY - Bc * s - 8, config.head_dim * s, Bc * s),
      O: at(oTileX, rowY, config.head_dim * s, Br * s),
      m: at(oTileX + config.head_dim * s + 12, rowY, s, Br * s),
      l: at(oTileX + config.head_dim * s + 12 + s + 6, rowY, s, Br * s),
      // Standard attention streams a whole row block of S or P instead.
      strip: at(sTileX, rowY - Br * 9 - 8, config.seq_len * 9, Br * 9),
    },
  }
  layouts.set(config, layout)
  return layout
}

/** Cell box inside a frame of `rows × cols` cells. */
export function cellIn(box: Box, rows: number, cols: number, row: number, col: number): Box {
  const w = (box[2] - box[0]) / cols
  const h = (box[3] - box[1]) / rows
  return [box[0] + col * w, box[1] + row * h, box[0] + (col + 1) * w, box[1] + (row + 1) * h]
}
const center = ([l, t, r, b]: Box): Point => [(l + r) / 2, (t + b) / 2]

/** Centre of value (row, col) of an HBM matrix. K is drawn transposed, as Kᵀ. */
export function hbmPoint(matrix: MatrixName, row: number, col: number, config: FlashConfig): Point {
  const { hbm } = layoutOf(config)
  const N = config.seq_len
  const d = config.head_dim
  switch (matrix) {
    case 'K':
      return center(cellIn(hbm.KT, d, N, col, row))
    case 'S':
    case 'P':
      return center(cellIn(hbm.S, N, N, row, col))
    case 'l':
    case 'm':
      return center(cellIn(hbm[matrix], N, 1, row, 0))
    default:
      return center(cellIn(hbm[matrix], N, d, row, col))
  }
}

/** Centre of the SRAM cell holding local row `row` of a tile. */
export function sramPoint(
  matrix: MatrixName,
  row: number,
  col: number,
  config: FlashConfig,
  mode: Algorithm,
): Point {
  const { sram } = layoutOf(config)
  const { Br, Bc } = blockSizes(config)
  const d = config.head_dim
  switch (matrix) {
    case 'K':
      return mode === 'standard'
        ? center(cellIn(sram.strip, Br, config.seq_len, 0, row))
        : center(cellIn(sram.KT, d, Bc, col, row))
    case 'V':
      return mode === 'standard'
        ? center(cellIn(sram.strip, Br, config.seq_len, Br - 1, row))
        : center(cellIn(sram.V, Bc, d, row, col))
    case 'S':
    case 'P':
      return center(cellIn(sram.strip, Br, config.seq_len, row, col))
    case 'l':
    case 'm':
      return center(cellIn(sram[matrix], Br, 1, row, 0))
    default:
      return center(cellIn(sram[matrix], Br, d, row, col))
  }
}

/** Parent of each region: a spotlight on a parent lights its children. */
function parentOf(region: string): string | null {
  if (region === 'hbm' || region === 'sram' || region === 'bus') return 'gpu'
  return null
}
/** An element belongs to a place (hbm/sram) and a matrix; either can light it. */
export function inSpotlight(regions: readonly string[], spotlight: readonly string[] | null): boolean {
  if (!spotlight) return true
  return regions.some((region) => {
    for (let part: string | null = region; part; part = parentOf(part))
      if (spotlight.includes(part)) return true
    return false
  })
}

const union = (boxes: Box[]): Box => [
  Math.min(...boxes.map((b) => b[0])),
  Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])),
  Math.max(...boxes.map((b) => b[3])),
]

/** Frames and front-face z for a spotlight target; matrices are framed in HBM and SRAM. */
export function spotlightBoxes(
  target: SpotlightTarget,
  config: FlashConfig,
  mode: Algorithm,
): { boxes: Box[]; z: number } {
  const { hbm, sram } = layoutOf(config)
  const tiled = mode !== 'standard'
  switch (target) {
    case 'gpu':
      return { boxes: [GPU_BOX], z: 0.5 }
    case 'hbm':
      return { boxes: [HBM_BOX], z: 0.4 }
    case 'sram':
      return { boxes: [SRAM_BOX], z: 0.4 }
    case 'bus':
      return { boxes: [BUS_BOX], z: 0.3 }
    case 'q':
      return { boxes: [hbm.Q, sram.Q], z: 0.45 }
    case 'k':
      return { boxes: tiled ? [hbm.KT, sram.KT] : [hbm.KT], z: 0.45 }
    case 'v':
      return { boxes: tiled ? [hbm.V, sram.V] : [hbm.V], z: 0.45 }
    case 'o':
      return { boxes: [hbm.O, sram.O], z: 0.45 }
    case 'stats':
      return { boxes: [union([hbm.l, hbm.m]), union([sram.m, sram.l])], z: 0.45 }
    case 'scores':
      return { boxes: [hbm.S], z: 0.45 }
    case 'tile':
      return { boxes: [tiled ? sram.S : sram.strip], z: 0.45 }
    default:
      return { boxes: [], z: 0 }
  }
}

export interface PacketRoute {
  points: Point[]
  color: string
  count: number
}

/** Up to `limit` evenly spread rows of a region, so a whole matrix stays readable. */
function sampleRows(region: Region, limit: number): number[] {
  const [from, to] = region.rows
  const count = Math.min(limit, to - from)
  return Array.from({ length: count }, (_, k) => from + Math.floor((k * (to - from)) / count))
}

/** Loads travel HBM → bus → SRAM; stores travel back. One packet per row, at most 8 per region. */
export function packetRoutes(cue: VisualCue, config: FlashConfig, mode: Algorithm): PacketRoute[] {
  const op = cue.op
  if (!op || (cue.kind !== 'load' && cue.kind !== 'store')) return []
  const regions = cue.kind === 'load' ? op.reads : op.writes
  const { Br, Bc } = blockSizes(config)
  return regions.flatMap((region) => {
    const column = Math.floor((region.cols[0] + region.cols[1] - 1) / 2)
    return sampleRows(region, 8).map((row) => {
      // Local coordinates inside the SRAM tile.
      const local =
        region.matrix === 'K' || region.matrix === 'V'
          ? mode === 'standard'
            ? row
            : row - op.j * Bc
          : row - op.i * Br
      const from = hbmPoint(region.matrix, row, column, config)
      const to = sramPoint(region.matrix, local, column, config, mode)
      const path: Point[] = [from, [BUS_BOX[0], from[1]], [BUS_BOX[2], to[1]], to]
      return {
        points: cue.kind === 'load' ? path : [...path].reverse(),
        color: MATRIX_COLOR[region.matrix],
        count: 1,
      }
    })
  })
}

/** A value's look: hue by sign (or matrix), strength by magnitude. */
export function cellLook(matrix: MatrixName, value: number): { color: string; opacity: number } {
  if (!Number.isFinite(value)) return { color: COLORS.cell, opacity: 0 }
  if (matrix === 'P') return { color: COLORS.p, opacity: 0.12 + 0.88 * Math.sqrt(value) }
  const range = matrix === 'S' ? 5 : matrix === 'l' ? 6 : 1.5
  const strength = Math.min(1, Math.abs(value) / range)
  return {
    color: value < 0 ? COLORS.negative : MATRIX_COLOR[matrix],
    opacity: 0.15 + 0.8 * strength,
  }
}

/** Short printable value for an SRAM cell. */
export function formatValue(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return ''
  if (value === -Infinity) return '−∞'
  const fixed = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
  return fixed === '-0.0' ? '0.0' : fixed.replace('-', '−')
}

export type View = 'overview' | 'hbm' | 'sram'
export function viewPreset(view: View, aspect: number): CameraPreset {
  if (view === 'hbm') return around(world(274, 258, 0.3), 6.4, -0.12, 0.18)
  if (view === 'sram') return around(world(758, 258, 0.3), 6.4, -0.12, 0.18)
  return cameraPreset('overview', aspect)
}
