#!/usr/bin/env bash
# Ryza Chat desktop launcher (Linux).
#
#   ./run.sh                     start the app
#   ./run.sh --shot out.png      boot, capture the window, quit
#
# Linux notes for this machine:
#   * --no-sandbox is required because chrome-sandbox ships with mode 755
#     instead of setuid root (4755). Fixing it properly needs sudo:
#       sudo chown root:root node_modules/electron/dist/chrome-sandbox
#       sudo chmod 4755      node_modules/electron/dist/chrome-sandbox
#     Until then the shell runs unsandboxed.
#   * npm 12 blocks electron's postinstall, so node_modules/electron/dist
#     can be missing. This script repairs it from the cached zip.
#   * Installing deps needs the registry from package-lock.json, otherwise
#     npm 12 fails with EALLOWREMOTE:
#       npm install --registry=https://registry.npmmirror.com
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON="$HERE/node_modules/electron"
BIN="$ELECTRON/dist/electron"

if [[ ! -f "$ELECTRON/cli.js" ]]; then
  echo "Dependencies missing. Run:"
  echo "  cd $HERE && npm install --registry=https://registry.npmmirror.com"
  exit 1
fi

# Repair the Electron binary if npm's postinstall never ran.
if [[ ! -x "$BIN" ]]; then
  echo "[run.sh] Electron binary missing, looking for a cached zip..."
  ZIP="$(find "$HOME/.cache/electron" -name 'electron-v33.2.0-linux-x64.zip' 2>/dev/null | head -1)"
  if [[ -z "$ZIP" ]]; then
    echo "[run.sh] No cached zip. Run:"
    echo "  cd $ELECTRON && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js"
    exit 1
  fi
  echo "[run.sh] Extracting from $ZIP"
  rm -rf "$ELECTRON/dist"
  mkdir -p "$ELECTRON/dist"
  unzip -q "$ZIP" -d "$ELECTRON/dist"
  printf 'electron' > "$ELECTRON/path.txt"   # no trailing newline on purpose
  echo "[run.sh] Repaired (electron $(cat "$ELECTRON/dist/version"))."
fi

SHOT_ARGS=()
if [[ "${1:-}" == "--shot" ]]; then
  SHOT_ARGS=(env "RYZA_SHOT=${2:?usage: run.sh --shot <out.png>}")
fi

cd "$HERE"
exec "${SHOT_ARGS[@]}" "$BIN" . --no-sandbox
