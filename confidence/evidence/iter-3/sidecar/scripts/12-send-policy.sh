#!/bin/bash
# G-3-16 / G-3-18 / G-3-30 / G-2-16 / F-74: cadence per kind of report, against private backend A, CS_INTERVAL=3s
# CS_HEARTBEAT=30s CS_RETRY_DELAY=1s CS_LOG_LEVEL=debug (every accepted send is a 'reported' line). For each case
# the reports accepted in a 60 s window are counted from the sidecar log, and the service's classification of the
# same report is read from its monitor: every probe must go with DOWN/DEGRADED there, the heartbeat with UP/UNKNOWN.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
T=vs3-pol
declare -A DOC=(
 [up]='{"status":"UP","components":{"db":{"status":"UP"}}}'
 [down]='{"status":"DOWN","components":{"db":{"status":"DOWN"}}}'
 [warn]='{"status":"WARN"}'
 [comp-down]='{"status":"UP","components":{"db":{"status":"DOWN"},"ping":{"status":"UP"}}}'
 [comp-warn]='{"status":"UP","components":{"cache":{"status":"WARN"}}}'
 [comp-nested]='{"status":"UP","components":{"db":{"status":"UP","components":{"primary":{"status":"UP"},"replica":{"status":"DOWN"}}}}}'
 [comp-unknown]='{"status":"UP","components":{"discovery":{"status":"UNKNOWN"},"ping":{"status":"UP"}}}'
 [comp-pass]='{"status":"UP","components":{"a":{"status":"pass"},"b":{"status":"SERVING"},"c":{"status":"green"},"d":{"status":"ok"},"e":{"status":"Healthy"}}}'
 [comp-fail]='{"status":"UP","components":{"a":{"status":"fail"}}}'
 [comp-notserving]='{"status":"UP","components":{"a":{"status":"NOT_SERVING"},"b":{"status":"red"}}}'
 [comp-error]='{"status":"UP","components":{"a":{"status":"error"},"b":{"status":"Failed"}}}'
 [overall-pass]='{"status":"pass","components":{"a":{"status":"PASS"}}}'
)
CASES="up down warn comp-down comp-warn comp-nested comp-unknown comp-pass comp-fail comp-notserving comp-error overall-pass never-up pinned-never-up"
names=""; i=0
for c in $CASES; do
  n=pol$i; names="$names vs3-$n-pod vs3-$n-app vs3-$n-sc"; i=$((i+1))
done
cleanup $names
i=0
for c in $CASES; do
  n=pol$i; port=$((19340+i)); i=$((i+1))
  pod vs3-$n-pod -p 127.0.0.1:$port:9465
  [ "$c" != never-up ] && app vs3-$n-pod vs3-$n-app -mode actuator -port 8080
done
sleep 1
# the app documents are set BEFORE the sidecars start (through the app's control endpoint, from inside the pod's
# network namespace), so a never-UP app never answers UP
i=0
for c in $CASES; do
  n=pol$i; i=$((i+1)); d="${DOC[$c]}"
  [ "$c" = pinned-never-up ] && d='{"status":"DOWN"}'
  [ -z "$d" ] && continue
  pid=$(docker inspect -f '{{.State.Pid}}' vs3-$n-pod)
  code=200; case "$d" in *'"status":"DOWN"'*) code=503;; esac
  nsenter -t $pid -n curl -s -XPOST "http://127.0.0.1:8080/__doc?code=$code" --data-binary "$d" >/dev/null
done
i=0
for c in $CASES; do
  n=pol$i; i=$((i+1))
  case $c in
    never-up) EXTRA="-e CS_STARTUP_GRACE=10s" ;;
    pinned-never-up) EXTRA="-e CS_PORT=8080 -e CS_PROBE=actuator -e CS_STARTUP_GRACE=0s" ;;
    *) EXTRA="-e CS_STARTUP_GRACE=0s" ;;
  esac
  sidecar vs3-$n-pod vs3-$n-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=$c -e POD_NAME=$c-7f9c6d5b4-x2k4q -e CS_INTERVAL=3s -e CS_HEARTBEAT=30s -e CS_RETRY_DELAY=1s -e CS_LOG_LEVEL=debug $EXTRA
done
START=$(date -u +%FT%T.%3NZ); echo "sidecars started at $START (documents set before); window = the 60 s from +6 s"
sleep 66
END=$(date -u +%FT%T.%3NZ)
printf '%-16s %-58s %-9s %-9s %-7s %s\n' case "document" "sent/60s" "every?" "level" "service: lastStatus | summary"
i=0
for c in $CASES; do
  n=pol$i; i=$((i+1))
  docker logs vs3-$n-sc > $W/work/$n.log 2>&1
  cnt=$(python3 -I -c "
import json,sys,datetime
import re
def f(x):
    m=re.match(r'(\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d)(?:\\.(\\d+))?', x)
    return datetime.datetime.strptime(m.group(1), '%Y-%m-%dT%H:%M:%S') + datetime.timedelta(microseconds=int((m.group(2) or '0')[:6].ljust(6,'0')))
s=f('$START')+datetime.timedelta(seconds=6); e=s+datetime.timedelta(seconds=60)
n=0
for l in open('$W/work/$n.log'):
    try: d=json.loads(l)
    except Exception: continue
    if d.get('msg')=='reported' and s<=f(d['time'])<e: n+=1
print(n)")
  lv=$(jq -r 'select(.msg=="reported") | .level' $W/work/$n.log | sort | uniq -c | tr -s ' ' | tr '\n' ' ')
  every=$([ $cnt -ge 8 ] && echo every-probe || echo heartbeat)
  svc=$(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r --arg s $c '.[] | select(.service==$s) | "\(.state.lastStatus) | \(.state.lastSummary)"')
  d="${DOC[$c]}"; [ "$c" = never-up ] && d="(nothing listens; grace 10s)"; [ "$c" = pinned-never-up ] && d='(CS_PORT=8080 pinned, app answers DOWN)'
  printf '%-16s %-58s %-9s %-11s %s\n' $c "$(echo $d | cut -c1-58)" "$cnt" "$every" "$svc"
done
echo
echo "== messages of the UNKNOWN cases (G-3-18): every accepted send, with its time"
for k in 12 13; do echo " pol$k:"; jq -c 'select(.msg=="reported") | {t:.time[11:23],level,status,message}' $W/work/pol$k.log | head -8; done
echo "== the service's notices for this tenant"; feed $T
echo "== the instance view of a nested-component case (what the service stored)"; inst $T comp-nested
cleanup $names
echo "end $(ts)"
