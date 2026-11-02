#!/bin/bash
# v2: keep the silent share under the 30 % pause valve: six services keep reporting, one pod goes silent, one service scales to zero.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; H='X-Client-Id: sc-verifier'; B=http://localhost:18800; L=$S/sidecar/backend-18800.log
ts(){ date -u +%H:%M:%S; }
nohup java -jar $S/communication-service.jar --server.port=18800 --spring.data.mongodb.uri=mongodb://localhost:27017/sc_silent2 --communication.health.sweep-interval-ms=2000 --communication.health.stale-grace-after-start-ms=10000 > $L 2>&1 &
PID=$!; for i in $(seq 1 90); do sleep 1; grep -q "Netty started on port" $L && break; done; kill -0 $PID || { echo "backend did not start"; tail -3 $L; exit 1; }; echo "[$(ts)] private backend pid $PID on :18800 ($(grep -oE 'Netty started on port [0-9]+' $L))"
post(){ curl -s -o /dev/null -w "%{http_code}" -H "$H" -H 'Content-Type: application/json' -X POST $B/v1/health/reports -d "$1"; }
noise(){ for n in 1 2 3 4 5 6; do post "{\"tenantId\":\"sc-silent\",\"service\":\"noise-$n\",\"status\":\"UP\",\"instance\":{\"id\":\"noise-$n-pod\"}}" >/dev/null; done; }
noise; echo "  six noise services reporting (keeps silent share at 1/8 = 12.5 %)"
echo "  silent-1 UP -> $(post '{"tenantId":"sc-silent","service":"goes-silent","status":"UP","instance":{"id":"silent-1","node":"n1"}}')  (no further reports)"
for i in 1 2; do echo "  zero-$i UP -> $(post "{\"tenantId\":\"sc-silent\",\"service\":\"scaled-to-zero\",\"status\":\"UP\",\"instance\":{\"id\":\"zero-$i\"}}")"; done
for i in 1 2; do echo "  zero-$i leaving -> $(post "{\"tenantId\":\"sc-silent\",\"service\":\"scaled-to-zero\",\"status\":\"UP\",\"instance\":{\"id\":\"zero-$i\",\"leaving\":true}}")"; done
T0=$(date +%s)
show(){ curl -s -H "$H" "$B/v1/health/monitors?tenantId=sc-silent" | python3 -c 'import json,sys; [print("    monitor %-15s lastStatus=%-8s unhealthy=%s incidents=%s summary=%r" % (m["service"], m["state"].get("lastStatus"), m["state"].get("unhealthyStreak"), m["state"].get("incidents"), m["state"].get("lastSummary"))) for m in json.load(sys.stdin) if not m["service"].startswith("noise")]'; curl -s -H "$H" "$B/v1/feed?tenantId=sc-silent" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("    feed:", [(i["type"], i["severity"], i["title"], (i.get("body") or "")[:220]) for i in d["items"]] or "empty")'; }
for round in 1 2 3 4 5 6 7; do sleep 20; noise; echo "[$(ts)] +$(( $(date +%s)-T0 )) s:"; show; done
echo "[$(ts)] backend log lines about staleness/silence:"; grep -iE "stale|silent|pause|silence" $L | cut -c1-260 | tail -8
kill $PID 2>/dev/null; echo "[$(ts)] DONE"
