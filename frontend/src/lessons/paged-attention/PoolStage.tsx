import type { Layout, PagedConfig, PagedState, Slot, VisualCue } from './types'
import { requestSpec, stageReached } from './simulation'
import {
  BLOCKS_PER_ROW,
  blockBox,
  cellBox,
  COLORS,
  packetRoutes,
  POOL,
  weightNames,
} from './geometry'

const STATUS_COLORS: Record<string, string> = {
  running: COLORS.token,
  waiting: COLORS.reserved,
  swapped: '#f07aa0',
  finished: '#6f7a8c',
  pending: '#6f7a8c',
}

/** Contiguous chunks as one frame per pool row they cross. */
export function chunkFrames(layout: Layout, config: PagedConfig) {
  return layout.sequences.flatMap((seq) => {
    const length = requestSpec(config, seq.request)!.max_tokens
    const rows = new Map<number, number[]>()
    for (let slot = seq.start; slot < seq.start + length; slot++) {
      const row = Math.floor(slot / config.block_size / BLOCKS_PER_ROW)
      rows.set(row, [...(rows.get(row) ?? []), slot])
    }
    return [...rows.values()].map((slots) => ({
      id: `${seq.id}-${slots[0]}`,
      request: seq.request,
      first: cellBox(slots[0], config),
      last: cellBox(slots[slots.length - 1], config),
    }))
  })
}

function Cell({ slot, index, config }: { slot: Slot; index: number; config: PagedConfig }) {
  const [left, top, right, bottom] = cellBox(index, config)
  const color = (slot.request && requestSpec(config, slot.request)?.color) || '#3a3345'
  const fill =
    slot.kind === 'token'
      ? color
      : slot.kind === 'internal'
        ? COLORS.internal
        : slot.kind === 'external'
          ? COLORS.external
          : slot.kind === 'reserved'
            ? color
            : 'transparent'
  const opacity = { token: 0.85, reserved: 0.14, internal: 0.3, external: 0.35, free: 0 }[slot.kind]
  return (
    <g>
      <rect
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
        rx="2"
        fill={fill}
        fillOpacity={opacity}
        stroke={slot.kind === 'free' || slot.kind === 'external' ? '#3a3345' : color}
        strokeOpacity={slot.kind === 'token' ? 0 : 0.7}
        strokeDasharray={slot.kind === 'reserved' ? '3 2' : undefined}
      />
      {slot.token && (
        <text
          x={(left + right) / 2}
          y={top + 15}
          textAnchor="middle"
          className="pa-svg-token"
          textLength={slot.token.length > 5 ? right - left - 3 : undefined}
          lengthAdjust="spacingAndGlyphs"
        >
          {slot.token}
        </text>
      )}
    </g>
  )
}

function Packets({ cue, config }: { cue: VisualCue | null; config: PagedConfig }) {
  if (!cue) return null
  const duration = cue.durationMs / 1000
  return (
    <g key={cue.serial} className="da-packets" aria-hidden="true">
      {packetRoutes(cue, config).flatMap((route, routeIndex) =>
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
              animation: `da-packet-travel ${duration * 0.65}s linear ${(i * duration * 0.3) / route.count}s both`,
            }}
          />
        )),
      )}
    </g>
  )
}

