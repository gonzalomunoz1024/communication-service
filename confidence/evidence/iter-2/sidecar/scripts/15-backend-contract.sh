#!/bin/bash
# vs2: the report contract from the backend side (private backend :19300): client id, vocabulary, nested composite, status required, instances, parallel reports, silence rule
. $(dirname $0)/lib.sh; T=vs2-contract; H='X-Client-Id: vs2-contract-repo'; U=$BE/v1/health/reports
post(){ curl -s -o /tmp/vs2-body -w '%{http_code}' -H "$H" -H 'Content-Type: application/json' -X POST $U -d "$1"; echo -n " "; cut -c1-160 /tmp/vs2-body; echo; }
echo "== $(date -u +%FT%TZ) private backend $BE"
echo "[$(ts)] F-27: client id rules on POST /v1/health/reports"
printf "  no X-Client-Id -> "; curl -s -o /tmp/vs2-body -w '%{http_code} ' -H 'Content-Type: application/json' -X POST $U -d '{"tenantId":"'$T'","service":"cid","status":"UP"}'; cat /tmp/vs2-body; echo
printf "  X-Client-Id: 'bad id!' -> "; curl -s -o /tmp/vs2-body -w '%{http_code} ' -H 'X-Client-Id: bad id!' -H 'Content-Type: application/json' -X POST $U -d '{"tenantId":"'$T'","service":"cid","status":"UP"}'; cat /tmp/vs2-body; echo
printf "  OPTIONS without id -> "; curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS $U
printf "  /swagger-ui.html without id -> "; curl -s -o /dev/null -w '%{http_code}\n' $BE/swagger-ui.html
echo "[$(ts)] F-36: first report auto-registers a push-only monitor; status missing/blank -> 400; tenant/service missing -> 400"
printf "  UP -> "; post '{"tenantId":"'$T'","service":"svc-a","status":"UP","publisher":"health-sidecar","observedAt":"'$(date -u +%FT%T.000Z)'","instance":{"id":"svc-a-0"}}'
printf "  no status -> "; post '{"tenantId":"'$T'","service":"svc-a"}'
printf "  blank status -> "; post '{"tenantId":"'$T'","service":"svc-a","status":"  "}'
printf "  no tenant -> "; post '{"service":"svc-a","status":"UP"}'
printf "  no service -> "; post '{"tenantId":"'$T'","status":"UP"}'
echo "  monitor: $(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | python3 -c 'import json,sys; [print("  ", m["service"], "url=%s" % m.get("url"), "publisher=%s" % m.get("publisher"), m["state"].get("lastStatus"), repr(m["state"].get("lastSummary"))) for m in json.load(sys.stdin) if m["service"]=="svc-a"]')"
echo "[$(ts)] F-38/F-70: vocabulary words, each as its own service, then the monitor's lastStatus/lastSummary"
for w in UP OK HEALTHY DOWN OUT_OF_SERVICE FATAL UNHEALTHY UNKNOWN WARN DEGRADED PASS FOO; do printf "  %-15s -> " "$w"; post '{"tenantId":"'$T'","service":"voc-'$w'","status":"'$w'","instance":{"id":"voc-'$w'-0"}}'; done
printf "  nested composite (UP overall, db.primary DOWN, legacy details) -> "; post '{"tenantId":"'$T'","service":"voc-NESTED","status":"UP","components":{"db":{"status":"DOWN","components":{"primary":{"status":"DOWN","details":{"error":"connection refused to pg:5432"}},"replica":{"status":"UP"}}},"cache":{"status":"UP","details":{"redis":{"status":"DOWN"}}}},"instance":{"id":"voc-NESTED-0"}}'
sleep 1; curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | python3 -c '
import json,sys
for m in sorted(json.load(sys.stdin), key=lambda m: m["service"]):
    if m["service"].startswith("voc-"): print("   %-16s lastStatus=%-9s summary=%r" % (m["service"], m["state"].get("lastStatus"), (m["state"].get("lastSummary") or "")[:110]))'
echo "[$(ts)] F-46: per-instance records: two pods, then the same pod again -> still 2; unknown monitor -> 404"
for p in a b a; do printf "  pod %s -> " $p; post '{"tenantId":"'$T'","service":"inst-svc","status":"UP","instance":{"id":"inst-svc-'$p'","namespace":"ns","node":"n1","cluster":"c1","version":"1.0","sidecar":"vs2"}}'; sleep 0.3; done
MID=$(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | python3 $W/j.py monid inst-svc); echo "  monitor $MID instances:"; curl -s -H "$H" "$BE/v1/health/monitors/$MID/instances" | python3 $W/j.py inst
printf "  unknown monitor -> "; curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$BE/v1/health/monitors/does-not-exist/instances"
echo "[$(ts)] F-50: 3 rounds x 20 parallel instance reports for one service -> count 202 / 409 / other"
for round in 1 2 3; do codes=$(seq 1 20 | xargs -P 20 -I{} curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -H 'Content-Type: application/json' -X POST $U -d '{"tenantId":"'$T'","service":"par-svc","status":"UP","instance":{"id":"par-svc-{}"}}' | sort | uniq -c | tr '\n' ' '); echo "  round $round: $codes"; done
curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | python3 -c 'import json,sys; [print("  par-svc:", m["state"].get("lastStatus"), repr(m["state"].get("lastSummary")), "version=%s" % m.get("version")) for m in json.load(sys.stdin) if m["service"]=="par-svc"]'
MID=$(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | python3 $W/j.py monid par-svc); echo "  instances recorded: $(curl -s -H "$H" "$BE/v1/health/monitors/$MID/instances" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
echo "[$(ts)] F-48 silence rule: the two side pods of 10-lifecycle were SIGKILLed at $(date -u -d @$(cat $W/logs/silence-start.txt) +%FT%TZ) (no leaving report); instance-stale-after 90 s"
NOW=$(date -u +%s); START=$(cat $W/logs/silence-start.txt); WAIT=$((START+100-NOW)); [ $WAIT -gt 0 ] && { echo "  waiting ${WAIT}s for the window"; sleep $WAIT; }
echo "  tenant vs2-pod monitors $(( $(date -u +%s) - START )) s after the kill:"; mon vs2-pod; feed vs2-pod
echo "  (vs2-app left cleanly with SIGTERM in STEP E: scaled to zero, must not be stale)"
echo "[$(ts)] DONE"
