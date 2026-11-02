#!/bin/bash
# 16: failure paths of the report path (G-3-15, G-4-23, G-4-25, F-92):
#  A  a slow service (stub :19340): 7 s answers accepted with the default 10 s CS_REPORT_TIMEOUT; 12 s answers cut at 10 s
#  B  a real service (private backend B :19302) whose database container vs4-mongo is STOPPED: what a report gets, recovery
#  C  the same database PAUSED (hung: open connections stop answering): a sidecar sending every ~2 s, and direct reports timed
#  (zero/negative timeouts are refused at start since G-4-22: see 04-config-errors.txt)
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
trap 'docker unpause vs4-mongo >/dev/null 2>&1; docker start vs4-mongo >/dev/null 2>&1' EXIT
N="vs4-fp-pod vs4-fp-app vs4-fp-sc vs4-fpb-pod vs4-fpb-app vs4-fpb-sc vs4-fpc-pod vs4-fpc-app vs4-fpc-sc"
cleanup $N
BEB=http://127.0.0.1:19302; BEBC=http://172.17.0.1:19302
slog(){ docker logs $1 2>&1 | jq -c 'select(.msg!=null and .msg!="health sidecar starting") | {t:.time[11:23],level,msg,status,error:((.error // "")|.[0:150]),in,failedAttempts,failingFor} | with_entries(select(.value!=null and .value!=""))' 2>/dev/null; }
stw(){ raw $1 | jq -c '{last:.lastReport.status, obs:((.lastReport.observedAt // "")[11:23]), tick:((.lastSendAt // "")[11:23]), n:.reportsSent, err:((.sendError // "")|.[0:200])}'; }
watchst(){ local prev="" i=0 s k; while [ $i -lt $2 ]; do s=$(stw $1); k=$(echo "$s" | jq -c '{tick,err}'); if [ "$k" != "$prev" ]; then echo "  [$(ts)] $s"; prev="$k"; fi; sleep 1; i=$((i+1)); done; }
direct(){ curl -s -o $W/work/direct.txt -w '%{http_code} in %{time_total}s' --max-time 60 -H "$H" -H 'Content-Type: application/json' -d '{"tenantId":"vs4-fpb","service":"direct","status":"UP"}' $BEB/v1/health/reports; echo " body=$(head -c 120 $W/work/direct.txt)"; }
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
    if j.get('msg') in ('reported','report failed; will retry','report rejected','report delivered again'):
        t=p(j['time']); prev=[a for a in arr if a<=t]
        d=(t-prev[-1]).total_seconds() if prev else None
        extra = (' failedAttempts=%s failingFor=%s' % (j.get('failedAttempts'), j.get('failingFor'))) if j.get('msg')=='report delivered again' else ''
        print('  %s %-26s arrived %s  took %s  %s%s' % (j['time'][11:23], j['msg'], prev[-1].strftime('%H:%M:%S.%f')[:12] if prev else '-', ('%.2fs' % d) if d is not None else '-', (j.get('error') or '')[:100], extra))
