# FlashAttention: the IO-aware attention lesson

This lesson explains [FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness](https://arxiv.org/abs/2205.14135) (Dao, Fu, Ermon, Rudra and Ré, NeurIPS 2022). It is an explicit **kernel simulation** that counts every value moved between HBM and SRAM. It is not a CUDA kernel or a GPU profiler. It reuses the Declarative Attention lesson's camera, voice, checkpoint card and page shell, and follows the PagedAttention lesson's structure.

## Read the implementation

- `backend/app/pods/flash-attention.json`: the sizes, seed, block mask and the 18-chapter story.
- `frontend/src/lessons/flash-attention/simulation.ts`: start here. `programOf(config, mode)` compiles Algorithm 0, 1 or 5 into a list of ops, one per line of the paper's algorithm. A run is a prefix of that program, so the state is just `{ stage, mode, pc }`. `runOf` replays the prefix with real numbers and counts HBM reads and writes.
- `playback.ts`: narration, cancellation and per-op animation. Long runs are compressed to a few seconds. `useLessonPlayback.ts` is the small React adapter.
- `FlashSpatial.tsx` / `FlashStage.tsx`: the spatial GPU and the diagram, which prints every value in the SRAM tiles. `geometry.ts` holds the board layout, spotlight frames and packet routes for both.
- `TrafficInspector.tsx`: the HBM traffic meter, the three-way comparison, the exactness check and the paper-scale table.
- `checkpoints.ts`: prediction questions with misconception-specific feedback.
- `FlashAttentionLesson.tsx`: controls, chapters and tutor handoff.
- `backend/app/lessons/flash_attention/`: schema validation and the lesson tutor. The socket and cancellation code is shared with Declarative Attention.

## The simulation

HBM holds Q, K and V (N × d), the output O, and the softmax statistics ℓ and m. SRAM holds M values, and the block sizes follow Algorithm 1 line 1: B_c = ⌈M / 4d⌉ and B_r = min(B_c, d). The toy uses N = 32, d = 4 and M = 128, so B_c = 8, B_r = 4, and the 32 × 32 score matrix splits into 8 × 4 tiles.

- **Standard** (Algorithm 0) runs three kernels, one query row block at a time: S = QKᵀ written to HBM, P = softmax(S) read and written, O = PV. S and P are drawn in one grid; really they are two N × N buffers.
- **FlashAttention** (Algorithm 1) loops over K, V blocks outside and Q blocks inside. Each tile loads Q_i, O_i, ℓ_i and m_i, computes S_ij, the tile softmax and P̃V on chip, and writes O_i, ℓ_i and m_i back. When a row's max rises, the running output is rescaled by e^(m_old − m_new).
- **Block-sparse** (Algorithm 5) skips tiles whose mask is zero. K_j and V_j are still loaded once per column, as in the paper.

Q, K and V come from a seeded generator (one decimal place in [−1.5, 1.5]), so every replay is identical. Seed 4 makes the rescale chapter concrete: the second K block raises row 1's max from about 1.2 to 3.5, and its output shrinks by 0.09. Scores are not scaled by 1/√d, and there is no masking or dropout, following Algorithm 1.

## Counting HBM traffic

Every value moved between HBM and SRAM counts once.

- Standard: each kernel reads its inputs once, the most generous count for standard attention: 4Nd + 4N² = 4,608 here, of which 4N² = 4,096 are S or P.
- FlashAttention: 2Nd for K and V, plus T_c passes that each load Q, O, ℓ, m and store O, ℓ, m: 2Nd + T_c·N·(3d + 4) = 2,304 here.
- Block-sparse: the pass term scales with the fraction of nonzero tiles: 1,280 here at 50% density.

Initialising O, ℓ and m in HBM is not counted, as in the paper's analysis. Tests check the simulated counters against these closed forms, and check that FlashAttention's output matches standard attention, and block-sparse matches masked attention, to within 1e-12.

## Scale and limits

The toy SRAM holds 128 values, so tiles are tiny and FlashAttention only halves the traffic. The inspector's "Scale it up" table applies the same counting rule at d = 64 and M ≈ 100 KB of fp16, where the ratio is about 3–4× per head for the forward pass. The paper's measured 9× (40.3 GB vs 4.4 GB on GPT-2 medium) is forward plus backward on real kernels and is quoted as a paper result, not reproduced.

Not modelled: the backward pass and its recomputation (mentioned in the tutor prompt), masking and dropout fusion, multiple SMs working in parallel, register-level tiling, and any timing. Packet animation length is pedagogical, not a latency estimate.

## Paper numbers used in narration

- A100: 40–80 GB of HBM at 1.5–2.0 TB/s; 192 KB of SRAM per each of 108 SMs at about 19 TB/s.
- IO complexity: standard Θ(Nd + N²), FlashAttention Θ(N²d²/M), block-sparse Θ(Nd + N²d²s/M).
- GPT-2 medium attention (N = 1,024, d = 64, forward + backward): 66.6 vs 75.2 GFLOPs, 40.3 vs 4.4 GB of HBM traffic, 41.7 vs 7.3 ms.
- BERT-large trained 15% faster than the MLPerf 1.1 record; GPT-2 up to 3× faster than HuggingFace.
- Path-X (16K tokens, 61.4%) with FlashAttention and Path-256 (64K tokens, 63.1%) with block-sparse FlashAttention; block-sparse is 2–4× faster than FlashAttention.
