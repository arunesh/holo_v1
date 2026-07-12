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