PY
}
$W/bin/stub -mode backend -port 19340 -ctl 19341 > $W/work/stub-19340.txt 2>&1 & echo $! > $W/work/stub-19340.pid
sleep 0.5; echo "start $(ts)"
echo "### PART A: a slow service (stub :19340), default CS_REPORT_TIMEOUT (10s); CS_INTERVAL=2s CS_HEARTBEAT=4s"
pod vs4-fp-pod -p 127.0.0.1:19380:9465; app vs4-fp-pod vs4-fp-app -mode actuator -port 8080; sleep 0.3
curl -s "127.0.0.1:19340/__delay?ms=7000" >/dev/null; echo "  [$(ts)] the service answers 202 after 7000 ms"
sidecar vs4-fp-pod vs4-fp-sc -e CS_ENDPOINT=http://172.17.0.1:19340 -e CS_TENANT=vs4-fp -e CS_SERVICE=slow -e POD_NAME=slow-0 -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug
sleep 18; echo "  [$(ts)] /status: $(stw 19380)"
curl -s "127.0.0.1:19340/__delay?ms=12000" >/dev/null; echo "  [$(ts)] the service answers 202 after 12000 ms"
sleep 32; echo "  [$(ts)] /status: $(stw 19380)"
curl -s "127.0.0.1:19340/__delay?ms=0" >/dev/null; echo "  [$(ts)] the service answers at once"
sleep 9; echo "  [$(ts)] /status: $(stw 19380)"
echo "  attempts (sidecar log line; when the request arrived at the service; how long the attempt took):"; attempts vs4-fp-sc 19341
cleanup vs4-fp-sc vs4-fp-app vs4-fp-pod; kill $(cat $W/work/stub-19340.pid)
echo "### PART B: private backend B (:19302) on its own database container vs4-mongo (:19301); database STOPPED"
echo "  sidecar CS_INTERVAL=5s CS_HEARTBEAT=10s (default report timeout 10 s)"
pod vs4-fpb-pod -p 127.0.0.1:19381:9465; app vs4-fpb-pod vs4-fpb-app -mode actuator -port 8080; sleep 0.3
sidecar vs4-fpb-pod vs4-fpb-sc -e CS_ENDPOINT=$BEBC -e CS_TENANT=vs4-fpb -e CS_SERVICE=dbdown -e POD_NAME=dbdown-0 -e CS_INTERVAL=5s -e CS_HEARTBEAT=10s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug
sleep 7; echo "  [$(ts)] /status: $(stw 19381)"
docker stop vs4-mongo >/dev/null; echo "  [$(ts)] docker stop vs4-mongo returned"
( echo "  [$(ts)] direct report to B (database stopped) -> $(direct)" > $W/work/direct-stop.txt ) & DP=$!
watchst 19381 40
wait $DP; cat $W/work/direct-stop.txt
echo "  [$(ts)] second direct report (database still stopped) -> $(direct)"
docker start vs4-mongo >/dev/null; echo "  [$(ts)] docker start vs4-mongo returned"
watchst 19381 30
echo "  sidecar log (PART B):"; slog vs4-fpb-sc | grep -v '"msg":"reported","status":"UP"}' ; echo "  (accepted UP reports: $(slog vs4-fpb-sc | grep -c '"msg":"reported"'))"
echo "  /healthz of the sidecar during all this: $(curl -s -w ' HTTP %{http_code}' 127.0.0.1:19381/healthz | tr -d '\n'); app untouched: $(docker inspect -f '{{.State.Status}} restarts={{.RestartCount}}' vs4-fpb-app)"
cleanup vs4-fpb-sc vs4-fpb-app vs4-fpb-pod
echo "### PART C: the same database PAUSED (docker pause: a hung database)"
echo "  C1: a sidecar that sends every ~2 s (CS_INTERVAL=2s CS_HEARTBEAT=2s, default report timeout 10 s)"
for i in $(seq 1 30); do c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -H "$H" -H 'Content-Type: application/json' -d '{"tenantId":"vs4-fpb","service":"direct","status":"UP"}' $BEB/v1/health/reports); [ "$c" = 202 ] && break; sleep 1; done; echo "  [$(ts)] backend B answers reports again ($c)"
pod vs4-fpc-pod -p 127.0.0.1:19382:9465; app vs4-fpc-pod vs4-fpc-app -mode actuator -port 8080; sleep 0.3
sidecar vs4-fpc-pod vs4-fpc-sc -e CS_ENDPOINT=$BEBC -e CS_TENANT=vs4-fpb -e CS_SERVICE=dbhang -e POD_NAME=dbhang-0 -e CS_INTERVAL=2s -e CS_HEARTBEAT=2s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug
sleep 8; echo "  [$(ts)] /status before: $(stw 19382)"
docker pause vs4-mongo >/dev/null; echo "  [$(ts)] docker pause vs4-mongo returned"
watchst 19382 60
docker unpause vs4-mongo >/dev/null; echo "  [$(ts)] docker unpause vs4-mongo returned"
watchst 19382 25
echo "  sidecar log (PART C1), every line but accepted UP sends:"; slog vs4-fpc-sc | grep -v '"msg":"reported","status":"UP"}'; echo "  (accepted UP reports: $(slog vs4-fpc-sc | grep -c '"msg":"reported"'))"
echo "  backend B's access lines for the sidecar's reports while paused (client=dbhang; status and duration):"
grep -E 'client=dbhang .*POST /v1/health/reports' $W/logs/backend-19302.txt | grep -v -e '-> 202' | sed -E 's/^([0-9T:.-]+Z).*(client=.*)$/\1 \2/' | head -20
echo "  ... (202 lines omitted: $(grep -cE 'client=dbhang .*-> 202' $W/logs/backend-19302.txt))"
docker stop vs4-fpc-sc >/dev/null; echo "  [$(ts)] sidecar stopped (SIGTERM): $(docker logs vs4-fpc-sc 2>&1 | tail -2 | jq -c '{msg,error}' | tr '\n' ' ')"
sleep 2
echo "  C2: direct reports with the database paused again, nothing else sending reports"
docker pause vs4-mongo >/dev/null; echo "  [$(ts)] docker pause vs4-mongo returned"
for i in 1 2 3; do echo "  [$(ts)] direct report $i -> $(direct)"; done
docker unpause vs4-mongo >/dev/null; echo "  [$(ts)] docker unpause vs4-mongo returned"; sleep 3
echo "  [$(ts)] direct report after unpause -> $(direct)"
cleanup $N
echo "  vs4-mongo: $(docker inspect -f '{{.State.Status}}' vs4-mongo)"
echo "end $(ts)"
