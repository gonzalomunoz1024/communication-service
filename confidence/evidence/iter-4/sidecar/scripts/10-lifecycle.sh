#!/bin/bash
# Emulated pod (holder + app + sidecar sharing one network namespace) against private backend A (:19300).
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
T=vs4-life; SVC=vs4-app
cleanup vs4-pod1 vs4-app1 vs4-sc1 vs4-pod2 vs4-app2 vs4-sc2
T0=$(date +%s.%N); el(){ python3 -c "import time;print('+%.1fs'%(time.time()-$T0))"; }
waitfor(){ # $1 desc, $2 timeout s, $3.. command that must succeed
  local d=$1 to=$2; shift 2; local s=$(date +%s.%N)
  for i in $(seq 1 $((to*4))); do if eval "$@" >/dev/null 2>&1; then echo "  [$(ts) $(el)] $d after $(python3 -c "import time;print('%.1fs'%(time.time()-$s))")"; return 0; fi; sleep 0.25; done
  echo "  [$(ts) $(el)] $d: NOT within ${to}s"; return 1
}
ENV1="-e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=$SVC -e CS_CLIENT_ID=vs4-life-repo -e POD_NAMESPACE=vs4-ns -e NODE_NAME=worker-9 -e CS_CLUSTER=sandbox -e CS_VERSION=2.0.0 -e CS_INTERVAL=3s -e CS_HEARTBEAT=30s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=30s"
echo "### STEP A: pod with app + sidecar (UID 1000660000:0, read-only, cap-drop ALL, no-new-privileges); discovery and first report"
pod vs4-pod1 -p 127.0.0.1:19310:9465 -p 127.0.0.1:19311:8080
app vs4-pod1 vs4-app1 -mode actuator -port 8080
sidecar vs4-pod1 vs4-sc1 $ENV1 -e POD_NAME=vs4-app-7f9c6d5b4-ab12c
waitfor "status UP with a target" 20 "st 19310 | grep -q 'last=UP'"
st 19310
waitfor "monitor auto-registered" 10 "mon $T | grep -q $SVC"
mon $T; inst $T $SVC
echo "### STEP B: app answers DOWN (db DOWN): sidecar DOWN, OUTAGE after failureThreshold=2"
curl -s -XPOST "127.0.0.1:19311/__set?status=DOWN&db=DOWN" >/dev/null; echo "  [$(ts) $(el)] app set DOWN"
n0=$(raw 19310 | jq .reportsSent)
waitfor "status DOWN" 15 "st 19310 | grep -q 'last=DOWN'"
st 19310
waitfor "OUTAGE in the feed" 30 "feed $T | grep -q OUTAGE"
feed $T; mon $T; inst $T $SVC
sleep 15; n1=$(raw 19310 | jq .reportsSent); echo "  reports sent from DOWN until +15 s after the OUTAGE: $((n1-n0))"
echo "### STEP C: app UP again: UP sent at once, notice retired at the second UP (the heartbeat)"
curl -s -XPOST "127.0.0.1:19311/__set?status=UP&db=UP" >/dev/null; echo "  [$(ts) $(el)] app set UP"
waitfor "status UP" 15 "st 19310 | grep -q 'last=UP'"
waitfor "notice retired (feed empty)" 60 "feed $T | grep -q 'feed empty'"
mon $T
echo "### STEP D: app container stopped (crash), then started again (rediscovery)"
docker stop -t 1 vs4-app1 >/dev/null; echo "  [$(ts) $(el)] app container stopped"
waitfor "status DOWN 'app is not listening'" 15 "st 19310 | grep -q 'app is not listening'"
st 19310
waitfor "OUTAGE in the feed" 30 "feed $T | grep -q OUTAGE"
feed $T
docker start vs4-app1 >/dev/null; echo "  [$(ts) $(el)] app container started"
waitfor "rediscovered and UP" 20 "st 19310 | grep -q 'last=UP'"
st 19310
waitfor "notice retired" 60 "feed $T | grep -q 'feed empty'"
echo "### STEP E: sidecar SIGKILL + restart (liveness restart emulated): UP again, same instance, no notice"
docker kill -s KILL vs4-sc1 >/dev/null; echo "  [$(ts) $(el)] sidecar killed; exit code $(docker inspect -f '{{.State.ExitCode}}' vs4-sc1)"
docker start vs4-sc1 >/dev/null; echo "  [$(ts) $(el)] sidecar started"
waitfor "UP after restart" 15 "st 19310 | grep -q 'last=UP'"
st 19310; inst $T $SVC; feed $T
echo "### STEP F: a second pod of the same service: rollup over two pods"
pod vs4-pod2 -p 127.0.0.1:19312:9465 -p 127.0.0.1:19313:8080
app vs4-pod2 vs4-app2 -mode actuator -port 8080
sidecar vs4-pod2 vs4-sc2 $ENV1 -e POD_NAME=vs4-app-7f9c6d5b4-cd34e
waitfor "pod2 UP" 20 "st 19312 | grep -q 'last=UP'"
waitfor "rollup 2 of 2" 10 "mon $T | grep -q '2 of 2 pods UP'"
mon $T
curl -s -XPOST "127.0.0.1:19313/__set?status=DOWN&db=DOWN" >/dev/null; echo "  [$(ts) $(el)] pod2 app DOWN"
waitfor "rollup '1 of 2 pods UP'" 20 "mon $T | grep -q '1 of 2 pods UP'"
mon $T; sleep 8; echo "  feed 8 s later (no notice expected: 1 of 2 = minHealthyPercent 50):"; feed $T
curl -s -XPOST "127.0.0.1:19311/__set?status=DOWN&db=DOWN" >/dev/null; echo "  [$(ts) $(el)] pod1 app DOWN too"
waitfor "OUTAGE with both pods down" 30 "feed $T | grep -q OUTAGE"
mon $T; feed $T
curl -s -XPOST "127.0.0.1:19311/__set?status=UP&db=UP" >/dev/null; curl -s -XPOST "127.0.0.1:19313/__set?status=UP&db=UP" >/dev/null; echo "  [$(ts) $(el)] both UP"
waitfor "notice retired" 60 "feed $T | grep -q 'feed empty'"
mon $T
echo "### STEP G: SIGTERM pod2's sidecar: leaving report, left=true, exit 0, time to stop"
s=$(date +%s.%N); docker stop -t 30 vs4-sc2 >/dev/null; echo "  docker stop took $(python3 -c "import time;print('%.2fs'%(time.time()-$s))"), exit code $(docker inspect -f '{{.State.ExitCode}}' vs4-sc2)"
docker logs vs4-sc2 2>&1 | tail -3 | jq -c '{level,msg,error}'
sleep 1; inst $T $SVC; mon $T
echo "### STEP H: log shape (JSON lines, levels, messages)"
docker logs vs4-sc1 > $W/work/sc1.log 2>&1; docker logs vs4-sc2 > $W/work/sc2.log 2>&1
echo " sc1:"; logshape $W/work/sc1.log; echo " sc2:"; logshape $W/work/sc2.log
echo " sc1 INFO 'reported' lines:"; jq -c 'select(.msg=="reported") | {time:.time[11:23],status,message}' $W/work/sc1.log
echo "### END $(ts) $(el)"
