# Holodeck

Interactive 3D explainers for technical concepts — like a 3Blue1Brown video you can
fly through and talk to. The flagship pod is **GPT-2**: watch a guided narration *or*
interrogate a live transformer — zoom into any block or attention head, run a real
forward pass, and read activations down to the decimal.

## What's here

```
backend/   FastAPI + real GPT-2 (transformers/torch) + Claude orchestration + ElevenLabs proxy
frontend/  React + react-three-fiber (Three.js) real-time 3D scene
scripts/   setup.sh (userspace install), dev.sh (run both servers)
```

## Run it (Linux or macOS — Intel & Apple Silicon)

```bash
cp .env.example .env   # add ANTHROPIC_API_KEY (and ELEVENLABS_API_KEY if you have one)
./scripts/setup.sh     # uses your node/python3 if present, else installs Node in .tooling
./scripts/dev.sh       # backend :8000, frontend :5173
# open http://localhost:5173
```

`setup.sh` is cross-platform: on macOS it uses your existing `node`/`python3` (or Homebrew),
picks the right torch wheel (Apple-Silicon MPS or Intel), and skips the Linux-only pip
bootstrap. No sudo required.

Config lives in `.env` (copy from `.env.example`):
- `ANTHROPIC_API_KEY` — required for the AI tutor + pod generation.
- `ELEVENLABS_API_KEY` — optional; if absent or out of quota, voice falls back to the
  browser Web Speech API automatically.

## The core idea — Pods + the affordance library

A **pod** (`backend/app/pods/*.json`, schema in `app/schemas/pod.py`) is:
- a **parameterized 3D scene** (transformer: embeddings → N blocks → unembedding),
- a linear **narration** track of beats, and
- an **affordance library** — the named animation commands the scene understands
  (`focusOn`, `highlightHead`, `showAttention`, `showActivations`, `setPrecision`,
  `runInference`, `annotate`, `reset`, …).

One command vocabulary, two drivers:
- **Video mode** — authored beats play their commands in order (`useNarration.ts`).
- **Interactive mode** — your voice/text goes to **Claude**, which is handed the same
  affordance library as tools and replies with narration + a command sequence
  (`anthropic_client.py`). Both paths execute through the *same* engine
  (`engine/affordances.ts`), so talking to the scene and watching it behave identically.

## Real model internals

`POST /api/gpt2/forward {text}` runs HuggingFace `gpt2` (124M, CPU) and returns real
per-token residual norms, per-head attention matrices, sampled hidden values, and the
top next-token predictions. The scene maps these to colors, attention arcs, and exact
numbers in the inspector.

## Generating new pods

`POST /api/generate` asks Claude to author a new pod constrained to the same schema +
affordances, so it runs in the identical viewer. It accepts **either**:
- `{youtube_url}` — the server fetches the transcript itself (yt-dlp, oEmbed title fallback), **or**
- `{title, transcript, video_id}` — a transcript you fetched elsewhere.

### Fetching transcripts on your own machine (avoids cloud bot-walls)

From datacenter IPs YouTube blocks transcript download ("confirm you're not a bot"). Run
the standalone fetcher on a normal machine instead — it needs only `pip3 install yt-dlp`:

```bash
# write the transcript JSON (use your browser cookies for best results):
python3 scripts/fetch_transcript.py "https://youtu.be/wjZofJX0v4M" \
        --cookies-from-browser chrome -o backend/app/transcripts/transformers.json

# …then generate the pod on a running Holodeck (one-shot fetch+generate also works):
curl -X POST http://localhost:8000/api/generate -H 'Content-Type: application/json' \
     -d @backend/app/transcripts/transformers.json
python3 scripts/fetch_transcript.py URL --cookies-from-browser chrome --post http://localhost:8000
```

The fetcher emits exactly `{title, description, transcript, video_id}` — the shape
`/api/generate` accepts. If no transcript is captured, the pod is still authored from the
title + Claude's knowledge. A pod generated from the README's transformer video ships in
`app/pods/`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/pods` / `/api/pods/{id}` | catalogue / pod spec |
| POST | `/api/gpt2/forward` | real activations + attention |
| WS   | `/ws/session/{pod}` | live AI session (query → narration + commands) |
| POST | `/api/tts`, `/api/stt`, GET `/api/voice/status` | ElevenLabs proxy (204 ⇒ use Web Speech) |
| POST | `/api/generate` | YouTube URL → new pod |

## Tests

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```
