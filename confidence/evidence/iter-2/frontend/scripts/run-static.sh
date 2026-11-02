#!/bin/bash
# Frontend Verifier iter-2: static checks, sequential. Output: one file per step + summary with exit codes.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend2/static
cd /home/claude/communication-service/frontend || exit 99
SUM=$S/summary.txt; : > $SUM
echo "commit $(git rev-parse HEAD) $(date -u +%FT%TZ)" | tee -a $SUM
run() { # name, command...
  local name=$1; shift
  local t0=$(date +%s.%N)
  "$@" > $S/$name.txt 2>&1; local rc=$?
  local t1=$(date +%s.%N)
  printf '%s | exit %d | %.1fs\n' "$name" "$rc" "$(echo "$t1 - $t0" | bc)" | tee -a $SUM
}
run 01-lint npm run lint
run 02-typecheck npm run typecheck
run 03-vite-build npx vite build --outDir /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend2/dist
run 04-test-run1 npm test
run 05-test-run2 npm test
run 06-test-run3 npm test
run 07-coverage npm run test:coverage
run 08-audit npm audit
run 09-audit-omit-dev npm audit --omit=dev
run 10-audit-json npm audit --json
run 11-default-tenant-build env VITE_DEFAULT_TENANT=vf2-default npx vite build --outDir /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend2/dist-default-tenant
run 12-xorigin-build env VITE_API_BASE=http://127.0.0.1:8080 npx vite build --outDir /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend2/dist-xorigin
run 13-badclientid-build env VITE_CLIENT_ID='bad id!' npx vite build --outDir /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend2/dist-badclientid
echo "DONE $(date -u +%FT%TZ)" | tee -a $SUM
