#!/bin/bash
# G-3-29 (a): default cadence (15 s / 30 s), the service answers 503 for 4 minutes; arrival times recorded by the stub.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
cleanup vs3-boa-pod vs3-boa-app vs3-boa-sc; pkill -f 'stub -mode backend -port 19320' ; sleep 0.5
$W/bin/stub -mode backend -port 19320 -ctl 19321 > $W/work/stub-19320.txt 2>&1 &
sleep 0.5
pod vs3-boa-pod -p 127.0.0.1:19324:9465
app vs3-boa-pod vs3-boa-app -mode actuator -port 8080
sidecar vs3-boa-pod vs3-boa-sc -e CS_ENDPOINT=http://172.17.0.1:19320 -e CS_TENANT=vs3-bo -e CS_SERVICE=bo-a -e POD_NAME=bo-a-7f9c6d5b4-aaaaa -e CS_LOG_LEVEL=debug
echo "start $(ts) (defaults: CS_INTERVAL 15s, CS_HEARTBEAT 30s, CS_RETRY_DELAY 2s, CS_REPORT_TIMEOUT 10s)"
for i in $(seq 1 80); do [ "$(nreq 19320)" -ge 2 ] && break; sleep 1; done
echo "$(ts) two accepted reports (first + heartbeat); service now answers 503"
curl -s "127.0.0.1:19320/__code?c=503" >/dev/null; down_at=$(date -u +%FT%T.%3NZ); n_down=$(nreq 19320)
sleep 240
curl -s "127.0.0.1:19320/__code?c=202" >/dev/null; up_at=$(date -u +%FT%T.%3NZ); echo "$(ts) service answers 202 again (after 240 s)"
for i in $(seq 1 45); do last=$(reqs 19320 | jq -r '.[-1].answer'); [ "$last" = 202 ] && [ "$(nreq 19320)" -gt $n_down ] && break; sleep 1; done
sleep 35
echo "== every request the stub received (gap = time since the previous arrival)"
reqs 19320 | $P reqs
echo "== gaps between attempts while the service answered 503 (from the first refused attempt to the first accepted one)"
reqs 19320 | python3 -I -c "
import json,sys,datetime
r=json.load(sys.stdin); f=lambda s: datetime.datetime.fromisoformat(s.replace('Z','+00:00')[:26])
down=f('$down_at'); up=f('$up_at')
att=[x for x in r if f(x['at'])>=down]
first_ok=next(i for i,x in enumerate(att) if x['answer']==202)
g=[round((f(b['at'])-f(a['at'])).total_seconds(),1) for a,b in zip(att[:first_ok],att[1:first_ok+1])]
print('refused attempts:',first_ok,' gaps:',g,' max gap:',max(g))
print('first accepted attempt %.1f s after the service answered 202 again (cap 30 s)' % (f(att[first_ok]['at'])-up).total_seconds())
after=[x for x in att[first_ok:]]
print('after recovery:', [(x['at'][11:19], x['answer']) for x in after])
"
echo "== sidecar log: WARN lines (backoff steps) and DEBUG/INFO reported lines"
docker logs vs3-boa-sc 2>&1 | jq -c 'select(.level=="WARN") | {t:.time[11:23],in:.in,error:(.error|.[0:80])}' | head -30
docker logs vs3-boa-sc 2>&1 | jq -c 'select(.msg=="reported") | {t:.time[11:23],level,status}' | head -12
echo "== /status during recovery"; st 19324
cleanup vs3-boa-pod vs3-boa-app vs3-boa-sc; pkill -f 'stub -mode backend -port 19320'
echo "end $(ts)"
