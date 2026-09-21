#!/usr/bin/env bash
# Builds (make linux-ru) and deploys the Russian-locale Linux build to the
# ctrlroom server: stops the sld-editor systemd service, copies the freshly
# built binary and the bundled element library, restores the executable
# bit scp doesn't preserve, then restarts the service. A failed build
# leaves the remote service untouched — set -e stops the script before any
# ssh/scp step runs.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@192.168.20.23}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_rsa_ctrlroom}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/usr/lib/sld-editor}"
SERVICE="sld-editor"
BINARY="sld-editor-linux-ru"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_XML="$REPO_ROOT/backend/assets/elements/base.xml"
BINARY_PATH="$REPO_ROOT/build/$BINARY"

echo "==> make linux-ru"
(cd "$REPO_ROOT" && make linux-ru)

if [ ! -f "$BINARY_PATH" ]; then
  echo "error: $BINARY_PATH not found after build" >&2
  exit 1
fi
if [ ! -f "$BASE_XML" ]; then
  echo "error: $BASE_XML not found" >&2
  exit 1
fi

ssh_cmd() { ssh -i "$SSH_KEY" "$HOST" "$@"; }
scp_cmd() { scp -i "$SSH_KEY" "$@"; }

echo "==> Stopping $SERVICE on $HOST"
ssh_cmd "systemctl stop $SERVICE"

echo "==> Copying base.xml"
scp_cmd "$BASE_XML" "$HOST:$REMOTE_DIR/assets/elements/base.xml"

echo "==> Copying $BINARY"
scp_cmd "$BINARY_PATH" "$HOST:$REMOTE_DIR/$BINARY"

echo "==> Restoring executable bit"
ssh_cmd "chmod +x $REMOTE_DIR/$BINARY"

echo "==> Starting $SERVICE on $HOST"
ssh_cmd "systemctl start $SERVICE"

echo "==> Done."
