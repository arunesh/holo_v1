# Holodeck — Build Plan

## Context

We're building **Holodeck** (`/home/azureuser/holodeck/holo_v1`), an interactive 3D web app that teaches
technical concepts the way 3Blue1Brown videos do — but *interactive*. Instead of a fixed video, the user
flies through a live 3D scene, talks to it by voice, and an AI backend (Anthropic Claude) drives the
animation: highlighting layers, zooming into an attention head, surfacing real activation values on demand.

The repo currently contains only `README.md` — this is greenfield. The README asks for two things:
1. A **flagship experience**: a GPT-2 transformer pod you can watch like a video *or* interrogate live
   (zoom into a layer/head, show activations as colors and down to `0.2f` values, free cursor/mouse pan-zoom).
2. A **pod generator**: given a 3Blue1Brown YouTube URL, produce a new interactive "pod".

**Confirmed decisions (from the user):**
- **Rendering:** real-time 3D via **React + react-three-fiber (Three.js / WebGL)** — *not* pre-rendered
  manim — because the core requirement is runtime interrogation of a live scene.
- **Voice:** **ElevenLabs** (key proxied server-side; user will add `ELEVENLABS_API_KEY`). Browser
  Web Speech API is the fallback so the app is usable before the key exists.
- **Sequencing:** build the **GPT-2 pod first**, then generalize into the YouTube→pod generator.
- **Data fidelity:** run a **real tiny GPT-2 (124M) in the backend** for genuine activations/attention.

**Environment constraints that shape the harness:** Python 3.12 + venv available; `ANTHROPIC_API_KEY`
set; **no Node/npm, no yt-dlp, no ffmpeg, no GPU, no passwordless sudo**. So all tooling must be installed
in user space (Node via prebuilt tarball; everything else via pip in a venv). GPT-2-small runs fine on CPU
for single forward passes.

---

## Core architecture concept — the "Pod spec" + AI command protocol

The single idea that makes both "watch like a video" and "interact live" share one engine:

- A **Pod** is a JSON document describing (a) a parameterized **scene graph**, (b) a linear **narration**
  track of beats, and (c) an **affordance library** — the named animation operations that can run against
  the scene (`focusOn(layer)`, `zoomTo(target)`, `highlightHead(layer, head)`, `showActivations(layer, mode)`,
  `setPrecision(n)`, `runInference(text)`, `play/pause/step`, `reset`, …).
- **Narration beats** are just pre-authored sequences of those same affordance calls + spoken text → "video mode".
- **Live interaction:** user speech → STT → (query + current scene state) → **Claude with the affordance
  library exposed as tool-use definitions** → Claude returns spoken narration + a sequence of affordance
  calls → backend streams them (with TTS audio) to the frontend → frontend executes them on the live scene.
  This is exactly the README's "create or run previously created library of animations."

One command vocabulary, two drivers (authored track vs. Claude). The "additional structured data for
real-time changes" = the affordance library + live scene-state model.

---

## Repository layout

```
holo_v1/
  backend/                      # Python FastAPI
    requirements.txt
    app/
      main.py                   # FastAPI app, CORS, serves built frontend
      config.py                 # env: ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, model ids
      schemas/pod.py            # pydantic models: Pod, Scene, Beat, Affordance
      api/
        pods.py                 # GET /api/pods, GET /api/pods/{id}
        session_ws.py           # WS /ws/session/{pod}: live query -> commands + TTS
        inference.py            # POST /api/gpt2/forward: real activations/attention
        voice.py                # POST /api/tts, POST /api/stt (ElevenLabs proxy)
        generate.py             # POST /api/generate: YouTube URL -> pod (Phase 5)
      services/
        anthropic_client.py     # Claude tool-use orchestration over affordance library
        gpt2_model.py           # transformers GPT-2 + hooks -> activations/attention
        elevenlabs.py           # TTS/STT wrappers (+ graceful no-key behavior)
        pod_store.py            # load/validate/save pod JSON
        youtube.py              # yt-dlp download + transcript (Phase 5)
        pod_generator.py        # Claude: transcript -> validated Pod spec (Phase 5)
      pods/gpt2.json            # flagship pod spec (reference output of the generator)
  frontend/                     # React + Vite + TypeScript + react-three-fiber
    package.json, index.html, vite.config.ts
    src/
      main.tsx, App.tsx
      scene/ ModelScene.tsx Block.tsx AttentionHeads.tsx ActivationGrid.tsx
             TokenStream.tsx CameraRig.tsx
      state/ podStore.ts        # zustand: scene state, focus target, precision, params
      ai/    useSession.ts      # WS client; applies incoming affordance commands
      voice/ useVoice.ts        # mic capture -> /api/stt; play TTS; Web Speech fallback
      engine/ affordances.ts    # client-side executor: command -> scene/camera mutation
      ui/    NarrationPanel.tsx Captions.tsx Controls.tsx ValueInspector.tsx
  scripts/ setup.sh dev.sh      # install userspace Node + venv + deps; run both servers
  .env.example
```

---

## Phased implementation

