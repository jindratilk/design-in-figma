#!/bin/bash
# Connect the bridge to a Figma file that is open in the user's own Chrome (macOS).
#
#   connect.sh <figma file url | new>
#
# It starts the local server, opens the file in a fresh tab, opens the JavaScript console
# and runs the loader line that starts scripts/bridge/agent.js in the tab. "new" opens a
# new draft. It needs Peekaboo (https://github.com/steipete/Peekaboo) with Accessibility permission to
# press the keys; without it the script prints the loader line for a person to paste.
#
# Environment: FIGMA_BRIDGE_DIR, FIGMA_BRIDGE_PORT, FIGMA_BRIDGE_CH (see run.sh),
#              FIGMA_BRIDGE_LOAD_WAIT (seconds to let the file load, default 10),
#              FIGMA_BRIDGE_KEEP_DEVTOOLS=1 to leave DevTools open.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${FIGMA_BRIDGE_DIR:-$PWD/.figma-bridge}"
PORT="${FIGMA_BRIDGE_PORT:-48765}"
CH="${FIGMA_BRIDGE_CH:-main}"
URL="${1:-}"
[ -n "$URL" ] || { sed -n 2,13p "$0"; exit 2; }
[ "$URL" = new ] && URL="https://www.figma.com/design/new"
mkdir -p "$DIR/out"
if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/agent.js"; then
  nohup python3 "$HERE/server.py" --port "$PORT" --dir "$DIR" >"$DIR/server.log" 2>&1 &
  sleep 1
fi
LOADER="window.__fb={port:$PORT,ch:'$CH'};fetch('http://127.0.0.1:$PORT/agent.js').then(r=>r.text()).then(t=>(0,eval)(t))"
rm -f "$DIR/out/hello-$CH.json"

wait_hello() {
  for _ in $(seq 1 $(( $1 * 2 ))); do
    [ -f "$DIR/out/hello-$CH.json" ] && { cat "$DIR/out/hello-$CH.json"; echo; return 0; }
    sleep 0.5
  done
  return 1
}

if [ "$(uname)" != Darwin ] || ! command -v peekaboo >/dev/null 2>&1; then
  echo "Open $URL in a browser that is logged in to Figma, open the JavaScript console and run:"
  echo
  echo "  $LOADER"
  echo
  echo "Waiting for the tab to answer (5 minutes)..."
  wait_hello 300 && exit 0
  echo "connect.sh: the tab did not answer." >&2; exit 1
fi

open -a "Google Chrome" "$URL"
sleep "${FIGMA_BRIDGE_LOAD_WAIT:-10}"
PID="$(pgrep -x "Google Chrome" | head -1)"
[ -n "$PID" ] || { echo "connect.sh: Google Chrome is not running" >&2; exit 1; }
peekaboo menu click --app "PID:$PID" --path "View > Developer > JavaScript Console" >/dev/null 2>&1 \
  || { echo "connect.sh: could not open the JavaScript console (Peekaboo needs Accessibility permission)" >&2; exit 1; }
sleep 2
peekaboo paste "$LOADER" --app "PID:$PID" --foreground >/dev/null 2>&1
sleep 0.6
peekaboo press Return --app "PID:$PID" --foreground >/dev/null 2>&1
if wait_hello 20; then
  [ -n "${FIGMA_BRIDGE_KEEP_DEVTOOLS:-}" ] || peekaboo press cmd+alt+i --app "PID:$PID" --foreground >/dev/null 2>&1
  exit 0
fi
cat >&2 <<MSG
connect.sh: the loader ran but the tab did not answer. Look at the Chrome window:
  - a prompt asking to let figma.com reach devices on the local network: allow it, then run connect.sh again
  - the console says to type "allow pasting": type it once, then run connect.sh again
  - DevTools opened with the device toolbar on: switch it off and reload, the mobile viewer has no plugin API
  - "figma is not defined" after the agent starts: you only have view access, or the file is still loading
MSG
exit 1
