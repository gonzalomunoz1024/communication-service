#!/usr/bin/env bash
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e2
OUT=$S/out
$S/scripts/run-suite.sh 1 fresh
$S/scripts/run-suite.sh 2
$S/scripts/run-suite.sh 3 fresh
cd /home/claude/communication-service/e2e
{ echo "## docker inspect (user / read-only / caps / security-opt / network mode)"
  for c in e2e-backend e2e-app e2e-sidecar e2e-mongo; do
    docker inspect "$c" --format "$c user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}} netmode={{.HostConfig.NetworkMode}} image={{.Config.Image}} status={{.State.Status}} restarts={{.RestartCount}}"
  done
  echo "## processes as seen from the host"
  for c in e2e-backend e2e-sidecar e2e-app; do pid=$(docker inspect -f '{{.State.Pid}}' $c); echo "$c pid=$pid uid=$(stat -c %u /proc/$pid 2>/dev/null) cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null | cut -c1-120)"; done
  echo "## image labels"; docker inspect health-sidecar:e2e --format '{{json .Config.Labels}}'; docker inspect communication-service:e2e --format 'backend user={{.Config.User}} labels={{json .Config.Labels}}'
} > $OUT/compose-inspect.txt 2>&1
./stack.sh logs > $OUT/stack-logs-after-run3.txt 2>&1
{ echo "## $(date -u +%FT%TZ) ./stack.sh down"; ./stack.sh down; echo "exit=$?"; } > $OUT/stack-down-final.txt 2>&1
echo "CHAIN DONE $(date -u +%FT%TZ)" > $OUT/chain-done.txt
