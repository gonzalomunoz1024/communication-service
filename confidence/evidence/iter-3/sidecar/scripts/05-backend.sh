#!/bin/bash
# Private backends for the sidecar verification (never the shared :8080).
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; W=$S/sidecar3
JAR=$S/communication-service-iter3.jar
FAST="--communication.health.sweep-interval-ms=1000 --communication.health.stale-grace-after-start-ms=0 --communication.health.stale-pause-min-silent=1000 --communication.sweep.interval-ms=2000"
start(){ # $1 port, $2 mongo uri, $3 log
  nohup java -Xmx384m -jar $JAR --server.port=$1 --spring.data.mongodb.uri=$2 $FAST > $3 2>&1 &
  echo "pid=$! port=$1 uri=$2"
}
case "$1" in
  A) start 19300 mongodb://localhost:27017/vs3_main $W/logs/backend-19300.txt ;;
  A2) start 19303 mongodb://localhost:27017/vs3_main $W/logs/backend-19303.txt ;;
  B) docker ps -a --format '{{.Names}}' | grep -qx vs3-mongo || docker run -d --name vs3-mongo -p 127.0.0.1:19301:27017 mongo:7.0 >/dev/null
     sleep 3; start 19302 mongodb://127.0.0.1:19301/vs3_db $W/logs/backend-19302.txt ;;
esac
