#!/bin/bash
# iteration-1 sidecar verifier (sc1): pod lifecycle + G-1-2 against the private backend on :19300 (db sc1-main)
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
IMG=gcr.io/distroless/static-debian12:latest
V="-v $S/sidecar1/bin:/bin-ro:ro"
BE=http://127.0.0.1:19300; BEC=http://172.17.0.1:19300; T=sc1-pod; H="X-Client-Id: sc1-verifier"; J="python3 $S/sidecar1/j.py"
ts(){ date -u +%H:%M:%S.%3N; }
st(){ curl -s --max-time 2 http://127.0.0.1:${1:-49465}/status | $J status; }
mon(){ curl -s --max-time 3 -H "$H" "$BE/v1/health/monitors?tenantId=$T" | $J mon; }
monid(){ curl -s --max-time 3 -H "$H" "$BE/v1/health/monitors?tenantId=$T" | $J monid $1; }
inst(){ local id=$(monid ${1:-sc1-app}); if [ -z "$id" ]; then echo "  (no monitor for ${1:-sc1-app})"; return; fi; curl -s --max-time 3 -H "$H" "$BE/v1/health/monitors/$id/instances" | $J inst; }
feed(){ curl -s --max-time 3 -H "$H" "$BE/v1/feed?tenantId=$T" | $J feed; }
fc(){ curl -s --max-time 3 -H "$H" "$BE/v1/feed?tenantId=$T" | $J feedcount; }
req(){ docker run --rm --network container:sc1-pod $V $IMG /bin-ro/req "$@"; }
SEC="--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges"
ENVMAIN="-e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=sc1-app -e CS_CLIENT_ID=sc1-app-repo -e CS_INTERVAL=3s -e CS_HEARTBEAT=5s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=2m -e POD_NAME=sc1-app-5d8c7b6f9-k2n4p -e POD_NAMESPACE=sc1-ns -e NODE_NAME=node-a -e CS_CLUSTER=sandbox -e CS_VERSION=1.4.2"
docker rm -f sc1-sidecar sc1-app sc1-pod sc1-nou-sidecar sc1-nou sc1-pin-sidecar sc1-pin >/dev/null 2>&1
echo "== sc1 pod lifecycle $(date -u +%FT%TZ) | sidecar image health-sidecar:sc1 version=$(docker inspect health-sidecar:sc1 --format '{{index .Config.Labels "org.opencontainers.image.version"}}') | fakeapp:ci $(docker inspect fakeapp:ci --format 'ports={{.Config.ExposedPorts}} user={{.Config.User}}')"
echo "backend readiness=$(curl -s --max-time 3 $BE/actuator/health/readiness) | tenant $T before:"; mon; feed
set -e
docker run -d --name sc1-pod -p 127.0.0.1:49465:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name sc1-app --network container:sc1-pod fakeapp:ci >/dev/null
docker run -d --name sc1-sidecar --network container:sc1-pod $SEC $ENVMAIN health-sidecar:sc1 >/dev/null
docker run -d --name sc1-nou -p 127.0.0.1:49466:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name sc1-nou-sidecar --network container:sc1-nou $SEC -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=sc1-never-up -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=20s -e POD_NAME=sc1-never-up-0 -e POD_NAMESPACE=sc1-ns health-sidecar:sc1 >/dev/null
docker run -d --name sc1-pin -p 127.0.0.1:49467:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name sc1-pin-sidecar --network container:sc1-pin $SEC -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=sc1-pinned -e CS_PORT=9999 -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=20s -e POD_NAME=sc1-pinned-0 -e POD_NAMESPACE=sc1-ns health-sidecar:sc1 >/dev/null
set +e
echo; echo "[$(ts)] STEP A: pod sc1-pod = netns holder + fakeapp + sidecar ($SEC); side pods sc1-nou (no app) and sc1-pin (CS_PORT=9999) started too"
for i in 1 2 3 4 5 6; do sleep 1; echo "  +${i}s $(st)"; done
echo "  healthz=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:49465/healthz) | raw /status: $(curl -s http://127.0.0.1:49465/status | $J raw 760)"
echo "  backend:"; mon; echo "  monitor keys: $(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | $J keys)"; inst; feed
PORT=$(curl -s http://127.0.0.1:49465/status | python3 -c 'import json,sys,re; print(re.search(r":(\d+)/", json.load(sys.stdin).get("target","")).group(1))' 2>/dev/null); echo "  app port discovered: $PORT"

echo; echo "[$(ts)] STEP B0 (F-70/F-75): the app answers DOWN with db DOWN (POST /__set?status=DOWN&db=DOWN from inside the pod)"
echo "  __set -> $(req -X POST "http://127.0.0.1:$PORT/__set?status=DOWN&db=DOWN")"
prev=""; for i in $(seq 1 30); do sleep 1; cur="$(st) feed=$(fc)"; [ "$cur" != "$prev" ] && echo "  +${i}s $cur"; prev=$cur; echo "$cur" | grep -q 'feed=[1-9]' && break; done
mon; feed; NID=$(curl -s -H "$H" "$BE/v1/feed?tenantId=$T" | $J feedid); echo "  notice id: $NID"
echo "  __set -> $(req -X POST "http://127.0.0.1:$PORT/__set?status=UP&db=UP")"
prev=""; for i in $(seq 1 30); do sleep 1; cur="$(st) feed=$(fc)"; [ "$cur" != "$prev" ] && echo "  +${i}s $cur"; prev=$cur; echo "$cur" | grep -q 'status=UP .*feed=0' && break; done
mon; echo "  notice $NID now: $(curl -s -o /dev/null -w '%{http_code} ' -H "$H" $BE/v1/communications/$NID)$(curl -s -H "$H" $BE/v1/communications/$NID | $J raw 320)"

echo; echo "[$(ts)] STEP B (G-1-2): docker stop -t 1 sc1-app -> the app stops listening while the netns and the sidecar stay"
docker stop -t 1 sc1-app >/dev/null; TSTOP=$(date +%s.%N); echo "  [$(ts)] app container $(docker inspect sc1-app --format '{{.State.Status}} exit={{.State.ExitCode}}')"
prev=""; FD=""; FO=""; for i in $(seq 1 45); do sleep 1; cur="$(st) feed=$(fc)"; [ "$cur" != "$prev" ] && echo "  +${i}s $cur"; prev=$cur; [ -z "$FD" ] && echo "$cur" | grep -q 'status=DOWN' && FD=$i; echo "$cur" | grep -q 'feed=[1-9]' && { FO=$i; break; }; done
echo "  [$(ts)] first DOWN in /status after ${FD:-never} s, OUTAGE in the feed after ${FO:-never} s"
mon; inst; feed; NID2=$(curl -s -H "$H" "$BE/v1/feed?tenantId=$T" | $J feedid)
echo "  sidecar log since the stop:"; docker logs --since "$(date -u -d @${TSTOP%.*} +%FT%TZ)" sc1-sidecar 2>&1 | head -8 | cut -c1-330

echo; echo "[$(ts)] STEP C (G-1-2): docker start sc1-app -> expect UP, target back, notice retired"
docker start sc1-app >/dev/null
prev=""; FU=""; FR=""; for i in $(seq 1 45); do sleep 1; cur="$(st) feed=$(fc)"; [ "$cur" != "$prev" ] && echo "  +${i}s $cur"; prev=$cur; [ -z "$FU" ] && echo "$cur" | grep -q 'status=UP' && FU=$i; [ -n "$FU" ] && echo "$cur" | grep -q 'feed=0' && { FR=$i; break; }; done
echo "  [$(ts)] UP after ${FU:-never} s, feed empty after ${FR:-never} s"; mon; inst; feed
echo "  notice $NID2 now: $(curl -s -o /dev/null -w '%{http_code} ' -H "$H" $BE/v1/communications/$NID2)$(curl -s -H "$H" $BE/v1/communications/$NID2 | $J raw 320)"

echo; echo "[$(ts)] STEP D (F-88): SIGKILL the sidecar, start the same container again -> same instance id, no notice"
docker kill -s KILL sc1-sidecar >/dev/null; sleep 1; echo "  after SIGKILL: $(docker inspect sc1-sidecar --format '{{.State.Status}} exit={{.State.ExitCode}}')"; docker start sc1-sidecar >/dev/null
for i in 2 4 6 8; do sleep 2; echo "  +${i}s $(st)"; done; mon; inst; feed

echo; echo "[$(ts)] STEP E (F-76/F-48): docker stop -t 30 sc1-sidecar (SIGTERM) -> leaving report, prompt exit"
echo "  instances before:"; inst
T0=$(date +%s.%N); docker stop -t 30 sc1-sidecar >/dev/null; T1=$(date +%s.%N); echo "  stop took $(python3 -c "print(round($T1-$T0,2))") s, exit code $(docker inspect sc1-sidecar --format '{{.State.ExitCode}}')"
sleep 1; echo "  backend 1 s later:"; mon; inst; feed; sleep 4; echo "  backend 5 s later:"; mon; inst
echo "  sidecar log tail:"; docker logs --tail 4 sc1-sidecar 2>&1 | cut -c1-330

echo; echo "[$(ts)] STEP F: the two unchanged rules after a 20 s grace (side pods started with STEP A)"
echo "  never-UP pod (no app): $(st 49466)"; docker logs --tail 2 sc1-nou-sidecar 2>&1 | cut -c1-300
echo "  pinned CS_PORT=9999 never answering: $(st 49467)"; docker logs --tail 2 sc1-pin-sidecar 2>&1 | cut -c1-300
echo "  backend monitors for the tenant now:"; mon; feed

echo; echo "[$(ts)] STEP G (F-89): sidecar log shape (both runs of sc1-sidecar)"
docker logs sc1-sidecar > $S/sidecar1/sc1-sidecar.log 2>&1; python3 - "$S/sidecar1/sc1-sidecar.log" <<'PY'
import json,sys,collections
lines=open(sys.argv[1]).read().splitlines(); bad=0; c=collections.Counter(); keys=set()
for l in lines:
    try: d=json.loads(l); c[(d.get("level"),d.get("msg"))]+=1; keys|=set(d)
    except Exception: bad+=1
print("  lines:",len(lines),"non-JSON:",bad,"keys seen:",sorted(keys))
for (lv,m),n in sorted(c.items(), key=lambda x:-x[1]): print("   %3d  %-5s %s"%(n,lv,m))
PY
echo "  first 4 lines:"; head -4 $S/sidecar1/sc1-sidecar.log | cut -c1-330
echo "  secret-looking strings in the log: $(grep -ciE 'password|secret|token|authorization' $S/sidecar1/sc1-sidecar.log)"
docker rm -f sc1-sidecar sc1-app sc1-pod sc1-nou-sidecar sc1-nou sc1-pin-sidecar sc1-pin >/dev/null 2>&1
echo "[$(ts)] DONE, containers removed"
