import { createContext, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import * as THREE from 'three'
import type { MemoryConfig, MemoryState, SpotlightTarget, VisualCue } from './types'
import { selectedChunkIds, stageReached } from './simulation'
import {
  COLORS,
  inSpotlight,
  packetRoutes,
  pointAlong,
  slotCenter,
  slotWidth,
  spotlightBounds,
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
} from './camera'

/** Pointer travel (px) beyond which a press is an orbit drag, not a click. */
const CLICK_TOLERANCE = 6
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
}: {
  x: number
  y: number
  text: string
  region: string
  color?: string
  size?: number
  z?: number
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
  onClick,
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
  onClick?: () => void
}) {
  const { gl } = useThree()
  const [hovered, setHovered] = useState(false)
  const lit = inSpotlight(region, useContext(Spotlight))
  const pointing = !!onClick && hovered
  if (!lit) {
    opacity *= DIMMED
    glow = 0
  }
  useEffect(() => {
    if (!pointing) return
    gl.domElement.style.cursor = 'pointer'
    return () => {
      gl.domElement.style.cursor = ''
    }
  }, [pointing, gl])
  return (
    <mesh
      position={world(x, y, z + depth / 2)}
      onClick={
        onClick
          ? (event) => {
              event.stopPropagation()
              onClick()
            }
          : undefined
      }
      onPointerOver={
        onClick
          ? (event) => {
              event.stopPropagation()
              setHovered(true)
            }
          : undefined
      }
      onPointerOut={() => setHovered(false)}
    >
      <boxGeometry args={[w / 60, h / 60, depth]} />
      <meshStandardMaterial
        key={opacity < 1 ? 'transparent' : 'opaque'}
        color={color}
        transparent={opacity < 1}
        opacity={pointing ? Math.max(opacity, 0.45) : opacity}
        roughness={0.55}
        emissive={color}
        emissiveIntensity={pointing ? 0.45 : glow}
      />
    </mesh>
  )
}
/** Pulsing frame around a spotlight target, drawn just in front of it. */
function Halo({ target, config, pulse }: { target: SpotlightTarget; config: MemoryConfig; pulse: boolean }) {
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
  const bounds = spotlightBounds(target, config)
  if (!bounds) return null
  const [left, top, right, bottom] = bounds.box
  const pad = 6
  const edge = 4
  const [x0, x1, y0, y1] = [left - pad, right + pad, top - pad, bottom + pad]
  const bars: [number, number, number, number][] = [
    [(x0 + x1) / 2, y0, x1 - x0 + edge, edge],
    [(x0 + x1) / 2, y1, x1 - x0 + edge, edge],
    [x0, (y0 + y1) / 2, edge, y1 - y0],
    [x1, (y0 + y1) / 2, edge, y1 - y0],
  ]
  return (
    <group>
      {bars.map(([x, y, w, h], i) => (
        <mesh key={i} position={world(x, y, bounds.z + 0.04)} material={material}>
          <boxGeometry args={[w / 60, h / 60, 0.03]} />
        </mesh>
      ))}
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
    if (camera.position.distanceTo(next.position) < 0.01 && orbit.target.distanceTo(next.target) < 0.01) {
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
      <boxGeometry args={[0.09, 0.09, 0.09]} />
      <meshBasicMaterial color={route.color} />
    </mesh>
  )
}

export default function GpuSpatial({
  state,
  config,
  cue,
  declaration,
  prefilledSlots,
  onChunk,
  reducedMotion,
  spotlight,
  guiding,
}: {
  state: MemoryState
  config: MemoryConfig
  cue: VisualCue | null
  declaration: string | null
  prefilledSlots: number
  onChunk: (id: number) => void
  reducedMotion: boolean
  spotlight: SpotlightTarget[] | null
  /** The guide is playing: hide camera chrome so the scene and caption lead. */
  guiding: boolean
}) {
  const [camera, setCamera] = useState<{ view: View; request: number }>({
    view: 'overview',
    request: 0,
  })
  const press = useRef({ x: 0, y: 0, travel: 0 })
  const selected = selectedChunkIds(state, config)
  const resident = stageReached(state, 'prefill')
  const responseCount = Math.max(
    0,
    state.responseTokens - (cue?.kind === 'read' || cue?.kind === 'response' ? 1 : 0),
  )
  const routes = useMemo(() => (cue ? packetRoutes(cue, config) : []), [cue, config])
  const slots = [
    { id: 0, label: 'SYS', tokens: config.scaffold_tokens, color: COLORS.scaffold },
    ...config.chunks,
  ]
  const tag =
    declaration ??
    (state.mode === 'focus'
      ? `focus: ${state.focusedChunks.map((id) => config.chunks.find((c) => c.id === id)?.label).join(' + ')}`
      : state.mode)
  return (
    <div className={`da-spatial ${cue?.kind === 'residency' ? 'da-residency-pulse' : ''}`}>
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
        aria-label={`Spatial GPU. ${state.mode} mode. ${resident ? 'KV resident' : 'KV empty'}. Use the controls below for accessible chunk selection.`}
        onPointerDown={(event) => {
          press.current = { x: event.clientX, y: event.clientY, travel: 0 }
        }}
        onPointerMove={(event) => {
          if (!event.buttons) return
          const last = press.current
          last.travel += Math.hypot(event.clientX - last.x, event.clientY - last.y)
          last.x = event.clientX
          last.y = event.clientY
        }}
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
              <Label region="gpu" x={90} y={66} text="GPU" color={COLORS.response} size={20} />
              {Array.from({ length: 12 }, (_, i) => (
                <Slab
                  key={i}
                  region="compute"
                  x={140 + (i % 4) * 125}
                  y={108 + Math.floor(i / 4) * 37}
                  w={105}
                  h={28}
                  color={COLORS.sm}
                  depth={0.55}
                />
              ))}
              <Label region="compute" x={325} y={214} text="COMPUTE" size={11} />
              <Slab region="l2" x={325} y={254} w={560} h={30} color={COLORS.l2} depth={0.32} />
              <Label region="l2" x={325} y={254} text="L2 CACHE" size={12} z={0.34} />
              <Slab region="memory" x={325} y={364} w={560} h={147} color="#361c29" depth={0.18} />
              {weightNames.map((name, i) => {
                const arrived =
                  stageReached(state, 'weights') && (cue?.kind !== 'weights' || i < (cue.slot ?? 0))
                return (
                  <group key={name}>
                    <Slab
                      region="weights"
                      x={125 + i * 135}
                      y={310}
                      w={124}
                      h={24}
                      color={COLORS.weights}
                      opacity={arrived ? 1 : 0.15}
                      depth={0.38}
                    />
                    {arrived && (
                      <Label region="weights" x={125 + i * 135} y={310} text={name} size={10} color="#05060a" z={0.4} />
                    )}
                  </group>
                )
              })}
              {slots.map((chunk, i) => {
                const active = chunk.id === 0 || selected.includes(chunk.id)
                const filled = resident && i < prefilledSlots
                const region = chunk.id ? `c${chunk.id}` : 'sys'
                return (
                  <group key={chunk.id}>
                    <Slab
                      region={region}
                      x={slotCenter(i, config.chunks.length)}
                      y={365}
                      w={slotWidth(config.chunks.length) - 9}
                      h={52}
                      color={chunk.color}
                      depth={0.48}
                      opacity={filled ? (active ? 0.85 : 0.16) : 0.08}
                      glow={filled && active ? 0.22 : 0}
                      onClick={
                        resident && chunk.id
                          ? () => {
                              if (press.current.travel <= CLICK_TOLERANCE) onChunk(chunk.id)
                            }
                          : undefined
                      }
                    />
                    <Label
                      region={region}
                      x={slotCenter(i, config.chunks.length)}
                      y={filled ? 358 : 365}
                      text={chunk.label}
                      color={filled && active ? '#071b12' : chunk.color}
                      size={16}
                      z={0.5}
                    />
                    {filled && (
                      <Label
                        region={region}
                        x={slotCenter(i, config.chunks.length)}
                        y={379}
                        text={active ? 'READ' : 'SKIPPED'}
                        color={active ? '#071b12' : '#e6e9f0'}
                        size={10}
                        z={0.5}
                      />
                    )}
                  </group>
                )
              })}
              <Label region="memory" x={112} y={420} text="MEMORY" color={COLORS.hbm} size={10} z={0.2} />
              {Array.from({ length: Math.min(12, responseCount) }, (_, i) => (
                <Slab
                  key={i}
                  region="reply"
                  x={257 + i * 13}
                  y={414}
                  w={9}
                  h={12}
                  color={COLORS.response}
                  depth={0.4}
                />
              ))}
              {responseCount > 0 && (
                <Label
                  region="reply"
                  x={513}
                  y={417}
                  text={`reply: ${responseCount} tok`}
                  color={COLORS.response}
                  size={10}
                  z={0.2}
                />
              )}
              <Slab region="pcie" x={674} y={283} w={80} h={22} color="#67728d" />
              <Label region="pcie" x={674} y={255} text="PCIe" size={16} z={0.2} />
              <Slab region="host" x={846} y={239} w={264} h={405} color="#101727" depth={0.16} z={-0.16} />
              <Label region="host" x={846} y={69} text="COMPUTER · CPU + RAM" size={15} />
              {!stageReached(state, 'request') ? (
                weightNames.map((name, i) => (
                  <group key={name}>
                    <Slab
                      region="host"
                      x={846}
                      y={185 + i * 38}
                      w={215}
                      h={28}
                      color={COLORS.weights}
                      opacity={stageReached(state, 'weights') ? 0.25 : 0.7}
                    />
                    <Label region="host" x={846} y={185 + i * 38} text={name} size={12} z={0.14} />
                  </group>
                ))
              ) : state.stage !== 'decode' ? (
                slots.map((chunk, i) => (
                  <Label
                    key={chunk.id}
                    region="host"
                    x={846}
                    y={160 + i * 27}
                    text={chunk.id ? `document ${chunk.label}` : 'SYS · instructions + question'}
                    color={chunk.color}
                    size={13}
                  />
                ))
              ) : (
                <>
                  <Label region="host" x={846} y={151} text={tag} color={SPOT_COLOR} size={tag.length > 25 ? 9 : 13} />
                  {state.events
                    .slice(0, responseCount)
                    .slice(-6)
                    .map((event, i) => (
                      <Label
                        key={event.id}
                        region="host"
                        x={846}
                        y={204 + i * 30}
                        text={event.text}
                        size={event.text.length > 24 ? 10 : 13}
                        color={event.mode === 'global' ? '#e6e9f0' : COLORS.response}
                      />
                    ))}
                </>
              )}
              {spotlight
                ?.filter((target) => target !== 'meter')
                .map((target) => (
                  <Halo key={target} target={target} config={config} pulse={!reducedMotion} />
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
        <span className="da-orbit-hint">Drag to orbit · scroll to zoom · click a seat to focus it</span>
      )}
    </div>
  )
}
