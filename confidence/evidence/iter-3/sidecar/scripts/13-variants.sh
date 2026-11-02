#!/bin/bash
# F-71 / F-72 / F-73 / F-75 / F-78: flap damping, pinned targets, ignore-ports + grace, own endpoints,
# ReadHeaderTimeout, 253/254-character instance ids (private backend A).
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
N="vs3-var-pod vs3-var-app vs3-flap-pod vs3-flap-app vs3-flap-sc vs3-pin1 vs3-pin2 vs3-pin3 vs3-pin4 vs3-pin5 vs3-ign vs3-id-pod vs3-id-app vs3-id253 vs3-id254"
cleanup $N
$W/bin/stub -mode backend -port 19334 -ctl 19335 > $W/work/stub-19334.txt 2>&1 & echo $! > $W/work/stub-19334.pid
sleep 0.5
E="-e CS_ENDPOINT=http://172.17.0.1:19334 -e CS_TENANT=vs3-var -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s"
pod vs3-var-pod -p 127.0.0.1:19360:9465 -p 127.0.0.1:19361:8080 -p 127.0.0.1:19362:9466 -p 127.0.0.1:19363:9467 -p 127.0.0.1:19364:9468 -p 127.0.0.1:19365:9469 -p 127.0.0.1:19366:9470 -p 127.0.0.1:19367:9471 -p 127.0.0.1:19368:9472
app vs3-var-pod vs3-var-app -mode actuator -port 8080; sleep 0.5
echo "### CASE 1: flap damping, default CS_RETRY_DELAY (2s): the app fails exactly one request (own pod and app)"
pod vs3-flap-pod -p 127.0.0.1:19369:8080; app vs3-flap-pod vs3-flap-app -mode actuator -port 8080; sleep 0.5
sidecar vs3-flap-pod vs3-flap-sc $E -e CS_SERVICE=flap -e POD_NAME=flap-0
sleep 3; curl -s -XPOST "127.0.0.1:19369/__failnext?n=1" >/dev/null; echo "  [$(ts)] one failing answer armed"; sleep 8
echo "  armed failures left unconsumed: $(curl -s 127.0.0.1:19369/__left); statuses reported: $(reqs 19334 | jq -r '[.[] | select(.body.service=="flap") | .body.status] | join(",")')"
cleanup vs3-flap-sc vs3-flap-app vs3-flap-pod
echo "### CASE 2: CS_RETRY_DELAY=0: the same single failure is reported (own pod and app)"
pod vs3-flap-pod -p 127.0.0.1:19369:8080; app vs3-flap-pod vs3-flap-app -mode actuator -port 8080; sleep 0.5
sidecar vs3-flap-pod vs3-flap-sc $E -e CS_SERVICE=flap0 -e POD_NAME=flap0-0 -e CS_RETRY_DELAY=0s
sleep 3; curl -s -XPOST "127.0.0.1:19369/__failnext?n=1" >/dev/null; echo "  [$(ts)] one failing answer armed"; sleep 8
echo "  armed failures left unconsumed: $(curl -s 127.0.0.1:19369/__left); statuses reported: $(reqs 19334 | jq -r '[.[] | select(.body.service=="flap0") | .body.status] | join(",")')"
cleanup vs3-flap-sc vs3-flap-app vs3-flap-pod
echo "### CASE 3: pinned targets (discovery off)"
for spec in "pin1 9467 -e CS_PORT=8080 -e CS_PATH=/ping" "pin2 9468 -e CS_PROBE=tcp -e CS_PORT=8080 -e CS_PATH=/ignored" "pin3 9469 -e CS_PROBE=actuator -e CS_PORT=8080" "pin4 9470 -e CS_PROBE=http -e CS_PORT=8080" "pin5 9471 -e CS_PORT=8080 -e CS_PATH=actuator/health -e CS_SCHEME=HTTP"; do
  set -- $spec; n=$1; l=$2; shift 2
  sidecar vs3-var-pod vs3-$n $E -e CS_SERVICE=$n -e POD_NAME=$n-0 -e CS_LISTEN=:$l "$@"
done
sleep 4
for p in 19363:pin1 19364:pin2 19365:pin3 19366:pin4 19367:pin5; do echo "  ${p#*:}: $(st ${p%:*})"; done
echo "### CASE 4: every port ignored, grace 6s: UNKNOWN 'starting', then 'no health target found after 6s'"
sidecar vs3-var-pod vs3-ign $E -e CS_SERVICE=ign -e POD_NAME=ign-0 -e CS_LISTEN=:9472 -e CS_IGNORE_PORTS=1-65535 -e CS_STARTUP_GRACE=6s -e CS_LOG_LEVEL=debug
sleep 2; echo "  +2s: $(st 19368)"; sleep 7; echo "  +9s: $(st 19368)"
echo "  ign reports: $(reqs 19334 | jq -c '[.[] | select(.body.service=="ign") | {at:.at[17:23],s:.body.status,m:.body.message}]')"
echo "### CASE 5: the sidecar's own endpoints"
curl -s -D - 127.0.0.1:19360/healthz | grep -iE '^HTTP|content-type|^ok'
curl -s -D - -o /dev/null 127.0.0.1:19360/status | grep -iE '^HTTP|content-type'
for u in /nope /status/x /; do echo "  GET $u -> $(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:19360$u)"; done
for u in /healthz /status; do echo "  POST $u -> $(curl -s -o /dev/null -w '%{http_code}' -XPOST 127.0.0.1:19360$u)"; done
echo "  /status keys (healthy): $(raw 19360 | jq -c 'keys')"
s=$(date +%s.%N); python3 -I -c "
import socket,time
s=socket.create_connection(('127.0.0.1',19360)); s.settimeout(30); t=time.time()
try:
    d=s.recv(100); print('  silent client (no request line): server closed after %.1fs, got %r' % (time.time()-t, d[:60]))
except Exception as e: print('  silent client: no close within 30 s:', e)
"
echo "### CASE 6: instance id of 253 and 254 characters against private backend A (limit 253)"
pod vs3-id-pod; app vs3-id-pod vs3-id-app -mode actuator -port 8080; sleep 0.5
ID253=$(python3 -c "print('p'*253)"); ID254=$(python3 -c "print('p'*254)")
sidecar vs3-id-pod vs3-id253 -e CS_ENDPOINT=$BEC -e CS_TENANT=vs3-var -e CS_SERVICE=id-len -e CS_INSTANCE_ID=$ID253 -e CS_INTERVAL=2s
sidecar vs3-id-pod vs3-id254 -e CS_ENDPOINT=$BEC -e CS_TENANT=vs3-var -e CS_SERVICE=id-len -e CS_INSTANCE_ID=$ID254 -e CS_INTERVAL=2s -e CS_LISTEN=:9466
sleep 5
echo "  253: $(docker logs vs3-id253 2>&1 | jq -c 'select(.msg=="reported" or .msg=="report rejected") | {level,msg,error:(.error // "" | .[0:150])}' | head -2 | tr '\n' ' ')"
echo "  254: $(docker logs vs3-id254 2>&1 | jq -c 'select(.msg=="reported" or .msg=="report rejected") | {level,msg,error:(.error // "" | .[0:200])}' | head -2 | tr '\n' ' ')"
echo "  254 sends in 5 s at a 2 s interval (a permanent rejection waits for the heartbeat): $(docker logs vs3-id254 2>&1 | grep -c 'report rejected')"
echo "  instances: $(inst vs3-var id-len | cut -c1-60)"
cleanup $N; kill $(cat $W/work/stub-19334.pid)
echo "end $(ts)"
