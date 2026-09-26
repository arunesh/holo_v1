import { createContext, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import * as THREE from 'three'
import type { Layout, PagedConfig, PagedState, Slot, SpotlightTarget, VisualCue } from './types'
import { requestSpec, stageReached } from './simulation'
import {
  blockBox,
  cellBox,
  COLORS,
  inSpotlight,
  packetRoutes,
  pointAlong,
  slotRegion,
  spotlightBoxes,
  weightNames,
  type PacketRoute,
} from './geometry'
import {
  AZIMUTH_LIMIT,
  cameraPreset,
  FOV,
  MAX_DISTANCE,
  MIN_DISTANCE,
  POLAR_RANGE,
  world,
  type View,
} from '../declarative-attention/camera'

const SPOT_COLOR = '#ffd36e'
/** Brightness kept by parts outside the spoken phrase's spotlight. */
const DIMMED = 0.18
const Spotlight = createContext<SpotlightTarget[] | null>(null)

function Label({
  x,
  y,
  text,
  region,
  color = '#e6e9f0',
  size = 13,
  z = 0.02,
  maxWidth,
}: {
  x: number
  y: number
  text: string
  region: string
  color?: string
  size?: number
  z?: number
  maxWidth?: number
}) {
  const lit = inSpotlight(region, useContext(Spotlight))
  return (
    <Text
      position={world(x, y, z)}
      fontSize={size / 60}
      color={color}
      fillOpacity={lit ? 1 : DIMMED}
      anchorX="center"
      anchorY="middle"
      maxWidth={maxWidth && maxWidth / 60}
    >
      {text}
    </Text>
  )
}
function Slab({
  x,
  y,
  w,
  h,
  color,
  region,
  depth = 0.12,
  z = 0,
  opacity = 1,
  glow = 0,
}: {
  x: number
  y: number
  w: number
  h: number
  color: string
  region: string
  depth?: number
  /** Z of the slab's back face. */
  z?: number
  opacity?: number
  glow?: number
}) {
  if (!inSpotlight(region, useContext(Spotlight))) {
    opacity *= DIMMED
    glow = 0
  }
  return (
    <mesh position={world(x, y, z + depth / 2)}>
      <boxGeometry args={[w / 60, h / 60, depth]} />
      <meshStandardMaterial
        key={opacity < 1 ? 'transparent' : 'opaque'}
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.55}
        emissive={color}
        emissiveIntensity={glow}
      />
    </mesh>
  )
}
/** Pulsing frames around a spotlight target, drawn just in front of it. */
function Halo({
  target,
  config,
  layout,
  pulse,
}: {
  target: SpotlightTarget
  config: PagedConfig
  layout: Layout
  pulse: boolean
}) {
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: SPOT_COLOR, transparent: true, opacity: 0.9 }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  const { invalidate } = useThree()
  useFrame(({ clock }) => {
    if (!pulse) return
    material.opacity = 0.65 + 0.35 * Math.sin(clock.elapsedTime * 4)
    invalidate()
  })
  const { boxes, z } = spotlightBoxes(target, config, layout)
  const pad = 5
  const edge = 3
  return (
    <group>
      {boxes.flatMap(([left, top, right, bottom], b) => {
        const [x0, x1, y0, y1] = [left - pad, right + pad, top - pad, bottom + pad]
        const bars: [number, number, number, number][] = [
          [(x0 + x1) / 2, y0, x1 - x0 + edge, edge],
          [(x0 + x1) / 2, y1, x1 - x0 + edge, edge],
          [x0, (y0 + y1) / 2, edge, y1 - y0],
          [x1, (y0 + y1) / 2, edge, y1 - y0],
        ]
        return bars.map(([x, y, w, h], i) => (
          <mesh key={`${b}-${i}`} position={world(x, y, z + 0.04)} material={material}>
            <boxGeometry args={[w / 60, h / 60, 0.03]} />
          </mesh>
        ))
      })}
    </group>
  )
}
function Camera({
  view,
  request,
  reducedMotion,
}: {
  view: View
  request: number
  reducedMotion: boolean
}) {
  const { camera, invalidate, size } = useThree()
  const controls = useRef<any>(null)
  const goal = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const placed = useRef(false)
  useEffect(() => {
    const preset = cameraPreset(view, size.width / size.height)
    goal.current = {
      position: new THREE.Vector3(...preset.position),
      target: new THREE.Vector3(...preset.target),
    }
    if (reducedMotion || !placed.current) {
      camera.position.copy(goal.current.position)
      controls.current?.target.copy(goal.current.target)
      controls.current?.update()
      goal.current = null
      placed.current = !!controls.current
    }
    invalidate()
  }, [view, request, reducedMotion, camera, invalidate, size.width, size.height])
  useFrame(() => {
    const orbit = controls.current
    const next = goal.current
    if (!orbit || !next) return
    camera.position.lerp(next.position, 0.14)
    orbit.target.lerp(next.target, 0.14)
    if (
      camera.position.distanceTo(next.position) < 0.01 &&
      orbit.target.distanceTo(next.target) < 0.01
    ) {
      camera.position.copy(next.position)
      orbit.target.copy(next.target)
      goal.current = null
    }
    orbit.update()
    invalidate()
  })
  return (
    <OrbitControls
      ref={controls}
      enableDamping
      dampingFactor={0.12}
      rotateSpeed={0.45}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      minAzimuthAngle={-AZIMUTH_LIMIT}
      maxAzimuthAngle={AZIMUTH_LIMIT}
      minPolarAngle={POLAR_RANGE[0]}
      maxPolarAngle={POLAR_RANGE[1]}
      onStart={() => (goal.current = null)}
    />
  )
}
function TravelingPacket({
  route,
  index,
  duration,
}: {
  route: PacketRoute
  index: number
  duration: number
}) {
  const mesh = useRef<THREE.Mesh>(null)
  const start = useRef<number | null>(null)
  const { invalidate } = useThree()
  useFrame(({ clock }) => {
    if (!mesh.current) return
    start.current ??= clock.elapsedTime
    const elapsed = clock.elapsedTime - start.current - (index * duration * 0.3) / route.count
    const progress = elapsed / (duration * 0.65)
    mesh.current.visible = progress >= 0 && progress <= 1
    const point = pointAlong(route.points, progress)
    mesh.current.position.set(...world(point[0], point[1], 0.75))
    if (clock.elapsedTime - start.current < duration) invalidate()
  })
  return (
    <mesh ref={mesh}>
      <boxGeometry args={[0.08, 0.08, 0.08]} />
      <meshBasicMaterial color={route.color} />
    </mesh>
  )
}

