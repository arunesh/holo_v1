import type { MemoryConfig, MemoryState, VisualCue } from './types'
import { selectedChunkIds, stageReached } from './simulation'
import PacketFlow from './PacketFlow'
import { slotX, slotWidth, slotCenter, weightNames, COLORS } from './geometry'

export default function GpuStage({
  state,
  config,
  cue,
  declaration,
  prefilledSlots,
  onChunk,
}: {
  state: MemoryState
  config: MemoryConfig
  cue: VisualCue | null
  declaration: string | null
  prefilledSlots: number
  onChunk: (id: number) => void
}) {
  const resident = stageReached(state, 'prefill')
  const selected = selectedChunkIds(state, config)
  const weights = stageReached(state, 'weights')
  const output = state.stage === 'decode'
  const tag =
    declaration ??
    (state.mode === 'focus'
      ? `<focus magic_chunks="${state.focusedChunks.join(',')}">`
      : `<${state.mode}>`)
  const responseCount = Math.max(
    0,
    state.responseTokens - (cue?.kind === 'read' || cue?.kind === 'response' ? 1 : 0),
  )
  return (
    <svg
      className={`da-stage ${cue?.kind === 'residency' ? 'da-residency-pulse' : ''}`}
      viewBox="0 0 1000 470"
      role="group"
      aria-label="GPU memory diagram. Masked chunks stay resident; packets show reads."
    >
      <defs>
        <pattern id="da-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".6" fill="#293646" />
        </pattern>
      </defs>
      <rect width="1000" height="470" fill="url(#da-grid)" opacity=".45" />
      <rect x="24" y="42" width="610" height="404" rx="16" className="da-gpu-outline" />
      <text x="45" y="72" className="da-svg-heading" fill="#8bd2b3">
        GPU
      </text>
      <text x="610" y="72" textAnchor="end" className="da-svg-small">
        schematic · not hardware telemetry
      </text>
      {Array.from({ length: 12 }, (_, i) => (
        <g key={i}>
          <rect
            x={86 + (i % 4) * 126}
            y={97 + Math.floor(i / 4) * 34}
            width="110"
            height="26"
            rx="4"
            fill="#322641"
            stroke="#8766ac"
          />
          <text
            x={141 + (i % 4) * 126}
            y={115 + Math.floor(i / 4) * 34}
            textAnchor="middle"
            className="da-svg-small"
            fill="#d2bde6"
          >
            SM
          </text>
        </g>
      ))}
      <text x="325" y="220" textAnchor="middle" className="da-svg-small">
        COMPUTE · streaming multiprocessors
      </text>
      <rect x="48" y="238" width="562" height="32" rx="5" fill="#183349" stroke="#4b8bb2" />
      <text x="325" y="259" textAnchor="middle" className="da-svg-label">
        L2 cache · shared memory path
      </text>
      <rect x="48" y="285" width="562" height="144" rx="9" fill="#271c28" stroke="#b66073" />
      {weightNames.map((name, i) => (
        <g key={name}>
          <rect
            x={64 + i * 135}
            y="296"
            width="125"
            height="25"
            rx="4"
            fill={
              weights && (cue?.kind !== 'weights' || i < (cue.slot ?? 0))
                ? COLORS.weights
                : 'transparent'
            }
            stroke={COLORS.weights}
          />
          <text
            x={126 + i * 135}
            y="313"
            textAnchor="middle"
            className="da-svg-tiny"
            fill={weights ? '#05060a' : COLORS.weights}
          >
            {name}
          </text>
        </g>
      ))}
      {[
        { id: 0, label: 'SYS', tokens: config.scaffold_tokens, color: '#aeb8cb' },
        ...config.chunks,
      ].map((chunk, i) => {
        const active = chunk.id === 0 || selected.includes(chunk.id)
        const filled = resident && i < prefilledSlots
        const toggle = () => {
          if (chunk.id && resident) onChunk(chunk.id)
        }
        return (
          <g
            key={chunk.id}
            className={chunk.id && resident ? 'da-chunk' : ''}
            role={chunk.id ? 'button' : undefined}
            tabIndex={chunk.id && resident ? 0 : undefined}
            aria-label={
              chunk.id
                ? `${chunk.label}: ${resident ? 'resident' : 'empty'}, ${active ? 'read enabled' : 'masked'}. Toggle focus.`
                : undefined
            }
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggle()
              }
            }}
          >
            <rect
              x={slotX(i, config.chunks.length)}
              y="337"
              width={slotWidth(config.chunks.length) - 8}
              height="54"
              rx="6"
              fill={filled ? chunk.color : 'transparent'}
              fillOpacity={active ? 0.28 : 0.045}
              stroke={resident ? chunk.color : '#60566a'}
              strokeOpacity={active ? 1 : 0.35}
            />
            <text
              x={slotCenter(i, config.chunks.length)}
              y="358"
              textAnchor="middle"
              fill={chunk.color}
              className="da-svg-label"
              opacity={filled ? 1 : 0.4}
            >
              {chunk.label}
            </text>
            <text
              x={slotCenter(i, config.chunks.length)}
              y="378"
              textAnchor="middle"
              className="da-svg-tiny"
            >
              {filled ? `${chunk.tokens.toLocaleString()} tok` : 'empty'}
            </text>
            {filled && (
              <text
                x={slotCenter(i, config.chunks.length)}
                y="403"
                textAnchor="middle"
                className="da-svg-tiny"
                fill={active ? '#badfce' : '#b8a4b4'}
              >
                {active ? 'READ' : 'MASKED'}
              </text>
            )}
          </g>
        )
      })}
      <text x="70" y="420" className="da-svg-tiny" fill={COLORS.hbm}>
        HBM · fixed KV seats
      </text>
      {Array.from({ length: Math.min(12, responseCount) }, (_, i) => (
        <rect key={i} x={248 + i * 13} y="410" width="10" height="11" fill={COLORS.response} />
      ))}
      <text x="590" y="420" textAnchor="end" className="da-svg-tiny" fill={COLORS.response}>
        reply: {responseCount} tok
      </text>
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
      <text x="738" y="110" className="da-svg-small">
        {output
          ? 'MODEL OUTPUT · SCRIPTED EXAMPLE'
          : stageReached(state, 'request')
            ? 'THE REQUEST'
            : 'MODEL CHECKPOINT'}
      </text>
      {!stageReached(state, 'request') && (
        <g opacity={weights ? 0.4 : 0.85}>
          {weightNames.map((name, i) => (
            <g key={name}>
              <rect
                x="738"
                y={150 + i * 38}
                width="216"
                height="29"
                rx="4"
                fill="#49352a"
                stroke={COLORS.weights}
              />
              <text
                x="846"
                y={170 + i * 38}
                textAnchor="middle"
                className="da-svg-label"
                fill={COLORS.weights}
              >
                {name}
              </text>
            </g>
          ))}
        </g>
      )}
      {stageReached(state, 'request') &&
        !output &&
        [{ label: 'SYS + question', color: '#aeb8cb' }, ...config.chunks].map((chunk, i) => (
          <g key={i} opacity={resident ? 0.4 : 1}>
            <rect
              x="738"
              y={143 + i * 27}
              width="216"
              height="23"
              rx="4"
              fill={chunk.color}
              fillOpacity=".16"
              stroke={chunk.color}
            />
            <text x="750" y={160 + i * 27} className="da-svg-label" fill={chunk.color}>
              {i ? `magic chunk ${chunk.label}` : chunk.label}
            </text>
          </g>
        ))}
      {output && (
        <g>
          <rect x="733" y="136" width="227" height="35" rx="5" fill="#243341" />
          <text
            x="743"
            y="158"
            textLength={tag.length > 32 ? 207 : undefined}
            lengthAdjust="spacingAndGlyphs"
            className="da-svg-code"
            fill="#f0d58c"
          >
            {tag}
          </text>
          {state.events
            .slice(0, responseCount)
            .slice(-6)
            .map((item, i) => (
              <text
                key={item.id}
                x="742"
                y={207 + i * 30}
                className="da-svg-label"
                fill={item.mode === 'global' ? '#b5c4d3' : '#88d7ad'}
                textLength={item.text.length > 26 ? 205 : undefined}
                lengthAdjust="spacingAndGlyphs"
              >
                {item.text}
              </text>
            ))}
          <text x="739" y="423" className="da-svg-tiny">
            ONE STEP = ONE SIMULATED TOKEN
          </text>
        </g>
      )}
      <PacketFlow cue={cue} config={config} />
    </svg>
  )
}
