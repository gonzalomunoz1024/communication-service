#!/bin/bash
# 01: static checks and the sidecar test suite in five modes (+ flake runs). Run from anywhere.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
R=/home/claude/communication-service
cd $R/sidecar
T="$S/tools"
export PATH="$T:$PATH"
sec(){ echo; echo "### $*"; }
run(){ echo "\$ $*"; eval "$@"; echo "exit=$?"; }
sec "0. versions and tree"
run "git -C $R rev-parse --short HEAD"
run "go version"
run "go env GOTOOLCHAIN GOFLAGS GOPROXY | tr '\n' ' '; echo"
run "kustomize version; helm version --short; kubeconform -v; kubectl version --client 2>/dev/null | head -1"
sec "1. gofmt -l . (expect no files)"
run "gofmt -l . | tee /dev/stderr | wc -l"
sec "2. go vet ./..."
run "go vet ./..."
sec "3. go build ./..."
run "go build ./... "
sec "4. MODE A plain: go test -count=1 ./... (tools on PATH)"
run "go test -count=1 ./... 2>&1 | tail -12"
sec "5. MODE B race: go test -count=1 -race ./..."
run "go test -count=1 -race ./... 2>&1 | tail -12"
sec "6. MODE C CI=true with tools on PATH, -v tally"
CI=true go test -count=1 -v ./... > $S/sidecar3/logs/go-test-ci-v.txt 2>&1; echo "exit=$?"
echo "top-level: PASS=$(grep -c '^--- PASS' $S/sidecar3/logs/go-test-ci-v.txt) FAIL=$(grep -c '^--- FAIL' $S/sidecar3/logs/go-test-ci-v.txt) SKIP=$(grep -c '^--- SKIP' $S/sidecar3/logs/go-test-ci-v.txt)"
echo "subtests: PASS=$(grep -c '^    --- PASS' $S/sidecar3/logs/go-test-ci-v.txt) FAIL=$(grep -cE '^ +--- FAIL' $S/sidecar3/logs/go-test-ci-v.txt) SKIP=$(grep -cE '^ +--- SKIP' $S/sidecar3/logs/go-test-ci-v.txt)"
grep -E '^(ok|FAIL|---)' $S/sidecar3/logs/go-test-ci-v.txt | grep -v -- '--- PASS' | head -20
grep -E 'kubeconform (1\.2[79]\.0):' $S/sidecar3/logs/go-test-ci-v.txt | sed 's/^ *//' | sort | uniq -c
sec "7. MODE D CI=true WITHOUT the tools on PATH (deploy tests must FAIL naming the tool), then without CI (must SKIP)"
GOBIN=$(dirname $(command -v go))
echo "\$ PATH=$GOBIN:/usr/bin:/bin CI=true go test -count=1 -v ./deploy/"
env PATH=$GOBIN:/usr/bin:/bin CI=true go test -count=1 -v ./deploy/ 2>&1 | grep -E '^(=== RUN|--- |    [a-z_]+\.go:[0-9]+:|ok|FAIL)' | grep -vE '^=== RUN' | head -20; echo "exit=${PIPESTATUS[0]}"
echo "\$ PATH=$GOBIN:/usr/bin:/bin go test -count=1 -v ./deploy/ (no CI)"
env -u CI PATH=$GOBIN:/usr/bin:/bin go test -count=1 -v ./deploy/ 2>&1 | grep -E '^(--- |    [a-z_]+\.go:[0-9]+:|ok|FAIL)' | head -20; echo "exit=${PIPESTATUS[0]}"
echo "\$ PATH=$GOBIN:/usr/bin:/bin go test -count=1 ./... (no CI, whole module)"
env -u CI PATH=$GOBIN:/usr/bin:/bin go test -count=1 ./... 2>&1 | tail -8; echo "exit=${PIPESTATUS[0]}"
sec "8. MODE E cover: CI=true go test -count=1 -cover ./..."
run "CI=true go test -count=1 -cover -coverprofile=$S/sidecar3/work/cover.out ./... 2>&1 | tail -8"
go tool cover -func=$S/sidecar3/work/cover.out | tail -1
echo "per function under 70%:"; go tool cover -func=$S/sidecar3/work/cover.out | awk '$NF+0<70' | head -20
sec "9. G-3-19: the rewritten heartbeat test 20x with -race"
run "go test -count=20 -race -run '^TestNotUpIsSentEveryProbeAndUpOnlyAtTheHeartbeat\$' -v ./internal/agent/ 2>&1 | grep -E '^(--- |ok|FAIL)' | sort | uniq -c"
sec "10. the other iteration-3 agent tests 20x with -race"
run "go test -count=20 -race -run '^(TestRetriesAreNeverFurtherApartThanTheBackoffCap|TestUpWithAFailingComponentIsSentEveryProbe|TestUnknownIsSentAtTheHeartbeat|TestStatusShowsTheLastReportComposedSentOrNot|TestRunSendsLeavingReportOnShutdown)\$' -v ./internal/agent/ 2>&1 | grep -E '^(--- |ok|FAIL)' | sort | uniq -c"
sec "11. flake check: the whole suite 3 more times, shuffled, CI=true with tools"
for i in 1 2 3; do echo "run $i:"; CI=true go test -count=1 -shuffle=on ./... 2>&1 | grep -E '^(ok|FAIL|---|-test.shuffle)' | head -10; echo "exit=${PIPESTATUS[0]}"; done
sec "12. G-3-29 test logs (waits observed by the test)"
go test -count=1 -run '^TestRetriesAreNeverFurtherApartThanTheBackoffCap$' -v ./internal/agent/ 2>&1 | grep -E 'waits after|first attempt|--- ' | sed 's/^ *//'
