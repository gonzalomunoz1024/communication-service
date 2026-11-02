#!/bin/bash
# F-46 TTL index (read-only query on the shared Mongo through a client container, my own database vs4_main) and F-76 "skipped if nothing was ever
# composed": SIGTERM 1 s after start, while the first probe of a pinned app that never answers is still running.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
echo "### F-46: indexes of vs4_main.health_instances (a throw-away mongosh client container on the host network; nothing exec'd into mongo7)"
timeout 60 docker run --rm --name vs4-mongosh --network host mongo:7.0 mongosh --quiet mongodb://127.0.0.1:27017/vs4_main --eval 'JSON.stringify(db.health_instances.getIndexes().map(i=>({name:i.name,key:i.key,expireAfterSeconds:i.expireAfterSeconds})))'; echo "exit $?"
echo "### F-76: SIGTERM during the first tick (pinned app that never answers, default 3 s probe timeout); recording stub :19348"
N="vs4-es-pod vs4-es-app vs4-es-sc"; cleanup $N
$W/bin/stub -mode backend -port 19348 -ctl 19349 > $W/work/stub-19348.txt 2>&1 & echo $! > $W/work/stub-19348.pid; sleep 0.4
pod vs4-es-pod -p 127.0.0.1:19388:8080; app vs4-es-pod vs4-es-app -mode backend -port 8080; sleep 0.3; curl -s "127.0.0.1:19388/__delay?ms=600000" >/dev/null
sidecar vs4-es-pod vs4-es-sc -e CS_ENDPOINT=http://172.17.0.1:19348 -e CS_TENANT=vs4-es -e CS_SERVICE=early -e POD_NAME=early-0 -e CS_PORT=8080 -e CS_PATH=/actuator/health -e CS_LOG_LEVEL=debug
sleep 1; s=$(date +%s.%N); docker stop -t 15 vs4-es-sc >/dev/null; echo "  docker stop returned after $(python3 -c "print(round($(date +%s.%N)-$s,2))") s, exit $(docker inspect -f '{{.State.ExitCode}}' vs4-es-sc)"
echo "  sidecar log:"; docker logs vs4-es-sc 2>&1 | jq -c '{t:.time[11:23],level,msg,status,message,error:((.error // "")|.[0:120])}'
echo "  reports the service received: $(reqs 19349 | jq -c '[.[] | {at:.at[11:23], status:.body.status, message:.body.message, leaving:.body.instance.leaving}]')"
cleanup $N; kill $(cat $W/work/stub-19348.pid); echo "end $(ts)"
