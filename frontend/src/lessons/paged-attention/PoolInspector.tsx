import type { Layout, PagedConfig } from './types'
import { formatBytes, kvBytesPerToken } from './simulation'
import { COLORS } from './geometry'

const PARTS = [
  { key: 'tokens', label: 'Tokens stored', color: COLORS.token },
  { key: 'reserved', label: 'Reserved', color: COLORS.reserved },
  { key: 'internal', label: 'Internal fragmentation', color: COLORS.internal },
  { key: 'external', label: 'External fragmentation', color: COLORS.external },
] as const

export default function PoolInspector({
  layout,
  config,
  animating = false,
  spotlit = false,
}: {
  layout: Layout
  config: PagedConfig
  animating?: boolean
  spotlit?: boolean
}) {
  const { stats } = layout
  const total = config.num_blocks * config.block_size
  const perToken = kvBytesPerToken(config)
  return (
    <aside className={`da-inspector ${spotlit ? 'da-spotlit' : ''}`}>
      <div className="da-kicker">{animating ? 'AFTER THIS STEP' : 'KV MEMORY IN USE'}</div>
      <div className="da-read-number">
        {stats.utilization === null ? '—' : `${(stats.utilization * 100).toFixed(1)}%`}
        <span>of allocated KV memory holds real tokens</span>
      </div>
      <div
        className="pa-usage"
        role="img"
        aria-label={`Pool of ${total} slots: ${PARTS.map((part) => `${stats[part.key]} ${part.label.toLowerCase()}`).join(', ')}, ${stats.free} free.`}
      >
        {PARTS.map((part) => (
          <div
            key={part.key}
            style={{ width: `${(stats[part.key] / total) * 100}%`, background: part.color }}
          />
        ))}
      </div>
      <dl>
        {PARTS.map((part) => (
          <div key={part.key}>
            <dt>
              <span className="pa-swatch" style={{ background: part.color }} />
              {part.label}
            </dt>
            <dd>{stats[part.key]}</dd>
          </div>
        ))}
        <div>
          <dt>Free slots</dt>
          <dd>{stats.free}</dd>
        </div>
        <div>
          <dt>Requests running</dt>
          <dd>{stats.running}</dd>
        </div>
        <div>
          <dt>Waiting · swapped out</dt>
          <dd>
            {stats.waiting} · {stats.swapped}
          </dd>
        </div>
      </dl>
      <div className="da-inspector-note">
        {layout.mode === 'paged'
          ? 'Waste stays inside each sequence’s last block.'
          : 'Every request holds its maximum length.'}
      </div>
      <details>
        <summary>What these numbers mean</summary>
        <p>
          One slot holds one token’s keys and values across every layer. For {config.model.name}:
          2 × {config.model.hidden_size.toLocaleString()} × {config.model.layers} layers ×{' '}
          {config.model.bytes_per_value} bytes = {formatBytes(perToken)} per token, so this
          {` ${total}`}-slot pool would be {formatBytes(total * perToken)}. On a 40 GB A100 the paper
          has 12 GB for KV cache, about 15.7K slots.
        </p>
        <p>
          The share of real tokens is tokens ÷ (tokens + reserved + internal + external), the same
          split as the paper’s Figure 2. Free slots don’t count against it.
        </p>
        <p>
          A toy workload with blocks of {config.block_size} tokens (vLLM’s default is 16) and short
          scripted answers. It is not measured GPU memory or throughput.
        </p>
      </details>
    </aside>
  )
}
