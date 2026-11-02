#!/bin/bash
# G-3-29 (b): CS_INTERVAL=45s (longer than the 30 s cap), the service refuses connections for 3 minutes.
# Attempt times come from the sidecar's WARN lines (a refused connection never reaches the stub's handler).
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
cleanup vs3-bob-pod vs3-bob-app vs3-bob-sc; pkill -f 'stub -mode backend -port 19322'; sleep 0.5
$W/bin/stub -mode backend -port 19322 -ctl 19323 > $W/work/stub-19322.txt 2>&1 &
sleep 0.5
pod vs3-bob-pod -p 127.0.0.1:19325:9465
app vs3-bob-pod vs3-bob-app -mode actuator -port 8080
sidecar vs3-bob-pod vs3-bob-sc -e CS_ENDPOINT=http://172.17.0.1:19322 -e CS_TENANT=vs3-bo -e CS_SERVICE=bo-b -e POD_NAME=bo-b-7f9c6d5b4-bbbbb -e CS_INTERVAL=45s -e CS_HEARTBEAT=45s -e CS_LOG_LEVEL=debug
echo "start $(ts) (CS_INTERVAL=45s CS_HEARTBEAT=45s)"
for i in $(seq 1 10); do [ "$(nreq 19322)" -ge 1 ] && break; sleep 1; done
echo "$(ts) first report accepted; the service now refuses connections"
curl -s 127.0.0.1:19323/__down >/dev/null; down_at=$(date -u +%FT%T.%3NZ)
sleep 180
curl -s 127.0.0.1:19323/__up >/dev/null; up_at=$(date -u +%FT%T.%3NZ); echo "$(ts) the service listens again (after 180 s)"
sleep 40
echo "== requests that reached the stub"; reqs 19322 | $P reqs
echo "== attempts while refused (WARN lines) and the first accepted after"
docker logs vs3-bob-sc 2>&1 > $W/work/bob.log
python3 -I - $W/work/bob.log "$down_at" "$up_at" "$(reqs 19322 | jq -r '[.[] | .at] | join(",")')" <<'PY'
import json,sys,datetime
f=lambda s: datetime.datetime.fromisoformat(s.replace('Z','+00:00')[:26])
lines=[json.loads(l) for l in open(sys.argv[1]) if l.startswith('{')]
down,up=f(sys.argv[2]),f(sys.argv[3]); arrivals=[f(x) for x in sys.argv[4].split(',') if x]
warn=[(f(l['time']),l.get('in')) for l in lines if l.get('msg')=='report failed; will retry']
print('refused attempts:',len(warn),' steps logged:',[w[1] for w in warn])
t=[w[0] for w in warn]
print('gaps between refused attempts:',[round((b-a).total_seconds(),1) for a,b in zip(t,t[1:])], ' max:', max([round((b-a).total_seconds(),1) for a,b in zip(t,t[1:])] or [0]))
ok=[a for a in arrivals if a>up]
if ok:
    print('first accepted attempt %.1f s after the service listened again; %.1f s after the last refused attempt (cap 30 s)' % ((ok[0]-up).total_seconds(), (ok[0]-t[-1]).total_seconds()))
PY
echo "== /status"; st 19325
cleanup vs3-bob-pod vs3-bob-app vs3-bob-sc; pkill -f 'stub -mode backend -port 19322'
echo "end $(ts)"
