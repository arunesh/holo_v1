import type { Layout, PagedConfig, SpotlightTarget, VisualCue } from './types'
import type { Point } from '../declarative-attention/geometry'

export { pointAlong, type Point } from '../declarative-attention/geometry'

export const COLORS = {
  weights: '#ffb35c',
  sm: '#9a72c7',
  l2: '#589dd6',
  hbm: '#de6476',
  token: '#5dd39e',
  reserved: '#f0a35c',
  internal: '#e0525c',
  external: '#8a93a6',
  free: '#2a2433',
}
export const weightNames = ['embeddings', 'early layers', 'late layers', 'output head']

/** Pool layout: 4 blocks per row, each block a row of `block_size` slots. */
export const POOL = { x: 64, y: 276, cellWidth: 31, cellHeight: 24, blockGap: 12, rowGap: 38 }
export const BLOCKS_PER_ROW = 4
/** Where packets enter and leave compute, and the L2 lane they travel along. */
export const SM_PORT: Point = [330, 118]
export const L2_Y = 181

export function blockOrigin(block: number, config: PagedConfig): Point {
  const width = config.block_size * POOL.cellWidth
  return [
    POOL.x + (block % BLOCKS_PER_ROW) * (width + POOL.blockGap),
    POOL.y + Math.floor(block / BLOCKS_PER_ROW) * POOL.rowGap,
  ]
}
export function cellBox(slot: number, config: PagedConfig): [number, number, number, number] {
  const [x, y] = blockOrigin(Math.floor(slot / config.block_size), config)
  const left = x + (slot % config.block_size) * POOL.cellWidth
  return [left, y, left + POOL.cellWidth - 2, y + POOL.cellHeight]
}
export function cellCenter(slot: number, config: PagedConfig): Point {
  const [left, top, right, bottom] = cellBox(slot, config)
  return [(left + right) / 2, (top + bottom) / 2]
}
export function blockBox(block: number, config: PagedConfig): [number, number, number, number] {
  const [x, y] = blockOrigin(block, config)
  return [x, y, x + config.block_size * POOL.cellWidth - 2, y + POOL.cellHeight]
}

/** Scene part each region belongs to; a spotlight on a parent lights its children. */
function parentOf(region: string): string | null {
  if (region.startsWith('r-')) return 'pool'
  if (region === 'pool' || region === 'weights') return 'memory'
  if (region === 'memory' || region === 'compute' || region === 'l2') return 'gpu'
  if (region === 'queue' || region === 'tables' || region === 'swap') return 'host'
  return null
}
export function inSpotlight(region: string, spotlight: readonly string[] | null): boolean {
  if (!spotlight) return true
  for (let part: string | null = region; part; part = parentOf(part))
    if (spotlight.includes(part)) return true
  return false
}
export const slotRegion = (request: string | null) => (request ? `r-${request}` : 'pool')

