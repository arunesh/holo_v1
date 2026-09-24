# Declarative Attention: the memory lesson

This lesson is an explicit **protocol simulation**, not a DA model deployment or live GPU profiler. It follows the supplied Manim/storyboard sequence without rendering or running Manim. The original transformer scene and GPT-2 inference implementation are retained.

## Read the implementation

- `backend/app/pods/declarative-attention.json`: authored story, cadence and numerical assumptions.
- `frontend/src/lessons/declarative-attention/simulation.ts`: pure state transitions and counters. Start here.
- `GpuSpatial.tsx`: demand-rendered spatial GPU, camera presets and bounded packets. No idle spin.
- `GpuStage.tsx` / `PacketFlow.tsx`: the equivalent low-power diagram; `geometry.ts` shares colors, seats and packet routes across both views.
- `MemoryInspector.tsx`: accounting and its explicit limitations.
- `playback.ts`: testable cancellation, command cursor and chapter playback. `useLessonPlayback.ts` is the small React adapter.
- `checkpoints.ts` / `CheckpointCard.tsx`: prediction questions with misconception-specific feedback.
- `DeclarativeAttentionLesson.tsx`: controls, navigation and tutor handoff.
- `backend/app/lessons/declarative_attention/`: schema validation and the scene-specific tutor. The normal Messages proxy is reused.

Holo's shell selects the renderer by `scene.type`; DA has its own state, not extra fields mixed into GPT-2's store. Selecting another lesson unmounts the old view, cancels playback and ignores stale tutor results.

## Accounting contract

Four chunks contain 2,048 tokens each; the always-attended scaffold contains 256. For one illustrative global-attention layer, KV bytes per token = 2 × 8 KV heads × 128 dimensions × 2 bytes = 4,096 bytes.

Global reads all chunks. Focus reads the selected set. Local reads none of the chunks. All modes read the scaffold and previously generated response tokens. Every decode step computes its read event **before** appending one new response token. The vanilla comparison uses that same decode position. Packet count follows token mass with a minimum visible packet for tiny regions, so it is a visual quantization, not literal one-packet-per-byte transport.

The inspector shows the **next** token's read set. Cumulative counters sum completed simulation steps. Mode changes do not change resident bytes. KV addresses/seats are fixed; new response KV grows separately. Reads still move data through the memory hierarchy: “Move no KV” means no cache relocation/compaction, not zero traffic.

The animation duration is a pedagogical scale, not a GPU latency estimate. Output phrases label individual simulated tokens; they are not a tokenizer trace or real generated answer. Weight traffic during decode, cache hits, page alignment and kernel overhead are outside this toy accounting model.

## Cadence

The authored spine is empty → weights → request → prefill → vanilla → focus → sparse read → paper result → global → local → conclusion. Prefill shows input travel, then KV writes, one seat at a time. Mode declarations appear before masks change; decode reads precede response writes. Visual actions settle before their spoken explanation. Each line has a breathing gap; with voice disabled, captions use a roughly 15-character/second reading hold.

Continue preserves the current scene and command cursor; it does not reconstruct a checkpoint or duplicate decoded tokens. Direct manipulation pauses the guide and leaves it at the next authored chapter. Only explicit chapter selection or Replay chapter reconstructs prior state. Three optional prediction checkpoints interrupt playback; wrong answers get specific feedback before the learner retries or skips. Restart begins the full guide again.

One browser voice is pinned for the lesson unless an existing TTS provider is configured. Microphone access stays browser-controlled. Stop recording submits; Cancel discards. Speech, capture, transcription and tutor work have bounded lifetimes and cancel on interruption/unmount. Cancel closes the upstream HTTP request; it cannot guarantee that the remote model provider stops computation already received.

The Grok tutor receives current state, code-computed counters, the lesson configuration and the last six conversation exchanges. It explains this simulation, not its own private model internals, and may control only three validated DA operations. Inference failures leave the scene unchanged. The sticky guide keeps captions and transport visible while the learner explores; the diagram alternative remains available when WebGL is unavailable or too costly.

## Verification

Run `npm run test:da` in `frontend`: no new test-runner dependency, using the existing TypeScript compiler and Node assertions. Run `pytest tests/test_declarative_attention.py` in `backend` with the project dependencies. Existing proxy contract tests must still pass.

Browser acceptance: start, pause, chapter seek, repeat prefill, select C3 then C1+C3, local/global, decode, cancel a tutor query, switch to GPT-2 and back, and test voice separately. Validate the production build with TypeScript before deployment.

## Scientific references

- https://arxiv.org/abs/2609.02737 — Language Models Can Control Their Own Attention. The 52.0% attended-token reduction and 1.27-point accuracy drop are paper benchmark results, not this toy's counters or a measured GPU speedup.
- https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html — memory hierarchy; L2 is a cache, not the memory bus itself.

Deployment configuration, OAuth credentials, runtime environments and built assets remain outside this repository. Deploy exact Git revisions; do not synchronize `.env` or the user's SSH/OAuth credentials.
