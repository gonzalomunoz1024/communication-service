#!/bin/bash
# Frontend Verifier iter-2 private infrastructure (ports 3200-3209 / 19200-19299, containers vf2-*, Mongo dbs vf2_*).
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend2
JAR=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter2.jar
FE=/home/claude/communication-service/frontend
mkdir -p $S/logs
java_pid() { ps -eo pid,args | grep "[s]erver.port=$1" | awk '{print $1}' | head -1; }
start_backend() { # port db [extra args...]
  local port=$1 db=$2; shift 2
  [ -n "$(java_pid $port)" ] && { echo "backend :$port already running (pid $(java_pid $port))"; return; }
  nohup java -jar $JAR --server.port=$port --spring.data.mongodb.uri=mongodb://localhost:27017/$db "$@" >> $S/logs/backend-$port.txt 2>&1 &
  echo "backend :$port db=$db pid $! extra: $*"
}
start_backend_uri() { # port mongo-uri [extra args...]
  local port=$1 uri=$2; shift 2
  [ -n "$(java_pid $port)" ] && { echo "backend :$port already running"; return; }
  nohup java -jar $JAR --server.port=$port --spring.data.mongodb.uri=$uri "$@" >> $S/logs/backend-$port.txt 2>&1 &
  echo "backend :$port uri=$uri pid $!"
}
start_vite() { # port backend-url
  local port=$1 be=$2
  (cd $FE && COMM_BACKEND=$be nohup npx vite --host 127.0.0.1 --port $port --strictPort >> $S/logs/vite-$port.txt 2>&1 &)
  echo "vite :$port -> $be"
}
start_rp() { # port backendPort distDir [env...]
  local port=$1 be=$2 dist=$3; shift 3
  (cd $S/scripts && env "$@" nohup node rp.js $port $be $dist >> $S/logs/rp-$port.txt 2>&1 &)
  echo "rp :$port -> :$be ($dist)"
}
wait_http() { # url expected-code timeout-s
  local t0=$SECONDS
  while (( SECONDS - t0 < ${3:-90} )); do
    code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' -H 'X-Client-Id: vf2-verifier' "$1"); [ "$code" = "$2" ] && { echo "ready $1 ($((SECONDS-t0)) s)"; return 0; }
    sleep 1
  done
  echo "TIMEOUT $1 last=$code"; return 1
}
case "$1" in
  up)
    start_backend 19200 vf2_reconnect --communication.servicenow.instance-url=https://vf2.service-now.com --communication.sweep.interval-ms=2000 --communication.health.sweep-interval-ms=1000
    start_backend 19201 vf2_reconnect --communication.servicenow.instance-url=https://vf2.service-now.com --communication.sweep.interval-ms=2000 --communication.health.sweep-interval-ms=1000
    docker ps -a --format '{{.Names}}' | grep -q '^vf2-mongo$' || docker run -d --name vf2-mongo -p 127.0.0.1:27117:27017 mongo:7.0 >/dev/null && echo "mongo vf2-mongo :27117"
    sleep 3
    start_backend_uri 19202 mongodb://localhost:27117/vf2_mongodown --communication.sweep.interval-ms=2000
    start_vite 3200 http://127.0.0.1:19200
    start_vite 3201 http://127.0.0.1:19202
    start_vite 3206 http://127.0.0.1:1
    start_rp 3202 8080 $S/dist-default-tenant
    start_rp 3203 8080 $S/dist-xorigin
    start_rp 3204 8080 $S/dist-badclientid
    start_rp 3205 19200 $S/dist
    ;;
  pod)
    docker rm -f vf2-app vf2-sidecar >/dev/null 2>&1
    docker run -d --name vf2-app -p 127.0.0.1:19290:8080 -p 127.0.0.1:19291:9465 fakeapp:ci >/dev/null && echo "vf2-app up (19290 app, 19291 sidecar status)"
    docker run -d --name vf2-sidecar --network container:vf2-app --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges \
      -e CS_ENDPOINT=http://172.17.0.1:19200 -e CS_TENANT=${POD_TENANT:-vf2-pod} -e CS_SERVICE=vf2-fake-app -e CS_CLIENT_ID=vf2-fakeapp-repo \
      -e POD_NAME=vf2-fake-app-5d7c9b8f6-q1w2e -e POD_NAMESPACE=vf2-ns -e NODE_NAME=worker-1 -e CS_CLUSTER=sandbox -e CS_VERSION=1.0.0 \
      -e CS_INTERVAL=2s -e CS_HEARTBEAT=6s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=30s health-sidecar:ci >/dev/null && echo "vf2-sidecar up"
    ;;
  wait)
    wait_http http://127.0.0.1:19200/actuator/health 200 120
    wait_http http://127.0.0.1:19201/actuator/health 200 120
    wait_http http://127.0.0.1:19202/actuator/health 200 120
    for p in 3200 3201 3206 3202 3203 3204 3205; do wait_http http://127.0.0.1:$p/ 200 30; done
    ;;
  status)
    for p in 19200 19201 19202; do echo "backend :$p pid=$(java_pid $p) health=$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:$p/actuator/health)"; done
    for p in 3200 3201 3202 3203 3204 3205 3206; do echo "front :$p $(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:$p/)"; done
    docker ps --filter name=vf2- --format '{{.Names}} {{.Status}} {{.Ports}}'
    ;;
  kill-backend) kill -9 $(java_pid $2) && echo "killed :$2";;
  start-backend) shift; start_backend "$@";;
  down)
    for p in 19200 19201 19202; do pid=$(java_pid $p); [ -n "$pid" ] && kill $pid && echo "stopped backend :$p"; done
    pkill -f "vite --host 127.0.0.1 --port 320" && echo "stopped vite 320x"
    pkill -f "node rp.js 320" && echo "stopped rp 320x"
    docker rm -f vf2-app vf2-sidecar vf2-mongo 2>/dev/null
    ;;
  *) echo "usage: infra.sh up|pod|wait|status|kill-backend <port>|start-backend <port> <db> [args]|down";;
esac
