#!/usr/bin/env bash
# G-3-12 mutation check: the repository's spec 04, unchanged, on a fresh compose stack, run twice behind a proxy:
# pass (control: must pass) and strip (no lastEventId reaches the backend, i.e. no replay: must fail).
set -u
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e3
cd /home/claude/communication-service/e2e
export GO_IMAGE=go-toolset:e2e BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot
echo "== $(date -u +%FT%TZ) stack up"; ./stack.sh down >/dev/null 2>&1; ./stack.sh up 2>&1 | grep -E 'stack: (up|the backend is ready)'
for mode in pass strip; do
  node $S/mut/replay-proxy.js 19590 $mode > $S/mut/proxy-$mode.txt 2>&1 & pp=$!
  sleep 1
  echo "== $(date -u +%FT%TZ) spec 04 with the proxy in mode '$mode'"
  npx playwright test --config $S/mut/pw-proxy.config.js 2>&1 | grep -vE '^\s*$' | cut -c1-260 | head -60
  echo "playwright exit=${PIPESTATUS[0]}"
  kill $pp 2>/dev/null; wait $pp 2>/dev/null
  echo "-- proxy log ($mode):"; head -12 $S/mut/proxy-$mode.txt
done
echo "== $(date -u +%FT%TZ) stack down"; ./stack.sh down 2>&1 | tail -1; docker ps -a --format '{{.Names}}' | grep -E '^e2e-' || echo "no e2e-* container left"
