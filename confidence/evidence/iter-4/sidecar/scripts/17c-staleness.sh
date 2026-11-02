#!/bin/bash
# G-3-29 / README "The 30 s cap and CS_HEARTBEAT ...": a pod at the default cadence (15 s / 30 s) reaches private
# backend A (which keeps sweeping: stale grace 0, valve off) through a TCP proxy that is switched off twice, as a
# Route outage would: 22 s starting 25 s after an accepted report (just before the heartbeat), then 100 s.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
T=vs4-stale; SVC=stale-app
cleanup vs4-stl-pod vs4-stl-app vs4-stl-sc
$W/bin/stub -mode proxy -port 19306 -to 127.0.0.1:19300 -ctl 19307 > $W/work/proxy-19306.txt 2>&1 & echo $! > $W/work/proxy.pid
sleep 0.5
pod vs4-stl-pod -p 127.0.0.1:19308:9465; app vs4-stl-pod vs4-stl-app -mode actuator -port 8080; sleep 0.5
sidecar vs4-stl-pod vs4-stl-sc -e CS_ENDPOINT=http://172.17.0.1:19306 -e CS_TENANT=$T -e CS_SERVICE=$SVC -e POD_NAME=stale-app-7f9c6d5b4-x2k4q -e CS_LOG_LEVEL=debug
echo "start $(ts) (sidecar defaults: CS_INTERVAL 15s, CS_HEARTBEAT 30s; service: instance-stale-after-seconds 90, sweep 1 s)"
( while true; do s=$(curl -s --max-time 2 -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r '.[0] | "\(.state.lastStatus) | \(.state.lastSummary) | notice=\(.state.openCommunicationId // .state.incidentCommunicationId // "-")"' 2>/dev/null); echo "$(ts) $s"; sleep 1; done ) > $W/work/stale-watch.txt 2>&1 & WP=$!
accepted(){ docker logs vs4-stl-sc 2>&1 | jq -r 'select(.msg=="reported") | .time[11:23]'; }
wait_n(){ for i in $(seq 1 120); do [ $(accepted | wc -l) -ge $1 ] && break; sleep 0.5; done; }
secs(){ python3 -c "import datetime as d;a=d.datetime.strptime('$1','%H:%M:%S.%f');b=d.datetime.strptime('$2','%H:%M:%S.%f');print('%.1f'%((b-a).total_seconds()))"; }
wait_n 2; L=$(accepted | tail -1); echo "PHASE 1: last accepted report $L; the proxy goes down 25 s after it"
sleep $(python3 -c "import datetime as d;n=d.datetime.utcnow();l=d.datetime.strptime(n.strftime('%Y-%m-%d ')+'$L','%Y-%m-%d %H:%M:%S.%f');print(max(0,25-(n-l).total_seconds()))")
curl -s 127.0.0.1:19307/__down >/dev/null; D1=$(ts); echo "  $D1 proxy DOWN"
sleep 22; curl -s 127.0.0.1:19307/__up >/dev/null; U1=$(ts); echo "  $U1 proxy UP (outage 22 s)"
n=$(accepted | wc -l); wait_n $((n+1)); F1=$(accepted | tail -1)
echo "  first accepted report after the outage: $F1 ($(secs $U1 $F1) s after the proxy came back; silence since the last accepted one: $(secs $L $F1) s)"
sleep 40
n=$(accepted | wc -l); wait_n $((n+1)); L2=$(accepted | tail -1); echo "PHASE 2: last accepted report $L2; the proxy goes down 25 s after it, for 100 s"
sleep $(python3 -c "import datetime as d;n=d.datetime.utcnow();l=d.datetime.strptime(n.strftime('%Y-%m-%d ')+'$L2','%Y-%m-%d %H:%M:%S.%f');print(max(0,25-(n-l).total_seconds()))")
curl -s 127.0.0.1:19307/__down >/dev/null; D2=$(ts); echo "  $D2 proxy DOWN"
sleep 100; curl -s 127.0.0.1:19307/__up >/dev/null; U2=$(ts); echo "  $U2 proxy UP (outage 100 s)"
n=$(accepted | wc -l); wait_n $((n+1)); F2=$(accepted | tail -1)
echo "  first accepted report after the outage: $F2 ($(secs $U2 $F2) s after the proxy came back; silence since the last accepted one: $(secs $L2 $F2) s)"
sleep 45
kill $WP
echo "== accepted reports (sidecar 'reported' lines) and the attempts that failed"
docker logs vs4-stl-sc 2>&1 | jq -c 'select(.msg=="reported" or .msg=="report failed; will retry") | {t:.time[11:23],msg,in}' 
echo "== the service's view, each change of status/summary (sampled every second)"
awk '{ $1=$1; k=substr($0, index($0,$2)); if (k!=prev) print; prev=k }' $W/work/stale-watch.txt | cut -c1-230
echo "== G-4-25: INFO 'report delivered again' lines (status, failedAttempts, failingFor) and the INFO lines around them"; docker logs vs4-stl-sc 2>&1 | jq -c 'select(.level!="DEBUG") | {t:.time[11:23],level,msg,status,failedAttempts,failingFor,in}' | grep -A2 -B1 "delivered again"; echo "  count: $(docker logs vs4-stl-sc 2>&1 | grep -c '"msg":"report delivered again"')"
echo "== notices"; feed $T
cleanup vs4-stl-pod vs4-stl-app vs4-stl-sc; kill $(cat $W/work/proxy.pid)
echo "end $(ts)"
