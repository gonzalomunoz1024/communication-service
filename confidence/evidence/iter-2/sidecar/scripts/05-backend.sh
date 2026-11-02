#!/bin/bash
# vs2 private backend on :19300, database vs2_main on the shared Mongo; fast sweeps for the lifecycle scenarios
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; W=$S/sidecar2
JAR=$S/communication-service-iter2.jar
if curl -s -m 2 -o /dev/null http://127.0.0.1:19300/actuator/health; then echo "backend :19300 already up"; exit 0; fi
nohup java -jar $JAR --server.port=19300 --spring.data.mongodb.uri=mongodb://localhost:27017/vs2_main \
  --communication.health.sweep-interval-ms=1000 --communication.health.stale-grace-after-start-ms=0 \
  --communication.health.stale-pause-min-silent=1000 --communication.sweep.interval-ms=2000 \
  > $W/logs/backend-19300.txt 2>&1 &
echo "pid $! started $(date -u +%FT%TZ)"
for i in $(seq 1 60); do sleep 1; c=$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:19300/actuator/health/readiness); [ "$c" = 200 ] && { echo "ready after ${i}s: $(curl -s http://127.0.0.1:19300/actuator/health/readiness)"; exit 0; }; done
echo "NOT READY after 60s"; tail -20 $W/logs/backend-19300.txt; exit 1
