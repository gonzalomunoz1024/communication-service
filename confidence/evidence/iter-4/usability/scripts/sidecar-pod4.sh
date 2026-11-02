#!/usr/bin/env bash
# sidecar-pod4.sh — a platform engineer walks the README's "Debugging" section on an emulated pod against private backend A :19600
A=http://127.0.0.1:19600; H='X-Client-Id: ux4-payments-repo'; T=ux4-sidecar; ST=http://127.0.0.1:19612/status; APP=http://127.0.0.1:19613
D=$(dirname "$0"); L=$D/../logs; ts(){ date -u +%H:%M:%S.%3N; }; say(){ printf '\n### [%s] %s\n' "$(ts)" "$*"; }
SC_ENV=(-e CS_ENDPOINT=http://172.17.0.1:19600 -e CS_TENANT=$T -e CS_SERVICE=payments-api -e CS_CLIENT_ID=ux4-payments-repo -e POD_NAME=payments-api-7f9c6d5b4-ux4aa -e POD_NAMESPACE=ux4-ns -e NODE_NAME=worker-1 -e CS_CLUSTER=sandbox -e CS_VERSION=1.4.2 -e CS_INTERVAL=3s -e CS_HEARTBEAT=10s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=20s)
SEC=(--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges)
statusof(){ curl -s $1 | python3 -I -c "import json,sys;d=json.load(sys.stdin);lr=d.get('lastReport') or {};print({k:d.get(k) for k in ('version','service','tenant','instance','target','lastTarget','upSeen','sendError','reportsSent','lastSendAt')}); print('  lastReport:',lr.get('status'),repr(lr.get('message')),'components:',lr.get('components'))"; }
status(){ statusof $ST; }
monitors(){ curl -s -H "$H" "$A/v1/health/monitors?tenantId=$1" | python3 -I -c "import json,sys;d=json.load(sys.stdin);[print('  monitor',m['service'],'| lastStatus:',m['state'].get('lastStatus'),'| lastSummary:',repr(m['state'].get('lastSummary')),'| publisher:',m['policy'].get('publisher')) for m in d] or print('  (no monitor)')"; }
feed(){ curl -s -H "$H" "$A/v1/feed?tenantId=$T" | python3 -I -c "import json,sys;d=json.load(sys.stdin);[print('  feed item:',i['type'],i['severity'],repr(i['title']),'| body:',repr(i.get('body','')),'| publisher:',i['publisher'],'| externalRef:',i.get('externalRef')) for i in d['items']] or print('  feed: empty')"; }
nfeed(){ curl -s -H "$H" "$A/v1/feed?tenantId=$T" | python3 -I -c "import json,sys;print(len(json.load(sys.stdin)['items']))"; }
docker rm -f ux4-sidecar ux4-app >/dev/null 2>&1
say "P1 the sidecar alone in the pod (no app yet)"
docker run -d --name ux4-sidecar -p 127.0.0.1:19612:9465 -p 127.0.0.1:19613:8080 "${SEC[@]}" "${SC_ENV[@]}" health-sidecar:ci >/dev/null && echo started
sleep 6; echo "/status after 6 s:"; status
say "P2 README service-side checks while nothing answers (inside the grace, then past it)"
monitors $T
sleep 19; echo "/status after the 20 s grace:"; status
sleep 11; echo "monitor summary past the grace (UX-63):"; monitors $T
MID=$(curl -s -H "$H" "$A/v1/health/monitors?tenantId=$T" | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
echo "instances:"; curl -s -H "$H" "$A/v1/health/monitors/$MID/instances" | head -c 600; echo
say "P3 the app starts in the same namespace"
docker run -d --name ux4-app --network container:ux4-sidecar fakeapp:ci >/dev/null && echo "app started at $(ts)"
for i in $(seq 1 30); do up=$(curl -s $ST | python3 -I -c "import json,sys;print(json.load(sys.stdin).get('upSeen'))"); [ "$up" = True ] && { echo "upSeen after ~$((i*2)) s"; break; }; sleep 2; done; status
say "P4 README curls: monitor, instances, and the consumers' tenant misspelled (cause 2)"
monitors $T; curl -s -H "$H" "$A/v1/health/monitors/$MID/instances" | head -c 600; echo
echo "under another tenant:"; curl -s -H "$H" "$A/v1/health/monitors?tenantId=${T}-typo"; echo
say "P5 the app stops listening (docker stop ux4-app)"
T0=$(date +%s.%N); docker stop -t 1 ux4-app >/dev/null; echo "stopped at $(ts)"
for i in $(seq 1 40); do [ "$(nfeed)" != 0 ] && { echo "OUTAGE in the feed after $(python3 -I -c "import time;print(round(time.time()-$T0,1))") s"; break; }; sleep 1; done
feed; echo "/status while down:"; status
echo "sidecar log since the stop:"; docker logs --since "$(date -u -d @${T0%.*} +%Y-%m-%dT%H:%M:%S)" ux4-sidecar 2>&1 | cut -c1-300 | head -8
say "P6 the SRE's view of that automated notice"
node "$D/auto-notice4.js" $T stopped
say "P7 the app comes back (docker start ux4-app)"
NID=$(curl -s -H "$H" "$A/v1/feed?tenantId=$T" | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(d['items'][0]['id'] if d['items'] else '')")
T1=$(date +%s.%N); docker start ux4-app >/dev/null; echo "started at $(ts)"
for i in $(seq 1 60); do [ "$(nfeed)" = 0 ] && { echo "notice gone from the feed after $(python3 -I -c "import time;print(round(time.time()-$T1,1))") s"; break; }; sleep 1; done
echo "the notice's history:"; curl -s -H "$H" "$A/v1/communications/$NID" | python3 -I -c "import json,sys;d=json.load(sys.stdin);print('  publisher:',d['publisher'],'| status:',d['status']);[print('  ',h['actor'],'|',h['action'][:160]) for h in d['history']]"
echo "/status after recovery:"; status
say "P7b the app answers DOWN with a failing component (POST /__set?status=DOWN&db=DOWN)"
curl -s -X POST "$APP/__set?status=DOWN&db=DOWN" -o /dev/null -w "flip %{http_code}\n"; T2=$(date +%s.%N)
for i in $(seq 1 40); do [ "$(nfeed)" != 0 ] && { echo "notice in the feed after $(python3 -I -c "import time;print(round(time.time()-$T2,1))") s"; break; }; sleep 1; done
feed; node "$D/auto-notice4.js" $T component
curl -s -X POST "$APP/__set?status=UP&db=UP" -o /dev/null -w "flip back %{http_code}\n"
for i in $(seq 1 60); do [ "$(nfeed)" = 0 ] && { echo "notice gone after ~$i s"; break; }; sleep 1; done
say "P8 the whole sidecar log at the default level"
docker logs ux4-sidecar > "$L/sidecar-pod4-container-info.txt" 2>&1
python3 -I - "$L/sidecar-pod4-container-info.txt" <<'PY'
import json,collections,sys
c=collections.Counter(); m=collections.Counter()
for line in open(sys.argv[1]):
    try: d=json.loads(line)
    except Exception: continue
    c[d.get('level')]+=1; m[(d.get('level'),d.get('msg'))]+=1
print('levels:',dict(c)); [print(' ',k,v) for k,v in m.most_common()]
PY
say "P9 README: set CS_LOG_LEVEL=debug and restart the pod's sidecar; watch 25 s"
docker stop -t 5 ux4-sidecar >/dev/null; docker rm -f ux4-app ux4-sidecar >/dev/null 2>&1
docker run -d --name ux4-sidecar -p 127.0.0.1:19612:9465 -p 127.0.0.1:19613:8080 "${SEC[@]}" "${SC_ENV[@]}" -e CS_LOG_LEVEL=debug health-sidecar:ci >/dev/null
docker run -d --name ux4-app --network container:ux4-sidecar fakeapp:ci >/dev/null; sleep 25
docker logs ux4-sidecar > "$L/sidecar-pod4-container-debug.txt" 2>&1
python3 -I - "$L/sidecar-pod4-container-debug.txt" <<'PY'
import json,collections,sys
c=collections.Counter(); m=collections.Counter(); ex={}
for line in open(sys.argv[1]):
    try: d=json.loads(line)
    except Exception: continue
    c[d.get('level')]+=1; k=(d.get('level'),d.get('msg')); m[k]+=1; ex.setdefault(k, line.strip()[:260])
print('levels:',dict(c)); [print(' ',k,v,'| e.g.',ex[k]) for k,v in m.most_common()]
PY
say "P10 SIGTERM: the leaving report"
MID=$(curl -s -H "$H" "$A/v1/health/monitors?tenantId=$T" | python3 -I -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
docker stop -t 5 ux4-sidecar >/dev/null; sleep 1; curl -s -H "$H" "$A/v1/health/monitors/$MID/instances" | head -c 500; echo; docker logs ux4-sidecar 2>&1 | tail -2 | cut -c1-200
docker rm -f ux4-app ux4-sidecar >/dev/null 2>&1
say "P11 README cause 1: a wrong CS_ENDPOINT, read from outside"
docker run -d --name ux4-sc-wrong -p 127.0.0.1:19615:9465 "${SEC[@]}" -e CS_ENDPOINT=http://127.0.0.1:9 -e CS_TENANT=$T -e CS_SERVICE=lonely -e CS_STARTUP_GRACE=5s health-sidecar:ci >/dev/null; sleep 8
curl -s 127.0.0.1:19615/status | python3 -I -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ('sendError','reportsSent','lastSendAt','upSeen','target')})"
docker logs ux4-sc-wrong 2>&1 | tail -2 | cut -c1-260; docker rm -f ux4-sc-wrong >/dev/null
say "P12 proxies: a dead HTTP_PROXY in the pod's environment (README configuration row and cause 1), then NO_PROXY"
docker rm -f ux4-sc-proxy ux4-app-proxy >/dev/null 2>&1
docker run -d --name ux4-sc-proxy -p 127.0.0.1:19622:9465 "${SEC[@]}" -e CS_ENDPOINT=http://172.17.0.1:19600 -e CS_TENANT=ux4-proxy -e CS_SERVICE=proxied-api -e CS_INTERVAL=3s -e CS_STARTUP_GRACE=20s -e HTTP_PROXY=http://127.0.0.1:9 health-sidecar:ci >/dev/null
docker run -d --name ux4-app-proxy --network container:ux4-sc-proxy fakeapp:ci >/dev/null; sleep 10
echo "/status with the dead proxy:"; statusof http://127.0.0.1:19622/status
docker logs ux4-sc-proxy 2>&1 | grep -m2 -E 'report failed|proxy' | cut -c1-300
docker rm -f ux4-sc-proxy ux4-app-proxy >/dev/null 2>&1
docker run -d --name ux4-sc-proxy -p 127.0.0.1:19622:9465 "${SEC[@]}" -e CS_ENDPOINT=http://172.17.0.1:19600 -e CS_TENANT=ux4-proxy -e CS_SERVICE=proxied-api -e CS_INTERVAL=3s -e CS_STARTUP_GRACE=20s -e HTTP_PROXY=http://127.0.0.1:9 -e NO_PROXY=172.17.0.1 health-sidecar:ci >/dev/null
docker run -d --name ux4-app-proxy --network container:ux4-sc-proxy fakeapp:ci >/dev/null; sleep 10
echo "/status with NO_PROXY=172.17.0.1:"; statusof http://127.0.0.1:19622/status
docker rm -f ux4-sc-proxy ux4-app-proxy >/dev/null 2>&1
say "P13 README cause 3 with a pinned wrong port (CS_PORT=9999), past the grace; the service-side summary"
docker run -d --name ux4-sc-port -p 127.0.0.1:19623:9465 "${SEC[@]}" -e CS_ENDPOINT=http://172.17.0.1:19600 -e CS_TENANT=ux4-port -e CS_SERVICE=port-api -e POD_NAME=port-api-6b7c-ux4pp -e CS_INTERVAL=3s -e CS_HEARTBEAT=10s -e CS_STARTUP_GRACE=10s -e CS_PORT=9999 health-sidecar:ci >/dev/null
docker run -d --name ux4-app-port --network container:ux4-sc-port fakeapp:ci >/dev/null; sleep 26
echo "/status:"; statusof http://127.0.0.1:19623/status; echo "monitor summary:"; monitors ux4-port
docker rm -f ux4-sc-port ux4-app-port >/dev/null 2>&1
echo; echo "cleaned up containers"
