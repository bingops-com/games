#!/usr/bin/env bash
# A fresh local process per suite keeps production rate limits intact.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
: "${GAMES_DATABASE_URL:?Set GAMES_DATABASE_URL to an isolated development database}"
regression_port=${GAMES_E2E_PORT:-3789}
if [[ ! $regression_port =~ ^[0-9]+$ ]] || (( regression_port < 1024 || regression_port > 65535 )); then
  echo 'GAMES_E2E_PORT must be a local unprivileged port' >&2
  exit 1
fi
regression_tmp=$(mktemp -d)
regression_pid=''
stop_server() {
  if [[ -n $regression_pid ]]; then
    kill "$regression_pid" 2>/dev/null || true
    wait "$regression_pid" 2>/dev/null || true
    regression_pid=''
  fi
}
cleanup() { stop_server; rm -rf "$regression_tmp"; }
trap cleanup EXIT
go build -o "$regression_tmp/games" ./cmd/games
for suite in run accessibility; do
  GAMES_ADDR="127.0.0.1:$regression_port" "$regression_tmp/games" >"$regression_tmp/server.log" 2>&1 &
  regression_pid=$!
  regression_ready=false
  for attempt in {1..50}; do
    sleep 0.2
    if ! kill -0 "$regression_pid" 2>/dev/null; then break; fi
    if curl --silent --fail "http://127.0.0.1:$regression_port/healthz" >/dev/null; then regression_ready=true; break; fi
  done
  if [[ $regression_ready != true ]]; then
    echo 'The isolated Games test server did not become ready; check the test database and port' >&2
    exit 1
  fi
  (cd web && GAMES_URL="http://127.0.0.1:$regression_port" node "e2e/$suite.mjs" "$@")
  stop_server
done
