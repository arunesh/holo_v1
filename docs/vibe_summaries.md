⏺ The bug is in how the Declarative Attention lesson's voice player detects the end of the ElevenLabs audio. I've fixed it locally and added tests, but haven't committed or deployed anything yet.

  What happens: when an audio clip plays to the end, the browser fires a pause event just before ended. playAudio in frontend/src/lessons/declarative-attention/voicePlayback.ts treated pause as "playback failed". So
  after ElevenLabs finished each sentence, speak() (in useLessonVoice.ts) fell back to browser speech and read it again. That's why you heard ElevenLabs first, then the browser voice. The GPT-2 lesson isn't affected
  because its voice code treats pause as finished.

  The fix: browser speech now takes over only if the ElevenLabs audio never started. Once it has played at all, a pause, error or timeout counts as spoken, so nothing is repeated. Skipping or interrupting still cancels
  without repeating, as before.

  Tests: I added two to test-lesson-experience.mjs:
  - Audio that plays to the end counts as spoken. This one fails without the fix and passes with it.
  - Audio that fails before starting still falls back to browser speech.

  All 26 frontend tests and tsc pass. I haven't tested it in a real browser.

  Git state:
  - The fix is uncommitted on main, next to the uncommitted README rewrite.
  - docs/vibe_summaries.md also shows as modified. I didn't touch it, so I assume it's your edit and have left it alone.

  Should I commit the fix (and the README) to a branch and open a PR, or commit straight to main? Once it's merged, deploying on botmc is:
  cd ~/holodeck/holo_v1 && git pull --ff-only && export PATH="$HOME/.local/node/bin:$PATH" && ./scripts/prod.sh
  I can run that over ssh when you're ready.
------------------------------------------------------------------------------------------------------------------------
⏺ I rewrote README.md but haven't committed it. It now covers:

  - a public description of the project and its three lessons
  - an architecture diagram and the "one command vocabulary, two drivers" design
  - install steps, a table of settings, and optional Google sign-in
  - pod generation, the API, tests, and a generic deploy section

  I scanned the new README for IPs, hostnames, usernames, domains and keys and found none. For deploying it gives only generic pm2 and reverse-proxy steps.

  Want me to commit it on a branch and open a PR, or commit straight to main?

  Prod details already in the public repo

  arunesh/holo_v1 is public, and these tracked files already expose production details:

  ┌────────────────────────────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────┐
  │                                        File                                        │                       What it exposes                       │
  ├────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ docs/gcp_connect.md                                                                │ The VM's public IP, the azureuser login, and an SSH command │
  ├────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ frontend/.env.local                                                                │ The production Google OAuth client ID                       │
  ├────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ docs/holo_transcript_1.md, docs/vibe_summaries.md, docs/clever-spinning-adleman.md │ Server paths and username (old session transcripts)         │
  └────────────────────────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────┘

  Deleting these files only removes them from future commits; they stay in the git history. The OAuth client ID is visible in the browser anyway, so it's low risk. The IP plus username is the main concern: make sure the
  VM only accepts SSH keys (password login off) and that its firewall only allows traffic from Cloudflare.

  I can remove these files from the repo if you want. Before I untrack frontend/.env.local, back it up on the server. Otherwise the next git pull there deletes it, and Google sign-in breaks after the rebuild.

  Pushing to prod

  The server runs the app under pm2 on port 8350, with nginx and Cloudflare in front. From your laptop:

  ssh azureuser@<your-vm>
  cd ~/holodeck/holo_v1

  git log --oneline -1          # note the current commit, for rollback
  git pull --ff-only origin main

  Next, install dependencies, but only if they changed since the commit you noted:

  git diff --stat <old-sha> HEAD -- backend/requirements.txt frontend/package-lock.json
  # if requirements.txt changed:
  backend/.venv/bin/pip install -r backend/requirements.txt
  # if package-lock.json changed (prod.sh only runs npm ci when node_modules is missing):
  (cd frontend && npm ci)

  Then build the frontend and restart the app:

  ./scripts/prod.sh

  Check that it came up:

  pm2 ls
  curl -s localhost:8350/api/health     # {"ok":true}
  pm2 logs holodeck --lines 50

  Then open the site and try the Declarative Attention lesson.

  For this deploy, PR #1 added only a test script to package.json, with no new dependencies. So git pull followed by ./scripts/prod.sh should be enough.

  To roll back: git checkout <old-sha> && ./scripts/prod.sh, then git checkout main once it's fixed.

  When you're ready, I'll start on review findings 5–10, plus adding jsonschema to requirements.txt and fixing the spatial test's missing playwright dependency.
