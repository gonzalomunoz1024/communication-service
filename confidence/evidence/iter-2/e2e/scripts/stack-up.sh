#!/usr/bin/env bash
# The E2E verifier's private stack: Mongo (container), backends A and B (java -jar), the production bundle served by
# `vite preview` with /v1 proxied to A, an emulated pod (netns holder + fake app + sidecar under restricted-v2-like
# flags) and a fake app the backend pull-probes. Nothing here touches the shared stack (:8080/:3000/:27017).
set -uo pipefail
source "$(dirname "$0")/env.sh"
cd "$REPO"
echo "## $(stamp) private stack up (head $(git rev-parse --short HEAD))"
docker run -d --name e2e2-mongo -p 127.0.0.1:$MONGO_PORT:27017 mongo:7.0 >/dev/null && echo "e2e2-mongo started"
until docker exec e2e2-mongo mongosh --quiet --eval "db.adminCommand('ping').ok" 2>/dev/null | grep -q 1; do sleep 1; done
echo "$(stamp) mongo answers ping"
"$S/scripts/start-backend.sh" A
"$S/scripts/start-backend.sh" B
wait_http "backend A readiness" http://127.0.0.1:$A_PORT/actuator/health/readiness '"UP"' 120
wait_http "backend B readiness" http://127.0.0.1:$B_PORT/actuator/health/readiness '"UP"' 120
( cd "$REPO/frontend" && COMM_BACKEND=http://127.0.0.1:$A_PORT nohup npm run preview -- --host 127.0.0.1 --port $UI_PORT --strictPort > "$OUT/vite-preview.txt" 2>&1 & echo $! > "$S/vite.pid" )
wait_http "vite preview (frontend/dist) -> A" http://127.0.0.1:$UI_PORT/ '<div id="root">' 60
echo "## $(stamp) building health-sidecar:e2e2 from sidecar/Dockerfile (GO_IMAGE/BASE_IMAGE substituted: UBI registry blocked)"
docker build -t health-sidecar:e2e2 --build-arg GO_IMAGE=local/go-toolset:1.25 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:latest \
  --build-arg VERSION=e2e2 --build-arg REVISION=$(git rev-parse --short HEAD) "$REPO/sidecar" > "$OUT/sidecar-image-build.txt" 2>&1
echo "sidecar image build exit=$? ($(docker inspect health-sidecar:e2e2 --format '{{.Id}}' | cut -c8-19), labels $(docker inspect health-sidecar:e2e2 --format '{{index .Config.Labels "org.opencontainers.image.version"}}/{{index .Config.Labels "org.opencontainers.image.revision"}}'))"
# the pod: a network-namespace holder with the host ports, the app and the sidecar joined to it
docker run -d --name e2e2-netns -p 127.0.0.1:$POD_APP_PORT:8080 -p 127.0.0.1:$POD_STATUS_PORT:9465 golang:1.24 sleep infinity >/dev/null && echo "e2e2-netns started"
docker run -d --name e2e2-app --network container:e2e2-netns fakeapp:e2e >/dev/null && echo "e2e2-app started (fakeapp:e2e)"
docker run -d --name e2e2-sidecar --network container:e2e2-netns \
  --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e CS_ENDPOINT=http://$GATEWAY:$A_PORT -e CS_TENANT=ve2 -e CS_SERVICE=ve2-app -e CS_CLIENT_ID=ve2-app-repo \
  -e CS_INTERVAL=3s -e CS_HEARTBEAT=10s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=30s \
  -e POD_NAME=ve2-app-6d4f8b7c9-ab12c -e POD_NAMESPACE=ve2-ns -e NODE_NAME=worker-7 -e CS_CLUSTER=sandbox -e CS_VERSION=2.1.0 \
  health-sidecar:e2e2 >/dev/null && echo "e2e2-sidecar started (health-sidecar:e2e2, uid 1000660000, read-only, cap-drop ALL, no-new-privileges)"
docker run -d --name e2e2-stub -p 127.0.0.1:$STUB_PORT:8080 fakeapp:e2e >/dev/null && echo "e2e2-stub started (pull-probe target)"
wait_http "fake app in the pod" http://127.0.0.1:$POD_APP_PORT/actuator/health '"UP"' 30
wait_http "sidecar reported" http://127.0.0.1:$POD_STATUS_PORT/status '"reportsSent":[1-9]' 60
wait_http "backend A sees monitor ve2/ve2-app UP" "http://127.0.0.1:$A_PORT/v1/health/monitors?tenantId=ve2" '"lastStatus":"UP"' 60
echo "## $(stamp) private stack up: A :$A_PORT B :$B_PORT UI :$UI_PORT pod app :$POD_APP_PORT status :$POD_STATUS_PORT stub :$STUB_PORT mongo :$MONGO_PORT"
docker ps --filter name=e2e2- --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
