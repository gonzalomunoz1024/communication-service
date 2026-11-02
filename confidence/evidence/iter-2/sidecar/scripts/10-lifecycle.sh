#!/bin/bash
# vs2 pod lifecycle against the private backend :19300 (db vs2_main): discovery, UP, DOWN document, app stops listening (G-2-16 first message),
# recovery, sidecar SIGKILL/restart, second pod rollup (F-91), SIGTERM leaving, never-UP and pinned side pods, log shape; CS_INTERVAL=3s CS_HEARTBEAT=30s
. $(dirname $0)/lib.sh
T=vs2-pod
ENVMAIN="-e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=vs2-app -e CS_CLIENT_ID=vs2-app-repo -e CS_INTERVAL=3s -e CS_HEARTBEAT=30s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=2m -e POD_NAMESPACE=vs2-ns -e NODE_NAME=node-a -e CS_CLUSTER=sandbox -e CS_VERSION=1.4.2"
docker rm -f vs2-sidecar vs2-app vs2-pod vs2-sidecar2 vs2-app2 vs2-pod2 vs2-nou-sidecar vs2-nou vs2-pin-sidecar vs2-pin >/dev/null 2>&1
echo "== vs2 pod lifecycle $(date -u +%FT%TZ) | image health-sidecar:vs2 version=$(docker inspect health-sidecar:vs2 --format '{{index .Config.Labels "org.opencontainers.image.version"}}') revision=$(docker inspect health-sidecar:vs2 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') | fakeapp:ci | backend readiness=$(curl -s --max-time 3 $BE/actuator/health/readiness)"
echo "tenant $T before:"; mon $T; feed $T
set -e
docker run -d --name vs2-pod -p 127.0.0.1:19365:9465 -p 127.0.0.1:19360:8080 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name vs2-app --network container:vs2-pod fakeapp:ci >/dev/null
docker run -d --name vs2-sidecar --network container:vs2-pod $SEC $ENVMAIN -e POD_NAME=vs2-app-5d8c7b6f9-k2n4p health-sidecar:vs2 >/dev/null
docker run -d --name vs2-nou -p 127.0.0.1:19366:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name vs2-nou-sidecar --network container:vs2-nou $SEC -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=vs2-never-up -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=20s -e POD_NAME=vs2-never-up-0 -e POD_NAMESPACE=vs2-ns health-sidecar:vs2 >/dev/null
docker run -d --name vs2-pin -p 127.0.0.1:19367:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name vs2-pin-sidecar --network container:vs2-pin $SEC -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=vs2-pinned -e CS_PORT=9999 -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=20s -e POD_NAME=vs2-pinned-0 -e POD_NAMESPACE=vs2-ns health-sidecar:vs2 >/dev/null
set +e
echo; echo "[$(ts)] STEP A (F-68/F-69/F-36/F-46/F-75): pod vs2-pod = netns holder + fakeapp:ci + sidecar ($SEC); side pods vs2-nou (no app) and vs2-pin (CS_PORT=9999)"
for i in 1 2 3 4 5 6; do sleep 1; echo "  +${i}s $(st 19365)"; done
echo "  healthz=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' http://127.0.0.1:19365/healthz) body=$(curl -s http://127.0.0.1:19365/healthz | tr -d '\n')"
echo "  raw /status keys: $(raw 19365 | python3 -c 'import json,sys; print(sorted(json.load(sys.stdin).keys()))')"
echo "  raw /status: $(raw 19365 | $J raw 700)"
echo "  backend:"; mon $T; inst $T vs2-app; feed $T

echo; echo "[$(ts)] STEP A2 (F-74 send policy, real backend): reportsSent over 30 s while UP (expect the one heartbeat at most)"
N0=$(raw 19365 | python3 -c 'import json,sys; print(json.load(sys.stdin)["reportsSent"])'); sleep 30; N1=$(raw 19365 | python3 -c 'import json,sys; print(json.load(sys.stdin)["reportsSent"])'); echo "  reportsSent $N0 -> $N1 in 30 s while UP (+$((N1-N0)))"

