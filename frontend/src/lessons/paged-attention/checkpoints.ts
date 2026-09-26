import type { Checkpoint } from '../declarative-attention/checkpoints'

export const CHECKPOINTS: Record<string, Checkpoint> = {
  waste: {
    title: 'Spot the internal fragmentation',
    question: 'C reserved 20 slots and D is waiting. Which slots are internal fragmentation?',
    choices: [
      {
        label: 'Slots A will fill with its next tokens',
        correct: false,
        feedback:
          'Those are reserved: they will be used, just later. They still block other requests until then.',
      },
      {
        label: 'Slots in C’s chunk that C will never write',
        correct: true,
        feedback:
          'Yes. C’s answer ends after one word, so most of its 20-slot chunk is never used. The waste only becomes obvious when C finishes.',
      },
      {
        label: 'The free gaps D can’t use',
        correct: false,
        feedback:
          'That’s external fragmentation: free memory outside any chunk, in gaps too small for the next request.',
      },
    ],
  },
  'next-block': {
    title: 'Where does the next token go?',
    question: 'A’s last block is now full. Where will the next token’s KV be stored?',
    choices: [
      {
        label: 'In block 2, right after block 1',
        correct: false,
        feedback:
          'Physical neighbours don’t matter. The allocator hands out any free block, and the block table remembers which.',
      },
      {
        label: 'In any free block, recorded in A’s block table',
        correct: true,
        feedback:
          'Exactly. A gets a new logical block, mapped to whichever physical block is free. Watch which one it gets.',
      },
      {
        label: 'A has to move to a bigger contiguous area',
        correct: false,
        feedback:
          'Nothing moves. Paging means A never needs its blocks to be next to each other.',
      },
    ],
  },
  cow: {
    title: 'Two samples, one block',
    question: 'E1 is about to write into a block that E1 and E2 share. What happens?',
    choices: [
      {
        label: 'E1 writes into it, and E2 sees E1’s token',
        correct: false,
        feedback: 'That would corrupt E2’s answer. Shared blocks are never written in place.',
      },
      {
        label: 'vLLM copies all of E’s blocks for E1',
        correct: false,
        feedback:
          'Only the block being written is copied. The full prompt blocks stay shared by both samples.',
      },
      {
        label: 'vLLM copies just that block, then E1 writes into the copy',
        correct: true,
        feedback:
          'Right: copy-on-write, one block at a time. Its reference count drops to 1, so E2 can then write in place.',
      },
    ],
  },
}
