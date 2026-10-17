import { createContext, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import * as THREE from 'three'
import type { FlashConfig, FlashState, Matrix, MatrixName, Run, SpotlightTarget, VisualCue } from './types'
import { ALGORITHM_DECLARATION, blockSizes, inputs, rescaledRows, stageReached } from './simulation'
import {
  BUS_BOX,
  cellIn,
  cellLook,
  COLORS,
  formatValue,
  GPU_BOX,
  HBM_BOX,
  inSpotlight,
  layoutOf,
  packetRoutes,
  pointAlong,
  spotlightBoxes,
  SRAM_BOX,
  viewPreset,
  type PacketRoute,
  type View,
} from './geometry'
import {
  AZIMUTH_LIMIT,
  FOV,
  MAX_DISTANCE,
  MIN_DISTANCE,
  POLAR_RANGE,
  world,
} from '../declarative-attention/camera'

type Box = [number, number, number, number]
const SPOT_COLOR = '#ffd36e'
/** Brightness kept by parts outside the spoken phrase's spotlight. */
const DIMMED = 0.18
const Spotlight = createContext<SpotlightTarget[] | null>(null)
/** The 3D font may lack math glyphs. */
const ascii = (text: string) => text.replace('−∞', '-inf').replace(/−/g, '-')

function Label({
  x,
  y,
  text,
  regions,
  color = '#e6e9f0',
  size = 13,
  z = 0.02,
}: {
  x: number
  y: number
  text: string
  regions: string[]
  color?: string
  size?: number
  z?: number
}) {
  const lit = inSpotlight(regions, useContext(Spotlight))
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
  box,
  color,
  regions,
  depth = 0.12,
  z = 0,
  opacity = 1,
  glow = 0,
}: {
  box: Box
  color: string
  regions: string[]
  depth?: number
  /** Z of the slab's back face. */
  z?: number
  opacity?: number
  glow?: number
}) {
  if (!inSpotlight(regions, useContext(Spotlight))) {
    opacity *= DIMMED
    glow = 0
  }
  const [left, top, right, bottom] = box
  return (
    <mesh position={world((left + right) / 2, (top + bottom) / 2, z + depth / 2)}>
      <boxGeometry args={[(right - left) / 60, (bottom - top) / 60, depth]} />
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

/** A matrix as one nearest-filtered texture: one texel per value. */
function MatrixPlane({
  box,
  values,
  matrix,
  regions,
  transpose = false,
  z = 0.2,
}: {
  box: Box
  values: Matrix
  matrix: MatrixName
  regions: string[]
  transpose?: boolean
  z?: number
}) {
  const lit = inSpotlight(regions, useContext(Spotlight))
  const texture = useMemo(() => {
    const rows = transpose ? values[0].length : values.length
    const cols = transpose ? values.length : values[0].length
    const data = new Uint8Array(rows * cols * 4)
    const background = new THREE.Color(COLORS.cell)
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const look = cellLook(matrix, transpose ? values[c][r] : values[r][c])
        const color = background.clone().lerp(new THREE.Color(look.color), look.opacity)
        // Texture rows run bottom-up; matrix rows run top-down.
        const at = ((rows - 1 - r) * cols + c) * 4
        data[at] = Math.round(color.r * 255)
        data[at + 1] = Math.round(color.g * 255)
        data[at + 2] = Math.round(color.b * 255)
        data[at + 3] = 255
      }
    const map = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat)
    map.magFilter = THREE.NearestFilter
    map.minFilter = THREE.NearestFilter
    map.needsUpdate = true
    return map
  }, [values, matrix, transpose])
  useEffect(() => () => texture.dispose(), [texture])
  const [left, top, right, bottom] = box
  return (
    <mesh position={world((left + right) / 2, (top + bottom) / 2, z)}>
      <planeGeometry args={[(right - left) / 60, (bottom - top) / 60]} />
      <meshBasicMaterial
        key={lit ? 'lit' : 'dim'}
        map={texture}
        toneMapped={false}
        transparent={!lit}
        opacity={lit ? 1 : DIMMED}
      />
    </mesh>
  )
}

