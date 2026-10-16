#!/usr/bin/env bash
# Starts the Vite dev server, first freeing its port if something is already
# listening on it (typically a previous dev-server run left behind) — otherwise
# Vite silently falls back to the next free port instead of 5173.
#
# Usage: ./frontend.sh [locale]     (default: en)
# Env:   PORT   port to free before starting (default: 5173, see vite.config.ts)
#        LOCALE UI locale, en|ru (overridden by the first argument)

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-5173}"
LOCALE="${1:-${LOCALE:-en}}"

case "$LOCALE" in
  en|ru) ;;
  *) echo "Unsupported locale: ${LOCALE} (expected en or ru)" >&2; exit 1 ;;
esac

# Listening sockets only, so clients merely connected to the port (browser
# tabs) are never killed.
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

if [[ ! -d node_modules ]]; then
  echo "node_modules missing, running npm install ..."
  npm install
fi

echo "Starting frontend dev server (locale: ${LOCALE}) ..."
exec npm run "dev:${LOCALE}"
