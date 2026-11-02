#!/bin/bash
# vs2: (a) two pods of one service, one DOWN -> rollup summary text and no notice; (b) an invalid CS_CLIENT_ID -> 400 permanent; (c) CS_INSECURE_SKIP_VERIFY=maybe accepted silently (finding)
. $(dirname $0)/lib.sh; T=vs2-roll
ENVMAIN="-e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=roll-app -e CS_INTERVAL=2s -e CS_HEARTBEAT=10s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=1m -e POD_NAMESPACE=vs2-ns"
docker rm -f vs2-roll1-sidecar vs2-roll1-app vs2-roll1 vs2-roll2-sidecar vs2-roll2-app vs2-roll2 vs2-cid >/dev/null 2>&1
for n in 1 2; do docker run -d --name vs2-roll$n -p 127.0.0.1:1938$((n+4)):9465 -p 127.0.0.1:1936$((n+1)):8080 $V $IMG /bin-ro/stub -mode hold >/dev/null; docker run -d --name vs2-roll$n-app --network container:vs2-roll$n fakeapp:ci >/dev/null; docker run -d --name vs2-roll$n-sidecar --network container:vs2-roll$n $SEC $ENVMAIN -e POD_NAME=roll-app-7f9c6d5b4-pod$n health-sidecar:vs2 >/dev/null; done
sleep 5; echo "[$(ts)] (a) two pods UP:"; mon $T; inst $T roll-app
echo "  pod2 app -> DOWN: $(curl -s -X POST 'http://127.0.0.1:19363/__set?status=DOWN&db=DOWN')"; sleep 12; echo "  12 s later:"; mon $T; inst $T roll-app; feed $T
echo "  pod1 app -> DOWN too: $(curl -s -X POST 'http://127.0.0.1:19362/__set?status=DOWN&db=DOWN')"; sleep 12; echo "  12 s later (0 of 2 UP):"; mon $T; feed $T
echo "  both UP again"; curl -s -X POST 'http://127.0.0.1:19362/__set?status=UP&db=UP' >/dev/null; curl -s -X POST 'http://127.0.0.1:19363/__set?status=UP&db=UP' >/dev/null; sleep 14; mon $T; feed $T
docker rm -f vs2-roll1-sidecar vs2-roll1-app vs2-roll1 vs2-roll2-sidecar vs2-roll2-app vs2-roll2 >/dev/null 2>&1
echo "[$(ts)] (b) F-27/F-92: CS_CLIENT_ID='bad id!' -> the service answers 400 -> logged as 'report rejected' (permanent), retried only at the heartbeat"
docker run -d --name vs2-cid -p 127.0.0.1:19387:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null; docker run -d --name vs2-cid-app --network container:vs2-cid fakeapp:ci >/dev/null
docker run -d --name vs2-cid-sidecar --network container:vs2-cid $SEC -e CS_ENDPOINT=$BEC -e CS_TENANT=vs2-cid -e CS_SERVICE=cid-app -e POD_NAME=cid-app-1 -e CS_CLIENT_ID='bad id!' -e CS_INTERVAL=2s health-sidecar:vs2 >/dev/null; sleep 5
echo "  $(st 19387)"; docker logs vs2-cid-sidecar 2>&1 | grep -E 'rejected' | head -1 | cut -c1-260
echo "  monitors under vs2-cid: $(curl -s -H 'X-Client-Id: vs2-verifier' "$BE/v1/health/monitors?tenantId=vs2-cid" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') (expect 0: nothing accepted)"
docker rm -f vs2-cid-sidecar vs2-cid-app vs2-cid >/dev/null 2>&1
echo "[$(ts)] (c) finding: CS_INSECURE_SKIP_VERIFY=maybe is not rejected (every other variable is validated); the sidecar starts with verification ON"
docker run -d --name vs2-cid -p 127.0.0.1:19387:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name vs2-cid-sidecar --network container:vs2-cid $SEC -e CS_ENDPOINT=https://127.0.0.1:1 -e CS_TENANT=vs2-cid -e CS_SERVICE=cid-app -e POD_NAME=cid-app-1 -e CS_INSECURE_SKIP_VERIFY=maybe -e CS_PORT=9465 -e CS_PATH=/healthz -e CS_INTERVAL=2s health-sidecar:vs2 >/dev/null; sleep 3
echo "  state=$(docker inspect vs2-cid-sidecar --format '{{.State.Status}} exit={{.State.ExitCode}}') first log line: $(docker logs vs2-cid-sidecar 2>&1 | head -1 | cut -c1-200)"
for v in TRUE yes 1 on; do docker rm -f vs2-cid-sidecar >/dev/null 2>&1; docker run -d --name vs2-cid-sidecar --network container:vs2-cid $SEC -e CS_ENDPOINT=https://127.0.0.1:1 -e CS_TENANT=vs2-cid -e CS_SERVICE=cid-app -e POD_NAME=cid-app-1 -e CS_INSECURE_SKIP_VERIFY=$v -e CS_PORT=9465 -e CS_PATH=/healthz -e CS_INTERVAL=2s health-sidecar:vs2 >/dev/null; sleep 1.5; printf "  CS_INSECURE_SKIP_VERIFY=%-5s -> state=%s exit=%s\n" $v $(docker inspect vs2-cid-sidecar --format '{{.State.Status}} {{.State.ExitCode}}'); done
docker rm -f vs2-cid-sidecar vs2-cid >/dev/null 2>&1; echo "[$(ts)] DONE"