------------------------------------------------------------------------------------------------------------------------
⏺ I fixed findings 1–4 and pushed the commit to PR #1 as 0395fd0. Note that the PR comes from the contributor's fork (JhonSummer/holo_v1), so the commit is on their branch through maintainer edits. It will show up in
  the PR for them to see.

  The fixes:
  1. Focus selection wiped (simulation.ts): switching to global or local mode with no chunks now keeps the last focus selection, so the Focus button can restore it.
  2. Empty tutor reply breaking history (DeclarativeAttentionLesson.tsx): when the tutor replies with commands only, history now stores (Updated the scene.) instead of an empty turn.
  3. Transformer beats misread as Declarative Attention beats (pod.py): Pod now picks the beat type from the scene type instead of letting Pydantic guess each beat.
  4. Any message treated as a disconnect (session.py): the socket now ignores stray messages while the tutor is answering and only cancels on a real disconnect.

  Testing: I added a regression test for 1, 3 and 4, and checked that each fails without its fix and passes with it. There's no test for 2 because that code is inside the React component. With the fixes, all 28
  backend tests, the 40 frontend test:da tests and tsc pass.

  Problems I hit while testing:
  - requirements.txt pins torch==2.5.1, which has no wheel for this Mac. I installed everything else into a throwaway venv at /tmp/holo-venv.
  - The existing backend tests import jsonschema, which isn't in requirements.txt.
  - scripts/test-spatial-interaction.mjs imports playwright, which isn't a dependency, so it can't run at all. That's worse than finding 9 said.

  I'll add the last two to the follow-up fixes.

  Your local checkout is still on lesson/declerative_attention. Once you've merged, tell me and I'll switch to main, fetch, and fix findings 5–10. For finding 6, the "Grok" wording, I'll change it to Claude unless you
  want to keep it.
