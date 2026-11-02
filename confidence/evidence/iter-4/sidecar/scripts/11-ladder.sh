#!/bin/bash
# F-68 / F-69 / F-77: the discovery ladder over four listeners, rediscovery as each disappears, a TLS-only port,
# a redirecting /health, CS_IGNORE_PORTS; reports go to a recording stub backend (:19332).
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
N="vs4-lad-pod vs4-lad-a1 vs4-lad-a2 vs4-lad-a3 vs4-lad-a4 vs4-lad-sc vs4-lad-sc2 vs4-tls-pod vs4-tls-app vs4-tls-sc vs4-red-pod vs4-red-app vs4-red-sc"
cleanup $N
$W/bin/stub -mode backend -port 19332 -ctl 19333 > $W/work/stub-19332.txt 2>&1 & echo $! > $W/work/stub-19332.pid
sleep 0.5
waitfor(){ local d=$1 to=$2; shift 2; local s=$(date +%s.%N)
  for i in $(seq 1 $((to*4))); do if eval "$@" >/dev/null 2>&1; then echo "  [$(ts)] $d after $(python3 -c "import time;print('%.1fs'%(time.time()-$s))")"; return 0; fi; sleep 0.25; done
  echo "  [$(ts)] $d: NOT within ${to}s"; return 1; }
E="-e CS_ENDPOINT=http://172.17.0.1:19332 -e CS_TENANT=vs4-lad -e CS_INTERVAL=2s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=0s"
echo "### STEP 1: 9001 plain 404, 9002 /healthz 200, 9003 Actuator document, 9004 raw TCP: the Actuator port wins"
pod vs4-lad-pod -p 127.0.0.1:19370:9465
app vs4-lad-pod vs4-lad-a1 -mode plain404 -port 9001; app vs4-lad-pod vs4-lad-a2 -mode healthz -port 9002
app vs4-lad-pod vs4-lad-a3 -mode actuator -port 9003; app vs4-lad-pod vs4-lad-a4 -mode tcp -port 9004
sleep 0.5; sidecar vs4-lad-pod vs4-lad-sc $E -e CS_SERVICE=ladder -e POD_NAME=ladder-7f9c6d5b4-x2k4q
waitfor "target found" 10 "st 19370 | grep -q 'target=http'"; st 19370
echo "### STEP 2: stop the Actuator app (9003): rediscovery falls to /healthz on 9002"
docker stop -t 1 vs4-lad-a3 >/dev/null; echo "  [$(ts)] 9003 stopped"
waitfor "target 9002" 15 "st 19370 | grep -q 'target=http://127.0.0.1:9002/healthz'"; st 19370
echo "### STEP 3: stop 9002: '/' on 9001 (a 404 proves the server is up)"
docker stop -t 1 vs4-lad-a2 >/dev/null; echo "  [$(ts)] 9002 stopped"
waitfor "target 9001 /" 15 "st 19370 | grep -q 'target=http://127.0.0.1:9001/ '"; st 19370
echo "### STEP 4: stop 9001: TCP connect to 9004"
docker stop -t 1 vs4-lad-a1 >/dev/null; echo "  [$(ts)] 9001 stopped"
waitfor "target tcp 9004" 15 "st 19370 | grep -q 'target=tcp://127.0.0.1:9004'"; st 19370
echo "### STEP 5: 9003 back: the pinned-by-discovery target stays tcp:9004 (first target kept while it answers)"
docker start vs4-lad-a3 >/dev/null; sleep 6; st 19370
echo "### STEP 6: the reports the stub received (status / message per transition)"
reqs 19332 | jq -c '.[] | select(.body.service=="ladder") | {at:.at[11:23],status:.body.status,message:.body.message}' | uniq -f1 | head -20
echo "  sidecar log:"; docker logs vs4-lad-sc 2>&1 | jq -c 'select(.msg!="reported") | {t:.time[11:23],msg,target}'
echo "### STEP 7: CS_IGNORE_PORTS=9003 with 9003 (Actuator) and 9004 (raw TCP) listening: 9003 is skipped (the first sidecar is stopped: one sidecar per pod)"
docker rm -f vs4-lad-sc >/dev/null
sidecar vs4-lad-pod vs4-lad-sc2 $E -e CS_SERVICE=ladder-ign -e POD_NAME=ladder-ign-0 -e CS_IGNORE_PORTS=9003,15000-15099
sleep 3; docker logs vs4-lad-sc2 2>&1 | jq -c 'select(.msg=="health target found") | {msg,target}'
echo "### STEP 8: a TLS-only app port (self-signed for localhost): https after the plain-HTTP hint"
pod vs4-tls-pod -p 127.0.0.1:19371:9465
docker run -d --name vs4-tls-app --network container:vs4-tls-pod --user 1001:0 -v $W/bin:/vs4:ro $STUBIMG /vs4/stub -mode actuator -port 9006 -tls -cert /vs4/tls/srv.pem -key /vs4/tls/srv.key >/dev/null
sleep 0.5; sidecar vs4-tls-pod vs4-tls-sc $E -e CS_SERVICE=tls-app -e POD_NAME=tls-app-0
waitfor "TLS target" 10 "st 19371 | grep -q 'target=https'"; st 19371
echo "### STEP 9: /health answers 302 to /elsewhere (everything else 404): a redirect is an answer, not followed"
pod vs4-red-pod -p 127.0.0.1:19372:9465
app vs4-red-pod vs4-red-app -mode redirect -port 9007; sleep 0.5
sidecar vs4-red-pod vs4-red-sc $E -e CS_SERVICE=redirect-app -e POD_NAME=redirect-app-0
waitfor "target found" 10 "st 19372 | grep -q 'target=http'"; st 19372
echo "  (had the 302 been followed, /elsewhere would answer 404 = not UP on a health path, and the target would be '/' instead)"
cleanup $N; kill $(cat $W/work/stub-19332.pid)
echo "end $(ts)"
