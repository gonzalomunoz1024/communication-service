# shared settings of the E2E verifier's private stack (iteration 4: the iteration-3 stack on the iteration-4 jar)
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e4
OUT=$S/out
REPO=/home/claude/communication-service
JAR=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter4.jar
MONGO_PORT=19527
A_PORT=19501
B_PORT=19502
UI_PORT=19530
POD_APP_PORT=19540      # e2e4-netns: host -> fake app :8080
POD_STATUS_PORT=19541   # e2e4-netns: host -> sidecar /status :9465
POD2_APP_PORT=19542
POD2_STATUS_PORT=19543
STUB_PORT=19551         # e2e4-stub: a fakeapp the backend pull-probes
CAPTURE_PORT=19560      # capture.js: a stub backend that records the sidecar's wire requests
DB=ve4_main
GATEWAY=172.17.0.1      # the docker bridge gateway = this host, as containers see it
stamp() { date -u +%FT%T.%3NZ; }
wait_http() { # wait_http <what> <url> <expected-substring> [seconds]
  local what=$1 url=$2 want=$3 secs=${4:-120} start=$SECONDS
  until curl -sS -m 3 -H 'X-Client-Id: ve4-stack' "$url" 2>/dev/null | grep -q -- "$want"; do
    if (( SECONDS - start >= secs )); then echo "$(stamp) GAVE UP waiting for $what ($url)"; return 1; fi
    sleep 1
  done
  echo "$(stamp) $what ready after $((SECONDS - start)) s"
}
SLOW_PORT=19552         # forced_probes.js: a 3 s health target for G-4-4