------------------------------------------------------------------------------------------------------------------------
● Both issues are real and I can pin them to specific code. Here's the diagnosis and what I'd do about each.

  1. Zoom only works at the center

  The camera is a stock drei OrbitControls in frontend/src/scene/CameraRig.tsx:44. Two things combine against you:                                                            

  - Scroll-zoom always dollies toward the orbit target, which sits wherever the last narration focus put it (usually the pipeline center). Pointing your mouse at a side block and scrolling still zooms
  toward the center target.                                                                                                                                                   
  - Panning does exist, but only on right-mouse-drag (OrbitControls' default), which nobody discovers — and even after panning, the orbit pivot only moves as far as the pan did.

  Ideas, in order of bang-for-buck:

  - zoomToCursor (one-liner). Your three version (r169) supports it: add zoomToCursor to the OrbitControls props and wheel-zoom heads toward whatever is under the mouse pointer. This alone fixes "pan to
  a side and zoom there" — you don't even need to pan first.
  - Double-click to re-center. Raycast the click against the scene and lerp controls.target to the hit point (you already have the lerp machinery in CameraRig — it's the same code path as focusToCamera).
  After re-centering, orbiting rotates around what you clicked, which zoomToCursor alone doesn't give you.
  - Optionally remap mouseButtons so left-drag pans and right-drag orbits (or advertise the right-drag pan in the UI hint).

  2. "MLP" text and activation values cutting through the attention cubes

  This is a genuine geometry collision, not a rendering artifact:

  - The activation panel is wider than the gap between blocks. ActivationGrid.tsx:24 places the panel at blockX + 4.1, but blocks are only BLOCK_SPACING = 7 apart. The per-token value labels grow
  downward from y≈3.5 by 0.58/token — with 8+ tokens they descend right to ATTN_Y = -1.1. And in values mode the dims panel starts at local x 2.6 and spans ~7.6 more units, so it runs straight through
  the next block (and the one after) at z=0 — exactly the plane where a head cube sits. Depth-tested text glyphs slicing through opaque cubes is precisely the "occluded intersection" look you're seeing.
  - The head cubes also outgrow their shell: with GPT-2's 12 heads, headZ spreads them across ±3.74 in z while the block shell is only ±1.7 wide, so cubes poke out and collide with anything nearby,
  including the "MLP" label plane of the same block when viewed at an angle.

  Ideas:

  - Move the activation panel out of the pipeline axis. Offset it in +Z (toward the default camera, e.g. z = BLOCK_WIDTH/2 + 3) or above the block instead of to the right along x — x is the one direction
  guaranteed to hit the next block.
  - Render the panel as an overlay: depthTest={false} + a high renderOrder on the Text and cell materials, with a semi-transparent dark backing plane for readability. Then even where it does overlap
  geometry, it reads as a floating HUD instead of intersecting solids. (drei Billboard around the group is a nice extra so it always faces the camera.)
  - Fit the heads inside the shell: compute head spacing from BLOCK_WIDTH ((BLOCK_WIDTH - HEAD_SIZE) / (n_heads - 1)) instead of the fixed 0.18 gap in layout.ts:22, so 12 heads compress to fit ±1.7.
  Labels ("MLP", "12-head attn", "Block n") could also get depthWrite={false} and a nudge to the front face (z = BLOCK_WIDTH/2 + 0.05) so they never sit inside the translucent shell.

  If you want, I can implement the quick wins — zoomToCursor, the panel z-offset + no-depth-test overlay, and head spacing that fits the shell — they're all small, contained changes.
------------------------------------------------------------------------------------------------------------------------

● The pitch deck now carries the branding, live at myholodeck.app/pitchdeck/. What I added:

  - Title slide — the text eyebrow "Holodeck · 2026" is now a proper brand lockup: the full primary mark (tapered arcs with the violet halo) at 64px next to the wordmark. I verified the mark renders
  correctly with its taper and glow on the deck's near-black background.
  - Prominent color — the headline accent "the video." on the title slide and "Neither is this." on the closing slide now use the brand's signature gradient ramp (cyan → violet → pink) as clipped text,
  instead of flat signal blue. This is the boldest change — it bookends the deck with the brand color while everything between keeps the existing signal/pulse/ember system. There's a print fallback so
  the gradient text doesn't vanish when someone hits P to print.
  - Persistent footer mark — an 18px mark sits in the scrubber bar next to the timecode, so the brand is on every slide without competing with content. (The scrubber already had a .mark class for its
  diamond beat markers, so the logo uses a separate mark-logo class to avoid a style collision.)
  - Head tags — the deck page now gets the real favicon, theme-color, and its own OG/Twitter card tags pointing at the branded 1200×630 card, so sharing the pitchdeck link also renders nicely.

  The deck is served directly from docs/pitchdeck/index.html so no build step was needed — the changes are live now. Everything (app + deck) is still uncommitted on top of the v1.0-pre-branding tag, so
  the full revert remains one git checkout -- . away. Take a look at both pages — if the gradient headline feels too loud against the locked palette, that's a one-line change back to accent-s blue while
  keeping the logo and favicon.

------------------------------------------------------------------------------------------------------------------------
  
● Done. The pitch deck is shareable at https://myholodeck.app/pitchdeck/ (the no-slash version redirects there). It's served by the existing uvicorn app via a new /pitchdeck static mount in
  backend/app/main.py, with the deck file now at docs/pitchdeck/index.html. The main site and API were verified unaffected after the restart, and I've updated my deploy notes to reflect that the domain's
  HTTPS issues are resolved and where the deck lives
------------------------------------------------------------------------------------------------------------------------
● Done. The pitch deck is at docs/holodeck_pitch.html — a single self-contained file, five slides, keyboard-driven, in the locked Holodeck brand (void background, signal/pulse/ember accents, Space
  Grotesk + Plex Mono). The inline JS passes a syntax check with the repo's bundled Node.

  The five beats:

  1. Cold open / Vision — "Step inside the video," over a lightweight version of the constellation animation from the login page.                                                            
  2. The shift — from watching to inhabiting: one scene, two drivers (▶ WATCH plays authored beats, ⦿ ASK lets a model drive the same scene with the same commands), with a LIVE proof strip pointing at
  myholodeck.app.
  3. Technical work — the three open problems, one accent color each: an open encoding for interactive video (pods as v1), a player that is a model (the VLM player), and a grammar for interactivity
  (pause-and-ask, recompute the story, branch the plot).
  4. Markets — education, creative expression, and crowd-sourced storytelling, rendered as the product's own session-tile pattern; education carries the LIVE dot since the demo exists there.
  5. Now / Next — what runs today vs. what's next (publish the pod spec, prototype the VLM player, open authoring), closing on "The holodeck was never a screen. Neither is this."

  One deliberate design move: the deck's navigation is a video-player scrubber — a timeline along the bottom with five diamond beat markers, mono timecodes (00:01 / 00:05), and a glowing playhead — so
  the artifact itself embodies the thesis of video you step through rather than slides you flip. Navigate with ←/→, space, or by clicking the timeline; P prints (each slide becomes its own PDF page); it
  respects reduced-motion and collapses cleanly on mobile.

  To view it: copy the file to any machine with a browser, or serve it from this box (python3 -m http.server in docs/, or drop it under the nginx root so it's reachable at myholodeck.app). I kept all
  copy factual to what exists — no invented market sizes or metrics.


------------------------------------------------------------------------------------------------------------------------

● Done and live at https://myholodeck.app (new bundle index-CSXCTG7O.js is being served).

  The login page is now three stacked pieces over the constellation:

  - Top-left header (outside the card): the HOLODECK eyebrow and the "Step inside the video." tagline, with the tagline bumped up slightly in size (up to 44px) since it's now the page title. It fades in
  from above.
  - Login card (unchanged position, vertically centered): starts directly with the "Step into the Transformer" session tile, then OR / Continue with Google. Top padding reduced from 38px to 28px since
  the title no longer leads the card.
  - Bottom-left about line: the "Holodeck turns a video into a place…" paragraph, pinned near the bottom of the viewport below the card and animation, fading in from below with a slight delay.

  Header and about line share the card's left offset (clamp(20px, 7vw, 130px)) so all three align on a common left edge. On mobile (≤720px) all three center horizontally with centered text, and the
  eyebrow's trailing rule line is dropped; prefers-reduced-motion disables the new entrance animations.
  
  Build passed and the rebuilt dist is what uvicorn serves, so no restart was needed. No browser on this box for a screenshot, so give it a quick eyeball on the live site — the one thing worth checking
  is a short/landscape phone viewport, where the centered card could crowd the header on very small heights. If it does, I can switch the page to a flex column layout instead of absolute positioning.
------------------------------------------------------------------------------------------------------------------------
● The script is done and the app is running under pm2 — but while verifying end-to-end I found two nginx/network problems that need your sudo, detailed below.

  What I built

  - scripts/prod.sh — the install/startup script. It puts userspace Node on PATH, installs pm2 if missing, creates the backend venv via setup.sh if missing, runs npm ci + npm run build, stops the old
  vite dev server if it's holding the port, then pm2 startOrRestart + pm2 save. Use --skip-build to just restart.                                                                            
  - ecosystem.config.js — pm2 runs a single uvicorn on :8350 which serves the API, websockets, and the built frontend/dist (the backend already mounts it), so no separate frontend process is needed in
  production. API keys come from the repo-root .env, which the backend loads itself.

  I ran it: frontend built, holodeck is online in pm2 with 0 restarts, and locally everything checks out — /, the JS bundle, and /api/pods all return 200 on :8350. I stopped the old dev.sh session
  (uvicorn :8000 + vite :8350) since prod replaces it; note dev.sh will now need a different port (HOLODECK_FRONTEND_PORT) while prod holds 8350.

  Two things only you can fix (need sudo / Azure access)
  
  Testing through the real domain, http://myholodeck.app serves the nginx default welcome page and https:// returns Cloudflare error 522:

  1. Wrong domain in the nginx config. /etc/nginx/sites-available/holodeck says server_name myholodeck.com — the domain is myholodeck.app, so requests fall through to the default site. I staged a
  corrected copy at docs/nginx-holodeck.conf:
  sudo cp docs/nginx-holodeck.conf /etc/nginx/sites-available/holodeck
  sudo nginx -t && sudo systemctl reload nginx
  2. Port 443 is blocked at the Azure NSG (port 80 gets through, 443 times out from outside — that's the 522, since Cloudflare's "Full" SSL mode connects to your origin on 443). Add an inbound allow rule
  for TCP 443 in the VM's network security group.

  After both: curl https://myholodeck.app/api/pods should return the pod list.

  Two smaller notes: pm2 won't survive a reboot yet — one-time setup is sudo env PATH=$PATH:/home/azureuser/.local/node/bin /home/azureuser/.local/node/bin/pm2 startup systemd -u azureuser --hp
  /home/azureuser (prod.sh prints this too). And if your Cloudflare origin cert (cf_holodeck.crt) was issued for myholodeck.com, it's fine in "Full" mode but would need reissuing for the .app domain if
  you ever switch to "Full (strict)". Also make sure myholodeck.app is an authorized origin on the Google OAuth client so sign-in works there.
------------------------------------------------------------------------------------------------------------------------

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