type Box = [number, number, number, number]
/** Board-space frames [left, top, right, bottom] and front-face z for a spotlight target. */
export function spotlightBoxes(
  target: SpotlightTarget,
  config: PagedConfig,
  layout: Layout,
): { boxes: Box[]; z: number } {
  if (target.startsWith('r-')) {
    const request = target.slice(2)
    const owned = layout.slots.flatMap((slot, i) => (slot.request === request ? [i] : []))
    // One frame per block (paged) or per contiguous run within a row (contiguous).
    const groups = new Map<string, number[]>()
    for (const slot of owned) {
      const block = Math.floor(slot / config.block_size)
      const key =
        layout.mode === 'paged' ? `b${block}` : `r${Math.floor(block / BLOCKS_PER_ROW)}`
      groups.set(key, [...(groups.get(key) ?? []), slot])
    }
    const boxes = [...groups.values()].map((slots) => {
      const cells = slots.map((slot) => cellBox(slot, config))
      return [
        Math.min(...cells.map((c) => c[0])),
        Math.min(...cells.map((c) => c[1])),
        Math.max(...cells.map((c) => c[2])),
        Math.max(...cells.map((c) => c[3])),
      ] as Box
    })
    return { boxes, z: 0.4 }
  }
  const fixed: Partial<Record<SpotlightTarget, { box: Box; z: number }>> = {
    gpu: { box: [23, 37, 637, 441], z: 0.6 },
    compute: { box: [82, 86, 580, 146], z: 0.58 },
    l2: { box: [42, 166, 608, 196], z: 0.35 },
    memory: { box: [43, 204, 607, 439], z: 0.45 },
    weights: { box: [60, 211, 598, 239], z: 0.4 },
    pool: { box: [58, 262, 600, 419], z: 0.42 },
    pcie: { box: [630, 268, 718, 298], z: 0.14 },
    host: { box: [712, 35, 980, 443], z: 0.2 },
    queue: { box: [724, 90, 968, 204], z: 0.2 },
    tables: { box: [724, 212, 968, 378], z: 0.2 },
    swap: { box: [724, 384, 968, 436], z: 0.2 },
  }
  const entry = fixed[target]
  return entry ? { boxes: [entry.box], z: entry.z } : { boxes: [], z: 0 }
}

export interface PacketRoute {
  points: Point[]
  color: string
  count: number
}

const toPort = (from: Point): Point[] => [from, [from[0], L2_Y], [SM_PORT[0], L2_Y], SM_PORT]
const HOST_LANE: Point[] = [
  [846, 283],
  [713, 283],
  [634, 283],
  [610, 283],
]

/** One cue has one causal phase: weights, prompt, write, read, copy or swap. */
export function packetRoutes(cue: VisualCue, config: PagedConfig): PacketRoute[] {
  const color = (slot: number) => cue.slotColors?.[slot] ?? COLORS.token
  const effects = cue.effects
  switch (cue.kind) {
    case 'weights': {
      const slot = cue.slot ?? 0
      return [
        {
          points: [[846, 150 + slot * 38], ...HOST_LANE, [610, 225], [130 + slot * 132, 225]],
          color: COLORS.weights,
          count: 8,
        },
      ]
    }
    case 'prompt':
      return [
        {
          points: [[846, 118], ...HOST_LANE, [610, L2_Y], [SM_PORT[0], L2_Y], SM_PORT],
          color: cue.color ?? COLORS.token,
          count: 6,
        },
      ]
    case 'write':
      return (effects?.writes ?? []).map((slot) => ({
        points: [...toPort(cellCenter(slot, config))].reverse(),
        color: color(slot),
        count: 1,
      }))
    case 'read':
      return (effects?.reads ?? []).map((slot) => ({
        points: toPort(cellCenter(slot, config)),
        color: color(slot),
        count: 1,
      }))
    case 'copy':
      return (effects?.copies ?? []).map(({ from, to }) => {
        const [fx, fy] = cellCenter(from * config.block_size, config)
        const [tx, ty] = cellCenter(to * config.block_size, config)
        return {
          points: [
            [fx, fy],
            [fx, L2_Y],
            [tx, L2_Y],
            [tx, ty],
          ],
          color: color(from * config.block_size),
          count: config.block_size,
        }
      })
    case 'swap-out':
    case 'swap-in': {
      const moves = cue.kind === 'swap-out' ? effects?.swapOut : effects?.swapIn
      return (moves ?? []).flatMap(({ slots }) =>
        slots.map((slot) => {
          const [x, y] = cellCenter(slot, config)
          const points: Point[] = [[x, y], [x, L2_Y], [610, L2_Y], ...[...HOST_LANE].reverse(), [846, 410]]
          return {
            points: cue.kind === 'swap-out' ? points : points.reverse(),
            color: color(slot),
            count: 1,
          }
        }),
      )
    }
    default:
      return []
  }
}
