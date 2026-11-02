#!/usr/bin/env bash
# sidecar-pod.sh — platform engineer: an emulated pod (sidecar owns the netns, fake app joins it) against the private backend :19600,
# walked with the README's "Debugging: my service does not show up" section. Tenant ux2-sidecar.
A=http://127.0.0.1:19600; H='X-Client-Id: ux2-payments-repo'; T=ux2-sidecar; ST=http://127.0.0.1:19612/status
ts(){ date -u +%H:%M:%S.%3N; }
say(){ printf '\n### [%s] %s\n' "$(ts)" "$*"; }
docker rm -f ux2-sidecar ux2-app >/dev/null 2>&1
say "P1 start the sidecar alone (it owns the network namespace; CS_STARTUP_GRACE=20s so the 'nothing answers' case shows quickly)"
docker run -d --name ux2-sidecar -p 127.0.0.1:19612:9465 -p 127.0.0.1:19613:8080 --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e CS_ENDPOINT=http://172.17.0.1:19600 -e CS_TENANT=$T -e CS_SERVICE=payments-api -e CS_CLIENT_ID=ux2-payments-repo \
  -e POD_NAME=payments-api-7f9c6d5b4-ux2aa -e POD_NAMESPACE=ux2-ns -e NODE_NAME=worker-1 -e CS_CLUSTER=sandbox -e CS_VERSION=1.4.2 \
  -e CS_INTERVAL=3s -e CS_HEARTBEAT=10s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=20s health-sidecar:ci >/dev/null && echo started
sleep 6; echo "/status after 6 s (no app in the pod yet):"; curl -s $ST | python3 -I -m json.tool | head -40
say "P2 the README's service-side check with nothing answering yet"
curl -s -H "$H" "$A/v1/health/monitors?tenantId=$T" | head -c 800; echo
sleep 18; echo; echo "/status after the 20 s grace (README: 'If target is empty after the grace ... set CS_PORT (and CS_PATH)'):"; curl -s $ST | python3 -I -m json.tool | head -40
say "P3 start the app in the same namespace; wait for UP"
docker run -d --name ux2-app --network container:ux2-sidecar fakeapp:ci >/dev/null && echo app started
for i in $(seq 1 30); do up=$(curl -s $ST | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(d.get('upSeen'), d.get('reportsSent'))"); [ "${up%% *}" = True ] && { echo "upSeen after ~$((i*2)) s ($up)"; break; }; sleep 2; done
curl -s $ST | python3 -I -m json.tool | head -30
say "P4 README debugging curls (monitor, instances)"
MON=$(curl -s -H "$H" "$A/v1/health/monitors?tenantId=$T"); echo "$MON" | head -c 1200; echo
MID=$(echo "$MON" | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(d[0]['id'] if isinstance(d,list) and d else '')"); echo "monitorId=$MID"
curl -s -H "$H" "$A/v1/health/monitors/$MID/instances" | head -c 800; echo
echo "wrong tenant (README cause 2):"; curl -s -H "$H" "$A/v1/health/monitors?tenantId=${T}-typo"; echo
say "P5 the app stops listening: docker stop ux2-app"
T0=$(date +%s.%N); docker stop -t 1 ux2-app >/dev/null; echo "stopped at $(ts)"
for i in $(seq 1 40); do n=$(curl -s -H "$H" "$A/v1/feed?tenantId=$T" | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(len(d['items']))"); if [ "$n" != 0 ]; then echo "OUTAGE visible in the feed after $(python3 -I -c "import time;print(round(time.time()-$T0,1))") s"; break; fi; sleep 1; done
curl -s -H "$H" "$A/v1/feed?tenantId=$T" | python3 -I -c "import json,sys;d=json.load(sys.stdin);[print('  feed item:',i['type'],i['severity'],repr(i['title']),'| body:',repr(i.get('body','')[:160]),'| publisher:',i['publisher'],'| externalRef:',i.get('externalRef')) for i in d['items']]"
echo "/status while down:"; curl -s $ST | python3 -I -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ('target','lastTarget','upSeen','sendError','reportsSent')}); print('  lastReport:',d['lastReport']['status'],repr(d['lastReport'].get('message')))"
echo "sidecar log lines since the stop:"; docker logs --since "$(date -u -d @${T0%.*} +%Y-%m-%dT%H:%M:%S)" ux2-sidecar 2>&1 | head -20
echo "instances while down:"; curl -s -H "$H" "$A/v1/health/monitors/$MID/instances" | head -c 600; echo
say "P6 the SRE's view of the automated notice (private UI :3600)"
node "$(dirname "$0")/auto-notice.js" $T
say "P7 the app comes back: docker start ux2-app"
T1=$(date +%s.%N); docker start ux2-app >/dev/null; echo "started at $(ts)"
for i in $(seq 1 60); do n=$(curl -s -H "$H" "$A/v1/feed?tenantId=$T" | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(len(d['items']))"); if [ "$n" = 0 ]; then echo "notice gone from the feed after $(python3 -I -c "import time;print(round(time.time()-$T1,1))") s"; break; fi; sleep 1; done
echo "/status after recovery:"; curl -s $ST | python3 -I -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ('target','lastTarget','upSeen','sendError','reportsSent')}); print('  lastReport:',d['lastReport']['status'],repr(d['lastReport'].get('message')))"
echo "sidecar log lines since the start:"; docker logs --since "$(date -u -d @${T1%.*} +%Y-%m-%dT%H:%M:%S)" ux2-sidecar 2>&1 | head -20
say "P8 whole sidecar log: levels and messages"
docker logs ux2-sidecar 2>&1 > "$(dirname "$0")/../logs/sidecar-pod-container.txt"; python3 -I - <<PY
import json,collections
c=collections.Counter(); msgs=collections.Counter()
for line in open('$(dirname "$0")/../logs/sidecar-pod-container.txt'):
    try: d=json.loads(line)
    except Exception: continue
    c[d.get('level')]+=1; msgs[(d.get('level'),d.get('msg'))]+=1
print('levels:',dict(c)); [print(' ',k,v) for k,v in msgs.most_common()]
PY
say "P9 SIGTERM: last report says leaving"
docker stop -t 5 ux2-sidecar >/dev/null; sleep 1; curl -s -H "$H" "$A/v1/health/monitors/$MID/instances" | head -c 600; echo
docker logs ux2-sidecar 2>&1 | tail -3
docker rm -f ux2-app ux2-sidecar >/dev/null 2>&1; echo "cleaned up containers"