/** An SRAM tile stands tall when loaded and lies as a faint pad when empty. */
function Tile({
  box,
  values,
  matrix,
  regions,
  label,
  transpose = false,
  numbers = false,
  glow = false,
}: {
  box: Box
  values: Matrix | undefined
  matrix: MatrixName
  regions: string[]
  label: string
  transpose?: boolean
  numbers?: boolean
  glow?: boolean
}) {
  const [left, top, right, bottom] = box
  const depth = values ? 0.34 : 0.04
  const rows = values ? (transpose ? values[0].length : values.length) : 0
  const cols = values ? (transpose ? values.length : values[0].length) : 0
  return (
    <group>
      <Slab box={box} color={glow ? SPOT_COLOR : '#1d2b3a'} regions={regions} depth={depth} z={0.16} opacity={values ? 1 : 0.5} glow={glow ? 0.5 : 0} />
      {values && <MatrixPlane box={box} values={values} matrix={matrix} regions={regions} transpose={transpose} z={0.16 + depth + 0.005} />}
      {values &&
        numbers &&
        Array.from({ length: rows * cols }, (_, k) => {
          const r = Math.floor(k / cols)
          const c = k % cols
          const [l, t, rr, b] = cellIn(box, rows, cols, r, c)
          const value = transpose ? values[c][r] : values[r][c]
          return (
            <Label
              key={k}
              regions={regions}
              x={(l + rr) / 2}
              y={(t + b) / 2}
              z={0.16 + depth + 0.02}
              text={ascii(matrix === 'P' ? value.toFixed(2) : formatValue(value))}
              size={6}
              color="#05060a"
            />
          )
        })}
      <Label regions={regions} x={(left + right) / 2} y={top - 8} z={0.2} text={label} size={9} />
    </group>
  )
}

