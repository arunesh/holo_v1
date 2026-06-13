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

## Run it

```bash
./scripts/setup.sh     # installs Node (userspace), Python venv, all deps
./scripts/dev.sh       # backend :8000, frontend :5173
# open http://localhost:5173
```

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

`POST /api/generate {youtube_url}` fetches a video's transcript (yt-dlp, with an oEmbed
title fallback when YouTube bot-walls the host) and asks Claude to author a new pod
constrained to the same schema + affordances, so it runs in the identical viewer.
A pod generated from the README's transformer video ships in `app/pods/`.

> Note: from cloud IPs YouTube often blocks transcript download ("confirm you're not a
> bot"). The generator degrades gracefully — it authors from the title + Claude's
> knowledge. For full transcripts, run with browser cookies (`yt-dlp --cookies`).

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
