#!/bin/bash
# vs2: probe ladder, rediscovery, send failures (500/400/409/202), heartbeat cadence while UP, SIGTERM, recorded wire contract
. $(dirname $0)/lib.sh; P=vs2-ladder
docker rm -f $P-sidecar $P-9001 $P-9002 $P-9003 $P-9004 $P-backend $P >/dev/null 2>&1
set -e
docker run -d --name $P -p 127.0.0.1:19370:9465 -p 127.0.0.1:19371:9100 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name $P-backend --network container:$P $V $IMG /bin-ro/stub -mode backend -port 9100 -code 202 >/dev/null
docker run -d --name $P-9001 --network container:$P $V $IMG /bin-ro/stub -mode plain404 -port 9001 >/dev/null
docker run -d --name $P-9002 --network container:$P $V $IMG /bin-ro/stub -mode healthz -port 9002 >/dev/null
docker run -d --name $P-9003 --network container:$P $V $IMG /bin-ro/stub -mode actuator -port 9003 >/dev/null
sleep 1
echo "[$(ts)] STEP 1 (F-68/F-69): ports 9001 (404 everywhere), 9002 (/healthz), 9003 (/actuator/health), backend stub 9100 (CS_IGNORE_PORTS=9100); start sidecar CS_INTERVAL=2s CS_HEARTBEAT=6s CS_RETRY_DELAY=1s"
docker run -d --name $P-sidecar --network container:$P $SEC \
  -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_TENANT=vs2-ladder -e CS_SERVICE=ladder-app -e CS_CLIENT_ID=vs2-ladder-repo \
  -e CS_INTERVAL=2s -e CS_HEARTBEAT=6s -e CS_RETRY_DELAY=1s -e CS_IGNORE_PORTS=9100 \
  -e POD_NAME=ladder-app-6d4f8b7c9-abcde -e POD_NAMESPACE=vs2-ns -e NODE_NAME=node-a -e CS_CLUSTER=sandbox -e CS_VERSION=2.3.4 \
  health-sidecar:vs2 >/dev/null
set +e
sleep 4; echo "[$(ts)] after start (expect target http://127.0.0.1:9003/actuator/health): $(st 19370)"
echo "[$(ts)] STEP 2 (F-77): stop 9003 -> rediscovery to 9002 /healthz"; docker stop -t 1 $P-9003 >/dev/null; sleep 9; echo "  $(st 19370)"
echo "[$(ts)] STEP 3: stop 9002 -> fallback to 9001 '/' (404 on root counts as UP)"; docker stop -t 1 $P-9002 >/dev/null; sleep 9; echo "  $(st 19370)"
echo "[$(ts)] STEP 4: stop 9001, raw TCP listener on 9004 -> tcp://127.0.0.1:9004"; docker stop -t 1 $P-9001 >/dev/null
docker run -d --name $P-9004 --network container:$P $V $IMG /bin-ro/stub -mode tcp -port 9004 >/dev/null; sleep 9; echo "  $(st 19370)"
echo "[$(ts)] STEP 5 (F-74): backend answers 500 -> backoff; 400 -> rejected (permanent); 409 -> retried; 202 -> clear"
N5=$(nreq 19371); curl -s -X POST 'http://127.0.0.1:19371/__code?c=500' >/dev/null; sleep 12; echo "  $(st 19370)"; echo "  requests during 12 s of 500s: $(( $(nreq 19371) - N5 ))"
echo "[$(ts)] now 400"; N5=$(nreq 19371); curl -s -X POST 'http://127.0.0.1:19371/__code?c=400' >/dev/null; sleep 12; echo "  $(st 19370)"; echo "  requests during 12 s of 400s: $(( $(nreq 19371) - N5 ))"
echo "  /status while the send error is set (for the README field check): $(raw 19370 | python3 -c 'import json,sys; print(sorted(json.load(sys.stdin).keys()))')"
echo "[$(ts)] now 409"; N5=$(nreq 19371); curl -s -X POST 'http://127.0.0.1:19371/__code?c=409' >/dev/null; sleep 12; echo "  $(st 19370)"; echo "  requests during 12 s of 409s: $(( $(nreq 19371) - N5 ))"
echo "[$(ts)] now 202"; curl -s -X POST 'http://127.0.0.1:19371/__code?c=202' >/dev/null; sleep 9; echo "  $(st 19370)"
echo "[$(ts)] STEP 6 (F-74 heartbeat while UP): nothing changing, CS_HEARTBEAT=6s: count requests over 24 s (expect 4)"
N0=$(nreq 19371); sleep 24; N1=$(nreq 19371); echo "  requests before=$N0 after=$N1 -> $((N1-N0)) in 24 s"
echo "[$(ts)] STEP 7 (F-76): docker stop sidecar (SIGTERM) -> final request with instance.leaving=true"
T0=$(date +%s.%N); docker stop -t 30 $P-sidecar >/dev/null; T1=$(date +%s.%N); echo "  stop took $(python3 -c "print(round($T1-$T0,2))") s; exit code: $(docker inspect $P-sidecar --format '{{.State.ExitCode}}')"
echo "[$(ts)] SIDECAR LOG:"; docker logs $P-sidecar 2>&1 | cut -c1-260
echo "[$(ts)] RECORDED REQUESTS (F-75/F-27 wire contract):"; reqs 19371 | python3 -c '
import json,sys
rs=json.load(sys.stdin); print("total", len(rs))
for r in rs:
    b=r["body"]; inst=b.get("instance",{}) if isinstance(b,dict) else {}
    print(r["at"][11:23], r["method"], r["path"], "status=",b.get("status") if isinstance(b,dict) else b, "msg=",(b.get("message","") if isinstance(b,dict) else "")[:60], "leaving=",inst.get("leaving"), "| X-Client-Id=",r["headers"].get("X-Client-Id"), "UA=",r["headers"].get("User-Agent"), "CT=",r["headers"].get("Content-Type"), "Accept=",r["headers"].get("Accept"))
print("FIRST BODY:", json.dumps(rs[0]["body"], sort_keys=True) if rs else None)
print("LAST BODY:", json.dumps(rs[-1]["body"], sort_keys=True) if rs else None)
hdr=set(); [hdr.update(r["headers"].keys()) for r in rs]; print("HEADER NAMES SEEN:", sorted(hdr))
'
docker rm -f $P-sidecar $P-9001 $P-9002 $P-9003 $P-9004 $P-backend $P >/dev/null 2>&1 || true; echo "[$(ts)] DONE"
