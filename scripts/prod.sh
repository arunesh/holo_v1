#!/usr/bin/env bash
# Holodeck production install/startup: build the frontend and run the backend
# under pm2 on :8350 (nginx proxies myholodeck.app -> 8350).
#
#   ./scripts/prod.sh          install deps if needed, build, (re)start via pm2
#   ./scripts/prod.sh --skip-build   just (re)start pm2 (use after config-only changes)
#
# Everything is userspace (no sudo) except optional boot persistence — see the
# note printed at the end.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${HOLODECK_PORT:-8350}"
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

# --- Node on PATH (userspace installs) -----------------------------------------
for NODE_BIN in "$ROOT/.tooling/node/bin" "$HOME/.local/node/bin"; do
  [ -x "$NODE_BIN/node" ] && export PATH="$NODE_BIN:$PATH" && break
done
command -v node >/dev/null || { echo "ERROR: node not found. Run ./scripts/setup.sh first."; exit 1; }
command -v pm2 >/dev/null || { echo "==> Installing pm2 (userspace)"; npm install -g pm2; }

# --- Backend venv ---------------------------------------------------------------
if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
  echo "==> Backend venv missing; running setup.sh"
  "$ROOT/scripts/setup.sh"
fi

# --- Frontend build ---------------------------------------------------------------
if [ "$SKIP_BUILD" -eq 0 ]; then
  cd "$ROOT/frontend"
  [ -d node_modules ] || { echo "==> Installing frontend deps"; npm ci; }
  echo "==> Building frontend"
  npm run build
fi

# --- Free the port if the dev servers hold it -----------------------------------
# dev.sh runs vite on :8350; the prod uvicorn needs that port. Only refuse if the
# holder isn't ours to manage (i.e. not the pm2 app we're about to restart).
HOLDER_PID="$(ss -tlnp 2>/dev/null | grep -F ":$PORT " | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
if [ -n "$HOLDER_PID" ] && ! pm2 pid holodeck 2>/dev/null | grep -qx "$HOLDER_PID"; then
  CMD="$(ps -p "$HOLDER_PID" -o comm= 2>/dev/null || echo '?')"
  if [ "$CMD" = "node" ]; then
    echo "==> Stopping dev server (pid $HOLDER_PID) holding :$PORT"
    kill "$HOLDER_PID" && sleep 1
  else
    echo "ERROR: :$PORT is held by pid $HOLDER_PID ($CMD). Stop it and re-run."
    exit 1
  fi
fi

# --- Start / restart under pm2 -------------------------------------------------
cd "$ROOT"
HOLODECK_PORT="$PORT" pm2 startOrRestart ecosystem.config.js
pm2 save

echo
echo "==> holodeck online: http://localhost:$PORT (nginx: https://myholodeck.app)"
echo "    logs:    pm2 logs holodeck"
echo "    status:  pm2 ls"

# --- Boot persistence (one-time, needs sudo) ------------------------------------
if ! systemctl status "pm2-$USER" >/dev/null 2>&1 && ! systemctl --user status pm2 >/dev/null 2>&1; then
  echo
  echo "NOTE: pm2 will not survive a reboot yet. One-time setup (needs sudo):"
  echo "    sudo env PATH=\$PATH:$(dirname "$(command -v node)") $(command -v pm2) startup systemd -u $USER --hp $HOME"
fi
