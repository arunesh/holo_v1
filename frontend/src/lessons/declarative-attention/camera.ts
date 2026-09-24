export type View = 'overview' | 'memory' | 'compute' | 'host'
export type Vec3 = [number, number, number]
export interface CameraPreset {
  position: Vec3
  target: Vec3
}
export const FOV = 42
export const MIN_DISTANCE = 4
export const MAX_DISTANCE = 38
/** Orbit limits around the board normal (+Z); beyond these the board is edge-on or reversed. */
export const AZIMUTH_LIMIT = 0.95
export const POLAR_RANGE: [number, number] = [Math.PI / 2 - 0.9, Math.PI / 2 + 0.6]

/** Board coordinates (the 1000×470 diagram space) to world units. */
export const world = (x: number, y: number, z = 0): Vec3 => [(x - 500) / 60, (235 - y) / 60, z]

const BOARD_CENTER = world(500.5, 239, 0.3)
const BOARD_HALF_WIDTH = (978 - 23) / 120
const BOARD_HALF_HEIGHT = (441 - 37) / 120
const OVERVIEW_AZIMUTH = -0.28
const OVERVIEW_ELEVATION = 0.2

function around(target: Vec3, distance: number, azimuth: number, elevation: number): CameraPreset {
  return {
    target,
    position: [
      target[0] + distance * Math.sin(azimuth) * Math.cos(elevation),
      target[1] + distance * Math.sin(elevation),
      target[2] + distance * Math.cos(azimuth) * Math.cos(elevation),
    ],
  }
}

export function cameraPreset(view: View, aspect: number): CameraPreset {
  switch (view) {
    case 'memory':
      return around([-2.8, -2.1, 0.25], 5.4, -0.16, 0.22)
    case 'compute':
      return around([-3, 1.5, 0.3], 6, -0.16, 0.2)
    case 'host':
      return around([5.7, 0, 0], 9, -0.14, 0.1)
    default: {
      const half = Math.tan((FOV * Math.PI) / 360)
      const fit = Math.max(
        (1.3 * BOARD_HALF_HEIGHT) / half,
        (1.25 * BOARD_HALF_WIDTH) / (half * aspect),
      )
      return around(BOARD_CENTER, fit + 0.6, OVERVIEW_AZIMUTH, OVERVIEW_ELEVATION)
    }
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const normalize = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a)
  return [a[0] / length, a[1] / length, a[2] / length]
}

/** Perspective projection matching three.js lookAt with +Y up; returns NDC in [-1, 1]. */
export function project(point: Vec3, preset: CameraPreset, aspect: number): [number, number] {
  const forward = normalize(sub(preset.target, preset.position))
  const right = normalize(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)
  const relative = sub(point, preset.position)
  const depth = dot(relative, forward)
  const half = Math.tan((FOV * Math.PI) / 360)
  return [dot(relative, right) / (depth * half * aspect), dot(relative, up) / (depth * half)]
}
