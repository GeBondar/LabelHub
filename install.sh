#!/usr/bin/env bash
# ============================================================
#   LabelHub - one-time installer (Linux / macOS)
#   Creates a Python venv, installs backend + frontend deps,
#   and builds the web bundle. Run it once after cloning.
#   (Windows is the primary target; see install.cmd.)
# ============================================================
set -e
cd "$(dirname "$0")"

echo "=== LabelHub installation ==="
command -v python3 >/dev/null || { echo "[ERROR] Python 3.10+ is required."; exit 1; }
command -v node    >/dev/null || { echo "[ERROR] Node.js 18+ is required.";  exit 1; }

echo "[1/4] Creating Python virtual environment (.venv)..."
[ -d .venv ] || python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate

echo "[2/4] Installing backend dependencies (downloads PyTorch - this can take a while)..."
python -m pip install --upgrade pip
if ! pip install -r backend/requirements.txt; then
  echo "[ERROR] Backend dependency install failed."
  echo "        Check your internet connection and that build tools / Python"
  echo "        headers are available for packages that compile from source."
  exit 1
fi

echo "[3/4] Installing frontend dependencies..."
cd electron
npm install

echo "[4/4] Building the web bundle..."
npm run build:web
cd ..

echo
echo "=== Done!  Start the app with:  ./run.sh ==="
echo "Optional SAM2 click-to-segment: see the README."