export default function PoolStage({
  state,
  layout,
  config,
  cue,
  declaration,
}: {
  state: PagedState
  layout: Layout
  config: PagedConfig
  cue: VisualCue | null
  declaration: string | null
}) {
  const weights = stageReached(state, 'weights')
  const pool = stageReached(state, 'pool')
  const paged = state.mode === 'paged'
  const allocator = declaration ?? (paged ? 'paged blocks' : 'contiguous chunks')
  return (
    <svg
      className={`da-stage ${cue?.kind === 'emphasis' ? 'da-residency-pulse' : ''}`}
      viewBox="0 0 1000 470"
      role="group"
      aria-label={`GPU memory diagram. ${paged ? 'Paged' : 'Contiguous'} KV cache allocation.`}
    >
      <defs>
        <pattern id="pa-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".6" fill="#293646" />
        </pattern>
      </defs>
      <rect width="1000" height="470" fill="url(#pa-grid)" opacity=".45" />
      <rect x="24" y="42" width="610" height="404" rx="16" className="da-gpu-outline" />
      <text x="45" y="72" className="da-svg-heading" fill="#8bd2b3">
        GPU
      </text>
      {pool && (
        <text
          x="610"
          y="72"
          textAnchor="end"
          className="da-svg-code"
          fill={declaration ? '#ffd36e' : '#f0d58c'}
        >
          {allocator}
        </text>
      )}
      {Array.from({ length: 12 }, (_, i) => (
        <g key={i}>
          <rect
            x={86 + (i % 6) * 85}
            y={90 + Math.floor(i / 6) * 30}
            width="75"
            height="22"
            rx="4"
            fill="#322641"
            stroke="#8766ac"
          />
          <text
            x={123 + (i % 6) * 85}
            y={105 + Math.floor(i / 6) * 30}
            textAnchor="middle"
            className="da-svg-tiny"
            fill="#d2bde6"
          >
            SM
          </text>
        </g>
      ))}
      <text x="325" y="160" textAnchor="middle" className="da-svg-small">
        COMPUTE · attention kernel
      </text>
      <rect x="48" y="168" width="562" height="26" rx="5" fill="#183349" stroke="#4b8bb2" />
      <text x="325" y="185" textAnchor="middle" className="da-svg-small">
        L2 cache
      </text>
      <rect x="48" y="206" width="562" height="232" rx="9" fill="#271c28" stroke="#b66073" />
      {weightNames.map((name, i) => (
        <g key={name}>
          <rect
            x={64 + i * 132}
            y="214"
            width="126"
            height="22"
            rx="4"
            fill={
              weights && (cue?.kind !== 'weights' || i < (cue.slot ?? 0))
                ? COLORS.weights
                : 'transparent'
            }
            stroke={COLORS.weights}
          />
          <text
            x={127 + i * 132}
            y="229"
            textAnchor="middle"
            className="da-svg-tiny"
            fill={weights ? '#05060a' : COLORS.weights}
          >
            {name}
          </text>
        </g>
      ))}
      <text x={POOL.x} y="256" className="da-svg-tiny" fill={COLORS.hbm}>
        {pool
          ? `KV CACHE · ${config.num_blocks} blocks × ${config.block_size} slots · 1 slot = 1 token`
          : 'KV CACHE · not allocated yet'}
      </text>
      {pool &&
        layout.slots.map((slot, i) => <Cell key={i} slot={slot} index={i} config={config} />)}
      {pool &&
        paged &&
        layout.blocks.map((block) => {
          const [left, top, right] = blockBox(block.id, config)
          return (
            <g key={block.id}>
              <rect
                x={left - 2}
                y={top - 2}
                width={right - left + 4}
                height={POOL.cellHeight + 4}
                rx="3"
                fill="none"
                stroke={block.refs ? '#e6e9f0' : '#4a4256'}
                strokeOpacity={block.refs ? 0.55 : 0.6}
              />
              <text x={left} y={top - 5} className="pa-svg-block" opacity={block.refs ? 1 : 0.5}>
                {block.id}
                {block.refs > 1 ? `  ref ×${block.refs}` : ''}
              </text>
            </g>
          )
        })}
      {pool &&
        !paged &&
        chunkFrames(layout, config).map((frame) => (
          <rect
            key={frame.id}
            x={frame.first[0] - 2}
            y={frame.first[1] - 2}
            width={frame.last[2] - frame.first[0] + 4}
            height={POOL.cellHeight + 4}
            rx="3"
            fill="none"
            stroke={requestSpec(config, frame.request)!.color}
            strokeWidth="1.5"
          />
        ))}
      <rect x="634" y="273" width="80" height="23" rx="3" fill="#222c35" stroke="#65737d" />
      <text x="674" y="265" textAnchor="middle" className="da-svg-small">
        PCIe
      </text>
      <rect x="714" y="42" width="264" height="404" rx="16" fill="#101a23" stroke="#526471" />
      <text x="737" y="73" className="da-svg-heading">
        HOST
      </text>
      <text x="955" y="73" textAnchor="end" className="da-svg-small">
        CPU + RAM
      </text>
      {!pool ? (
        <g opacity={weights ? 0.4 : 0.85}>
          <text x="738" y="110" className="da-svg-small">
            MODEL CHECKPOINT
          </text>
          {weightNames.map((name, i) => (
            <g key={name}>
              <rect
                x="738"
                y={135 + i * 38}
                width="216"
                height="29"
                rx="4"
                fill="#49352a"
                stroke={COLORS.weights}
              />
              <text
                x="846"
                y={155 + i * 38}
                textAnchor="middle"
                className="da-svg-label"
                fill={COLORS.weights}
              >
                {name}
              </text>
            </g>
          ))}
        </g>
      ) : (
        <g>
          <text x="738" y="104" className="da-svg-tiny">
            REQUESTS · first come, first served
          </text>
          {config.requests.map((spec, i) => {
            const status = layout.status[spec.id]
            const preview = `${spec.prompt.slice(0, 5).join(' ')}…${spec.outputs.length > 1 ? ` ×${spec.outputs.length}` : ''}`
            return (
              <g key={spec.id} opacity={status === 'pending' || status === 'finished' ? 0.5 : 1}>
                <text x="740" y={120 + i * 14} className="da-svg-small" fill={spec.color}>
                  {spec.id}
                </text>
                <text x="756" y={120 + i * 14} className="da-svg-tiny" fill={STATUS_COLORS[status]}>
                  {status}
                </text>
                <text
                  x="808"
                  y={120 + i * 14}
                  className="da-svg-tiny"
                  textLength={preview.length > 30 ? 150 : undefined}
                  lengthAdjust="spacingAndGlyphs"
                >
                  {preview}
                </text>
              </g>
            )
          })}
          <text x="738" y="226" className="da-svg-tiny">
            {paged ? 'BLOCK TABLES · logical → physical' : 'CHUNKS · one per sequence'}
          </text>
          {layout.sequences.map((seq, i) => {
            const spec = requestSpec(config, seq.request)!
            return (
              <g key={seq.id}>
                <text x="740" y={246 + i * 18} className="da-svg-small" fill={spec.color}>
                  {seq.id}
                </text>
                {paged ? (
                  seq.blocks.map((block, j) => {
                    const filled = Math.min(
                      config.block_size,
                      seq.tokens.length - j * config.block_size,
                    )
                    return (
                      <g key={j}>
                        <rect
                          x={764 + j * 30}
                          y={235 + i * 18}
                          width="26"
                          height="14"
                          rx="2"
                          fill={spec.color}
                          fillOpacity={0.15 + (0.6 * filled) / config.block_size}
                          stroke={spec.color}
                        />
                        <text
                          x={777 + j * 30}
                          y={246 + i * 18}
                          textAnchor="middle"
                          className="da-svg-tiny"
                          fill="#05060a"
                        >
                          {block}
                        </text>
                      </g>
                    )
                  })
                ) : (
                  <text x="764" y={246 + i * 18} className="da-svg-tiny">
                    {`slots ${seq.start}–${seq.start + spec.max_tokens - 1} · ${seq.tokens.length} used`}
                  </text>
                )}
              </g>
            )
          })}
          <text x="738" y="398" className="da-svg-tiny">
            CPU SWAP SPACE
          </text>
          {Object.entries(layout.swappedBlocks).flatMap(([request, count]) =>
            Array.from({ length: count }, (_, k) => (
              <rect
                key={`${request}-${k}`}
                x={740 + k * 16}
                y="408"
                width="12"
                height="12"
                rx="2"
                fill={requestSpec(config, request)?.color}
              />
            )),
          )}
          {!Object.keys(layout.swappedBlocks).length && (
            <text x="740" y="418" className="da-svg-tiny" opacity=".5">
              empty
            </text>
          )}
        </g>
      )}
      <Packets cue={cue} config={config} />
    </svg>
  )
}
