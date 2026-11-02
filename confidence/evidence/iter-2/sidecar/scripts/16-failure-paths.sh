#!/bin/bash
# vs2 F-92 (sidecar side): slow backend (> CS_REPORT_TIMEOUT), backend down then back, Mongo paused behind a private backend (:19302 on vs2-mongo) -> 503 retried, recovery without restart
. $(dirname $0)/lib.sh; P=vs2-fail
status(){ st 19380; }
docker rm -f $P-sidecar $P-backend $P-app $P >/dev/null 2>&1
docker run -d --name $P -p 127.0.0.1:19380:9465 -p 127.0.0.1:19381:9100 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name $P-backend --network container:$P $V $IMG /bin-ro/stub -mode backend -port 9100 -code 202 >/dev/null
docker run -d --name $P-app --network container:$P fakeapp:ci >/dev/null; sleep 1
COMMON="--network container:$P $SEC -e CS_TENANT=vs2-fail -e CS_SERVICE=fail-app -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_IGNORE_PORTS=9100 -e POD_NAME=fail-app-1"
echo "[$(ts)] CASE 1 (slow backend): stub delays every answer 7000 ms > CS_REPORT_TIMEOUT=5s (default) -> timeout error, backoff; delay removed -> accepted"
docker run -d --name $P-sidecar $COMMON -e CS_ENDPOINT=http://127.0.0.1:9100 health-sidecar:vs2 >/dev/null; sleep 4; echo "  $(status)"
curl -s -X POST 'http://127.0.0.1:19381/__delay?ms=7000' >/dev/null; LOGMARK=$(date -u +%FT%T.%NZ); sleep 14; echo "  $(status)"; docker logs --since "$LOGMARK" $P-sidecar 2>&1 | head -3 | cut -c1-300
curl -s -X POST 'http://127.0.0.1:19381/__delay?ms=0' >/dev/null; sleep 10; echo "  after removing the delay: $(status)"
echo "[$(ts)] CASE 2 (backend down, then back): stop the stub container -> connection refused with 1,2,4,8 s backoff; start it -> next retry accepted"
LOGMARK=$(date -u +%FT%T.%NZ); docker stop -t 1 $P-backend >/dev/null; sleep 16; echo "  $(status)"; docker logs --since "$LOGMARK" $P-sidecar 2>&1 | grep -oE '"msg":"[^"]+".*"in":"[^"]+"' | cut -c1-200 | sed 's/"error":"[^"]*"//' 
docker start $P-backend >/dev/null; sleep 12; echo "  after the stub is back: $(status)"; docker logs --since "$LOGMARK" $P-sidecar 2>&1 | grep -E '"reported"' | tail -1 | cut -c1-200
docker rm -f $P-sidecar $P-backend $P-app $P >/dev/null 2>&1
echo "[$(ts)] CASE 3 (Mongo down behind the service): private Mongo vs2-mongo (:19301) + private backend :19302 (db vs2_mdown); pause Mongo -> service answers 503 -> sidecar retries (not permanent); unpause -> accepted"
docker rm -f vs2-mongo >/dev/null 2>&1; docker run -d --name vs2-mongo -p 127.0.0.1:19301:27017 mongo:7.0 >/dev/null; sleep 4
nohup java -jar $S/communication-service-iter2.jar --server.port=19302 --spring.data.mongodb.uri=mongodb://localhost:19301/vs2_mdown --communication.health.sweep-interval-ms=1000 --communication.health.stale-grace-after-start-ms=0 > $W/logs/backend-19302.txt 2>&1 &
BPID=$!; for i in $(seq 1 60); do sleep 1; [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:19302/actuator/health/readiness)" = 200 ] && { echo "  backend :19302 ready after ${i}s (pid $BPID)"; break; }; done
docker run -d --name $P -p 127.0.0.1:19380:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null; docker run -d --name $P-app --network container:$P fakeapp:ci >/dev/null; sleep 1
docker run -d --name $P-sidecar $COMMON -e CS_ENDPOINT=http://172.17.0.1:19302 health-sidecar:vs2 >/dev/null; sleep 5; echo "  $(status)"
echo "  monitor before: $(curl -s -H 'X-Client-Id: vs2-verifier' 'http://127.0.0.1:19302/v1/health/monitors?tenantId=vs2-fail' | python3 $W/j.py mon)"
LOGMARK=$(date -u +%FT%T.%NZ); docker pause vs2-mongo; T0=$(date +%s); echo "  [$(ts)] Mongo paused"
printf "  direct POST while Mongo is paused: "; T1=$(date +%s.%N); curl -s -o /tmp/vs2-b -w '%{http_code}' -m 40 -H 'X-Client-Id: vs2-verifier' -H 'Content-Type: application/json' -X POST http://127.0.0.1:19302/v1/health/reports -d '{"tenantId":"vs2-fail","service":"direct","status":"UP"}'; echo " $(cat /tmp/vs2-b | cut -c1-120) after $(python3 -c "print(round($(date +%s.%N)-$T1,1))") s"
sleep 20; echo "  $(status)"; docker logs --since "$LOGMARK" $P-sidecar 2>&1 | grep -E 'report failed|rejected' | head -3 | cut -c1-260
docker unpause vs2-mongo; echo "  [$(ts)] Mongo unpaused"; sleep 20; echo "  $(status)"; docker logs --since "$LOGMARK" $P-sidecar 2>&1 | grep -E '"reported"' | tail -1 | cut -c1-200
echo "  monitor after: $(curl -s -H 'X-Client-Id: vs2-verifier' 'http://127.0.0.1:19302/v1/health/monitors?tenantId=vs2-fail' | python3 $W/j.py mon)"
docker rm -f $P-sidecar $P-app $P >/dev/null 2>&1; kill $BPID 2>/dev/null; sleep 2; docker rm -f vs2-mongo >/dev/null 2>&1; echo "[$(ts)] DONE (backend :19302 and vs2-mongo removed)"
