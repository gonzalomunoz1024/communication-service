#!/usr/bin/env bash
# start-backend.sh <A|B> : one backend instance of the private stack (same Mongo database for both = one cluster)
source "$(dirname "$0")/env.sh"
which=$1
case $which in A) port=$A_PORT;; B) port=$B_PORT;; *) echo "A or B"; exit 2;; esac
log=$OUT/backend$which.txt
echo "## $(stamp) starting backend $which on :$port (log appended)" >> "$log"
nohup java -Xmx1g -jar "$JAR" --server.port=$port \
  --spring.data.mongodb.uri=mongodb://localhost:$MONGO_PORT/$DB \
  --communication.sweep.interval-ms=2000 \
  --communication.health.sweep-interval-ms=1000 \
  --communication.health.stale-grace-after-start-ms=0 \
  >> "$log" 2>&1 &
echo $! > "$S/backend$which.pid"
echo "backend $which pid $(cat "$S/backend$which.pid")"