echo; echo "[$(ts)] STEP B0 (F-70/F-38/F-75): the app answers DOWN with db DOWN (POST /__set on the app's published port)"
echo "  __set -> $(curl -s -X POST 'http://127.0.0.1:19360/__set?status=DOWN&db=DOWN')"
TB=$(date +%s); prev=""; for i in $(seq 1 30); do sleep 1; cur="$(st 19365) feed=$(fc $T)"; [ "$cur" != "$prev" ] && echo "  +${i}s $cur"; prev=$cur; echo "$cur" | grep -q 'feed=[1-9]' && break; done
mon $T; inst $T vs2-app; feed $T; NID=$(feedid $T); echo "  notice id: $NID"
echo "  notice body: $(curl -s -H 'X-Client-Id: vs2-verifier' $BE/v1/communications/$NID | $J raw 600)"
echo "  reports while DOWN: counting reportsSent over 30 s (expect one per probe, ~4-5 s apart at 3s + jitter + 1s retry)"
N0=$(raw 19365 | python3 -c 'import json,sys; print(json.load(sys.stdin)["reportsSent"])'); sleep 30; N1=$(raw 19365 | python3 -c 'import json,sys; print(json.load(sys.stdin)["reportsSent"])'); echo "  reportsSent $N0 -> $N1 in 30 s while DOWN (+$((N1-N0)))"
echo "  __set -> $(curl -s -X POST 'http://127.0.0.1:19360/__set?status=UP&db=UP')"
prev=""; for i in $(seq 1 50); do sleep 1; cur="$(st 19365) feed=$(fc $T)"; [ "$cur" != "$prev" ] && echo "  +${i}s $cur"; prev=$cur; echo "$cur" | grep -q 'status=UP .*feed=0' && break; done
mon $T; echo "  notice $NID now: $(curl -s -o /dev/null -w '%{http_code} ' -H 'X-Client-Id: vs2-verifier' $BE/v1/communications/$NID)$(curl -s -H 'X-Client-Id: vs2-verifier' $BE/v1/communications/$NID | $J raw 300)"

echo; echo "[$(ts)] STEP B (G-2-16/F-88): docker stop -t 1 vs2-app -> the app stops listening while the netns and the sidecar stay; poll /status every 0.5 s for the FIRST DOWN report"
LOGMARK=$(date -u +%FT%T.%NZ); docker stop -t 1 vs2-app >/dev/null; TSTOP=$(date +%s.%N); echo "  [$(ts)] app container $(docker inspect vs2-app --format '{{.State.Status}} exit={{.State.ExitCode}}')"
prev=""; FD=""; FO=""; for i in $(seq 1 90); do sleep 0.5; cur="$(st 19365) feed=$(fc $T)"; [ "$cur" != "$prev" ] && echo "  +$(python3 -c "print(round($(date +%s.%N)-$TSTOP,1))")s $cur"; prev=$cur; [ -z "$FD" ] && echo "$cur" | grep -q 'status=DOWN' && FD=$(python3 -c "print(round($(date +%s.%N)-$TSTOP,1))"); echo "$cur" | grep -q 'feed=[1-9]' && { FO=$(python3 -c "print(round($(date +%s.%N)-$TSTOP,1))"); break; }; done
echo "  [$(ts)] first DOWN in /status after ${FD:-never} s, OUTAGE in the feed after ${FO:-never} s"
mon $T; inst $T vs2-app; feed $T; NID2=$(feedid $T)
echo "  sidecar log since the stop (every line, default level):"; docker logs --since "$LOGMARK" vs2-sidecar 2>&1 | cut -c1-330
echo "  waiting 20 s more while the app is dead: new log lines at the default level (expect none: repeats are DEBUG)"; LOGMARK2=$(date -u +%FT%T.%NZ); N0=$(raw 19365 | python3 -c 'import json,sys; print(json.load(sys.stdin)["reportsSent"])'); sleep 20; N1=$(raw 19365 | python3 -c 'import json,sys; print(json.load(sys.stdin)["reportsSent"])'); echo "  reportsSent +$((N1-N0)) in 20 s; log lines: $(docker logs --since "$LOGMARK2" vs2-sidecar 2>&1 | wc -l)"; docker logs --since "$LOGMARK2" vs2-sidecar 2>&1 | cut -c1-200

echo; echo "[$(ts)] STEP C (F-77/F-88): docker start vs2-app -> expect UP, target back, notice retired after the second UP observation (heartbeat 30 s)"
LOGMARK=$(date -u +%FT%T.%NZ); docker start vs2-app >/dev/null; TSTART=$(date +%s.%N)
prev=""; FU=""; FR=""; for i in $(seq 1 60); do sleep 1; cur="$(st 19365) feed=$(fc $T)"; [ "$cur" != "$prev" ] && echo "  +${i}s $cur"; prev=$cur; [ -z "$FU" ] && echo "$cur" | grep -q 'status=UP' && FU=$i; [ -n "$FU" ] && echo "$cur" | grep -q 'feed=0' && { FR=$i; break; }; done
echo "  [$(ts)] UP after ${FU:-never} s, feed empty after ${FR:-never} s"; mon $T; inst $T vs2-app; feed $T
echo "  notice $NID2 now: $(curl -s -o /dev/null -w '%{http_code} ' -H 'X-Client-Id: vs2-verifier' $BE/v1/communications/$NID2)$(curl -s -H 'X-Client-Id: vs2-verifier' $BE/v1/communications/$NID2 | $J raw 300)"
echo "  sidecar log since the start:"; docker logs --since "$LOGMARK" vs2-sidecar 2>&1 | cut -c1-250

