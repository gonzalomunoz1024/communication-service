#!/bin/bash
# 18 (G-4-25, the "rejected" half of README L276-279): sends REJECTED (400, then 401) and then accepted (202), at the
# default log level: expect ERROR "report rejected" lines, then ONE INFO "report delivered again" with status,
# failedAttempts and failingFor. Stub service :19350 (ctl :19351), sidecar /status on :19352.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
N="vs4-rj-pod vs4-rj-app vs4-rj-sc"; cleanup $N
$W/bin/stub -mode backend -port 19350 -ctl 19351 > $W/work/stub-19350.txt 2>&1 & SP=$!; sleep 0.4
pod vs4-rj-pod -p 127.0.0.1:19352:9465; app vs4-rj-pod vs4-rj-app -mode actuator -port 8080; sleep 0.3
echo "start $(ts) (CS_INTERVAL=2s CS_HEARTBEAT=4s, default CS_LOG_LEVEL)"
curl -s "127.0.0.1:19350/__code?c=400" >/dev/null; echo "  [$(ts)] the service answers 400"
sidecar vs4-rj-pod vs4-rj-sc -e CS_ENDPOINT=http://172.17.0.1:19350 -e CS_TENANT=vs4-rj -e CS_SERVICE=rj -e POD_NAME=rj-0 -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_STARTUP_GRACE=0s
sleep 7; curl -s "127.0.0.1:19350/__code?c=401" >/dev/null; echo "  [$(ts)] the service answers 401"
sleep 7; curl -s "127.0.0.1:19350/__code?c=202" >/dev/null; echo "  [$(ts)] the service answers 202"
sleep 9
echo "  /status: $(raw 19352 | jq -c '{reportsSent, lastSendAt:(.lastSendAt // "" | .[11:23]), sendError}')"
echo "  every log line of the sidecar (default level):"
docker logs vs4-rj-sc 2>&1 | jq -c '{t:.time[11:23],level,msg,status,failedAttempts,failingFor,error:((.error // "")|.[0:70])}' | sed 's/^/    /'
echo "  answers the stub gave: $(reqs 19350 | jq -c '[.[] | .answer] | group_by(.) | map({(.[0]|tostring): length}) | add')"
cleanup $N; kill $SP 2>/dev/null; echo "end $(ts)"
