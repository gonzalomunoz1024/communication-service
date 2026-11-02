#!/bin/sh
# Scenario A: SIGTERM the backend while an SSE subscriber is connected directly (no proxy). Does the JVM exit? Does the stream close?
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
PORT=$(cat $S/frontend/aux-port.txt); JAR=$S/communication-service.jar
jpid() { ps -eo pid,args | grep java | grep "server.port=$PORT" | grep -v grep | awk '{print $1}' | head -1; }
nohup java -jar $JAR --server.port=$PORT --spring.data.mongodb.uri=mongodb://localhost:27017/fe_reconnect > $S/frontend/backend-aux-sigterm.txt 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null -H 'X-Client-Id: fe-verifier' "http://127.0.0.1:$PORT/v1/feed?tenantId=x" && break; sleep 1; done
echo "backend up, pid $(jpid)"
T=fe-sigterm-$(date +%s)
curl -s -o /dev/null -w "seed %{http_code}\n" -H 'X-Client-Id: fe-verifier' -X POST http://127.0.0.1:$PORT/v1/communications -H 'Content-Type: application/json' -d "{\"tenantId\":\"$T\",\"publisher\":\"p\",\"type\":\"OUTAGE\",\"severity\":\"MAJOR\",\"title\":\"seed\"}"
node $S/frontend/sse-client.js "http://127.0.0.1:$PORT/v1/feed/stream?tenantId=$T" 45 > $S/frontend/sigterm-sse.txt 2>&1 &
SSEPID=$!
sleep 3
P=$(jpid); echo "sending SIGTERM to java pid $P at $(date -u +%T)"; kill -TERM $P
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do sleep 2; if ps -p $P > /dev/null 2>&1; then ALIVE=yes; else ALIVE=no; fi; NEW=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Client-Id: fe-verifier' "http://127.0.0.1:$PORT/v1/feed?tenantId=x" 2>/dev/null); echo "+$((i*2))s after SIGTERM: java alive=$ALIVE, new GET -> ${NEW:-refused}"; [ "$ALIVE" = no ] && break; done
wait $SSEPID
echo "--- SSE client log:"; cat $S/frontend/sigterm-sse.txt
echo "--- backend shutdown log lines:"; grep -iE "shutdown|graceful|stopping|closed|Commencing" $S/frontend/backend-aux-sigterm.txt | tail -5 | cut -c1-160
if ps -p $P > /dev/null 2>&1; then echo "java still alive after the scenario; SIGKILL it"; kill -9 $P; fi
echo "SCENARIO_A_DONE"
