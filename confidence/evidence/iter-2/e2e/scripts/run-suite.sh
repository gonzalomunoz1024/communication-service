#!/usr/bin/env bash
# Runs the in-repo e2e suite exactly as e2e/README.md says (jar + dist prebuilt; GO_IMAGE/BASE_IMAGE for the sidecar
# because the UBI registry is blocked here). run-suite.sh <n> [fresh]: fresh = stack.sh down + up before the run.
set -u
N=$1; FRESH=${2:-}
OUT=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e2/out
cd /home/claude/communication-service/e2e || exit 9
export GO_IMAGE=local/go-toolset:1.25 BASE_IMAGE=gcr.io/distroless/static-debian12:latest
stamp() { date -u +%FT%T.%3NZ; }
if [ "$FRESH" = fresh ]; then
  { echo "## $(stamp) ./stack.sh down"; ./stack.sh down; echo "exit=$?"; } > "$OUT/stack-down-before-$N.txt" 2>&1
  { echo "## $(stamp) ./stack.sh up  (GO_IMAGE=$GO_IMAGE BASE_IMAGE=$BASE_IMAGE)"; t0=$(date +%s.%N); ./stack.sh up; rc=$?; t1=$(date +%s.%N)
    echo "exit=$rc elapsed=$(echo "$t1 - $t0" | bc) s"; } > "$OUT/stack-up-$N.txt" 2>&1
fi
docker compose -f docker-compose.yml ps > "$OUT/compose-ps-$N.txt" 2>&1
{ echo "## $(stamp) npx playwright test (run $N, $([ "$FRESH" = fresh ] && echo fresh stack || echo same stack as the previous run))"
  t0=$(date +%s.%N); npx playwright test; rc=$?; t1=$(date +%s.%N)
  echo "## $(stamp) exit=$rc elapsed=$(echo "$t1 - $t0" | bc) s"; } > "$OUT/suite-run-$N.txt" 2>&1
cp -r playwright-report "$OUT/playwright-report-$N" 2>/dev/null
[ -d test-results ] && cp -r test-results "$OUT/test-results-$N" 2>/dev/null
exit 0
