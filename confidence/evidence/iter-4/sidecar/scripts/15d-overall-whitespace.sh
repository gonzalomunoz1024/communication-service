#!/bin/bash
# G-4-16 residual check: white-space-only words as the app's OVERALL status, through the sidecar to private backend A.
# The sidecar trims chars <= U+0020 and passes any other word through upper-cased; the service's @NotBlank on status
# uses Character.isWhitespace (U+2003 is white space there, U+00A0 is not). A pod that was UP then answers "\u2003".
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
T=vs4-ows; BS=$'\x5c'
WORDS=( ' ' "${BS}u0001" "${BS}u00a0" "${BS}u2003" )
N=""; for k in 0 1 2 3; do N="$N vs4-ows$k-pod vs4-ows$k-app vs4-ows$k-sc"; done; N="$N vs4-owsw-pod vs4-owsw-app vs4-owsw-sc"
cleanup $N
for k in 0 1 2 3; do pod vs4-ows$k-pod; app vs4-ows$k-pod vs4-ows$k-app -mode actuator -port 8080; done
pod vs4-owsw-pod -p 127.0.0.1:19393:8080; app vs4-owsw-pod vs4-owsw-app -mode actuator -port 8080
sleep 1
for k in 0 1 2 3; do w=${WORDS[$k]}
  pid=$(docker inspect -f '{{.State.Pid}}' vs4-ows$k-pod)
  nsenter -t $pid -n curl -s -XPOST "http://127.0.0.1:8080/__doc?code=200" --data-binary '{"status":"'"$w"'"}' >/dev/null
  sidecar vs4-ows$k-pod vs4-ows$k-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=ows-$k -e POD_NAME=ows-$k-0 -e CS_INTERVAL=3s -e CS_HEARTBEAT=30s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug
done
echo "### A. overall status words (HTTP 200) from the start; 20 s"
sleep 20
for k in 0 1 2 3; do w=${WORDS[$k]}
  echo "  \"$w\": sidecar lastReport.status=$(docker logs vs4-ows$k-sc 2>&1 | jq -r 'select(.msg=="reported" or .msg=="report rejected") | .status // "-"' | tail -1 | od -An -c | tr -s ' ' | head -1) log: $(docker logs vs4-ows$k-sc 2>&1 | jq -c 'select(.msg=="reported" or .msg=="report rejected") | {level,msg,error:((.error // "")|.[0:90])}' | sort | uniq -c | tr -s ' ' | paste -sd' ') service: $(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r --arg s ows-$k '.[] | select(.service==$s) | "\(.state.lastStatus) | \(.state.lastSummary)"')"
done
echo "### B. a pod that was UP, then its app answers {\"status\":\"\\u2003\"} (HTTP 200): what the service makes of it over 110 s"
sidecar vs4-owsw-pod vs4-owsw-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=ows-switch -e POD_NAME=ows-switch-7f9c6d5b4-x2k4q -e CS_INTERVAL=3s -e CS_HEARTBEAT=30s -e CS_STARTUP_GRACE=0s
sleep 6; echo "  [$(ts)] before: $(mon $T | grep ows-switch)"
curl -s -XPOST "127.0.0.1:19393/__doc?code=200" --data-binary '{"status":"'"${BS}u2003"'"}' >/dev/null; echo "  [$(ts)] app now answers {\"status\":\"\\u2003\"}"
for i in $(seq 1 11); do sleep 10; echo "  [$(ts)] $(mon $T | grep ows-switch | sed -E 's/ id=[^ ]+//; s/publisher=[^ ]+ //')"; done
echo "  sidecar log: $(docker logs vs4-owsw-sc 2>&1 | jq -c 'select(.level!="DEBUG") | {t:.time[11:23],level,msg,status,error:((.error // "")|.[0:100])}' | tail -4 | paste -sd' ')"
echo "  feed: $(feed $T | grep ows-switch)"
cleanup $N; echo "end $(ts)"
