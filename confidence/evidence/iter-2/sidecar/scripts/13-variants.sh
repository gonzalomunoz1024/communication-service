#!/bin/bash
# vs2: flap damping, pinned targets, ignore-ports + grace, pinned never-UP, WARN -> DEGRADED on the private backend, 253/254-char ids, own endpoints
. $(dirname $0)/lib.sh; P=vs2-var
status(){ st 19375; }
sreqs(){ reqs 19377 | python3 -c 'import json,sys; rs=json.load(sys.stdin); print("  stub backend saw", len(rs), "reports:", [r["body"].get("status") for r in rs if isinstance(r["body"],dict)])'; }
resetstub(){ docker rm -f $P-backend >/dev/null 2>&1; docker run -d --name $P-backend --network container:$P $V $IMG /bin-ro/stub -mode backend -port 9100 -code 202 >/dev/null; sleep 1; }
SC="--network container:$P $SEC -e CS_TENANT=vs2-var -e CS_SERVICE=var-app -e POD_NAME=var-app-1 -e CS_IGNORE_PORTS=9100"
docker rm -f $P-sidecar $P-backend $P-app $P-warn $P >/dev/null 2>&1
docker run -d --name $P -p 127.0.0.1:19375:9465 -p 127.0.0.1:19376:9003 -p 127.0.0.1:19377:9100 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name $P-app --network container:$P $V $IMG /bin-ro/stub -mode actuator -port 9003 >/dev/null; resetstub
echo "[$(ts)] F-73 CASE 1: default CS_RETRY_DELAY=2s; app fails exactly ONE health request -> stays UP (no DOWN sent)"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_HEARTBEAT=30s health-sidecar:vs2 >/dev/null; sleep 4; echo "  $(status)"
curl -s -X POST 'http://127.0.0.1:19376/__failnext?n=1' >/dev/null; sleep 8; echo "  $(status)"; sreqs; echo "  DOWN lines in sidecar log: $(docker logs $P-sidecar 2>&1 | grep -c '"status":"DOWN"')"; docker rm -f $P-sidecar >/dev/null; resetstub
echo "[$(ts)] F-73 CASE 2: CS_RETRY_DELAY=0; app fails exactly one request -> DOWN is reported"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_HEARTBEAT=30s -e CS_RETRY_DELAY=0s health-sidecar:vs2 >/dev/null; sleep 4; echo "  $(status)"
curl -s -X POST 'http://127.0.0.1:19376/__failnext?n=1' >/dev/null; sleep 8; echo "  $(status)"; sreqs; docker rm -f $P-sidecar >/dev/null; resetstub
echo "[$(ts)] F-71 CASE 3: CS_PORT=9003 + CS_PATH=/ping (auto) -> http://127.0.0.1:9003/ping; '/ping' answers 200 -> UP"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_PORT=9003 -e CS_PATH=/ping health-sidecar:vs2 >/dev/null; sleep 4; echo "  $(status)"; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] F-71 CASE 4: CS_PROBE=tcp CS_PORT=9003 (CS_PATH ignored) -> tcp://127.0.0.1:9003 UP"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_PROBE=tcp -e CS_PORT=9003 -e CS_PATH=/ignored health-sidecar:vs2 >/dev/null; sleep 4; echo "  $(status)"; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] F-71 CASE 5: CS_PROBE=actuator CS_PORT=9003 -> http://127.0.0.1:9003/actuator/health"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_PROBE=actuator -e CS_PORT=9003 health-sidecar:vs2 >/dev/null; sleep 4; echo "  $(status)"; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] F-71 CASE 5b: CS_PROBE=http CS_PORT=9003 (no path) -> http://127.0.0.1:9003/ ; CS_SCHEME=https on a plain port -> DOWN with a TLS error"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_PROBE=http -e CS_PORT=9003 health-sidecar:vs2 >/dev/null; sleep 4; echo "  $(status)"; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] F-68 CASE 6: CS_IGNORE_PORTS=9100,9003 with CS_STARTUP_GRACE=6s -> UNKNOWN 'starting' then 'no health target found after 6s ... set CS_PORT and CS_PATH'"
docker run -d --name $P-sidecar $SC -e CS_IGNORE_PORTS=9100,9003 -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=6s health-sidecar:vs2 >/dev/null; sleep 3; echo "  $(status)"; sleep 7; echo "  $(status)"; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] F-72 CASE 7: pinned port that never answers UP (app DOWN) with CS_STARTUP_GRACE=6s -> 'waiting for the first healthy answer', then 'never answered UP since start; check CS_PORT...'"
curl -s -X POST 'http://127.0.0.1:19376/__set?status=DOWN&db=DOWN' >/dev/null
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_RETRY_DELAY=0s -e CS_PORT=9003 -e CS_STARTUP_GRACE=6s health-sidecar:vs2 >/dev/null; sleep 3; echo "  $(status)"; sleep 7; echo "  $(status)"
echo "  then the app comes UP -> UP; then DOWN again -> DOWN now counts (upSeen)"; curl -s -X POST 'http://127.0.0.1:19376/__set?status=UP&db=UP' >/dev/null; sleep 5; echo "  $(status)"; curl -s -X POST 'http://127.0.0.1:19376/__set?status=DOWN&db=DOWN' >/dev/null; sleep 5; echo "  $(status)"; docker rm -f $P-sidecar >/dev/null; curl -s -X POST 'http://127.0.0.1:19376/__set?status=UP&db=UP' >/dev/null
echo "[$(ts)] F-70 CASE 8: app says {status:WARN} after having been UP -> report WARN -> PRIVATE backend monitor DEGRADED (tenant vs2-warn)"
docker run -d --name $P-sidecar $SC -e CS_TENANT=vs2-warn -e CS_SERVICE=warn-app -e CS_IGNORE_PORTS=9100 -e CS_ENDPOINT=$BEC -e CS_INTERVAL=2s -e CS_RETRY_DELAY=0s -e CS_STARTUP_GRACE=0s health-sidecar:vs2 >/dev/null; sleep 4; echo "  $(status)"
docker run -d --name $P-warn --network container:$P $V $IMG /bin-ro/stub -mode warn -port 9005 >/dev/null; docker stop -t 1 $P-app >/dev/null; sleep 8; echo "  $(status)"
curl -s -H 'X-Client-Id: vs2-verifier' "$BE/v1/health/monitors?tenantId=vs2-warn" | python3 -c 'import json,sys; [print("  private backend monitor:", m["service"], m["state"].get("lastStatus"), repr(m["state"].get("lastSummary"))) for m in json.load(sys.stdin)]'; docker rm -f $P-sidecar $P-warn >/dev/null; docker start $P-app >/dev/null; sleep 1
echo "[$(ts)] F-75 CASE 9: instance id of 253 chars accepted by the private backend; 254 chars -> 400 permanent 'report rejected' (tenant vs2-len)"
ID253=$(python3 -c 'print("p"*253)'); ID254=$(python3 -c 'print("p"*254)')
docker run -d --name $P-sidecar $SC -e CS_TENANT=vs2-len -e CS_SERVICE=len-app -e CS_INSTANCE_ID=$ID253 -e CS_ENDPOINT=$BEC -e CS_INTERVAL=2s health-sidecar:vs2 >/dev/null; sleep 5; echo "  $(status)"; docker rm -f $P-sidecar >/dev/null
docker run -d --name $P-sidecar $SC -e CS_TENANT=vs2-len -e CS_SERVICE=len-app -e CS_INSTANCE_ID=$ID254 -e CS_ENDPOINT=$BEC -e CS_INTERVAL=2s health-sidecar:vs2 >/dev/null; sleep 5; echo "  $(status)"; docker logs $P-sidecar 2>&1 | grep -E "rejected" | head -1 | cut -c1-300; docker rm -f $P-sidecar >/dev/null
curl -s -H 'X-Client-Id: vs2-verifier' "$BE/v1/health/monitors?tenantId=vs2-len" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  vs2-len monitors:", [(m["service"], m["state"].get("lastSummary")) for m in d])'
echo "[$(ts)] F-78 CASE 10: /healthz, /status, unknown path, wrong method, HEAD"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s health-sidecar:vs2 >/dev/null; sleep 3
for p in /healthz /status /nope /status/x; do printf "  GET %s -> " $p; curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:19375$p; done; printf "  POST /status -> "; curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:19375/status; printf "  POST /healthz -> "; curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:19375/healthz; printf "  /healthz body: "; curl -s http://127.0.0.1:19375/healthz
printf "  ReadHeaderTimeout: a client that sends nothing is closed after ~5 s: "; T0=$(date +%s.%N); (exec 3<>/dev/tcp/127.0.0.1/19375; printf 'GET /status HTTP/1.1\r\n' >&3; cat <&3 >/dev/null; exec 3<&-) 2>/dev/null; python3 -c "print(round($(date +%s.%N)-$T0,1), 's')"
docker rm -f $P-sidecar $P-backend $P-app $P >/dev/null 2>&1; echo "[$(ts)] DONE"
