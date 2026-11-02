#!/usr/bin/env bash
# The e2e stack (docker-compose.yml) with the waits the suite relies on.
#
#   ./stack.sh up                      build the images, start everything, wait until the pod reports UP
#   ./stack.sh down                    remove the containers, the network and the volumes
#   ./stack.sh restart-backend         restart the backend container and wait for its readiness probe
#   ./stack.sh app-set <status> <db>   flip the fake app's health: app-set DOWN DOWN, app-set UP UP
#   ./stack.sh logs                    every container's log (what CI prints when the suite fails)
#
# Needs docker compose v2, curl and node. GO_IMAGE / BASE_IMAGE in the environment override the images
# the sidecar is built from (docker-compose.yml); E2E_WAIT_SECONDS (default 150) bounds every wait.
set -euo pipefail
cd "$(dirname "$0")"

BACKEND=http://127.0.0.1:28080
APP=http://127.0.0.1:28090
SIDECAR=http://127.0.0.1:28091
TIMEOUT=${E2E_WAIT_SECONDS:-150}

compose() { docker compose -f docker-compose.yml "$@"; }
log() { printf '%s stack: %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { log "$*" >&2; exit 1; }
usage() { sed -n '2,9p' "$0" >&2; exit 2; }

# wait_for <what> <command...>: polls once a second until the command succeeds, for at most TIMEOUT seconds
wait_for() {
  local what=$1 start=$SECONDS
  shift
  until "$@" >/dev/null 2>&1; do
    if (( SECONDS - start >= TIMEOUT )); then
      compose ps >&2 || true
      fail "gave up after ${TIMEOUT}s waiting until $what"
    fi
    sleep 1
  done
  log "$what ($((SECONDS - start)) s)"
}

# json <url> <JavaScript predicate over the parsed body>: succeeds when the answer is 2xx and the predicate holds
json() {
  node -e '
    const [url, predicate] = process.argv.slice(1)
    fetch(url, { headers: { "X-Client-Id": "e2e-suite" }, signal: AbortSignal.timeout(5000) })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body) => process.exit(new Function("body", "return (" + predicate + ")")(body) ? 0 : 1))
      .catch(() => process.exit(1))' "$1" "$2"
}

backend_ready() { json "$BACKEND/actuator/health/readiness" 'body.status === "UP"'; }
app_up() { json "$APP/actuator/health" 'body.status === "UP"'; }
sidecar_reported() { json "$SIDECAR/status" 'body.reportsSent >= 1 && !body.sendError'; }
pod_up() { json "$BACKEND/v1/health/monitors?tenantId=e2e" 'body.some((m) => m.service === "fakeapp" && m.state.lastStatus === "UP")'; }

up() {
  ls ../build/libs/communication-service-*.jar >/dev/null 2>&1 \
    || fail "no jar under build/libs: run ./gradlew bootJar at the repository root first"
  [ -f ../frontend/dist/index.html ] \
    || fail "no frontend/dist: run npm ci && npm run build in frontend/ first (the suite serves that bundle)"
  compose build
  # the backend first, so the sidecar's first report is accepted instead of entering its send backoff
  compose up -d --no-build backend
  wait_for "the backend is ready" backend_ready
  compose up -d --no-build sidecar
  wait_for "the fake app answers UP" app_up
  wait_for "the sidecar has reported" sidecar_reported
  wait_for "the backend sees the pod UP (monitor e2e/fakeapp)" pod_up
  log "up: backend $BACKEND, fake app $APP, sidecar status $SIDECAR"
}

restart_backend() {
  compose restart -t 15 backend
  wait_for "the backend is ready again" backend_ready
}

app_set() {
  [ $# -eq 2 ] || usage
  curl -fsS -X POST "$APP/__set?status=$1&db=$2"
}

case "${1:-}" in
  up) up ;;
  down) compose down -v --remove-orphans ;;
  restart-backend) restart_backend ;;
  app-set) shift; app_set "$@" ;;
  logs) compose logs --no-color --timestamps ;;
  *) usage ;;
esac
