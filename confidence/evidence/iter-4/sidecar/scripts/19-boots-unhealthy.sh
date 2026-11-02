#!/bin/bash
# 19: README L159-160 "a service that boots unhealthy (its endpoint answers but never UP): it is invisible for the whole
# grace, then its real status flows" (unpinned). App answers Actuator DOWN from the start; CS_STARTUP_GRACE=8s,
# CS_INTERVAL=2s; private backend A, tenant vs4-bu.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
N="vs4-bu-pod vs4-bu-app vs4-bu-sc"; cleanup $N; T=vs4-bu
pod vs4-bu-pod -p 127.0.0.1:19353:8080 -p 127.0.0.1:19354:9465; app vs4-bu-pod vs4-bu-app -mode actuator -port 8080; sleep 0.3
curl -s -XPOST "127.0.0.1:19353/__set?status=DOWN&db=DOWN" >/dev/null; echo "  [$(ts)] app answers DOWN (db DOWN) before the sidecar starts"
sidecar vs4-bu-pod vs4-bu-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=boots-unhealthy -e POD_NAME=boots-unhealthy-0 -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=8s
S0=$(date +%s.%N); echo "  [$(ts)] sidecar started (grace 8 s)"
for at in 4 7 11 15 19; do
  while [ $(echo "$(date +%s.%N) - $S0 < $at" | bc) -eq 1 ]; do sleep 0.2; done
  echo "  [$(ts) +${at}s] sidecar: $(raw 19354 | jq -c '{upSeen, last:.lastReport.status, msg:.lastReport.message}')"
  echo "            service: $(mon $T | head -1)"
done
echo "  feed: $(feed $T)"
echo "  sidecar log: $(docker logs vs4-bu-sc 2>&1 | jq -c 'select(.msg=="reported") | {t:.time[11:23],level,status,message}' | paste -sd' ')"
cleanup $N; echo "end $(ts)"
