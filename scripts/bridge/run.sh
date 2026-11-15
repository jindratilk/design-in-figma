#!/bin/bash
# Run JavaScript inside the connected Figma file and print the result as JSON.
#
#   run.sh <script.js | recipe name> [timeout_s] [json args]
#
# The script is the body of an async function: use `await`, `return` a JSON-serialisable
# value, read arguments from `args`. Recipes live in scripts/figma/ (ping, build, arrange,
# export, comments, fonts, reconnect).
#
# Environment: FIGMA_BRIDGE_DIR (work directory, default ./.figma-bridge),
#              FIGMA_BRIDGE_PORT (default 48765), FIGMA_BRIDGE_CH (channel, default main),
#              FIGMA_BRIDGE_FILE (a Figma file key: the script refuses to run in a tab
#              that has another file open, so a command can never land in the wrong file).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${FIGMA_BRIDGE_DIR:-$PWD/.figma-bridge}"
PORT="${FIGMA_BRIDGE_PORT:-48765}"
CH="${FIGMA_BRIDGE_CH:-main}"
[ $# -ge 1 ] || { sed -n 2,12p "$0"; exit 2; }
SRC="$1"
[ -f "$SRC" ] || SRC="$HERE/../figma/${1%.js}.js"
[ -f "$SRC" ] || { echo "run.sh: no such script or recipe: $1" >&2; exit 2; }
TIMEOUT="${2:-60}"
ARGS="${3:-}"
[ -n "$ARGS" ] || ARGS='{}'
mkdir -p "$DIR/out"
if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/agent.js"; then
  FIGMA_BRIDGE_DIR="$DIR" nohup python3 "$HERE/server.py" --port "$PORT" --dir "$DIR" >"$DIR/server.log" 2>&1 &
  sleep 1
fi
id="id:$(date +%s)-$$-$RANDOM"
rm -f "$DIR/out/result-$CH.json"
GUARD=""
[ -z "${FIGMA_BRIDGE_FILE:-}" ] || GUARD="if (!location.pathname.includes('/${FIGMA_BRIDGE_FILE}')) throw new Error('bridge: this tab has another file open (' + location.pathname + '), expected ${FIGMA_BRIDGE_FILE}');"
{ echo "// $id"; echo "const args = $ARGS;$GUARD"; cat "$SRC"; } > "$DIR/cmd-$CH.tmp" && mv "$DIR/cmd-$CH.tmp" "$DIR/cmd-$CH.js"
for _ in $(seq 1 $(( TIMEOUT * 10 ))); do
  if [ -f "$DIR/out/result-$CH.json" ] && grep -q "$id" "$DIR/out/result-$CH.json"; then
    cat "$DIR/out/result-$CH.json"; echo
    grep -q '"ok":true' "$DIR/out/result-$CH.json"; exit $?
  fi
  sleep 0.1
done
echo "run.sh: no answer in ${TIMEOUT}s. Is the tab open and the agent started (connect.sh)? A busy tab needs a longer timeout." >&2
exit 124
