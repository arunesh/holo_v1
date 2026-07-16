
  The hooks error is a hot-reload artifact, not a bug. My TTS fix added a new useCallback (stopSpeaking) inside useVoice. Vite's hot module replacement swapped the new code into your already-running
  page, so the mounted App component suddenly rendered with one more hook than its previous render — exactly what the error says ("hook #36: useRef → useCallback", "Rendered more hooks than during the
  previous render"). React's rules-of-hooks checker can't tell "the code was edited live" apart from "the code conditionally calls hooks", so it throws. I verified all hooks in App.tsx, useVoice, and
  useNarration are unconditional, and the production build compiles cleanly. After a full page reload, the old and new renders come from the same code and the error can't recur.
  
  The 404 was the missing favicon. The page has no public/ directory or icon link, so the browser's automatic /favicon.ico request 404'd — harmless, but noisy. I added an inline SVG favicon to index.html
  to silence it.

  After the hard refresh, you should be on the new code with a clean console — that's also when you'll get the TTS-completion behavior, so long sentences should play to the end before the next beat
  starts.


------------------------------------------------------------------------------------------------------------------------
● Default confirmed at 8350. Let me verify the override separately.

● Bash(cd /home/azureuser/holodeck/holo_v1/frontend; export PATH="$(cd ../.tooling/node/bin && pwd):$PATH"; HOLODECK_FRONTEND_PORT=9999 npm run dev > /tmp/vite2.log 2>&1 & P=$!; sleep 7; grep -iE "Local:"
      /tmp/vite2.log | head; kill $P 2>/dev/null; true)
  ⎿    ➜  Local:   http://localhost:9999/
  ⎿  Allowed by auto mode classifier

● Both verified. The frontend port is now configurable and defaults to 8350.

  Changes:
  - frontend/vite.config.ts — reads HOLODECK_FRONTEND_PORT (defaults to 8350) instead of the hardcoded 5173.
  - scripts/dev.sh — exports HOLODECK_FRONTEND_PORT (default 8350) so vite picks it up, and the startup log now prints the actual port.
  - HOLODECK.md — quickstart updated to 8350 and notes the override env var.

  Verified end-to-end: Vite serves on http://localhost:8350/ by default and on 9999 when HOLODECK_FRONTEND_PORT=9999 is set. The backend stays on :8000 and the proxy is unchanged, so API/WS calls still route
  correctly. (Historical transcript files under docs/ still mention :5173 — I left those as-is since they're records of past sessions.)

------------------------------------------------------------------------------------------------------------------------
● Done. Both requests are implemented and verified.

  1. Local transcript fetcher → scripts/fetch_transcript.py

  A self-contained script (only needs pip3 install yt-dlp) you run on your MacBook/residential IP. It outputs exactly the JSON shape Holodeck's /api/generate accepts: {title, description, transcript, video_id}.

  # fetch with your browser cookies (beats the bot-wall):
  python3 scripts/fetch_transcript.py "https://youtu.be/wjZofJX0v4M" \
          --cookies-from-browser chrome -o backend/app/transcripts/transformers.json

  # one-shot: fetch locally AND generate the pod on a running server:
  python3 scripts/fetch_transcript.py URL --cookies-from-browser chrome --post http://localhost:8000

  To make it integrate, I extended the backend: POST /api/generate now accepts either {youtube_url} (server fetches) or {title, transcript, video_id} (your offline fetch). I verified both paths live — the transcript-driven pod
  genuinely reflected the supplied text ("attention… lets each token look at every other token"), and the JSON file POST round-trips. The fetcher supports --cookies-from-browser, --cookies file, -o file, and --post.

  2. macOS install/run

  scripts/setup.sh is now cross-platform (no separate mac script needed):
  - Uses your existing node/python3 if present (Homebrew), else downloads the correct Node tarball (darwin-arm64/darwin-x64/linux-*).
  - Picks the right torch wheel per-OS — default PyPI on macOS (Apple-Silicon MPS / Intel), CPU index on Linux.
  - Skips the Linux-only --without-pip+get-pip bootstrap when your python has working pip.
  - dev.sh falls back to system Node when .tooling/node is absent.

  Both verified: bash -n clean, fetch_transcript.py compiles, all 6 backend tests still pass, catalogue is back to the two real pods (flagship GPT-2 + the README transformer video). I removed the throwaway test pod I'd generated.

  One caveat I couldn't fully exercise here: this datacenter box has no yt-dlp on system python and YouTube bot-walls it, so I tested the real-transcript path with a supplied transcript rather than a live YouTube pull. On your
  MacBook with cookies, the live pull is what --cookies-from-browser is for — that's the piece to confirm on your end (rg #2). Docs for the whole flow are in HOLODECK.md.
------------------------------------------------------------------------------------------------------------------------
● Holodeck is built and verified end-to-end. The backend is running at http://localhost:8000 (serving the built frontend); for live dev use ./scripts/dev.sh (Vite on :5173).
  
  What was built — all 6 phases

  ┌───────────────────────────────────┬────────┬───────────────────────────────────────────────────────────────────────────┐
  │               Phase               │ Status │                                Verified by                                │
  ├───────────────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────────┤
  │ 0 · Harness & scaffold            │ ✅     │ userspace Node + venv installed; both apps build                          │
  ├───────────────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────────┤
  │ 1 · GPT-2 pod scene + narration   │ ✅     │ npm run build clean; 11-beat authored track                               │
  ├───────────────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────────┤
  │ 2 · Real GPT-2 internals          │ ✅     │ "The cat sat on the" → floor, bed, couch… with real activations/attention │
  ├───────────────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────────┤
  │ 3 · Claude orchestration          │ ✅     │ "zoom into layer 5, show head 2" → correct narration + 5-command sequence │
  ├───────────────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────────┤
  │ 4 · Voice (ElevenLabs + fallback) │ ✅     │ TTS 402-quota → 204 → Web Speech fallback                                 │
  ├───────────────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────────┤
  │ 5 · YouTube → pod generator       │ ✅     │ README's transformer video → 14-beat runnable pod                         │
  └───────────────────────────────────┴────────┴───────────────────────────────────────────────────────────────────────────┘

  6/6 backend tests pass.
  
  The architecture in one idea

  A Pod = parameterized 3D scene + narration beats + an affordance library (focusOn, highlightHead, showAttention, showActivations, setPrecision, runInference…). That one command vocabulary has two drivers — authored beats ("watch
  like a video") and Claude (your voice/text → tool-use → commands). Both execute through the same engine/affordances.ts, so the scene behaves identically whether scripted or conversational. Real numbers come from an actual gpt2
  forward pass on CPU.
  
  Three environment realities (handled gracefully, worth knowing)

  1. ElevenLabs key is present but the account is out of credits (402). Voice automatically falls back to the browser's Web Speech API — top up credits and it just works, no code change.
  2. YouTube bot-walls this server's IP, so yt-dlp can't pull transcripts. The generator degrades to the video's title (via oEmbed) + Claude's knowledge — still produced a solid 14-beat pod. Full transcripts need yt-dlp --cookies.
  3. No browser/sudo here, so I couldn't screenshot the actual WebGL pixels. Everything behind the render is verified live (build, APIs, WebSocket, real model, Claude). When you open it locally you'll see the 3D transformer; mouse
  orbits/zooms freely and the camera flies to whatever you or Claude focus on.

  To run from scratch on any machine: ./scripts/setup.sh && ./scripts/dev.sh. Details in HOLODECK.md.
