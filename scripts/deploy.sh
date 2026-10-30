#!/usr/bin/env bash
# Builds (make linux-ru) and deploys the Russian-locale Linux build to the
# ctrlroom server. The binary, the bundled element library, the user
# guides (backend/assets/USER_GUIDE*.md, shown by the Help button) and their
# pictures (backend/assets/images/) are
# uploaded under temporary *.new names while the sld-editor systemd service
# keeps running, then the service is stopped, the files are moved into
# place, the executable bit restored, and the service started again. The
# .xsde converter's assets/xsde2svg.yml and assets/workplace.xml are copied
# only when the server has none, so a site's own files are never replaced.
# A failed build or upload leaves the remote service untouched; a failure
# after the stop still tries to start the service.
#
# make linux-ru needs the sibling slddoc and EMA/xsde2svg checkouts (see
# README.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# HOST/SSH_KEY name this specific deployment target, so they live in
# scripts/.env (gitignored, not this script) rather than being hardcoded
# here — see scripts/.env.example for the expected shape. set -a exports
# everything .env defines so ${DEPLOY_HOST:?...} below can see it.
ENV_FILE="$REPO_ROOT/scripts/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

HOST="${DEPLOY_HOST:?set DEPLOY_HOST in scripts/.env (see scripts/.env.example) or the environment}"
SSH_KEY="${DEPLOY_SSH_KEY:?set DEPLOY_SSH_KEY in scripts/.env (see scripts/.env.example) or the environment}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/usr/lib/sld-editor}"
SERVICE="sld-editor"
BINARY="sld-editor-linux-ru"

ASSETS="$REPO_ROOT/backend/assets"
BINARY_PATH="$REPO_ROOT/build/$BINARY"

echo "==> make linux-ru"
(cd "$REPO_ROOT" && make linux-ru)

# Local file -> path under REMOTE_DIR, replaced on every deploy.
REPLACE=(
  "$BINARY_PATH" "$BINARY"
  "$ASSETS/elements/base.xml" "assets/elements/base.xml"
)
# Every translation of the guide too (USER_GUIDE.ru.md, ...): the backend
# serves the one matching the build's locale, falling back to USER_GUIDE.md.
for guide in "$ASSETS"/USER_GUIDE*.md; do
  REPLACE+=("$guide" "assets/$(basename "$guide")")
done
# The guides' pictures, every language's (x.png, x.ru.png, ...).
for image in "$ASSETS"/images/*; do
  if [ -f "$image" ]; then REPLACE+=("$image" "assets/images/$(basename "$image")"); fi
done
# Local file -> path under REMOTE_DIR, copied only when missing there.
IF_MISSING=(
  "$ASSETS/xsde2svg.yml" "assets/xsde2svg.yml"
  "$ASSETS/workplace.xml" "assets/workplace.xml"
)

for ((i = 0; i < ${#REPLACE[@]}; i += 2)); do
  [ -f "${REPLACE[i]}" ] || { echo "error: ${REPLACE[i]} not found" >&2; exit 1; }
done
for ((i = 0; i < ${#IF_MISSING[@]}; i += 2)); do
  [ -f "${IF_MISSING[i]}" ] || { echo "error: ${IF_MISSING[i]} not found" >&2; exit 1; }
done

ssh_cmd() { ssh -i "$SSH_KEY" "$HOST" "$@"; }
scp_cmd() { scp -i "$SSH_KEY" "$@"; }

echo "==> Preparing $REMOTE_DIR on $HOST"
ssh_cmd "mkdir -p '$REMOTE_DIR/assets/elements' '$REMOTE_DIR/assets/images'"

# Remote paths (under REMOTE_DIR) uploaded as <path>.new, moved into place
# while the service is stopped.
STAGED=()

echo "==> Uploading"
for ((i = 0; i < ${#REPLACE[@]}; i += 2)); do
  echo "    ${REPLACE[i + 1]}"
  scp_cmd "${REPLACE[i]}" "$HOST:$REMOTE_DIR/${REPLACE[i + 1]}.new"
  STAGED+=("${REPLACE[i + 1]}")
done
for ((i = 0; i < ${#IF_MISSING[@]}; i += 2)); do
  remote="${IF_MISSING[i + 1]}"
  if ssh_cmd "test -e '$REMOTE_DIR/$remote'"; then
    echo "    $remote (kept: already on the server)"
  else
    echo "    $remote (new)"
    scp_cmd "${IF_MISSING[i]}" "$HOST:$REMOTE_DIR/$remote.new"
    STAGED+=("$remote")
  fi
done

# Once the service is stopped, any failure still tries to start it again.
STOPPED=0
on_exit() {
  status=$?
  if [ "$STOPPED" = 1 ]; then
    echo "==> Failed after stopping $SERVICE; starting it again" >&2
    ssh_cmd "systemctl start $SERVICE" || echo "error: could not start $SERVICE on $HOST" >&2
  fi
  exit "$status"
}
trap on_exit EXIT

echo "==> Stopping $SERVICE on $HOST"
ssh_cmd "systemctl stop $SERVICE"
STOPPED=1

echo "==> Moving files into place"
install=""
for remote in "${STAGED[@]}"; do
  install+="mv -f '$REMOTE_DIR/$remote.new' '$REMOTE_DIR/$remote' && "
done
ssh_cmd "${install}chmod +x '$REMOTE_DIR/$BINARY'"

echo "==> Starting $SERVICE on $HOST"
ssh_cmd "systemctl start $SERVICE"
STOPPED=0

# The server's sld-editor.yaml is its own (never deployed): without an xsde
# section, .xsde import uses the converter's built-in settings and no
# workplace palette.
if ! ssh_cmd "grep -q '^xsde:' '$REMOTE_DIR/config/sld-editor.yaml'"; then
  cat >&2 <<'EOF'
warning: the server's config/sld-editor.yaml has no xsde: section, so .xsde
import ignores assets/xsde2svg.yml and assets/workplace.xml. Add:

xsde:
  config: "assets/xsde2svg.yml"
  workplace: "assets/workplace.xml"
EOF
fi

echo "==> Done."
