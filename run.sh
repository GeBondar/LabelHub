#!/usr/bin/env bash
# Launch LabelHub (Linux / macOS). Activates the venv from install.sh if present.
cd "$(dirname "$0")"
# shellcheck disable=SC1091
[ -f .venv/bin/activate ] && source .venv/bin/activate
export NODE_ENV=production
cd electron
[ -f dist/index.html ] || npm run build:web
exec ./node_modules/.bin/electron .
