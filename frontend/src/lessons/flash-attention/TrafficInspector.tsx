import type { Algorithm, FlashConfig, Run } from './types'
import {
  ALGORITHM_LABEL,
  ALGORITHMS,
  blockSizes,
  formatBytes,
  hbmAccesses,
  maskDensity,
  paperScale,
  PAPER_SCALE,
} from './simulation'
import { COLORS } from './geometry'

const BAR_COLOR: Record<Algorithm, string> = {
  standard: COLORS.hbm,
  flash: COLORS.sram,
  'block-sparse': COLORS.v,
}
const SCALES = [1024, 4096, 16384, 65536]
/** Narrow-column bytes: three significant digits at most. */
const compact = (bytes: number) => formatBytes(bytes).replace(/^(\d{3})\.\d/, '$1')

export default function TrafficInspector({
  run,
  config,
  animating = false,
  spotlit = false,
}: {
  run: Run
  config: FlashConfig
  animating?: boolean
  spotlit?: boolean
}) {
  const N = config.seq_len
  const d = config.head_dim
  const { Bc, Br, Tr, Tc } = blockSizes(config)
  const density = maskDensity(config)
  const totals = Object.fromEntries(
    ALGORITHMS.map((mode) => [mode, hbmAccesses(mode, N, d, config.sram_size, density)]),
  ) as Record<Algorithm, number>
  const moved = run.counters.reads + run.counters.writes
  const tiled = run.mode !== 'standard'
  const tiles = run.tiles.flat()
  const count = (status: string) => tiles.filter((tile) => tile === status).length
  return (
    <aside className={`da-inspector ${spotlit ? 'da-spotlit' : ''}`}>
      <div className="da-kicker">{animating ? 'HBM TRAFFIC · THIS STEP IS LANDING' : 'HBM TRAFFIC · THIS RUN'}</div>
      <div className="da-read-number">
        {moved.toLocaleString()}
        <span>values read or written in HBM so far</span>
      </div>
      <div className="fa-bars" role="img" aria-label={`Full runs: ${ALGORITHMS.map((mode) => `${ALGORITHM_LABEL[mode]} ${totals[mode].toLocaleString()} values`).join(', ')}.`}>
        {ALGORITHMS.map((mode) => {
          const current = mode === run.mode
          return (
            <div key={mode} className={`fa-bar ${current ? 'fa-bar-current' : ''}`}>
              <span>{ALGORITHM_LABEL[mode]}</span>
              <div className="fa-bar-track">
                <div
                  className="fa-bar-total"
                  style={{ width: `${(totals[mode] / totals.standard) * 100}%`, borderColor: BAR_COLOR[mode] }}
                />
                {current && (
                  <div
                    className="fa-bar-fill"
                    style={{ width: `${(moved / totals.standard) * 100}%`, background: BAR_COLOR[mode] }}
                  />
                )}
              </div>
              <b>{totals[mode].toLocaleString()}</b>
            </div>
          )
        })}
      </div>
      <dl>
        <div>
          <dt>Reads · writes</dt>
          <dd>
            {run.counters.reads.toLocaleString()} · {run.counters.writes.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>S or P values through HBM</dt>
          <dd>{run.counters.quadratic.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Matmul FLOPs</dt>
          <dd>{run.counters.flops.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Extra HBM memory</dt>
          <dd>{tiled ? `${(2 * N).toLocaleString()} (ℓ, m)` : `${(2 * N * N).toLocaleString()} (S, P)`}</dd>
        </div>
        {tiled && (
          <div>
            <dt>Tiles done · skipped</dt>
            <dd>
              {count('done')} · {count('skipped')} of {Tr * Tc}
            </dd>
          </div>
        )}
        <div>
          <dt>Output check</dt>
          <dd>
            {run.check
              ? `|O − ${run.check.reference === 'masked' ? 'masked ref' : 'reference'}| ≤ ${run.check.maxError.toExponential(0)}`
              : `step ${run.pc} of ${run.total}`}
          </dd>
        </div>
        {run.check?.denseGap != null && (
          <div>
            <dt>Gap from dense attention</dt>
            <dd>{run.check.denseGap.toFixed(2)}</dd>
          </div>
        )}
      </dl>
      <div className="da-inspector-note">
        {run.mode === 'standard'
          ? 'Three kernels: S and P make the round trip to HBM.'
          : run.mode === 'flash'
            ? 'One fused kernel: only Q, K, V, O, ℓ and m cross the bus.'
            : `Zero tiles are skipped; ${Math.round(density * 100)}% of tiles are computed.`}
      </div>
      <details>
        <summary>Block sizes and counting</summary>
        <p>
          Algorithm 1 sets B<sub>c</sub> = ⌈M / 4d⌉ = ⌈{config.sram_size} / {4 * d}⌉ = {Bc} and B<sub>r</sub> = min(B
          <sub>c</sub>, d) = {Br}, so the {N} × {N} score matrix splits into {Tr} × {Tc} tiles of {Br} × {Bc}.
        </p>
        <p>
          Every value moved between HBM and SRAM counts once. Standard attention is counted generously: each of its three
          kernels reads its inputs once, so 4Nd + 4N². FlashAttention reads K and V once and makes T<sub>c</sub> passes over
          Q, O, ℓ and m: 2Nd + T<sub>c</sub>N(3d + 4). Initialising O, ℓ and m is not counted, as in the paper’s analysis.
        </p>
        <p>
          With an SRAM of only {config.sram_size} values the toy’s tiles are tiny, so the saving is modest. Bigger SRAM
          means bigger tiles, fewer passes and less traffic.
        </p>
      </details>
      <details>
        <summary>Scale it up</summary>
        <p>
          Same counting rule, one head, forward pass, d = {PAPER_SCALE.head_dim}, M ≈ 100 KB of fp16, block-sparse at{' '}
          {Math.round(density * 100)}% density:
        </p>
        <table className="fa-scale">
          <thead>
            <tr>
              <th>N</th>
              <th>Standard</th>
              <th>Flash</th>
              <th>Sparse</th>
            </tr>
          </thead>
          <tbody>
            {SCALES.map((tokens) => {
              const row = paperScale(tokens, density)
              return (
                <tr key={tokens}>
                  <td>{tokens >= 1024 ? `${tokens / 1024}K` : tokens}</td>
                  <td>{compact(row.standard)}</td>
                  <td>{compact(row.flash)}</td>
                  <td>{compact(row.sparse)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p>
          Standard attention must also hold S and P in HBM per head:{' '}
          {SCALES.map((tokens) => `${compact(paperScale(tokens, density).scores)} at ${tokens / 1024}K`).join(', ')}.
          FlashAttention holds 2N statistics instead. The paper
          measured GPT-2 medium attention (N = 1,024, d = 64, forward and backward on an A100) at 40.3 GB of HBM traffic
          for standard attention versus 4.4 GB, and 41.7 ms versus 7.3 ms.
        </p>
      </details>
    </aside>
  )
}
