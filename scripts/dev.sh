#!/usr/bin/env bash
# Run the Holodeck backend (uvicorn :8000) and frontend (vite :5173) together.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/.tooling/node/bin:$PATH"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "==> Backend  → http://localhost:8000"
( cd "$ROOT/backend" && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload ) &

echo "==> Frontend → http://localhost:5173"
( cd "$ROOT/frontend" && npm run dev ) &

wait
