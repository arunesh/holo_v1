#!/usr/bin/env bash
# Run the Holodeck backend (uvicorn :8000) and frontend (vite) together.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Prefer the userspace Node from setup.sh; otherwise rely on a system node on PATH.
[ -x "$ROOT/.tooling/node/bin/node" ] && export PATH="$ROOT/.tooling/node/bin:$PATH"

# Frontend dev server port (overridable via env; matches vite.config.ts default).
FRONTEND_PORT="${HOLODECK_FRONTEND_PORT:-8350}"
export HOLODECK_FRONTEND_PORT="$FRONTEND_PORT"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "==> Backend  → http://localhost:8000"
( cd "$ROOT/backend" && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload ) &

echo "==> Frontend → http://localhost:$FRONTEND_PORT"
( cd "$ROOT/frontend" && npm run dev ) &

wait