/** Token slots stand tall; waste lies flat and tinted by kind. */
function Cell({ slot, index, config }: { slot: Slot; index: number; config: PagedConfig }) {
  const [left, top, right, bottom] = cellBox(index, config)
  const color = (slot.request && requestSpec(config, slot.request)?.color) || COLORS.free
  const look = {
    token: { color, opacity: 0.92, depth: 0.34 },
    reserved: { color, opacity: 0.24, depth: 0.14 },
    internal: { color: COLORS.internal, opacity: 0.45, depth: 0.1 },
    external: { color: COLORS.external, opacity: 0.45, depth: 0.08 },
    free: { color: COLORS.free, opacity: 0.6, depth: 0.04 },
  }[slot.kind]
  const region = slotRegion(slot.request)
  return (
    <group>
      <Slab
        region={region}
        x={(left + right) / 2}
        y={(top + bottom) / 2}
        w={right - left}
        h={bottom - top}
        color={look.color}
        opacity={look.opacity}
        depth={look.depth}
        z={0.18}
      />
      {slot.token && (
        <Label
          region={region}
          x={(left + right) / 2}
          y={(top + bottom) / 2}
          text={slot.token}
          size={slot.token.length > 6 ? 6 : 8}
          color="#071b12"
          z={0.54}
          maxWidth={right - left}
        />
      )}
    </group>
  )
}

