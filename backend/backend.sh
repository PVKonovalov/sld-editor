#!/usr/bin/env bash
# Starts the sld-editor backend, first freeing its HTTP port if something is
# already listening on it (typically a previous backend run left behind).
#
# Usage: ./backend.sh [config]      (default: config/sld-editor.yaml)
# Env:   PORT   port to free before starting (default: 8080)
#        CONFIG config file (overridden by the first argument)

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8099}"
CONFIG="${1:-${CONFIG:-config/sld-editor.yaml}}"

# Listening sockets only, so clients merely connected to the port (browsers,
# the vite dev-server proxy) are never killed.
listeners() {
  lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true
}

pids="$(listeners)"
if [[ -n "$pids" ]]; then
  echo "Port ${PORT} is in use by:"
  lsof -i "tcp:${PORT}" -sTCP:LISTEN
  echo "Sending SIGTERM to: ${pids//$'\n'/ }"
  kill "$pids" 2>/dev/null || true

  for _ in {1..10}; do
    [[ -z "$(listeners)" ]] && break
    sleep 0.5
  done

  pids="$(listeners)"
  if [[ -n "$pids" ]]; then
    echo "Still listening after 5s, sending SIGKILL to: ${pids//$'\n'/ }"
    kill -9 "$pids" 2>/dev/null || true
    sleep 0.5
  fi

  if [[ -n "$(listeners)" ]]; then
    echo "Failed to free port ${PORT}" >&2
    exit 1
  fi
  echo "Port ${PORT} is free."
fi

echo "Starting backend with ${CONFIG} ..."
exec go run ./cmd/sld-editor --config "$CONFIG"

