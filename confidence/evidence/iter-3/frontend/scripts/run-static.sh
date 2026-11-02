#!/bin/bash
# Frontend Verifier iter-3: static checks, sequential, in frontend/ (no npm install/ci). One output file per step + a summary.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend3
O=$S/static
cd /home/claude/communication-service/frontend || exit 99
SUM=$O/summary.txt; : > $SUM
echo "commit $(git rev-parse HEAD) $(date -u +%FT%TZ) node $(node --version) npm $(npm --version)" | tee -a $SUM
run() { # name, command...
  local name=$1; shift
  local t0=$(date +%s.%N)
  "$@" > $O/$name.txt 2>&1; local rc=$?
  local t1=$(date +%s.%N)
  printf '%s | exit %d | %.1fs | %s\n' "$name" "$rc" "$(echo "$t1 - $t0" | bc)" "$*" | tee -a $SUM
}
run 01-lint-run1 npm run lint
run 02-typecheck-run1 npm run typecheck
run 03-build-run1 npm run build -- --outDir $S/dist --emptyOutDir
run 04-test-run1 npm test -- --reporter=verbose
run 05-test-run2 npm test
run 06-test-run3 npm test
run 07-coverage npm run test:coverage -- --coverage.reportsDirectory=$S/coverage
run 08-audit npm audit
run 09-audit-omit-dev npm audit --omit=dev
run 10-audit-json npm audit --json
run 11-default-tenant-build env VITE_DEFAULT_TENANT=vf3-default npx vite build --outDir $S/dist-default-tenant --emptyOutDir
run 12-xorigin-build env VITE_API_BASE=http://127.0.0.1:8080 npx vite build --outDir $S/dist-xorigin --emptyOutDir
run 13-badclientid-build env VITE_CLIENT_ID='bad id!' npx vite build --outDir $S/dist-badclientid --emptyOutDir
run 14-lint-run2 npm run lint
run 15-lint-run3 npm run lint
run 16-typecheck-run2 npm run typecheck
run 17-typecheck-run3 npm run typecheck
run 18-build-run2 npm run build -- --outDir $S/dist-run2 --emptyOutDir
run 19-build-run3 npm run build -- --outDir $S/dist-run3 --emptyOutDir
echo "git status --short (frontend/): [$(git status --short . | tr '\n' ';')]" | tee -a $SUM
echo "DONE $(date -u +%FT%TZ)" | tee -a $SUM