export default function PoolSpatial({
  state,
  layout,
  config,
  cue,
  declaration,
  reducedMotion,
  spotlight,
  guiding,
}: {
  state: PagedState
  layout: Layout
  config: PagedConfig
  cue: VisualCue | null
  declaration: string | null
  reducedMotion: boolean
  spotlight: SpotlightTarget[] | null
  /** The guide is playing: hide camera chrome so the scene and caption lead. */
  guiding: boolean
}) {
  const [camera, setCamera] = useState<{ view: View; request: number }>({
    view: 'overview',
    request: 0,
  })
  const pool = stageReached(state, 'pool')
  const weights = stageReached(state, 'weights')
  const paged = state.mode === 'paged'
  const routes = useMemo(() => (cue ? packetRoutes(cue, config) : []), [cue, config])
  const allocator = declaration ?? (paged ? 'paged blocks' : 'contiguous chunks')
  return (
    <div className={`da-spatial ${cue?.kind === 'emphasis' ? 'da-residency-pulse' : ''}`}>
      {!guiding && (
        <div className="da-camera-controls" aria-label="Camera views">
          {(['overview', 'memory', 'compute', 'host'] as View[]).map((name) => (
            <button
              key={name}
              aria-pressed={camera.view === name}
              onClick={() => setCamera((current) => ({ view: name, request: current.request + 1 }))}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div
        className="da-canvas"
        role="img"
        aria-label={`Spatial GPU. ${paged ? 'Paged' : 'Contiguous'} KV cache allocation. ${layout.stats.running} requests running. Use the controls below the scene to experiment.`}
      >
        <Canvas
          frameloop="demand"
          dpr={[1, 1.25]}
          camera={{ position: [0, 0.6, 10], fov: FOV }}
          gl={{ antialias: true, powerPreference: 'low-power' }}
        >
          <color attach="background" args={['#05060a']} />
          <ambientLight intensity={0.8} />
          <directionalLight position={[-6, 8, 12]} intensity={2.2} />
          <directionalLight position={[9, 2, 4]} intensity={0.6} color="#88aaff" />
          <Camera view={camera.view} request={camera.request} reducedMotion={reducedMotion} />
          <Suspense fallback={null}>
            <Spotlight.Provider value={spotlight}>
              <Slab region="gpu" x={330} y={239} w={615} h={405} color="#12221f" depth={0.16} z={-0.16} />
              <Label region="gpu" x={90} y={66} text="GPU" color={COLORS.token} size={20} />
              {pool && (
                <Label
                  region="gpu"
                  x={500}
                  y={66}
                  text={allocator}
                  color={declaration ? SPOT_COLOR : '#f0d58c'}
                  size={13}
                />
              )}
              {Array.from({ length: 12 }, (_, i) => (
                <Slab
                  key={i}
                  region="compute"
                  x={123 + (i % 6) * 85}
                  y={101 + Math.floor(i / 6) * 30}
                  w={75}
                  h={22}
                  color={COLORS.sm}
                  depth={0.5}
                />
              ))}
              <Label region="compute" x={325} y={156} text="COMPUTE · attention kernel" size={10} />
              <Slab region="l2" x={329} y={181} w={562} h={26} color={COLORS.l2} depth={0.3} />
              <Label region="l2" x={329} y={181} text="L2 CACHE" size={11} z={0.32} />
              <Slab region="memory" x={329} y={322} w={562} h={232} color="#361c29" depth={0.18} />
              {weightNames.map((name, i) => {
                const arrived = weights && (cue?.kind !== 'weights' || i < (cue.slot ?? 0))
                return (
                  <group key={name}>
                    <Slab
                      region="weights"
                      x={127 + i * 132}
                      y={225}
                      w={126}
                      h={22}
                      color={COLORS.weights}
                      opacity={arrived ? 1 : 0.15}
                      depth={0.36}
                    />
                    {arrived && (
                      <Label region="weights" x={127 + i * 132} y={225} text={name} size={10} color="#05060a" z={0.38} />
                    )}
                  </group>
                )
              })}
              <Label
                region="pool"
                x={200}
                y={251}
                text={pool ? 'KV CACHE · 1 slot = 1 token' : 'KV CACHE · not allocated yet'}
                color={COLORS.hbm}
                size={10}
                z={0.2}
              />
              {pool &&
                layout.slots.map((slot, i) => <Cell key={i} slot={slot} index={i} config={config} />)}
              {pool &&
                paged &&
                layout.blocks.map((block) => {
                  const [left, top] = blockBox(block.id, config)
                  return (
                    <Label
                      key={block.id}
                      region={slotRegion(block.request)}
                      x={left + 16}
                      y={top - 7}
                      text={block.refs > 1 ? `#${block.id} ×${block.refs}` : `#${block.id}`}
                      color={block.refs > 1 ? SPOT_COLOR : block.refs ? '#e6e9f0' : '#6f6680'}
                      size={8}
                      z={0.2}
                    />
                  )
                })}
              <Slab region="pcie" x={674} y={283} w={80} h={22} color="#67728d" />
              <Label region="pcie" x={674} y={255} text="PCIe" size={16} z={0.2} />
              <Slab region="host" x={846} y={239} w={264} h={405} color="#101727" depth={0.16} z={-0.16} />
              <Label region="host" x={846} y={69} text="COMPUTER · CPU + RAM" size={15} />
              {!pool ? (
                weightNames.map((name, i) => (
                  <group key={name}>
                    <Slab
                      region="host"
                      x={846}
                      y={150 + i * 38}
                      w={215}
                      h={28}
                      color={COLORS.weights}
                      opacity={weights ? 0.25 : 0.7}
                    />
                    <Label region="host" x={846} y={150 + i * 38} text={name} size={12} z={0.14} />
                  </group>
                ))
              ) : (
                <>
                  <Label region="queue" x={846} y={100} text="REQUESTS" size={11} />
                  {config.requests.map((spec, i) => {
                    const status = layout.status[spec.id]
                    return (
                      <Label
                        key={spec.id}
                        region="queue"
                        x={846}
                        y={120 + i * 16}
                        text={`${spec.id} · ${status}`}
                        color={status === 'pending' || status === 'finished' ? '#6f7a8c' : spec.color}
                        size={13}
                      />
                    )
                  })}
                  <Label
                    region="tables"
                    x={846}
                    y={226}
                    text={paged ? 'BLOCK TABLES' : 'CHUNKS'}
                    size={11}
                  />
                  {layout.sequences.map((seq, i) => {
                    const spec = requestSpec(config, seq.request)!
                    const detail = paged
                      ? seq.blocks.join(' · ')
                      : `slots ${seq.start}–${seq.start + spec.max_tokens - 1}`
                    return (
                      <Label
                        key={seq.id}
                        region="tables"
                        x={846}
                        y={248 + i * 19}
                        text={`${seq.id} → ${detail}`}
                        color={spec.color}
                        size={14}
                      />
                    )
                  })}
                  <Label region="swap" x={846} y={396} text="CPU SWAP SPACE" size={11} />
                  {Object.entries(layout.swappedBlocks).flatMap(([request, count]) =>
                    Array.from({ length: count }, (_, k) => (
                      <Slab
                        key={`${request}-${k}`}
                        region="swap"
                        x={770 + k * 18}
                        y={418}
                        w={13}
                        h={13}
                        color={requestSpec(config, request)?.color ?? COLORS.token}
                        depth={0.2}
                      />
                    )),
                  )}
                </>
              )}
              {spotlight
                ?.filter((target) => target !== 'meter')
                .map((target) => (
                  <Halo
                    key={target}
                    target={target}
                    config={config}
                    layout={layout}
                    pulse={!reducedMotion}
                  />
                ))}
            </Spotlight.Provider>
            {!reducedMotion && cue && (
              <group key={cue.serial}>
                {routes.flatMap((route, r) =>
                  Array.from({ length: route.count }, (_, i) => (
                    <TravelingPacket
                      key={`${r}-${i}`}
                      route={route}
                      index={i}
                      duration={cue.durationMs / 1000}
                    />
                  )),
                )}
              </group>
            )}
          </Suspense>
        </Canvas>
      </div>
      {!guiding && (
        <span className="da-orbit-hint">
          Drag to orbit · scroll to zoom · tall squares hold tokens, flat ones are waste
        </span>
      )}
    </div>
  )
}
