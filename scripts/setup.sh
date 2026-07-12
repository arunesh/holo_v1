#!/usr/bin/env bash
# Holodeck setup — installs all tooling in user space (no sudo). Works on Linux and macOS
# (Intel + Apple Silicon). Uses an existing `node`/`python3` if suitable, else downloads Node.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_VER="v20.18.1"
NODE_DIR="$ROOT/.tooling/node"

OS="$(uname -s)"   # Linux | Darwin
ARCH="$(uname -m)" # x86_64 | aarch64 | arm64

# --- Node ---------------------------------------------------------------------
have_node() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]; }
if have_node; then
  echo "==> Using existing node $(node --version)"
else
  case "$OS-$ARCH" in
    Linux-x86_64)   NODE_PLAT="linux-x64" ;;
    Linux-aarch64)  NODE_PLAT="linux-arm64" ;;
    Darwin-arm64)   NODE_PLAT="darwin-arm64" ;;
    Darwin-x86_64)  NODE_PLAT="darwin-x64" ;;
    *) echo "Unsupported platform $OS-$ARCH. Install Node 18+ manually and re-run." ; exit 1 ;;
  esac
  echo "==> Installing Node $NODE_VER ($NODE_PLAT) into .tooling (userspace)"
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    mkdir -p "$ROOT/.tooling"
    curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-${NODE_PLAT}.tar.xz"
    tar -xf /tmp/node.tar.xz -C "$ROOT/.tooling"
    mv "$ROOT/.tooling/node-${NODE_VER}-${NODE_PLAT}" "$NODE_DIR"
    rm -f /tmp/node.tar.xz
  fi
  export PATH="$NODE_DIR/bin:$PATH"
fi
node --version

# --- Python backend -----------------------------------------------------------
echo "==> Creating Python venv + installing backend deps"
cd "$ROOT/backend"
if [ ! -x ".venv/bin/python" ]; then
  # Some minimal Linux pythons lack ensurepip; create without pip then bootstrap it.
  if python3 -m venv .venv 2>/dev/null && .venv/bin/python -m pip --version >/dev/null 2>&1; then
    :
  else
    rm -rf .venv
    python3 -m venv .venv --without-pip
    curl -fsSL -o /tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py
    .venv/bin/python /tmp/get-pip.py --quiet
  fi
fi

# torch wheels: Linux uses the CPU index; macOS uses the default PyPI wheel (incl. Apple MPS).
if [ "$OS" = "Linux" ]; then
  .venv/bin/python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu --quiet
else
  .venv/bin/python -m pip install torch==2.5.1 --quiet
fi
.venv/bin/python -m pip install -r requirements.txt --quiet

# --- Frontend -----------------------------------------------------------------
echo "==> Installing frontend deps"
cd "$ROOT/frontend"
npm install --no-fund --no-audit

echo "==> Done. Copy .env.example to .env, add keys, then run ./scripts/dev.sh"
