import { memo } from 'react'
import type { FlashConfig, FlashState, Matrix, MatrixName, Run, VisualCue } from './types'
import {
  ALGORITHM_DECLARATION,
  blockSizes,
  describeOp,
  inputs,
  opTraffic,
  rescaledRows,
  stageReached,
  sub,
} from './simulation'
import {
  BUS_BOX,
  cellIn,
  cellLook,
  COLORS,
  formatValue,
  GPU_BOX,
  HBM_BOX,
  layoutOf,
  packetRoutes,
  SRAM_BOX,
} from './geometry'

type Box = [number, number, number, number]
const SPOT = '#ffd36e'

/** P̃ and P are in (0, 1]: two decimals without the leading zero fit a cell. */
const formatCell = (matrix: MatrixName, value: number) =>
  matrix === 'P' && value < 0.995 && value >= 0 ? value.toFixed(2).slice(1) : formatValue(value)

/** One rect per value; `transpose` draws an N × d matrix as d × N (Kᵀ). */
const Cells = memo(function Cells({
  box,
  values,
  matrix,
  numbers = false,
  transpose = false,
}: {
  box: Box
  values: Matrix
  matrix: MatrixName
  numbers?: boolean
  transpose?: boolean
}) {
  const rows = transpose ? values[0].length : values.length
  const cols = transpose ? values.length : values[0].length
  return (
    <g>
      {Array.from({ length: rows * cols }, (_, k) => {
        const r = Math.floor(k / cols)
        const c = k % cols
        const value = transpose ? values[c][r] : values[r][c]
        const [left, top, right, bottom] = cellIn(box, rows, cols, r, c)
        const look = cellLook(matrix, value)
        const text = numbers ? formatCell(matrix, value) : ''
        return (
          <g key={k}>
            <rect
              x={left + 0.5}
              y={top + 0.5}
              width={right - left - 1}
              height={bottom - top - 1}
              rx={numbers ? 2 : 0.5}
              fill={look.color}
              fillOpacity={look.opacity}
            />
            {text && (
              <text
                x={(left + right) / 2}
                y={(top + bottom) / 2 + 2.6}
                textAnchor="middle"
                className="fa-svg-num"
                textLength={text.length > 3 ? right - left - 3 : undefined}
                lengthAdjust="spacingAndGlyphs"
              >
                {text}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
})

function Frame({
  box,
  color,
  label,
  labelAt = 'above',
  dashed = false,
  glow = false,
}: {
  box: Box
  color: string
  label?: string
  labelAt?: 'above' | 'below' | 'left'
  dashed?: boolean
  glow?: boolean
}) {
  const [left, top, right, bottom] = box
  const position =
    labelAt === 'left'
      ? { x: left - 6, y: (top + bottom) / 2 + 4, anchor: 'end' as const }
      : { x: (left + right) / 2, y: labelAt === 'above' ? top - 5 : bottom + 13, anchor: 'middle' as const }
  return (
    <g>
      <rect
        x={left - 1}
        y={top - 1}
        width={right - left + 2}
        height={bottom - top + 2}
        rx="2"
        fill="none"
        stroke={glow ? SPOT : color}
        strokeWidth={glow ? 2 : 1}
        strokeOpacity={dashed ? 0.45 : 0.9}
        strokeDasharray={dashed ? '3 3' : undefined}
        className={glow ? 'fa-glow' : undefined}
      />
      {label && (
        <text x={position.x} y={position.y} textAnchor={position.anchor} className="da-svg-small" fill={color}>
          {label}
        </text>
      )}
    </g>
  )
}

function Packets({ cue, config, run }: { cue: VisualCue | null; config: FlashConfig; run: Run }) {
  if (!cue) return null
  const duration = cue.durationMs / 1000
  return (
    <g key={cue.serial} className="da-packets" aria-hidden="true">
      {packetRoutes(cue, config, run.mode).flatMap((route, routeIndex) =>
        Array.from({ length: route.count }, (_, i) => (
          <rect
            key={`${routeIndex}-${i}`}
            x={-3}
            y={-3}
            width={6}
            height={6}
            rx={1}
            fill={route.color}
            style={{
              offsetPath: `path('M ${route.points.map((point) => point.join(' ')).join(' L ')}')`,
              offsetRotate: '0deg',
              animation: `da-packet-travel ${duration * 0.85}s linear ${(routeIndex * duration * 0.1) / 8}s both`,
            }}
          />
        )),
      )}
    </g>
  )
}

function HbmPanel({ config, run, ready, cue }: { config: FlashConfig; run: Run; ready: boolean; cue: VisualCue | null }) {
  const { hbm } = layoutOf(config)
  const { Q, K, V } = inputs(config)
  const N = config.seq_len
  const { Br, Bc, Tr, Tc } = blockSizes(config)
  const tiled = run.mode !== 'standard'
  const sram = run.sram
  const shown = (values: number[], r: number) => (run.hbm.oWritten[r] ? values : values.map(() => NaN))
  const O = run.hbm.O.map((row, r) => shown(row, r))
  const l = run.hbm.l.map((x, r) => shown([x], r))
  const m = run.hbm.m.map((x, r) => shown([x], r))
  // Where standard attention has written P, show P; else S where written.
  const scores = run.hbm.S.map((row, r) => (Number.isNaN(run.hbm.P[r][0]) ? row : run.hbm.P[r]))
  const scoreMatrix: MatrixName = run.hbm.P.some((row) => !Number.isNaN(row[0])) ? 'P' : 'S'
  const tileBox = (i: number, j: number) => cellIn(hbm.S, Tr, Tc, i, j)
  const focus = cue?.op ?? run.op
  const [sLeft, sTop, sRight, sBottom] = hbm.S
  return (
    <g className={cue?.kind === 'boot' ? 'fa-boot' : undefined}>
      <rect x={HBM_BOX[0]} y={HBM_BOX[1]} width={HBM_BOX[2] - HBM_BOX[0]} height={HBM_BOX[3] - HBM_BOX[1]} rx="10" fill="#271c28" stroke="#b66073" />
      <text x={HBM_BOX[0] + 16} y={HBM_BOX[1] + 22} className="da-svg-heading" fill={COLORS.hbm}>
        HBM
      </text>
      <text x={HBM_BOX[2] - 14} y={HBM_BOX[1] + 22} textAnchor="end" className="da-svg-small">
        40 GB · 1.5 TB/s · slow, large
      </text>
      {!ready ? (
        <text x={(HBM_BOX[0] + HBM_BOX[2]) / 2} y="260" textAnchor="middle" className="da-svg-small" opacity=".6">
          Q, K and V not loaded yet
        </text>
      ) : (
        <g className="fa-inputs">
          <Cells box={hbm.Q} values={Q} matrix="Q" />
          <Frame box={hbm.Q} color={COLORS.q} label="Q" labelAt="left" />
          <Cells box={hbm.KT} values={K} matrix="K" transpose />
          <Frame box={hbm.KT} color={COLORS.k} label="Kᵀ" labelAt="left" />
          <Cells box={hbm.V} values={V} matrix="V" />
          <Frame box={hbm.V} color={COLORS.v} label="V" />
          <Cells box={hbm.O} values={O} matrix="O" />
          <Frame box={hbm.O} color={COLORS.o} label="O" />
          <Cells box={hbm.l} values={l} matrix="l" />
          <Frame box={hbm.l} color={COLORS.stats} label="ℓ" />
          <Cells box={hbm.m} values={m} matrix="m" />
          <Frame box={hbm.m} color={COLORS.stats} label="m" />
          {tiled ? (
            <g>
              <rect x={sLeft} y={sTop} width={sRight - sLeft} height={sBottom - sTop} fill="none" stroke={COLORS.s} strokeOpacity=".5" strokeDasharray="4 3" />
              {run.tiles.flatMap((row, i) =>
                row.map((status, j) => {
                  const [left, top, right, bottom] = tileBox(i, j)
                  const masked = status === 'masked' || status === 'skipped'
                  return (
                    <g key={`${i}-${j}`}>
                      <rect
                        x={left + 1}
                        y={top + 1}
                        width={right - left - 2}
                        height={bottom - top - 2}
                        rx="2"
                        fill={masked ? 'url(#fa-hatch)' : status === 'done' ? COLORS.s : 'transparent'}
                        fillOpacity={status === 'done' ? 0.14 : 1}
                        stroke={status === 'active' ? SPOT : COLORS.s}
                        strokeOpacity={status === 'active' ? 1 : 0.25}
                        strokeWidth={status === 'active' ? 1.6 : 1}
                      />
                      {status === 'skipped' && (
                        <text x={(left + right) / 2} y={(top + bottom) / 2 + 4} textAnchor="middle" className="da-svg-tiny" fill="#8a93a6">
                          skipped
                        </text>
                      )}
                    </g>
                  )
                }),
              )}
              <text x={(sLeft + sRight) / 2} y={sBottom + 16} textAnchor="middle" className="da-svg-small" fill={COLORS.s}>
                S and P (N × N): never written to HBM
              </text>
            </g>
          ) : (
            <g>
              <rect x={sLeft} y={sTop} width={sRight - sLeft} height={sBottom - sTop} fill="none" stroke={COLORS.s} strokeOpacity=".5" />
              <Cells box={hbm.S} values={scores} matrix={scoreMatrix} />
              {Array.from({ length: Tr - 1 }, (_, i) => (
                <line key={i} x1={sLeft} x2={sRight} y1={tileBox(i + 1, 0)[1]} y2={tileBox(i + 1, 0)[1]} stroke="#05060a" strokeOpacity=".5" />
              ))}
              <text x={(sLeft + sRight) / 2} y={sBottom + 16} textAnchor="middle" className="da-svg-small" fill={COLORS.s}>
                S = QKᵀ, then P = softmax(S): N × N in HBM
              </text>
            </g>
          )}
          {/* What SRAM holds right now, framed where it came from. */}
          {sram?.K && tiled && (
            <Frame box={cellIn(hbm.KT, 1, Tc, 0, sram.j)} color={COLORS.k} glow />
          )}
          {sram?.V && tiled && <Frame box={cellIn(hbm.V, Tc, 1, sram.j, 0)} color={COLORS.v} glow />}
          {focus && focus.i >= 0 && (
            <>
              {(tiled ? sram?.Q : focus.phase === 'std-qk') && <Frame box={cellIn(hbm.Q, Tr, 1, focus.i, 0)} color={COLORS.q} glow />}
              {(tiled ? sram?.O : run.op?.phase === 'std-pv') && <Frame box={cellIn(hbm.O, Tr, 1, focus.i, 0)} color={COLORS.o} glow />}
              {!tiled && <Frame box={cellIn(hbm.S, Tr, 1, focus.i, 0)} color={COLORS.s} glow />}
              {tiled && focus.j >= 0 && <Frame box={tileBox(focus.i, focus.j)} color={COLORS.s} glow />}
            </>
          )}
          <text x={(HBM_BOX[0] + HBM_BOX[2]) / 2} y={HBM_BOX[3] - 8} textAnchor="middle" className="da-svg-tiny" opacity=".7">
            {`1 square = 1 value · N = ${N} tokens · d = ${config.head_dim} · tiles ${Br} × ${Bc}`}
          </text>
        </g>
      )}
    </g>
  )
}

function SramPanel({ config, run, ready, cue }: { config: FlashConfig; run: Run; ready: boolean; cue: VisualCue | null }) {
  const { sram: boxes } = layoutOf(config)
  const { Br } = blockSizes(config)
  const sram = run.sram
  const tiled = run.mode !== 'standard'
  const computing = cue?.kind === 'compute' ? cue.op?.phase : null
  const rescaled = rescaledRows(run)
  const risen = new Set(rescaled.map((entry) => entry.row))
  const column = (values: number[] | undefined) => values?.map((x) => [x])
  const i = sram && sram.i >= 0 ? sub(sram.i) : 'ᵢ'
  const j = sram && sram.j >= 0 ? sub(sram.j) : 'ⱼ'
  const op = run.op
  const traffic = op ? opTraffic(op) : null
  const scoreLabel =
    op?.phase === 'skip'
      ? `tile (${op.i + 1}, ${op.j + 1}) skipped`
      : sram?.Pt
        ? `P̃${i}${j} = exp(S − m̃)`
        : `S${i}${j} = Q${i}K${j}ᵀ`
  return (
    <g>
      <rect x={SRAM_BOX[0]} y={SRAM_BOX[1]} width={SRAM_BOX[2] - SRAM_BOX[0]} height={SRAM_BOX[3] - SRAM_BOX[1]} rx="10" fill="#132332" stroke="#4b8bb2" />
      <text x={SRAM_BOX[0] + 16} y={SRAM_BOX[1] + 22} className="da-svg-heading" fill={COLORS.sram}>
        SRAM
      </text>
      <text x={SRAM_BOX[2] - 14} y={SRAM_BOX[1] + 22} textAnchor="end" className="da-svg-small">
        {ready ? `on chip · holds M = ${config.sram_size} values here` : '192 KB per SM · ~19 TB/s · fast, tiny'}
      </text>
      {!ready ? (
        <text x={(SRAM_BOX[0] + SRAM_BOX[2]) / 2} y="260" textAnchor="middle" className="da-svg-small" opacity=".6">
          Every matmul and softmax runs here
        </text>
      ) : tiled ? (
        <g>
          {sram?.Q ? <Cells box={boxes.Q} values={sram.Q} matrix="Q" /> : null}
          <Frame box={boxes.Q} color={COLORS.q} label={`Q${i}`} dashed={!sram?.Q} />
          {sram?.K ? <Cells box={boxes.KT} values={sram.K} matrix="K" transpose /> : null}
          <Frame box={boxes.KT} color={COLORS.k} label={`K${j}ᵀ`} labelAt="left" dashed={!sram?.K} />
          {sram?.V ? <Cells box={boxes.V} values={sram.V} matrix="V" /> : null}
          <Frame box={boxes.V} color={COLORS.v} label={`V${j}`} labelAt="left" dashed={!sram?.V} glow={computing === 'pv'} />
          {sram?.Pt ? (
            <Cells box={boxes.S} values={sram.Pt} matrix="P" numbers />
          ) : sram?.S ? (
            <Cells box={boxes.S} values={sram.S} matrix="S" numbers />
          ) : null}
          <Frame box={boxes.S} color={sram?.Pt ? COLORS.p : COLORS.s} dashed={!sram?.S} glow={computing === 'qk' || computing === 'softmax'} />
          <text x={(boxes.S[0] + boxes.S[2]) / 2} y={boxes.S[3] + 13} textAnchor="middle" className="da-svg-small" fill={sram?.Pt ? COLORS.p : COLORS.s}>
            {scoreLabel}
          </text>
          {sram?.O ? <Cells box={boxes.O} values={sram.O} matrix="O" numbers /> : null}
          <Frame box={boxes.O} color={COLORS.o} label={`O${i}`} labelAt="below" dashed={!sram?.O} glow={computing === 'pv'} />
          {sram?.m ? <Cells box={boxes.m} values={column(sram.mNew ?? sram.m)!} matrix="m" numbers /> : null}
          <Frame box={boxes.m} color={COLORS.stats} label="m" labelAt="below" dashed={!sram?.m} glow={computing === 'softmax'} />
          {sram?.l ? <Cells box={boxes.l} values={column(sram.lNew ?? sram.l)!} matrix="l" numbers /> : null}
          <Frame box={boxes.l} color={COLORS.stats} label="ℓ" labelAt="below" dashed={!sram?.l} glow={computing === 'softmax'} />
          {[...risen].map((r) => (
            <g key={r}>
              <Frame box={cellIn(boxes.O, Br, 1, r, 0)} color={SPOT} glow />
              <Frame box={cellIn(boxes.m, Br, 1, r, 0)} color={SPOT} glow />
            </g>
          ))}
        </g>
      ) : (
        <g>
          {sram?.Q ? <Cells box={boxes.Q} values={sram.Q} matrix="Q" /> : null}
          <Frame box={boxes.Q} color={COLORS.q} label={`Q${i}`} dashed={!sram?.Q} />
          {sram?.strip ? <Cells box={boxes.strip} values={sram.strip.rows} matrix={sram.strip.kind} /> : null}
          <Frame
            box={boxes.strip}
            color={sram?.strip?.kind === 'P' ? COLORS.p : COLORS.s}
            label={sram?.strip ? `row block ${(sram.i ?? 0) + 1} of ${sram.strip.kind}: written back to HBM` : 'one row block of S or P'}
            dashed={!sram?.strip}
            glow={!!computing}
          />
          {sram?.O ? <Cells box={boxes.O} values={sram.O} matrix="O" numbers /> : null}
          <Frame box={boxes.O} color={COLORS.o} label={`O${i}`} labelAt="below" dashed={!sram?.O} />
        </g>
      )}
      {ready && (
        <g>
          <text x={(SRAM_BOX[0] + SRAM_BOX[2]) / 2} y={SRAM_BOX[3] - 44} textAnchor="middle" className="da-svg-code" fill="#f0d58c">
            {op ? describeOp(op) : run.next ? `Next: ${describeOp(run.next)}` : ''}
          </text>
          <text x={(SRAM_BOX[0] + SRAM_BOX[2]) / 2} y={SRAM_BOX[3] - 28} textAnchor="middle" className="da-svg-tiny">
            {op && traffic
              ? `Algorithm ${op.algorithm}, line ${op.line} · HBM reads ${traffic.reads} · writes ${traffic.writes}${op.flops ? ` · ${op.flops} FLOPs` : ''}`
              : `Step 0 of ${run.total}`}
          </text>
          {rescaled.length > 0 && (
            <text x={(SRAM_BOX[0] + SRAM_BOX[2]) / 2} y={SRAM_BOX[3] - 12} textAnchor="middle" className="da-svg-tiny" fill={SPOT}>
              {rescaled
                .map(({ row, mOld, mNew, factor }) => `row ${row + 1}: m ${mOld.toFixed(1)} → ${mNew.toFixed(1)}, O and ℓ × ${factor.toFixed(2)}`)
                .join(' · ')}
            </text>
          )}
        </g>
      )}
    </g>
  )
}

export default function FlashStage({
  state,
  run,
  config,
  cue,
  declaration,
}: {
  state: FlashState
  run: Run
  config: FlashConfig
  cue: VisualCue | null
  declaration: string | null
}) {
  const ready = stageReached(state, 'inputs')
  const algorithm = declaration ?? ALGORITHM_DECLARATION[state.mode]
  return (
    <svg
      className={`da-stage ${cue?.kind === 'emphasis' ? 'da-residency-pulse' : ''}`}
      viewBox="0 0 1000 470"
      role="group"
      aria-label={`GPU memory diagram: HBM on the left, on-chip SRAM on the right. ${ready ? `${algorithm}, step ${run.pc} of ${run.total}.` : 'Inputs not loaded.'}`}
    >
      <defs>
        <pattern id="fa-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".6" fill="#293646" />
        </pattern>
        <pattern id="fa-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={COLORS.masked} />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#4a4256" strokeWidth="2" />
        </pattern>
      </defs>
      <rect width="1000" height="470" fill="url(#fa-grid)" opacity=".45" />
      <rect x={GPU_BOX[0]} y={GPU_BOX[1]} width={GPU_BOX[2] - GPU_BOX[0]} height={GPU_BOX[3] - GPU_BOX[1]} rx="16" className="da-gpu-outline" />
      <text x={GPU_BOX[0] + 18} y={GPU_BOX[1] + 26} className="da-svg-heading" fill="#8bd2b3">
        GPU
      </text>
      {ready && (
        <text x={GPU_BOX[2] - 18} y={GPU_BOX[1] + 26} textAnchor="end" className="da-svg-code" fill={declaration ? SPOT : '#f0d58c'}>
          {algorithm}
        </text>
      )}
      <HbmPanel config={config} run={run} ready={ready} cue={cue} />
      <rect x={BUS_BOX[0]} y={BUS_BOX[1]} width={BUS_BOX[2] - BUS_BOX[0]} height={BUS_BOX[3] - BUS_BOX[1]} rx="4" fill="#222c35" stroke={COLORS.bus} />
      <text
        x={(BUS_BOX[0] + BUS_BOX[2]) / 2}
        y={(BUS_BOX[1] + BUS_BOX[3]) / 2}
        textAnchor="middle"
        className="da-svg-tiny"
        transform={`rotate(-90 ${(BUS_BOX[0] + BUS_BOX[2]) / 2} ${(BUS_BOX[1] + BUS_BOX[3]) / 2})`}
      >
        HBM ↔ SRAM · the bottleneck
      </text>
      <SramPanel config={config} run={run} ready={ready} cue={cue} />
      <Packets cue={cue} config={config} run={run} />
    </svg>
  )
}
