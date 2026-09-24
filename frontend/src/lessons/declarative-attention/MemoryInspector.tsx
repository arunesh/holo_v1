import type { MemoryConfig, MemoryState } from './types'
import { bytesPerToken, formatBytes, nextRead, residentBytes, stageReached } from './simulation'

export default function MemoryInspector({
  state,
  config,
  animating = false,
  spotlit = false,
}: {
  state: MemoryState
  config: MemoryConfig
  animating?: boolean
  spotlit?: boolean
}) {
  const ready = stageReached(state, 'prefill')
  const read = nextRead(state, config)
  const actual = state.events.reduce((sum, event) => sum + event.readBytes, 0)
  const baseline = state.events.reduce((sum, event) => sum + event.fullBytes, 0)
  return (
    <aside className={`da-inspector ${spotlit ? 'da-spotlit' : ''}`}>
      <div className="da-kicker">{animating ? 'AFTER THIS ANIMATION' : 'THE NEXT TOKEN'}</div>
      <div className="da-read-number">
        {ready ? `${(read.fraction * 100).toFixed(1)}%` : '—'}
        <span>of a full KV read</span>
      </div>
      <div
        className="da-meter"
        role="meter"
        aria-label="Next token KV read percentage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ready ? read.fraction * 100 : 0}
      >
        <div
          style={{
            width: `${ready ? read.fraction * 100 : 0}%`,
            background: state.mode === 'global' ? '#e98772' : '#77df9b',
          }}
        />
      </div>
      <dl>
        <div>
          <dt>KV resident</dt>
          <dd>{formatBytes(residentBytes(state, config))}</dd>
        </div>
        <div>
          <dt>Next read</dt>
          <dd>{ready ? formatBytes(read.readBytes) : '—'}</dd>
        </div>
        <div>
          <dt>Full-read baseline</dt>
          <dd>{ready ? formatBytes(read.fullBytes) : '—'}</dd>
        </div>
        <div>
          <dt>Response cached</dt>
          <dd>{state.responseTokens} tokens</dd>
        </div>
      </dl>
      <div className="da-inspector-note">Same resident blocks. Different read set.</div>
      <div className="da-total">
        <span>This experiment · {state.events.length} steps</span>
        <strong>
          {baseline
            ? `${((1 - actual / baseline) * 100).toFixed(1)}% fewer KV bytes read`
            : 'No decode steps yet'}
        </strong>
        <small>
          {formatBytes(actual)} read vs {formatBytes(baseline)} with global attention
        </small>
      </div>
      <details>
        <summary>What these numbers mean</summary>
        <p>
          Calculated KV payload for one illustrative global-attention layer. Not measured HBM
          traffic or GPU latency.
        </p>
        <p>
          2 (K + V) × {config.kv_heads} KV heads × {config.head_dimension} dimensions ×{' '}
          {config.bytes_per_value} bytes = {bytesPerToken(config).toLocaleString()} bytes per token.
        </p>
        <p>
          SYS and the reply so far are read in every mode. Each click appends one
          simulated token; output phrases are illustrative labels. Weight reads, caches and kernel
          overhead are not modeled.
        </p>
      </details>
    </aside>
  )
}