/** Pulsing frames around a spotlight target, drawn just in front of it. */
function Halo({ boxes, z, pulse }: { boxes: Box[]; z: number; pulse: boolean }) {
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
function Camera({ view, request, reducedMotion }: { view: View; request: number; reducedMotion: boolean }) {
  const { camera, invalidate, size } = useThree()
  const controls = useRef<any>(null)
  const goal = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const placed = useRef(false)
  useEffect(() => {
    const preset = viewPreset(view, size.width / size.height)
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
function TravelingPacket({ route, index, duration }: { route: PacketRoute; index: number; duration: number }) {
  const mesh = useRef<THREE.Mesh>(null)
  const start = useRef<number | null>(null)
  const { invalidate } = useThree()
  useFrame(({ clock }) => {
    if (!mesh.current) return
    start.current ??= clock.elapsedTime
    const progress = (clock.elapsedTime - start.current - index * 0.012) / (duration * 0.85)
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

function Board({ state, run, config, cue, declaration }: { state: FlashState; run: Run; config: FlashConfig; cue: VisualCue | null; declaration: string | null }) {
  const { hbm, sram: boxes } = layoutOf(config)
  const { Q, K, V } = inputs(config)
  const { Br, Tr, Tc } = blockSizes(config)
  const ready = stageReached(state, 'inputs')
  const tiled = run.mode !== 'standard'
  const sram = run.sram
  const computing = cue?.kind === 'compute' ? cue.op?.phase : null
  const shown = (values: number[], r: number) => (run.hbm.oWritten[r] ? values : values.map(() => NaN))
  const O = useMemo(() => run.hbm.O.map((row, r) => shown(row, r)), [run])
  const l = useMemo(() => run.hbm.l.map((x, r) => shown([x], r)), [run])
  const m = useMemo(() => run.hbm.m.map((x, r) => shown([x], r)), [run])
  const scores = useMemo(() => run.hbm.S.map((row, r) => (Number.isNaN(run.hbm.P[r][0]) ? row : run.hbm.P[r])), [run])
  const risen = rescaledRows(run).map((entry) => entry.row)
  const focus = cue?.op ?? run.op
  const i = sram && sram.i >= 0 ? String(sram.i + 1) : 'i'
  const j = sram && sram.j >= 0 ? String(sram.j + 1) : 'j'
  const column = (values: number[] | undefined) => values?.map((x) => [x])
  return (
    <>
      <Slab box={GPU_BOX} color="#12221f" regions={['gpu']} depth={0.16} z={-0.16} />
      <Label regions={['gpu']} x={GPU_BOX[0] + 40} y={GPU_BOX[1] + 22} text="GPU" color="#8bd2b3" size={18} />
      {ready && (
        <Label regions={['gpu']} x={GPU_BOX[2] - 140} y={GPU_BOX[1] + 22} text={declaration ?? ALGORITHM_DECLARATION[state.mode]} color={declaration ? SPOT_COLOR : '#f0d58c'} size={12} />
      )}
      <Slab box={HBM_BOX} color="#361c29" regions={['hbm']} depth={0.12} />
      <Label regions={['hbm']} x={HBM_BOX[0] + 34} y={HBM_BOX[1] + 20} text="HBM" color={COLORS.hbm} size={16} />
      <Label regions={['hbm']} x={HBM_BOX[2] - 100} y={HBM_BOX[1] + 20} text="40 GB · 1.5 TB/s" size={10} />
      <Slab box={BUS_BOX} color={COLORS.bus} regions={['bus']} depth={0.2} />
      <Label regions={['bus']} x={(BUS_BOX[0] + BUS_BOX[2]) / 2} y={BUS_BOX[1] - 12} text="bus" size={10} />
      <Slab box={SRAM_BOX} color="#16304a" regions={['sram']} depth={0.12} />
      <Label regions={['sram']} x={SRAM_BOX[0] + 38} y={SRAM_BOX[1] + 20} text="SRAM" color={COLORS.sram} size={16} />
      <Label regions={['sram']} x={SRAM_BOX[2] - 110} y={SRAM_BOX[1] + 20} text={ready ? `on chip · M = ${config.sram_size} values` : '192 KB per SM · ~19 TB/s'} size={10} />
      {!ready ? (
        <>
          <Label regions={['hbm']} x={274} y={260} text="Q, K and V not loaded yet" size={12} z={0.2} />
          <Label regions={['sram']} x={758} y={260} text="every matmul runs here" size={12} z={0.2} />
        </>
      ) : (
        <>
          <MatrixPlane box={hbm.Q} values={Q} matrix="Q" regions={['hbm', 'q']} />
          <Label regions={['hbm', 'q']} x={hbm.Q[0] - 12} y={(hbm.Q[1] + hbm.Q[3]) / 2} text="Q" color={COLORS.q} size={12} z={0.2} />
          <MatrixPlane box={hbm.KT} values={K} matrix="K" regions={['hbm', 'k']} transpose />
          <Label regions={['hbm', 'k']} x={hbm.KT[0] - 16} y={(hbm.KT[1] + hbm.KT[3]) / 2} text="K^T" color={COLORS.k} size={10} z={0.2} />
          <MatrixPlane box={hbm.V} values={V} matrix="V" regions={['hbm', 'v']} />
          <Label regions={['hbm', 'v']} x={(hbm.V[0] + hbm.V[2]) / 2} y={hbm.V[1] - 8} text="V" color={COLORS.v} size={12} z={0.2} />
          <MatrixPlane box={hbm.O} values={O} matrix="O" regions={['hbm', 'o']} />
          <Label regions={['hbm', 'o']} x={(hbm.O[0] + hbm.O[2]) / 2} y={hbm.O[1] - 8} text="O" color={COLORS.o} size={12} z={0.2} />
          <MatrixPlane box={hbm.l} values={l} matrix="l" regions={['hbm', 'stats']} />
          <MatrixPlane box={hbm.m} values={m} matrix="m" regions={['hbm', 'stats']} />
          <Label regions={['hbm', 'stats']} x={(hbm.l[0] + hbm.m[2]) / 2} y={hbm.l[1] - 8} text="l  m" color={COLORS.stats} size={10} z={0.2} />
          {tiled ? (
            <>
              {run.tiles.flatMap((row, ti) =>
                row.map((status, tj) => {
                  const box = cellIn(hbm.S, Tr, Tc, ti, tj)
                  const inner: Box = [box[0] + 1, box[1] + 1, box[2] - 1, box[3] - 1]
                  const look =
                    status === 'active'
                      ? { color: SPOT_COLOR, opacity: 0.8, depth: 0.08 }
                      : status === 'done'
                        ? { color: COLORS.s, opacity: 0.3, depth: 0.03 }
                        : status === 'masked' || status === 'skipped'
                          ? { color: '#0a080d', opacity: 0.9, depth: 0.02 }
                          : { color: COLORS.s, opacity: 0.08, depth: 0.01 }
                  return <Slab key={`${ti}-${tj}`} box={inner} regions={['hbm', 'scores']} color={look.color} opacity={look.opacity} depth={look.depth} z={0.12} />
                }),
              )}
              <Label regions={['hbm', 'scores']} x={(hbm.S[0] + hbm.S[2]) / 2} y={hbm.S[3] + 14} text="S, P never written to HBM" color={COLORS.s} size={10} z={0.2} />
            </>
          ) : (
            <>
              <MatrixPlane box={hbm.S} values={scores} matrix={run.hbm.P.some((row) => !Number.isNaN(row[0])) ? 'P' : 'S'} regions={['hbm', 'scores']} />
              <Label regions={['hbm', 'scores']} x={(hbm.S[0] + hbm.S[2]) / 2} y={hbm.S[3] + 14} text="S then P: N x N in HBM" color={COLORS.s} size={10} z={0.2} />
            </>
          )}
          {focus && focus.i >= 0 && tiled && focus.j >= 0 && (
            <Halo boxes={[cellIn(hbm.S, Tr, Tc, focus.i, focus.j)]} z={0.16} pulse={false} />
          )}
          {tiled ? (
            <>
              <Tile box={boxes.Q} values={sram?.Q} matrix="Q" regions={['sram', 'q']} label={`Q${i}`} />
              <Tile box={boxes.KT} values={sram?.K} matrix="K" regions={['sram', 'k']} label={`K${j}^T`} transpose />
              <Tile box={boxes.V} values={sram?.V} matrix="V" regions={['sram', 'v']} label={`V${j}`} glow={computing === 'pv'} />
              <Tile
                box={boxes.S}
                values={sram?.Pt ?? sram?.S}
                matrix={sram?.Pt ? 'P' : 'S'}
                regions={['sram', 'tile']}
                label={sram?.Pt ? `P~ ${i},${j} = exp(S - m~)` : `S${i},${j} = Q${i} K${j}^T`}
                numbers
                glow={computing === 'qk' || computing === 'softmax'}
              />
              <Tile box={boxes.O} values={sram?.O} matrix="O" regions={['sram', 'o']} label={`O${i}`} numbers glow={computing === 'pv'} />
              <Tile box={boxes.m} values={column(sram?.mNew ?? sram?.m)} matrix="m" regions={['sram', 'stats']} label="m" numbers glow={computing === 'softmax'} />
              <Tile box={boxes.l} values={column(sram?.lNew ?? sram?.l)} matrix="l" regions={['sram', 'stats']} label="l" numbers glow={computing === 'softmax'} />
              {risen.length > 0 && (
                <Halo boxes={risen.flatMap((r) => [cellIn(boxes.O, Br, 1, r, 0), cellIn(boxes.m, Br, 1, r, 0)])} z={0.55} pulse={false} />
              )}
            </>
          ) : (
            <>
              <Tile box={boxes.Q} values={sram?.Q} matrix="Q" regions={['sram', 'q']} label={`Q${i}`} />
              <Tile box={boxes.strip} values={sram?.strip?.rows} matrix={sram?.strip?.kind ?? 'S'} regions={['sram', 'tile']} label={sram?.strip ? `row block ${i} of ${sram.strip.kind}` : 'row block of S or P'} glow={!!computing} />
              <Tile box={boxes.O} values={sram?.O} matrix="O" regions={['sram', 'o']} label={`O${i}`} numbers />
            </>
          )}
        </>
      )}
    </>
  )
}

export default function FlashSpatial({
  state,
  run,
  config,
  cue,
  declaration,
  reducedMotion,
  spotlight,
  guiding,
}: {
  state: FlashState
  run: Run
  config: FlashConfig
  cue: VisualCue | null
  declaration: string | null
  reducedMotion: boolean
  spotlight: SpotlightTarget[] | null
  /** The guide is playing: hide camera chrome so the scene and caption lead. */
  guiding: boolean
}) {
  const [camera, setCamera] = useState<{ view: View; request: number }>({ view: 'overview', request: 0 })
  const routes = useMemo(() => (cue ? packetRoutes(cue, config, run.mode) : []), [cue, config, run.mode])
  return (
    <div className={`da-spatial ${cue?.kind === 'emphasis' ? 'da-residency-pulse' : ''}`}>
      {!guiding && (
        <div className="da-camera-controls" aria-label="Camera views">
          {(['overview', 'hbm', 'sram'] as View[]).map((name) => (
            <button
              key={name}
              aria-pressed={camera.view === name}
              onClick={() => setCamera((current) => ({ view: name, request: current.request + 1 }))}
            >
              {name === 'overview' ? 'overview' : name.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      <div
        className="da-canvas"
        role="img"
        aria-label={`Spatial GPU: HBM on the left, SRAM on the right. ${run.mode} attention, step ${run.pc} of ${run.total}. Use the controls below the scene to experiment.`}
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
              <Board state={state} run={run} config={config} cue={cue} declaration={declaration} />
              {spotlight
                ?.filter((target) => target !== 'meter')
                .map((target) => {
                  const { boxes, z } = spotlightBoxes(target, config, run.mode)
                  return <Halo key={target} boxes={boxes} z={z} pulse={!reducedMotion} />
                })}
            </Spotlight.Provider>
            {!reducedMotion && cue && (
              <group key={cue.serial}>
                {routes.map((route, r) => (
                  <TravelingPacket key={r} route={route} index={r} duration={cue.durationMs / 1000} />
                ))}
              </group>
            )}
          </Suspense>
        </Canvas>
      </div>
      {!guiding && (
        <span className="da-orbit-hint">
          Drag to orbit · scroll to zoom · tall tiles are loaded in SRAM, flat ones are empty
        </span>
      )}
    </div>
  )
}
