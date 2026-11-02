#!/bin/bash
# Pod D (sc1-var): flap damping, WARN passthrough, pinned targets, ignore-ports, grace messages, 254-char instance id.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
IMG=gcr.io/distroless/static-debian12:latest; V="-v $S/sidecar1/bin:/bin-ro:ro"; P=sc1-var; H='X-Client-Id: sc-verifier'; B=http://localhost:8080
ts(){ date -u +%H:%M:%S; }
status(){ curl -s --max-time 3 http://127.0.0.1:58465/status | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("lastReport") or {}; print("  /status: target=%s upSeen=%s last=%s msg=%r sendError=%r sent=%s" % (d.get("target"), d["upSeen"], r.get("status"), r.get("message",""), d.get("sendError","")[:120], d["reportsSent"]))' 2>/dev/null || echo "  /status unreachable"; }
reqs(){ curl -s http://127.0.0.1:58100/__requests | python3 -c 'import json,sys; rs=json.load(sys.stdin); print("  stub backend saw", len(rs), "reports:", [r["body"].get("status") for r in rs if isinstance(r["body"],dict)])'; }
resetstub(){ docker rm -f $P-backend >/dev/null 2>&1; docker run -d --name $P-backend --network container:$P $V $IMG /bin-ro/stub -mode backend -port 9100 -code 202 >/dev/null; sleep 1; }
SC="--network container:$P --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges -e CS_TENANT=sc-var -e CS_SERVICE=var-app -e POD_NAME=var-app-1 -e CS_IGNORE_PORTS=9100"
docker rm -f $P-sidecar $P-backend $P-app $P-warn $P >/dev/null 2>&1
docker run -d --name $P -p 127.0.0.1:58465:9465 -p 127.0.0.1:58080:9003 -p 127.0.0.1:58100:9100 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name $P-app --network container:$P $V $IMG /bin-ro/stub -mode actuator -port 9003 >/dev/null; resetstub
echo "[$(ts)] F-73 CASE 1: default CS_RETRY_DELAY=2s; app fails exactly ONE health request -> report stays UP (no DOWN sent)"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_HEARTBEAT=30s health-sidecar:sc1 >/dev/null; sleep 4; status
curl -s -X POST 'http://127.0.0.1:58080/__failnext?n=1' >/dev/null; sleep 8; status; reqs; docker logs $P-sidecar 2>&1 | grep -c '"status":"DOWN"' | sed 's/^/  DOWN lines in sidecar log: /'; docker rm -f $P-sidecar >/dev/null; resetstub
echo "[$(ts)] F-73 CASE 2: CS_RETRY_DELAY=0; app fails exactly one request -> DOWN is reported"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_HEARTBEAT=30s -e CS_RETRY_DELAY=0s health-sidecar:sc1 >/dev/null; sleep 4; status
curl -s -X POST 'http://127.0.0.1:58080/__failnext?n=1' >/dev/null; sleep 8; status; reqs; docker rm -f $P-sidecar >/dev/null; resetstub
echo "[$(ts)] F-71 CASE 3: pinned CS_PORT=9003 + CS_PATH=/ping (auto) -> http target http://127.0.0.1:9003/ping; '/ping' answers 200 'app' (root handler) -> UP"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_PORT=9003 -e CS_PATH=/ping health-sidecar:sc1 >/dev/null; sleep 4; status; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] F-71 CASE 4: CS_PROBE=tcp CS_PORT=9003 (CS_PATH ignored) -> tcp://127.0.0.1:9003 UP"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_PROBE=tcp -e CS_PORT=9003 -e CS_PATH=/ignored health-sidecar:sc1 >/dev/null; sleep 4; status; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] F-71 CASE 5: CS_PROBE=actuator CS_PORT=9003 -> http://127.0.0.1:9003/actuator/health"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_PROBE=actuator -e CS_PORT=9003 health-sidecar:sc1 >/dev/null; sleep 4; status; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] F-68 CASE 6: CS_IGNORE_PORTS=9100,9003 with CS_STARTUP_GRACE=6s -> UNKNOWN 'starting' then after grace UNKNOWN 'no health target found after 6s ... set CS_PORT and CS_PATH'"
docker run -d --name $P-sidecar $SC -e CS_IGNORE_PORTS=9100,9003 -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=6s health-sidecar:sc1 >/dev/null; sleep 3; status; sleep 7; status; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] F-72 CASE 7: pinned port that never answers UP (app set DOWN) with CS_STARTUP_GRACE=6s -> UNKNOWN 'waiting for first healthy answer', then after grace UNKNOWN 'never answered UP since start; check CS_PORT...'"
curl -s -X POST 'http://127.0.0.1:58080/__set?status=DOWN&db=DOWN' >/dev/null
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s -e CS_RETRY_DELAY=0s -e CS_PORT=9003 -e CS_STARTUP_GRACE=6s health-sidecar:sc1 >/dev/null; sleep 3; status; sleep 7; status
echo "[$(ts)]   then the app comes UP -> UP; then DOWN again -> DOWN is now reported (upSeen)"; curl -s -X POST 'http://127.0.0.1:58080/__set?status=UP&db=UP' >/dev/null; sleep 5; status; curl -s -X POST 'http://127.0.0.1:58080/__set?status=DOWN&db=DOWN' >/dev/null; sleep 5; status; docker rm -f $P-sidecar >/dev/null; curl -s -X POST 'http://127.0.0.1:58080/__set?status=UP&db=UP' >/dev/null
echo "[$(ts)] F-70 CASE 8: app says {status:WARN} (stub 'warn' on 9005) -> report status WARN -> REAL backend monitor lastStatus DEGRADED (tenant sc-warn)"
docker run -d --name $P-warn --network container:$P $V $IMG /bin-ro/stub -mode warn -port 9005 >/dev/null; sleep 1
docker run -d --name $P-sidecar $SC -e CS_TENANT=sc-warn -e CS_SERVICE=warn-app -e CS_IGNORE_PORTS=9100,9003 -e CS_ENDPOINT=http://172.17.0.1:8080 -e CS_INTERVAL=2s -e CS_RETRY_DELAY=0s health-sidecar:sc1 >/dev/null; sleep 6; status
curl -s -H "$H" "$B/v1/health/monitors?tenantId=sc-warn" | python3 -c 'import json,sys; [print("  real backend monitor:", m["service"], m["state"].get("lastStatus"), repr(m["state"].get("lastSummary"))) for m in json.load(sys.stdin)]'; docker rm -f $P-sidecar $P-warn >/dev/null
echo "[$(ts)] F-75 CASE 9: instance id of 253 chars accepted by the real backend; 254 chars -> 400 permanent 'report rejected' (tenant sc-len)"
ID253=$(python3 -c 'print("p"*253)'); ID254=$(python3 -c 'print("p"*254)')
docker run -d --name $P-sidecar $SC -e CS_TENANT=sc-len -e CS_SERVICE=len-app -e CS_INSTANCE_ID=$ID253 -e CS_ENDPOINT=http://172.17.0.1:8080 -e CS_INTERVAL=2s health-sidecar:sc1 >/dev/null; sleep 5; status; docker rm -f $P-sidecar >/dev/null
docker run -d --name $P-sidecar $SC -e CS_TENANT=sc-len -e CS_SERVICE=len-app -e CS_INSTANCE_ID=$ID254 -e CS_ENDPOINT=http://172.17.0.1:8080 -e CS_INTERVAL=2s health-sidecar:sc1 >/dev/null; sleep 5; status; docker logs $P-sidecar 2>&1 | grep -E "rejected" | head -1 | cut -c1-300; docker rm -f $P-sidecar >/dev/null
curl -s -H "$H" "$B/v1/health/monitors?tenantId=sc-len" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  sc-len monitors:", [(m["service"], m["state"].get("lastSummary")) for m in d])'
echo "[$(ts)] F-78 CASE 10: /healthz, /status, unknown path, wrong method"
docker run -d --name $P-sidecar $SC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_INTERVAL=2s health-sidecar:sc1 >/dev/null; sleep 3
for p in /healthz /status /nope; do printf "  GET %s -> " $p; curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:58465$p; done; printf "  POST /status -> "; curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:58465/status; printf "  /healthz body: "; curl -s http://127.0.0.1:58465/healthz
docker rm -f $P-sidecar $P-backend $P-app $P >/dev/null 2>&1; echo "[$(ts)] DONE"