echo; echo "[$(ts)] STEP D (F-88): SIGKILL the sidecar, start the same container again -> same instance id, no notice"
docker kill -s KILL vs2-sidecar >/dev/null; sleep 1; echo "  after SIGKILL: $(docker inspect vs2-sidecar --format '{{.State.Status}} exit={{.State.ExitCode}}')"; docker start vs2-sidecar >/dev/null
for i in 2 4 6; do sleep 2; echo "  +${i}s $(st 19365)"; done; mon $T; inst $T vs2-app; feed $T

echo; echo "[$(ts)] STEP G (F-91 rollup): a second pod of the same service; then its app DOWN -> '1 of 2 pods UP' stays UP (min-healthy 50 %), no notice"
docker run -d --name vs2-pod2 -p 127.0.0.1:19368:9465 -p 127.0.0.1:19361:8080 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name vs2-app2 --network container:vs2-pod2 fakeapp:ci >/dev/null
docker run -d --name vs2-sidecar2 --network container:vs2-pod2 $SEC $ENVMAIN -e POD_NAME=vs2-app-5d8c7b6f9-zz9qq health-sidecar:vs2 >/dev/null
sleep 5; echo "  pod2: $(st 19368)"; mon $T; inst $T vs2-app
echo "  pod2 app -> DOWN: $(curl -s -X POST 'http://127.0.0.1:19361/__set?status=DOWN&db=DOWN')"
prev=""; for i in $(seq 1 20); do sleep 1; cur="pod2 $(st 19368) | feed=$(fc $T)"; [ "$cur" != "$prev" ] && echo "  +${i}s $cur"; prev=$cur; done
mon $T; inst $T vs2-app; feed $T
echo "  pod2 app -> UP: $(curl -s -X POST 'http://127.0.0.1:19361/__set?status=UP&db=UP')"; sleep 8; mon $T
echo "  SIGTERM pod2's sidecar (docker stop -t 30) -> leaving, back to 1 of 1"; T0=$(date +%s.%N); docker stop -t 30 vs2-sidecar2 >/dev/null; T1=$(date +%s.%N); echo "  stop took $(python3 -c "print(round($T1-$T0,2))") s exit=$(docker inspect vs2-sidecar2 --format '{{.State.ExitCode}}')"; sleep 3; mon $T; inst $T vs2-app
docker rm -f vs2-sidecar2 vs2-app2 vs2-pod2 >/dev/null 2>&1

echo; echo "[$(ts)] STEP E (F-76/F-48): docker stop -t 30 vs2-sidecar (SIGTERM) -> leaving report, prompt exit"
T0=$(date +%s.%N); docker stop -t 30 vs2-sidecar >/dev/null; T1=$(date +%s.%N); echo "  stop took $(python3 -c "print(round($T1-$T0,2))") s, exit code $(docker inspect vs2-sidecar --format '{{.State.ExitCode}}')"
sleep 1; echo "  backend 1 s later:"; mon $T; inst $T vs2-app; feed $T; sleep 5; echo "  backend 6 s later:"; mon $T
echo "  sidecar log tail:"; docker logs --tail 3 vs2-sidecar 2>&1 | cut -c1-330

echo; echo "[$(ts)] STEP F (F-72): the two startup rules after a 20 s grace (side pods started with STEP A)"
echo "  never-UP pod (no app): $(st 19366)"; docker logs --tail 2 vs2-nou-sidecar 2>&1 | cut -c1-300
echo "  pinned CS_PORT=9999 never answering: $(st 19367)"; docker logs --tail 2 vs2-pin-sidecar 2>&1 | cut -c1-300
echo "  reports sent by the never-UP sidecar so far (UNKNOWN is sent every probe): $(raw 19366 | python3 -c 'import json,sys; print(json.load(sys.stdin)["reportsSent"])')"
echo "  backend monitors for the tenant now:"; mon $T; feed $T

echo; echo "[$(ts)] STEP H (F-89): sidecar log shape (both runs of vs2-sidecar)"
docker logs vs2-sidecar > $W/logs/vs2-sidecar.log 2>&1; logshape $W/logs/vs2-sidecar.log
echo "  INFO 'reported' lines (the transitions):"; grep '"msg":"reported"' $W/logs/vs2-sidecar.log | cut -c1-220
echo "  first 3 lines:"; head -3 $W/logs/vs2-sidecar.log | cut -c1-330
echo "  secret-looking strings in the log: $(grep -ciE 'password|secret|token|authorization' $W/logs/vs2-sidecar.log)"
echo; echo "[$(ts)] STEP S (F-48 silence): SIGKILL the two side-pod sidecars (no leaving report) at $(date -u +%FT%TZ); 15-backend-contract reads the tenant after the 90 s window"
docker kill -s KILL vs2-nou-sidecar vs2-pin-sidecar >/dev/null; date -u +%s > $W/logs/silence-start.txt
docker rm -f vs2-sidecar vs2-app vs2-pod vs2-nou-sidecar vs2-nou vs2-pin-sidecar vs2-pin >/dev/null 2>&1
echo "[$(ts)] DONE, containers removed"
