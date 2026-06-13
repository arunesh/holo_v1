#!/usr/bin/env bash
# Holodeck setup — installs all tooling in user space (no sudo required).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_VER="v20.18.1"
NODE_DIR="$ROOT/.tooling/node"

echo "==> Installing Node ($NODE_VER) into .tooling (userspace)"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  mkdir -p "$ROOT/.tooling"
  curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz"
  tar -xf /tmp/node.tar.xz -C "$ROOT/.tooling"
  mv "$ROOT/.tooling/node-${NODE_VER}-linux-x64" "$NODE_DIR"
  rm -f /tmp/node.tar.xz
fi
export PATH="$NODE_DIR/bin:$PATH"
node --version

echo "==> Creating Python venv + installing backend deps"
cd "$ROOT/backend"
if [ ! -x ".venv/bin/python" ]; then
  python3 -m venv .venv --without-pip
  curl -fsSL -o /tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py
  .venv/bin/python /tmp/get-pip.py --quiet
fi
.venv/bin/python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu --quiet
.venv/bin/python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu --quiet

echo "==> Installing frontend deps"
cd "$ROOT/frontend"
npm install --no-fund --no-audit

echo "==> Done. Run ./scripts/dev.sh to start Holodeck."
