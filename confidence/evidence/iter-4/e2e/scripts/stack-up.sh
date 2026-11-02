#!/usr/bin/env bash
# The E2E verifier's private stack: Mongo (container), backends A and B (java -jar), the production bundle served by
# `vite preview` with /v1 proxied to A, an emulated pod (netns holder + fake app + sidecar under restricted-v2-like
# flags) and a fake app the backend pull-probes. Nothing here touches the shared stack (:8080/:3000/:27017).
set -uo pipefail
source "$(dirname "$0")/env.sh"
cd "$REPO"
echo "## $(stamp) private stack up (head $(git rev-parse --short HEAD), jar $(md5sum $JAR | cut -c1-12))"
docker run -d --name e2e4-mongo -p 127.0.0.1:$MONGO_PORT:27017 mongo:7.0 >/dev/null && echo "e2e4-mongo started"
until docker exec e2e4-mongo mongosh --quiet --eval "db.adminCommand('ping').ok" 2>/dev/null | grep -q 1; do sleep 1; done
echo "$(stamp) mongo answers ping"
"$S/scripts/start-backend.sh" A
"$S/scripts/start-backend.sh" B
wait_http "backend A readiness" http://127.0.0.1:$A_PORT/actuator/health/readiness '"UP"' 120
wait_http "backend B readiness" http://127.0.0.1:$B_PORT/actuator/health/readiness '"UP"' 120
( cd "$REPO/frontend" && COMM_BACKEND=http://127.0.0.1:$A_PORT nohup npm run preview -- --host 127.0.0.1 --port $UI_PORT --strictPort > "$OUT/vite-preview.txt" 2>&1 & echo $! > "$S/vite.pid" )
wait_http "vite preview (frontend/dist) -> A" http://127.0.0.1:$UI_PORT/ '<div id="root">' 60
echo "## $(stamp) sidecar image health-sidecar:e2e4 (built beforehand from sidecar/Dockerfile, GO_IMAGE=local/go-toolset:1.27 BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot): $(docker inspect health-sidecar:e2e4 --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.version"}}/{{index .Config.Labels "org.opencontainers.image.revision"}} user={{.Config.User}}')"
# the pod: a network-namespace holder with the host ports, the app and the sidecar joined to it
docker run -d --name e2e4-netns -p 127.0.0.1:$POD_APP_PORT:8080 -p 127.0.0.1:$POD_STATUS_PORT:9465 golang:1.24 sleep infinity >/dev/null && echo "e2e4-netns started"
docker run -d --name e2e4-app --network container:e2e4-netns fakeapp:e2e >/dev/null && echo "e2e4-app started (fakeapp:e2e)"
docker run -d --name e2e4-sidecar --network container:e2e4-netns \
  --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e CS_ENDPOINT=http://$GATEWAY:$A_PORT -e CS_TENANT=ve4 -e CS_SERVICE=ve4-app -e CS_CLIENT_ID=ve4-app-repo \
  -e CS_INTERVAL=3s -e CS_HEARTBEAT=10s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=30s \
  -e POD_NAME=ve4-app-6d4f8b7c9-ab12c -e POD_NAMESPACE=ve4-ns -e NODE_NAME=worker-7 -e CS_CLUSTER=sandbox -e CS_VERSION=2.1.0 \
  health-sidecar:e2e4 >/dev/null && echo "e2e4-sidecar started (health-sidecar:e2e4, uid 1000660000, read-only, cap-drop ALL, no-new-privileges)"
docker run -d --name e2e4-stub -p 127.0.0.1:$STUB_PORT:8080 fakeapp:e2e >/dev/null && echo "e2e4-stub started (pull-probe target)"
wait_http "fake app in the pod" http://127.0.0.1:$POD_APP_PORT/actuator/health '"UP"' 30
wait_http "sidecar reported" http://127.0.0.1:$POD_STATUS_PORT/status '"reportsSent":[1-9]' 60
wait_http "backend A sees monitor ve4/ve4-app UP" "http://127.0.0.1:$A_PORT/v1/health/monitors?tenantId=ve4" '"lastStatus":"UP"' 60
echo "## $(stamp) private stack up: A :$A_PORT B :$B_PORT UI :$UI_PORT pod app :$POD_APP_PORT status :$POD_STATUS_PORT stub :$STUB_PORT mongo :$MONGO_PORT"
docker ps --filter name=e2e4- --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
