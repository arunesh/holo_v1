# PagedAttention: the KV cache allocator lesson

This lesson explains [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180) (Kwon et al., SOSP 2023), the vLLM paper. It is an explicit **allocator simulation**, not a vLLM deployment or GPU profiler. It reuses the Declarative Attention lesson's board, camera, voice and page shell, so the two memory lessons look and behave alike.

## Read the implementation

- `backend/app/pods/paged-attention.json`: the requests, block size, allocation order and the 16-chapter story.
- `frontend/src/lessons/paged-attention/simulation.ts`: the allocator. Start here. The workload is a log of `admit` / `decode` / `finish` ops; `simulate(log, mode)` replays it under either allocator, so switching modes re-lays out the same requests.
- `playback.ts`: narration, cancellation and packet animation. `useLessonPlayback.ts` is the small React adapter.
- `PoolSpatial.tsx` / `PoolStage.tsx`: the spatial GPU and the equivalent low-power diagram. `geometry.ts` holds the pool layout, spotlight frames and packet routes for both.
- `PoolInspector.tsx`: the memory breakdown, in the same categories as the paper's Figure 2.
- `checkpoints.ts`: prediction questions with misconception-specific feedback.
- `PagedAttentionLesson.tsx`: controls, chapters and tutor handoff.
- `backend/app/lessons/paged_attention/`: schema validation and the lesson tutor. The socket and cancellation code is shared with Declarative Attention.

## The simulation

The pool has `num_blocks` blocks of `block_size` slots; one slot holds one token's keys and values across all layers.

**Contiguous** allocation reserves `max_tokens` slots in a row per sequence (first fit), and each parallel sample needs its own chunk and its own copy of the prompt. **Paged** allocation hands out blocks on demand in `allocation_order`, so replays are deterministic and A lands in physical blocks 7, 1 and then 3, as in the paper's Figure 6.

Every slot is exactly one of:

- **token**: holds a real token's KV.
- **reserved**: allocated, and the sequence will still write it.
- **internal fragmentation**: allocated, and never written.
- **external fragmentation** (contiguous only): free, but in a gap shorter than the waiting request needs.
- **free**.

The inspector's headline is tokens ÷ (tokens + reserved + internal + external), the same split as the paper's Figure 2. Free slots don't count against it.

Parallel samples share prompt blocks with reference counts. Writing into a shared block copies that one block first (copy-on-write). Scheduling is first come, first served: when a block is needed and none is free, the latest-arrived running request is preempted, all or nothing, and its blocks are swapped to CPU RAM. Preempted requests return before any waiting request is admitted.

Requests have scripted outputs, so decode steps are deterministic; a sequence stops writing when its script runs out and holds its memory until it is finished.

## Scale and limits

Blocks here hold 4 tokens so the story fits on screen; vLLM defaults to 16. The toy pool is 64 slots, where a 40 GB A100 serving a 13B model has about 15.7K. Utilization in the toy is usually lower than the paper's 96.3% because short scripted answers leave proportionally more of each last block empty.

Not modelled: recomputation as a recovery strategy (mentioned in narration), beam search and shared-prefix caching (mentioned), multiple GPUs, and any timing. Packet animation length is pedagogical, not a latency estimate.

## Paper numbers used in narration

- OPT-13B: 2 × 5120 × 40 × 2 bytes = 800 KB of KV per token; up to 1.6 GB for a 2048-token request.
- 13B model on a 40 GB A100: 26 GB (65%) weights, about 30% KV cache.
- KV memory holding token states: 20.4–38.2% for Orca variants, 96.3% for vLLM (Figure 2).
- 2.2× more batched requests than Orca (Oracle) for OPT-13B on ShareGPT; 2–4× throughput over FasterTransformer and Orca at the same latency.
- Beam search memory savings 37.6–66.3% across the Alpaca and ShareGPT traces.
- PagedAttention kernel 20–26% slower than FasterTransformer's attention kernel.
