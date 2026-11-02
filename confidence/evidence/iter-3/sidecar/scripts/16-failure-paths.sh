#!/bin/bash
# G-3-15 and the report client's failure paths (default timeouts unless named):
#  A  a slow service (stub :19340): 7 s answers accepted with the default 10 s CS_REPORT_TIMEOUT; 12 s answers cut at 10 s
#  B  a real service (private backend B :19302) whose database container vs3-mongo is stopped: its 503 in /status; started: recovery
#  B2 the same database paused (docker pause: open connections stop answering): what /status shows; the service's own answer times
#  C1 CS_REPORT_TIMEOUT=0s (accepted at start) against a service that never answers
#  C2 CS_PROBE_TIMEOUT=0s (accepted at start) against an app whose health endpoint never answers, beside the default 3s
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
trap 'docker unpause vs3-mongo >/dev/null 2>&1; docker start vs3-mongo >/dev/null 2>&1' EXIT
N="vs3-fp-pod vs3-fp-app vs3-fp-sc vs3-fpb-pod vs3-fpb-app vs3-fpb-sc vs3-fz-pod vs3-fz-app vs3-fz-sc vs3-fq-pod vs3-fq-app vs3-fq-sc vs3-fq3-sc"
cleanup $N
BEB=http://127.0.0.1:19302; BEBC=http://172.17.0.1:19302
slog(){ docker logs $1 2>&1 | jq -c 'select(.msg!=null and .msg!="health sidecar starting") | {t:.time[11:23],level,msg,status,error:((.error // "")|.[0:190]),in}' 2>/dev/null; }
stw(){ raw $1 | jq -c '{last:.lastReport.status, obs:((.lastReport.observedAt // "")[11:23]), tick:((.lastSendAt // "")[11:23]), n:.reportsSent, err:((.sendError // "")|.[0:210])}'; }
watchst(){ local prev="" i=0 s k; while [ $i -lt $2 ]; do s=$(stw $1); k=$(echo "$s" | jq -c '{tick,err}'); if [ "$k" != "$prev" ]; then echo "  [$(ts)] $s"; prev="$k"; fi; sleep 1; i=$((i+1)); done; }
direct(){ curl -s -o $W/work/direct.txt -w '%{http_code} in %{time_total}s' -H "$H" -H 'Content-Type: application/json' -d '{"tenantId":"vs3-fpb","service":"direct","status":"UP"}' $BEB/v1/health/reports; echo " body=$(head -c 120 $W/work/direct.txt)"; }
attempts(){ # $1 sidecar container, $2 stub control port: duration of each attempt = sidecar log time - the stub's arrival time
docker logs $1 > $W/work/att-$1.txt 2>&1; reqs $2 > $W/work/att-$1.json
python3 -I - $W/work/att-$1.txt $W/work/att-$1.json <<'PY'
import json,sys,datetime
def p(s):
    s=s.replace('Z','')
    if '.' in s: a,b=s.split('.'); s=a+'.'+b[:6].ljust(6,'0')
    return datetime.datetime.fromisoformat(s)
arr=[p(r['at']) for r in json.load(open(sys.argv[2]))]
for l in open(sys.argv[1]):
    try: j=json.loads(l)
    except Exception: continue
    if j.get('msg') in ('reported','report failed; will retry','report rejected'):
        t=p(j['time']); prev=[a for a in arr if a<=t]
        d=(t-prev[-1]).total_seconds() if prev else None
        print('  %s %-26s arrived %s  took %s  %s' % (j['time'][11:23], j['msg'], prev[-1].strftime('%H:%M:%S.%f')[:12] if prev else '-', ('%.2fs' % d) if d is not None else '-', (j.get('error') or '')[:110]))
PY
}
$W/bin/stub -mode backend -port 19340 -ctl 19341 > $W/work/stub-19340.txt 2>&1 & echo $! > $W/work/stub-19340.pid
$W/bin/stub -mode backend -port 19342 -ctl 19343 > $W/work/stub-19342.txt 2>&1 & echo $! > $W/work/stub-19342.pid
sleep 0.5
echo "start $(ts)"
echo "### PART A: a slow service (stub :19340), default CS_REPORT_TIMEOUT (10s); CS_INTERVAL=2s CS_HEARTBEAT=4s"
pod vs3-fp-pod -p 127.0.0.1:19380:9465; app vs3-fp-pod vs3-fp-app -mode actuator -port 8080; sleep 0.3
curl -s "127.0.0.1:19340/__delay?ms=7000" >/dev/null; echo "  [$(ts)] the service answers 202 after 7000 ms"
sidecar vs3-fp-pod vs3-fp-sc -e CS_ENDPOINT=http://172.17.0.1:19340 -e CS_TENANT=vs3-fp -e CS_SERVICE=slow -e POD_NAME=slow-0 -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug
sleep 18; echo "  [$(ts)] /status: $(stw 19380)"
curl -s "127.0.0.1:19340/__delay?ms=12000" >/dev/null; echo "  [$(ts)] the service answers 202 after 12000 ms"
sleep 32; echo "  [$(ts)] /status: $(stw 19380)"
curl -s "127.0.0.1:19340/__delay?ms=0" >/dev/null; echo "  [$(ts)] the service answers at once"
sleep 9; echo "  [$(ts)] /status: $(stw 19380)"
echo "  attempts (sidecar log line; when the request arrived at the service; how long the attempt took):"; attempts vs3-fp-sc 19341
cleanup vs3-fp-sc vs3-fp-app vs3-fp-pod
echo "### PART B: private backend B (:19302) on its own database container vs3-mongo (:19301); sidecar CS_INTERVAL=5s CS_HEARTBEAT=10s"
pod vs3-fpb-pod -p 127.0.0.1:19381:9465; app vs3-fpb-pod vs3-fpb-app -mode actuator -port 8080; sleep 0.3
sidecar vs3-fpb-pod vs3-fpb-sc -e CS_ENDPOINT=$BEBC -e CS_TENANT=vs3-fpb -e CS_SERVICE=dbdown -e POD_NAME=dbdown-0 -e CS_INTERVAL=5s -e CS_HEARTBEAT=10s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug
sleep 7; echo "  [$(ts)] /status: $(stw 19381)"
docker stop vs3-mongo >/dev/null; echo "  [$(ts)] docker stop vs3-mongo returned"
( echo "  [$(ts)] direct report to B (database stopped) -> $(direct)" > $W/work/direct-stop.txt ) &
watchst 19381 40
wait; cat $W/work/direct-stop.txt
docker start vs3-mongo >/dev/null; echo "  [$(ts)] docker start vs3-mongo returned"
watchst 19381 30
echo "### PART B2: the same database paused (docker pause vs3-mongo)"
for i in $(seq 1 30); do [ -z "$(raw 19381 | jq -r '.sendError // ""')" ] && break; sleep 1; done; echo "  [$(ts)] /status before: $(stw 19381)"
docker pause vs3-mongo >/dev/null; echo "  [$(ts)] docker pause vs3-mongo returned"
watchst 19381 60
docker unpause vs3-mongo >/dev/null; echo "  [$(ts)] docker unpause vs3-mongo returned"
watchst 19381 25
echo "  sidecar log (B and B2):"; slog vs3-fpb-sc | grep -v '"msg":"reported","status":"UP","error":""' ; echo "  (accepted UP reports in B/B2: $(slog vs3-fpb-sc | grep -c '"msg":"reported"'))"
docker stop vs3-fpb-sc >/dev/null; echo "  [$(ts)] sidecar stopped (SIGTERM): $(docker logs vs3-fpb-sc 2>&1 | tail -1 | jq -c '{msg,error}')"
sleep 2
echo "  direct reports with the database paused again (nothing else sending reports)"
docker pause vs3-mongo >/dev/null; echo "  [$(ts)] docker pause vs3-mongo returned"
for i in 1 2 3; do echo "  [$(ts)] direct report $i -> $(direct)"; done
docker unpause vs3-mongo >/dev/null; echo "  [$(ts)] docker unpause vs3-mongo returned"; sleep 3
echo "  [$(ts)] direct report after unpause -> $(direct)"
cleanup vs3-fpb-sc vs3-fpb-app vs3-fpb-pod
echo "### PART C1: CS_REPORT_TIMEOUT=0s (accepted at start) against a service that never answers (stub :19342, delay 600 s)"
curl -s "127.0.0.1:19342/__delay?ms=600000" >/dev/null
pod vs3-fz-pod -p 127.0.0.1:19382:9465 -p 127.0.0.1:19383:8080; app vs3-fz-pod vs3-fz-app -mode actuator -port 8080; sleep 0.3
sidecar vs3-fz-pod vs3-fz-sc -e CS_ENDPOINT=http://172.17.0.1:19342 -e CS_TENANT=vs3-fp -e CS_SERVICE=zero -e POD_NAME=zero-0 -e CS_REPORT_TIMEOUT=0s -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug
sleep 4; curl -s -XPOST "127.0.0.1:19383/__set?status=DOWN&db=DOWN" >/dev/null; echo "  [$(ts)] app DOWN"
sleep 20
echo "  [$(ts)] /healthz: $(curl -s -w ' (HTTP %{http_code})' 127.0.0.1:19382/healthz)"
echo "  [$(ts)] /status: $(stw 19382)"
echo "  requests the service received: $(reqs 19343 | jq -c '[.[] | {at:.at[11:23], status:.body.status}]')"
s=$(date +%s.%N); docker stop -t 15 vs3-fz-sc >/dev/null; echo "  docker stop (SIGTERM) returned after $(python3 -c "print(round($(date +%s.%N)-$s,2))") s, exit $(docker inspect -f '{{.State.ExitCode}}' vs3-fz-sc)"
echo "  sidecar log:"; slog vs3-fz-sc
cleanup vs3-fz-sc vs3-fz-app vs3-fz-pod
echo "### PART C2: CS_PROBE_TIMEOUT=0s (accepted at start), pinned to an app whose /actuator/health never answers; beside it the default 3s"
pod vs3-fq-pod -p 127.0.0.1:19384:9465 -p 127.0.0.1:19385:8080 -p 127.0.0.1:19386:9466
app vs3-fq-pod vs3-fq-app -mode backend -port 8080; sleep 0.3; curl -s "127.0.0.1:19385/__delay?ms=600000" >/dev/null
sidecar vs3-fq-pod vs3-fq-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=vs3-fp -e CS_SERVICE=hung0 -e POD_NAME=hung0-0 -e CS_PORT=8080 -e CS_PATH=/actuator/health -e CS_PROBE_TIMEOUT=0s -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug
sidecar vs3-fq-pod vs3-fq3-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=vs3-fp -e CS_SERVICE=hung3 -e POD_NAME=hung3-0 -e CS_PORT=8080 -e CS_PATH=/actuator/health -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug -e CS_LISTEN=:9466
sleep 25
echo "  [$(ts)] hung0 (CS_PROBE_TIMEOUT=0s): /healthz $(curl -s -w ' (HTTP %{http_code})' 127.0.0.1:19384/healthz); /status $(raw 19384 | jq -c '{target, lastReport:(.lastReport.status // null), reportsSent, sendError}')"
echo "  [$(ts)] hung3 (default 3s):         /status $(stw 19386)"
echo "  service view:"; mon vs3-fp | grep -E 'hung|zero|slow'
echo "  hung0 log:"; slog vs3-fq-sc; echo "  hung3 log (first 4):"; slog vs3-fq3-sc | head -4
cleanup $N; kill $(cat $W/work/stub-19340.pid) $(cat $W/work/stub-19342.pid)
echo "  vs3-mongo: $(docker inspect -f '{{.State.Status}}' vs3-mongo)"
echo "end $(ts)"
