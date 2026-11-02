#!/bin/bash
# Pod B: probe ladder, rediscovery, send policy and wire contract against a recording backend stub.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
IMG=gcr.io/distroless/static-debian12:latest
V="-v $S/sidecar/bin:/bin-ro:ro"
P=sc-pod-ladder
ts(){ date -u +%H:%M:%S; }
status(){ curl -s --max-time 3 http://127.0.0.1:39465/status; echo; }
reqs(){ curl -s --max-time 3 http://127.0.0.1:39100/__requests; }
docker rm -f $P-sidecar $P-9001 $P-9002 $P-9003 $P-9004 $P-backend $P >/dev/null 2>&1
set -e
docker run -d --name $P -p 127.0.0.1:39465:9465 -p 127.0.0.1:39100:9100 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name $P-backend --network container:$P $V $IMG /bin-ro/stub -mode backend -port 9100 -code 202 >/dev/null
docker run -d --name $P-9001 --network container:$P $V $IMG /bin-ro/stub -mode plain404 -port 9001 >/dev/null
docker run -d --name $P-9002 --network container:$P $V $IMG /bin-ro/stub -mode healthz -port 9002 >/dev/null
docker run -d --name $P-9003 --network container:$P $V $IMG /bin-ro/stub -mode actuator -port 9003 >/dev/null
sleep 1
echo "[$(ts)] STEP 1: ports 9001 (404 everywhere), 9002 (/healthz), 9003 (/actuator/health), backend stub 9100 (ignored via CS_IGNORE_PORTS); start sidecar"
docker run -d --name $P-sidecar --network container:$P --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_TENANT=sc-ladder -e CS_SERVICE=ladder-app -e CS_CLIENT_ID=ladder-repo \
  -e CS_INTERVAL=2s -e CS_HEARTBEAT=6s -e CS_RETRY_DELAY=1s -e CS_IGNORE_PORTS=9100 \
  -e POD_NAME=ladder-app-6d4f8b7c9-abcde -e POD_NAMESPACE=sc-ns -e NODE_NAME=node-a -e CS_CLUSTER=sandbox -e CS_VERSION=2.3.4 \
  health-sidecar:verify >/dev/null
sleep 4
echo "[$(ts)] status after start (expect target http://127.0.0.1:9003/actuator/health):"; status
echo "[$(ts)] STEP 2: stop 9003 -> expect rediscovery to 9002 /healthz (http mode)"
docker stop -t 1 $P-9003 >/dev/null; sleep 9; status
echo "[$(ts)] STEP 3: stop 9002 -> expect fallback to 9001 '/' (404 counts as UP on root)"
docker stop -t 1 $P-9002 >/dev/null; sleep 9; status
echo "[$(ts)] STEP 4: stop 9001, start a raw TCP listener on 9004 -> expect tcp://127.0.0.1:9004"
docker stop -t 1 $P-9001 >/dev/null
docker run -d --name $P-9004 --network container:$P $V $IMG /bin-ro/stub -mode tcp -port 9004 >/dev/null
sleep 9; status
echo "[$(ts)] STEP 5: send policy: backend answers 500 -> backoff; then 400 -> rejected; then 409 -> retried; then 202"
curl -s -X POST 'http://127.0.0.1:39100/__code?c=500' >/dev/null; sleep 9; status
echo "[$(ts)] now 400"; curl -s -X POST 'http://127.0.0.1:39100/__code?c=400' >/dev/null; sleep 9; status
echo "[$(ts)] now 409"; curl -s -X POST 'http://127.0.0.1:39100/__code?c=409' >/dev/null; sleep 9; status
echo "[$(ts)] now 202"; curl -s -X POST 'http://127.0.0.1:39100/__code?c=202' >/dev/null; sleep 9; status
echo "[$(ts)] STEP 6: heartbeat cadence with nothing changing (CS_HEARTBEAT=6s): count requests over 20s"
N0=$(reqs | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'); sleep 20; N1=$(reqs | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'); echo "requests before=$N0 after=$N1 (expect ~3 in 20s)"
echo "[$(ts)] STEP 7: docker stop sidecar (SIGTERM) -> expect a final request with instance.leaving=true"
T0=$(date +%s.%N); docker stop -t 30 $P-sidecar >/dev/null; T1=$(date +%s.%N); echo "stop took $(python3 -c "print(round($T1-$T0,2))")s; exit code: $(docker inspect $P-sidecar --format '{{.State.ExitCode}}')"
echo "[$(ts)] SIDECAR LOG:"; docker logs $P-sidecar 2>&1
echo "[$(ts)] RECORDED REQUESTS (backend stub):"; reqs | python3 -c '
import json,sys
rs=json.load(sys.stdin)
print("total", len(rs))
for r in rs:
    b=r["body"]; inst=b.get("instance",{}) if isinstance(b,dict) else {}
    print(r["at"][11:23], r["method"], r["path"], "status=",b.get("status") if isinstance(b,dict) else b, "msg=",(b.get("message","") if isinstance(b,dict) else "")[:60], "leaving=",inst.get("leaving"), "| hdr X-Client-Id=",r["headers"].get("X-Client-Id"), "UA=",r["headers"].get("User-Agent"), "CT=",r["headers"].get("Content-Type"), "Accept=",r["headers"].get("Accept"))
print("FIRST BODY:", json.dumps(rs[0]["body"]) if rs else None)
print("LAST BODY:", json.dumps(rs[-1]["body"]) if rs else None)
'
docker rm -f $P-sidecar $P-9001 $P-9002 $P-9003 $P-9004 $P-backend $P >/dev/null 2>&1 || true
echo "[$(ts)] DONE"
