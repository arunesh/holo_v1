import type { MemoryConfig, SpotlightTarget, VisualCue } from './types'

export const COLORS = {
  weights: '#ffb35c',
  scaffold: '#aeb8cb',
  response: '#5dd39e',
  sm: '#9a72c7',
  l2: '#589dd6',
  hbm: '#de6476',
}
export const weightNames = ['embeddings', 'early layers', 'late layers', 'output head']
export const slotWidth = (count: number) => 536 / (count + 1)
export const slotX = (index: number, count = 4) => 64 + index * slotWidth(count)
export const slotCenter = (index: number, count: number) =>
  slotX(index, count) + (slotWidth(count) - 8) / 2
export type Point = [number, number]

/** Scene part each region belongs to; a spotlight on a parent lights its children. */
function parentOf(region: string): string | null {
  if (/^c\d+$/.test(region)) return 'docs'
  if (region === 'sys' || region === 'docs') return 'seats'
  if (region === 'seats' || region === 'weights' || region === 'reply') return 'memory'
  if (region === 'memory' || region === 'compute' || region === 'l2') return 'gpu'
  return null
}
export function inSpotlight(region: string, spotlight: readonly string[] | null): boolean {
  if (!spotlight) return true
  for (let part: string | null = region; part; part = parentOf(part))
    if (spotlight.includes(part)) return true
  return false
}
/** Board-space frame [left, top, right, bottom] and front-face z for a spotlight target. */
export function spotlightBounds(
  target: SpotlightTarget,
  config: MemoryConfig,
): { box: [number, number, number, number]; z: number } | null {
  const count = config.chunks.length
  const seat = (i: number) => [slotX(i, count), 339, slotX(i, count) + slotWidth(count) - 9, 391]
  const union = (boxes: number[][]) =>
    [
      Math.min(...boxes.map((b) => b[0])),
      Math.min(...boxes.map((b) => b[1])),
      Math.max(...boxes.map((b) => b[2])),
      Math.max(...boxes.map((b) => b[3])),
    ] as [number, number, number, number]
  const chunk = /^c(\d+)$/.exec(target)
  if (chunk) {
    const index = config.chunks.findIndex((c) => c.id === Number(chunk[1]))
    return index < 0 ? null : { box: seat(index + 1) as [number, number, number, number], z: 0.5 }
  }
  switch (target) {
    case 'gpu':
      return { box: [23, 37, 637, 441], z: 0.6 }
    case 'compute':
      return { box: [82, 90, 572, 198], z: 0.58 }
    case 'l2':
      return { box: [42, 237, 608, 271], z: 0.35 }
    case 'memory':
      return { box: [43, 289, 607, 439], z: 0.5 }
    case 'weights':
      return { box: [59, 296, 571, 324], z: 0.4 }
    case 'seats':
      return { box: union(Array.from({ length: count + 1 }, (_, i) => seat(i))), z: 0.5 }
    case 'sys':
      return { box: seat(0) as [number, number, number, number], z: 0.5 }
    case 'docs':
      return { box: union(Array.from({ length: count }, (_, i) => seat(i + 1))), z: 0.5 }
    case 'reply':
      return { box: [250, 404, 604, 426], z: 0.42 }
    case 'pcie':
      return { box: [630, 268, 718, 298], z: 0.14 }
    case 'host':
      return { box: [712, 35, 980, 443], z: 0.2 }
    default:
      return null
  }
}
export interface PacketRoute {
  points: Point[]
  color: string
  count: number
}

/** One cue has one causal phase: input, write, read OR response write. */
export function packetRoutes(cue: VisualCue, config: MemoryConfig): PacketRoute[] {
  const slot = cue.slot ?? 0
  const colors = [COLORS.scaffold, ...config.chunks.map((chunk) => chunk.color)]
  const x = slotCenter(slot, config.chunks.length)
  if (cue.kind === 'weights')
    return [
      {
        points: [
          [845, 185 + slot * 38],
          [845, 283],
          [713, 283],
          [634, 283],
          [570, 283],
          [110 + slot * 135, 310],
        ],
        color: COLORS.weights,
        count: 8,
      },
    ]
  if (cue.kind === 'input')
    return [
      {
        points: [
          [845, 160 + slot * 27],
          [845, 283],
          [713, 283],
          [634, 283],
          [580, 283],
          [580, 254],
          [320, 254],
          [320, 170],
        ],
        color: colors[slot],
        count: slot ? 6 : 2,
      },
    ]
  if (cue.kind === 'write')
    return [
      {
        points: [
          [320, 170],
          [320, 254],
          [x, 254],
          [x, 362],
        ],
        color: colors[slot],
        count: slot ? 6 : 2,
      },
    ]
  if (cue.kind === 'response')
    return [
      {
        points: [
          [320, 170],
          [320, 254],
          [580, 254],
          [580, 414],
        ],
        color: COLORS.response,
        count: 1,
      },
    ]
  if (cue.kind !== 'read' || !cue.event) return []
  const sources = [
    { slot: 0, tokens: config.scaffold_tokens, color: COLORS.scaffold },
    ...config.chunks.flatMap((chunk, i) =>
      cue.event!.chunkIds.includes(chunk.id)
        ? [{ slot: i + 1, tokens: chunk.tokens, color: chunk.color }]
        : [],
    ),
  ]
  const routes: PacketRoute[] = sources.map((source) => ({
    points: [
      [slotCenter(source.slot, config.chunks.length), 347],
      [slotCenter(source.slot, config.chunks.length), 254],
      [320, 254],
      [320, 170],
    ],
    color: source.color,
    count: Math.min(12, Math.max(1, Math.round(source.tokens / 256))),
  }))
  if (cue.event.responseTokens)
    routes.push({
      points: [
        [580, 414],
        [580, 254],
        [320, 254],
        [320, 170],
      ],
      color: COLORS.response,
      count: Math.min(6, Math.max(1, Math.round(cue.event.responseTokens / 256))),
    })
  return routes
}

/** Linear distance along a polyline, shared by spatial rendering and tests. */
export function pointAlong(points: Point[], progress: number): Point {
  const lengths = points
    .slice(1)
    .map((point, i) => Math.hypot(point[0] - points[i][0], point[1] - points[i][1]))
  let remaining = Math.min(1, Math.max(0, progress)) * lengths.reduce((a, b) => a + b, 0)
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] ? remaining / lengths[i] : 0
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        points[i][1] + (points[i + 1][1] - points[i][1]) * t,
      ]
    }
    remaining -= lengths[i]
  }
  return points[points.length - 1]
}