### Phase 0 — Harness & scaffold (the "harness needed to execute")
- `scripts/setup.sh`: download Node LTS prebuilt **tarball** into `holo_v1/.tooling/node` and export to PATH
  (no sudo); create Python venv `backend/.venv`; `pip install fastapi uvicorn[standard] anthropic
  pydantic websockets python-dotenv torch --index-url <cpu> transformers yt-dlp elevenlabs`; scaffold Vite
  React-TS app and `npm install` (three, @react-three/fiber, @react-three/drei, zustand).
- `scripts/dev.sh`: run uvicorn (`:8000`) + vite (`:5173`) together; `.env.example` documents keys.
- Exit criterion: both servers boot; frontend renders a placeholder 3D cube; `GET /api/pods` returns `[]`.

### Phase 1 — Flagship GPT-2 pod (scene + narration engine, synthetic data first)
- `schemas/pod.py` + `pods/gpt2.json`: define the Pod schema and author the GPT-2 spec (token embeds →
  12 transformer blocks {12-head attention + MLP} → unembed), parameterized by `n_layers/n_heads/d_model`.
- `ModelScene.tsx` + children: render the architecture in 3D from the spec; `CameraRig.tsx` with
  drei `OrbitControls` for free cursor/mouse pan-zoom **and** programmatic `focusOn`/`zoomTo`.
- `engine/affordances.ts` + `podStore.ts`: the command executor + scene state.
- `NarrationPanel`/`Controls`: play/pause/step the authored beat track ("watch like a video").
- Exit criterion: you can play the GPT-2 narration end-to-end and freely orbit/zoom by mouse.

### Phase 2 — Real model internals
- `gpt2_model.py`: load `gpt2` (124M) via transformers+torch CPU; forward hooks capture per-layer hidden
  states, per-head attention matrices, MLP activations; `inference.py` endpoint takes input text →
  tokenization + quantized/downsampled tensors for transport.
- Frontend maps real data onto the scene: `ActivationGrid` (value→color), `AttentionHeads` (weight→edge
  opacity), `ValueInspector` shows exact `0.2f` values on demand via `setPrecision`.
- Exit criterion: type a sentence, watch real activations/attention light up the scene; drill to numbers.

### Phase 3 — AI orchestration (Claude drives the scene)
- `anthropic_client.py`: expose the affordance library as Anthropic **tool-use** definitions; system prompt
  = pod context + current scene state; Claude returns spoken narration + ordered tool calls.
- `session_ws.py`: WS session — receives text query + scene snapshot, streams back narration + commands.
- `ai/useSession.ts`: applies incoming commands through the same `affordances.ts` executor.
- Use the latest Claude (Opus 4.8 / Fable per README) via the `anthropic` SDK with `ANTHROPIC_API_KEY`.
- Exit criterion: typed query like "zoom into layer 5's attention" makes the camera + scene respond.

### Phase 4 — Voice
- `voice.py`: ElevenLabs TTS (text→audio) and STT (audio→text) proxied server-side so the key stays secret;
  `elevenlabs.py` returns a clear "no key" signal when unset.
- `voice/useVoice.ts`: mic capture → `/api/stt`; play returned TTS synced with `Captions`; **fallback to
  browser Web Speech API** (SpeechRecognition + speechSynthesis) when the server reports no ElevenLabs key.
- Exit criterion: speak a question, hear a spoken answer, watch the scene change — with or without a key.

### Phase 5 — YouTube → pod generator (generalize the flagship)
- `youtube.py`: `yt-dlp` fetch video + auto-captions/subtitles (transcript); whisper optional later fallback.
- `pod_generator.py`: chunk transcript → Claude summarizes into the **Pod schema**, constrained to the known
  affordance vocabulary so output is runnable; validate against pydantic; save to `pods/`.
- `generate.py`: `POST /api/generate {youtube_url}` runs the pipeline; generate a 2nd pod from the README's
  transformer video (`https://www.youtube.com/watch?v=wjZofJX0v4M`) as the proof.
- Exit criterion: a generated pod loads and plays in the same viewer as the hand-authored GPT-2 pod.

---

## Reuse & key dependencies
- **Frontend:** `@react-three/fiber` + `@react-three/drei` (OrbitControls, Html labels, Text), `zustand`
  for state. No custom WebGL — lean on drei helpers.
- **Backend:** `anthropic` SDK (tool use), `transformers`+`torch` (CPU) for GPT-2, `yt-dlp`, `elevenlabs`,
  `fastapi`/`uvicorn`/`websockets`.
- The GPT-2 pod spec is intentionally the **reference output** of the Phase 5 generator — same schema, so
  Phase 1 work is not throwaway.

## Verification (end-to-end)
1. `scripts/setup.sh` then `scripts/dev.sh`; open `http://localhost:5173`.
2. **Video mode:** load GPT-2 pod, press play — narration + camera moves run start to finish.
3. **Free nav:** orbit/zoom with mouse; confirm smooth pan-zoom of the architecture.
4. **Real data:** enter input text → real activations/attention render; open ValueInspector → exact `0.2f`.
5. **AI live:** typed query ("show attention head 3 in layer 8") → scene + camera respond via Claude.
6. **Voice:** with `ELEVENLABS_API_KEY` set, speak a question → spoken answer + scene change; unset key →
   Web Speech fallback still works.
7. **Generator:** `POST /api/generate` with the transformer URL → new pod appears in `/api/pods` and plays.
8. Backend sanity: `pytest` for pod-schema validation + a gpt2 forward-pass smoke test.
