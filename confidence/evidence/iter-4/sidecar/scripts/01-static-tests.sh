#!/bin/bash
# 01: static checks and the sidecar suite in five modes, flake runs, the toolchain rules (G-4-2). vs4.
W=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4
. $W/scripts/env.sh
R=/home/claude/communication-service
cd $R/sidecar
L=$W/logs; mkdir -p $L $W/work
sec(){ echo; echo "### $*"; }
run(){ echo "\$ $*"; eval "$@"; echo "exit=$?"; }
sec "0. versions and tree"
run "git -C $R rev-parse --short HEAD; git -C $R diff --quiet 1cd3f13 HEAD -- sidecar .github && echo 'sidecar/ and .github/ identical to 1cd3f13'"
run "git -C $R status --porcelain -- sidecar | wc -l"
run "which go; go version; go env GOROOT GOTOOLCHAIN GOFLAGS GOPROXY | tr '\n' ' '; echo"
run "kustomize version; helm version --short; kubeconform -v; kubectl version --client 2>/dev/null | head -1"
sec "1. gofmt -l . (expect no files)"
gofmt -l . > $W/work/gofmt.txt; echo "\$ gofmt -l .   -> exit=$?, files listed: $(wc -l < $W/work/gofmt.txt)"; cat $W/work/gofmt.txt
sec "2. go vet ./..."
run "go vet ./..."
sec "3. go build ./..."
run "go build ./..."
sec "4. MODE A plain: go test -count=1 ./... (tools on PATH, CI unset)"
run "env -u CI go test -count=1 ./... 2>&1 | tail -12"
sec "5. MODE B race: go test -count=1 -race ./..."
run "env -u CI go test -count=1 -race ./... 2>&1 | tail -12"
sec "6. MODE C CI=true with tools on PATH, -race (CI's own command), -v tally"
CI=true go test -count=1 -race -v ./... > $L/go-test-ci-race-v.txt 2>&1; echo "exit=$?"
echo "top-level: PASS=$(grep -c '^--- PASS' $L/go-test-ci-race-v.txt) FAIL=$(grep -c '^--- FAIL' $L/go-test-ci-race-v.txt) SKIP=$(grep -c '^--- SKIP' $L/go-test-ci-race-v.txt)"
echo "subtests: PASS=$(grep -cE '^ +--- PASS' $L/go-test-ci-race-v.txt) FAIL=$(grep -cE '^ +--- FAIL' $L/go-test-ci-race-v.txt) SKIP=$(grep -cE '^ +--- SKIP' $L/go-test-ci-race-v.txt)"
grep -E '^(ok|FAIL|--- FAIL|--- SKIP)' $L/go-test-ci-race-v.txt | head -20
sec "7. MODE D CI=true WITHOUT the tools on PATH (deploy tests must FAIL naming the tool), then without CI (must SKIP)"
GOBIN=$(dirname $(command -v go))
echo "\$ PATH=$GOBIN:/usr/bin:/bin CI=true go test -count=1 -v ./deploy/"
env PATH=$GOBIN:/usr/bin:/bin CI=true go test -count=1 -v ./deploy/ > $L/go-test-ci-notools.txt 2>&1; echo "exit=$?"
grep -E '^(--- |    [a-z_]+\.go:[0-9]+:|ok|FAIL)' $L/go-test-ci-notools.txt | head -24
echo "\$ PATH=$GOBIN:/usr/bin:/bin go test -count=1 -v ./deploy/ (no CI)"
env -u CI PATH=$GOBIN:/usr/bin:/bin go test -count=1 -v ./deploy/ 2>&1 | grep -E '^(--- |    [a-z_]+\.go:[0-9]+:|ok|FAIL)' | head -24; echo "exit=${PIPESTATUS[0]}"
echo "\$ PATH=$GOBIN:/usr/bin:/bin go test -count=1 ./... (no CI, whole module)"
env -u CI PATH=$GOBIN:/usr/bin:/bin go test -count=1 ./... 2>&1 | tail -8; echo "exit=${PIPESTATUS[0]}"
sec "8. MODE E cover: CI=true go test -count=1 -cover ./..."
run "CI=true go test -count=1 -cover -coverprofile=$W/work/cover.out ./... 2>&1 | tail -8"
go tool cover -func=$W/work/cover.out | tail -1
echo "functions under 70%:"; go tool cover -func=$W/work/cover.out | awk '$NF+0<70' | head -20
sec "9. iteration-4 tests 20x with -race"
run "go test -count=20 -race -run '^(TestDeliveryAgainAfterFailedSendsIsLoggedOnceAtInfo|TestNotUpIsSentEveryProbeAndUpOnlyAtTheHeartbeat|TestRetriesAreNeverFurtherApartThanTheBackoffCap|TestUpWithAFailingComponentIsSentEveryProbe|TestUnknownIsSentAtTheHeartbeat|TestStatusShowsTheLastReportComposedSentOrNot|TestRunSendsLeavingReportOnShutdown|TestRejectedDownReportKeepsTheHeartbeatCadence|TestTransitionsAreLoggedAtInfoAndRepeatedSendsAtDebug)\$' -v ./internal/agent/ 2>&1 | grep -E '^(--- |ok|FAIL)' | sed -E 's/ \(.*\)$//; s/\t[0-9.]+s$//' | sort | uniq -c"
run "go test -count=20 -race -run '^(TestDurationsTheSidecarCannotUseAreRejected|TestReportTimeoutDefaultAgainstTheServiceDatabaseTimeouts|TestProxyVariablesAreDocumented|TestEveryEnvironmentVariableIsDocumented|TestFromEnvOverridesAndValidation)\$' -v ./internal/config/ 2>&1 | grep -E '^(--- |ok|FAIL)' | sed -E 's/ \(.*\)$//; s/\t[0-9.]+s$//' | sort | uniq -c"
run "go test -count=20 -race -run '^(TestStatusWordsAreTrimmedLikeTheService|TestNormalize|TestFailingCountsTheComponentsTheServiceCounts)\$' -v ./internal/probe/ 2>&1 | grep -E '^(--- |ok|FAIL)' | sed -E 's/ \(.*\)$//; s/\t[0-9.]+s$//' | sort | uniq -c"
run "go test -count=5 -race -run '^(TestRunRejectsAnUnusableValueWithExit2|TestRunRejectsAnUnreadableCAFile|TestRunReportsWithTheBuildVersionAndStopsCleanly|TestRunLogsAtTheConfiguredLevel)\$' -v ./cmd/health-sidecar/ 2>&1 | grep -E '^(--- |ok|FAIL)' | sed -E 's/ \(.*\)$//; s/\t[0-9.]+s$//' | sort | uniq -c"
sec "10. flake check: the whole suite 3 more times, shuffled, CI=true with tools"
for i in 1 2 3; do echo "run $i:"; CI=true go test -count=1 -shuffle=on ./... 2>&1 | grep -E '^(ok|FAIL|---|-test.shuffle)' | head -10; echo "exit=${PIPESTATUS[0]}"; done
sec "11. the iteration-4 tests' subtests (names only)"
grep -E '^ +--- (PASS|FAIL): (TestDurationsTheSidecarCannotUseAreRejected|TestRunRejectsAnUnusableValueWithExit2|TestStatusWordsAreTrimmedLikeTheService)/' $L/go-test-ci-race-v.txt | sed 's/ (.*//' | sed 's/^ *//' 
sec "12. G-4-2 toolchain rules on the host Go (1.24.7)"
HOSTGO=/usr/local/go/bin/go
echo "\$ GOTOOLCHAIN=auto $HOSTGO version   (in sidecar/)"; env -u GOROOT GOTOOLCHAIN=auto PATH=/usr/local/go/bin:/usr/bin:/bin $HOSTGO version; echo "exit=$?"
echo "\$ GOTOOLCHAIN=local $HOSTGO build ./..."; env -u GOROOT GOTOOLCHAIN=local PATH=/usr/local/go/bin:/usr/bin:/bin $HOSTGO build ./... > $W/work/hostgo.txt 2>&1; echo "exit=$?"; tail -2 $W/work/hostgo.txt
echo "\$ GOTOOLCHAIN=local $HOSTGO test ./..."; env -u GOROOT GOTOOLCHAIN=local PATH=/usr/local/go/bin:/usr/bin:/bin $HOSTGO test ./... > $W/work/hostgo.txt 2>&1; echo "exit=$?"; tail -2 $W/work/hostgo.txt
echo "\$ GOMODCACHE=<empty dir> GOTOOLCHAIN=auto $HOSTGO version   (README L334: an older Go downloads 1.27.3 through the module proxy)"
rm -rf $W/work/gomodcache; env -u GOROOT GOMODCACHE=$W/work/gomodcache GOFLAGS=-modcacherw GOTOOLCHAIN=auto PATH=/usr/local/go/bin:/usr/bin:/bin $HOSTGO version 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
echo "downloaded: $(ls $W/work/gomodcache/golang.org/ 2>/dev/null | tr '\n' ' ')"; rm -rf $W/work/gomodcache
