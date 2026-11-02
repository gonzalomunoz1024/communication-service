#!/bin/bash
# 45: CS_HOST (sidecar README L215: "addresses tried for the app", default 127.0.0.1,::1). An app bound to
# exactly one address in an emulated pod; the sidecar with the default and with each address alone.
W=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4
source $W/scripts/lib.sh
cleanup vs4-v6 vs4-v6-app vs4-v6-sc
pod vs4-v6 -p 19390:9465
summ(){ python3 -I -c '
import json,sys
d=json.load(sys.stdin); lr=d.get("lastReport") or {}
print("target=%s lastTarget=%s upSeen=%s sendError=%s | lastReport.status=%s message=%r" % (d.get("target"), d.get("lastTarget"), d.get("upSeen"), d.get("sendError"), lr.get("status"), lr.get("message")))'; }
case_(){ # $1 label, $2 app address, $3 pod suffix, $4 CS_HOST ("" = default)
  cleanup vs4-v6-app vs4-v6-sc
  echo "== $1"
  docker run -d --name vs4-v6-app --network container:vs4-v6 --user 1001:0 -v $W/bin:/vs4:ro $STUBIMG /vs4/v6app "$2" >/dev/null
  sleep 1
  echo "  app: $(docker logs vs4-v6-app 2>&1 | tail -1 | cut -c21-)"
  local h=(); [ -n "$4" ] && h=(-e "CS_HOST=$4")
  sidecar vs4-v6 vs4-v6-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=vs4-v6 -e POD_NAME=v6svc-7f9c6d5b4-$3 -e CS_INTERVAL=3s -e CS_LOG_LEVEL=debug "${h[@]}"
  sleep 9
  echo "  CS_HOST=${4:-(default)}  /status: $(raw 19390 | summ)"
  docker logs vs4-v6-sc > $W/logs/45-$3.txt 2>&1
  echo "  sidecar log lines (level msg, count):"; logshape $W/logs/45-$3.txt | grep -v '^ *keys' | head -8
  grep -o '"target":"[^"]*"\|"error":"[^"]*"\|"hint":"[^"]*"' $W/logs/45-$3.txt | sort | uniq -c | head -5 | sed 's/^/   /'
}
echo "## 45: CS_HOST, $(ts) UTC; image $IMG; backend A ($BEC), tenant vs4-v6"
case_ "A. app on [::1]:8080 only, CS_HOST default"           '[::1]:8080'     v6a ""
case_ "B. app on [::1]:8080 only, CS_HOST=127.0.0.1"         '[::1]:8080'     v6b "127.0.0.1"
case_ "C. app on 127.0.0.1:8080 only, CS_HOST=::1"           '127.0.0.1:8080' v6c "::1"
case_ "D. app on 127.0.0.1:8080 only, CS_HOST default (control)" '127.0.0.1:8080' v6d ""
echo "== service side (backend A), monitor v6svc, after the four runs"
mon vs4-v6 | head -3
inst vs4-v6 v6svc | head -6
cleanup vs4-v6 vs4-v6-app vs4-v6-sc
echo "containers removed: $(docker ps -a --format '{{.Names}}' | grep -c '^vs4-v6') left"
