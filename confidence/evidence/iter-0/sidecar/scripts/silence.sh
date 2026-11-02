#!/bin/bash
# Private backend instance (own DB) with a short start-up grace so the 90 s instance staleness rule can be observed:
# pod goes silent -> DOWN naming it; pods that leave cleanly -> scaled to zero, never stale.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
H='X-Client-Id: sc-verifier'; B=http://localhost:18790
ts(){ date -u +%H:%M:%S; }
nohup java -jar $S/communication-service.jar --server.port=18790 --spring.data.mongodb.uri=mongodb://localhost:27017/sc_silent --communication.health.sweep-interval-ms=2000 --communication.health.stale-grace-after-start-ms=10000 > $S/sidecar/backend-18790.log 2>&1 &
echo $! > $S/sidecar/backend-18790.pid
for i in $(seq 1 90); do sleep 1; grep -q "Netty started on port" $S/sidecar/backend-18790.log && break; done; kill -0 $(cat $S/sidecar/backend-18790.pid) || { echo "private backend did not start:"; tail -5 $S/sidecar/backend-18790.log; exit 1; }; grep -E "Netty started|Started" $S/sidecar/backend-18790.log | cut -c1-120; echo "[$(ts)] private backend (pid $(cat $S/sidecar/backend-18790.pid)) up on :18790 (sweep 2 s, stale grace after start 10 s, instance staleness default 90 s)"
post(){ curl -s -o /dev/null -w "%{http_code}" -H "$H" -H 'Content-Type: application/json' -X POST $B/v1/health/reports -d "$1"; }
echo "  silent-1 UP -> $(post '{"tenantId":"sc-silent","service":"goes-silent","status":"UP","instance":{"id":"silent-1","node":"n1"}}')  (no further reports)"
for i in 1 2; do echo "  zero-$i UP -> $(post "{\"tenantId\":\"sc-silent\",\"service\":\"scaled-to-zero\",\"status\":\"UP\",\"instance\":{\"id\":\"zero-$i\"}}")"; done
for i in 1 2; do echo "  zero-$i leaving -> $(post "{\"tenantId\":\"sc-silent\",\"service\":\"scaled-to-zero\",\"status\":\"UP\",\"instance\":{\"id\":\"zero-$i\",\"leaving\":true}}")"; done
echo "  partial: two pods UP, one of them then goes silent (the other keeps reporting every 20 s) -> expect DEGRADED or DOWN? (minHealthyPercent 50: 1 of 2 live... the silent one is not live after 90 s, so UP 1 of 1)"
echo "  part-a UP -> $(post '{"tenantId":"sc-silent","service":"partial","status":"UP","instance":{"id":"part-a"}}')  part-b UP -> $(post '{"tenantId":"sc-silent","service":"partial","status":"UP","instance":{"id":"part-b"}}')"
T0=$(date +%s)
show(){ curl -s -H "$H" "$B/v1/health/monitors?tenantId=sc-silent" | python3 -c 'import json,sys; [print("    monitor %-15s lastStatus=%-8s unhealthy=%s incidents=%s summary=%r" % (m["service"], m["state"].get("lastStatus"), m["state"].get("unhealthyStreak"), m["state"].get("incidents"), m["state"].get("lastSummary"))) for m in json.load(sys.stdin)]'; curl -s -H "$H" "$B/v1/feed?tenantId=sc-silent" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("    feed:", [(i["type"], i["severity"], i["title"], (i.get("body") or "")[:200]) for i in d["items"]] or "empty")'; }
for round in 1 2 3 4 5 6 7; do sleep 20; post '{"tenantId":"sc-silent","service":"partial","status":"UP","instance":{"id":"part-a"}}' >/dev/null; echo "[$(ts)] +$(( $(date +%s)-T0 )) s:"; show; done
echo "[$(ts)] backend log lines about staleness:"; grep -iE "stale|silent|pause" $S/sidecar/backend-18790.log | cut -c1-260 | tail -8
kill $(cat $S/sidecar/backend-18790.pid) 2>/dev/null; echo "[$(ts)] DONE"
