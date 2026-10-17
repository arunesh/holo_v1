import type { Checkpoint } from '../declarative-attention/checkpoints'

export const CHECKPOINTS: Record<string, Checkpoint> = {
  materialize: {
    title: 'Where does the time go?',
    question:
      'Standard attention just moved 4,608 numbers over the HBM bus. Which part makes that number grow fastest with sequence length?',
    choices: [
      {
        label: 'Reading Q, K and V',
        correct: false,
        feedback:
          'Q, K and V are N × d each, so reading them grows linearly with N. They are the small part of the bill.',
      },
      {
        label: 'Writing S and P to HBM and reading them back',
        correct: true,
        feedback:
          'Yes. S and P are N × N. Each is written once and read once, so four N² passes cross the slow bus. At 1,024 tokens that is four million numbers per head.',
      },
      {
        label: 'The multiply-adds inside QKᵀ and PV',
        correct: false,
        feedback:
          'Those happen on chip at tens of teraflops. The matmuls are fast; softmax in particular does almost no math and is limited by memory traffic.',
      },
    ],
  },
  rescale: {
    title: 'A bigger score arrives late',
    question:
      'Q₁ has seen only K₁ so far. If K₂ holds a larger score for some row, what has to happen to that row of O₁?',
    choices: [
      {
        label: 'Reload K₁ and V₁ and recompute the row from scratch',
        correct: false,
        feedback:
          'Nothing is reloaded. The old max m and sum ℓ are all FlashAttention needs to correct what it has already accumulated.',
      },
      {
        label: 'Scale it by e^(m_old − m_new), fixing ℓ the same way',
        correct: true,
        feedback:
          'Right. Every earlier exponent was taken relative to the old max, so multiplying by e^(m_old − m_new) re-bases them on the new max. The answer stays exact.',
      },
      {
        label: 'Nothing: the softmax will be slightly off, which is fine',
        correct: false,
        feedback:
          'FlashAttention is exact, not approximate. Without the correction, the earlier block would be over-weighted by e^(m_new − m_old).',
      },
    ],
  },
  sparse: {
    title: 'Half the tiles are zero',
    question: 'The mask zeroes half the tiles. How much less HBM traffic will block-sparse FlashAttention need?',
    choices: [
      {
        label: 'None: masked scores are computed, then set to −∞',
        correct: false,
        feedback:
          'That is how a dense mask works, and it saves nothing. Block-sparse FlashAttention never loads or computes a zero tile.',
      },
      {
        label: 'Less than half: K and V are still loaded once per column',
        correct: true,
        feedback:
          'Exactly. Zero tiles skip the Q, O, ℓ and m traffic, but each K, V block is still loaded once. That is the Nd term in Θ(Nd + N²d²s/M).',
      },
      {
        label: 'Exactly half of everything',
        correct: false,
        feedback:
          'Close, but the Nd part does not shrink: every column still loads its K and V block. Only the tile traffic scales with the fraction of nonzero tiles.',
      },
    ],
  },
}
