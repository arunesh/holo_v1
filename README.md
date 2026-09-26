# Holodeck

Interactive 3D explainers for technical concepts. Think of a 3Blue1Brown video that you can
fly through and talk to.

Each topic is a **pod**: a 3D scene, a guided narration track, and a set of animation
commands the scene understands. Press play and it runs like a video. Interrupt at any
point, by voice or text, and an AI tutor (Claude) answers by narrating *and* driving the
same scene: zooming into a layer, highlighting an attention head, running a real forward
pass, or showing activations down to the decimal.

### Lessons included

- **GPT-2**: a live 124M-parameter GPT-2. Explore embeddings, all 12 blocks, per-head
  attention and the unembedding, all driven by real activations from a forward pass on
  your own input.
- **Transformers: the tech behind LLMs**: a pod generated automatically from a
  3Blue1Brown video transcript.
- **Declarative Attention**: a simulated GPU-memory lesson (SMs, L2, HBM, KV cache)
  showing how global / focus / local attention change which KV chunks are read during
  decode. See [`docs/declarative-attention.md`](docs/declarative-attention.md).
- **PagedAttention**: a simulated KV cache allocator for the
  [vLLM paper](https://arxiv.org/abs/2309.06180). Watch contiguous allocation waste memory
  (reserved slots, internal and external fragmentation), then serve the same requests with
  paged blocks, block tables, copy-on-write sharing and preemption to CPU. See
  [`docs/paged-attention.md`](docs/paged-attention.md).

New pods can be generated from a YouTube explainer URL (see [Generating pods](#generating-pods)).

## Architecture

```
          Browser (React + react-three-fiber)
   ┌────────────────────────────────────────────────┐
   │  3D scene  ◄── affordance engine ◄── narration │  guided "video" playback
   │                      ▲                         │
   │                      └── tutor commands ◄──┐   │  interactive Q&A
   │  voice (ElevenLabs or Web Speech API)      │   │
   └──────────────┬──────────────────────────┬──┴───┘
             REST │                          │ WebSocket
   ┌──────────────▼──────────────────────────▼──────┐
   │  FastAPI backend                                │
   │   /api/pods         pod catalogue + specs (JSON)│
   │   /api/gpt2/forward real GPT-2 (transformers)   │
   │   /ws/session/{pod} Claude tutor → narration +  │
   │                     validated scene commands    │
   │   /api/tts, /api/stt  ElevenLabs proxy          │
   │   /api/generate     YouTube → new pod (Claude)  │
   └─────────────────────────────────────────────────┘
```

**The key idea: one command vocabulary, two drivers.** Every pod declares an *affordance
library*, the named commands its scene supports (`focusOn`, `highlightHead`,
`showAttention`, `showActivations`, `runInference`, …). Authored narration beats play
these commands in order. During Q&A, Claude gets the same library as tools and replies
with narration plus a command sequence. Both paths run through the same frontend engine,
so asking the scene a question and watching the guided lesson behave the same way. The
backend validates tutor commands against the pod schema before they reach the browser.

| Path | What's there |
|---|---|
| `backend/app/pods/*.json` | Pod definitions (scene, narration, affordances) |
| `backend/app/schemas/pod.py` | Pydantic schema all pods and generated output must satisfy |
| `backend/app/services/` | Claude orchestration, GPT-2 inference, ElevenLabs, pod generator |
| `backend/app/lessons/` | Lesson-specific backends (e.g. Declarative Attention tutor) |
| `frontend/src/scene/` | Transformer 3D scene |
| `frontend/src/engine/affordances.ts` | Executes affordance commands against the scene |
| `frontend/src/lessons/` | Lesson-specific frontends with their own scene and state |
| `scripts/` | Setup, dev and production scripts |

In production a single uvicorn process serves the API, the WebSockets and the built
frontend (`frontend/dist`).

## Getting started

### Prerequisites

- Python 3.10+
- Node.js 18+ (`scripts/setup.sh` installs a local copy if you don't have one)
- An [Anthropic API key](https://console.anthropic.com/) for the AI tutor and pod generation
- Optional: an [ElevenLabs](https://elevenlabs.io/) API key for higher-quality voice.
  Without one, the app uses the browser's Web Speech API.

Works on Linux and macOS (Intel and Apple Silicon). No sudo is needed.

### Install and run

```bash
git clone https://github.com/arunesh/holo_v1.git
cd holo_v1

cp .env.example .env     # then add your ANTHROPIC_API_KEY
./scripts/setup.sh       # Python venv + torch + backend deps, frontend deps
./scripts/dev.sh         # backend on :8000, frontend on :8350
```

Open <http://localhost:8350>. The Vite dev server proxies `/api` and `/ws` to the
backend. The first GPT-2 request downloads the model weights (~500 MB) from Hugging Face.

### Configuration

All configuration comes from `.env` in the repo root (see [`.env.example`](.env.example)).
`.env*` files are gitignored, so never commit real keys.

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | AI tutor and pod generation. Without it, guided playback still works but the GPT-2 tutor only handles simple keyword commands and the Declarative Attention and PagedAttention tutors say they're offline. |
| `ELEVENLABS_API_KEY` | no | ElevenLabs TTS/STT. Falls back to Web Speech if unset or out of quota. |
| `ELEVENLABS_VOICE_ID` | no | ElevenLabs voice to use |
| `HOLODECK_CLAUDE_MODEL` | no | Model used by the tutor |
| `HOLODECK_GENERATOR_MODEL` | no | Model used for pod generation |
| `HOLODECK_GPT2_MODEL` | no | Hugging Face GPT-2 variant (default `gpt2`) |
| `HOLODECK_FRONTEND_PORT` | no | Dev server port (default `8350`) |
| `HOLODECK_PORT` | no | Production server port (default `8350`) |

**Optional Google sign-in.** The login page offers guest access by default. To enable
"Continue with Google", create a *Web application* OAuth client ID in Google Cloud, add
your origin (e.g. `http://localhost:8350`) under *Authorized JavaScript origins*, and put
it in `frontend/.env.local`:

```bash
VITE_GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
```

Sign-in only personalizes the UI. The backend doesn't verify it, so it doesn't protect
the API.

## Generating pods

`POST /api/generate` asks Claude to write a new pod that follows the same schema and
affordances, so it plays in the same viewer. Send either:

- `{"youtube_url": "..."}` and the server fetches the transcript itself, or
- `{"title": "...", "transcript": "...", "video_id": "..."}` with a transcript you fetched yourself.

YouTube often blocks transcript downloads from cloud IPs. If that happens, fetch the
transcript on your own machine (needs only `pip install yt-dlp`) and post it:

```bash
python3 scripts/fetch_transcript.py "https://youtu.be/wjZofJX0v4M" \
    --cookies-from-browser chrome --post http://localhost:8000
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/pods`, `/api/pods/{id}` | Pod catalogue / full pod spec |
| POST | `/api/gpt2/forward` | Real GPT-2 activations, attention and top predictions |
| WS | `/ws/session/{pod_id}` | Live tutor session (question → narration + commands) |
| POST | `/api/tts`, `/api/stt` | ElevenLabs proxy (`204` means use Web Speech) |
| GET | `/api/voice/status` | Whether ElevenLabs is configured |
| POST | `/api/generate` | Generate a new pod |
| GET | `/api/health` | Health check |

## Tests

```bash
# backend
cd backend && .venv/bin/python -m pytest tests/ -q

# frontend (lesson simulations + playback)
cd frontend && npm run test:da && npm run test:pa
```

## Deploying

The production setup is a single process managed by [pm2](https://pm2.keymetrics.io/)
behind a reverse proxy:

```bash
cp .env.example .env    # add production keys on the server
./scripts/prod.sh       # installs deps if needed, builds the frontend, (re)starts pm2
```

- `ecosystem.config.js` runs uvicorn on `HOLODECK_PORT` (default 8350). It must stay a
  **single process** because session state lives in memory.
- Put a TLS-terminating reverse proxy in front of it. The proxy must forward WebSocket
  upgrade headers for `/ws`. [`docs/nginx-holodeck.conf`](docs/nginx-holodeck.conf) is an
  example nginx site.
- `./scripts/prod.sh --skip-build` restarts without rebuilding. Use `pm2 logs holodeck`
  to see logs.
