#!/bin/bash
# vs2: gofmt / vet / build / go test x3 (+race, CI=true with tools, CI=true WITHOUT tools -> FAIL not skip), laptop skip, coverage
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
cd /home/claude/communication-service/sidecar
export PATH=$S/tools:$PATH
ts(){ date -u +%H:%M:%S; }
echo "== $(date -u +%FT%TZ) head $(git rev-parse --short HEAD) | host $(go version) | GOTOOLCHAIN=$(go env GOTOOLCHAIN) | go.mod: $(grep '^go ' go.mod)"
echo "## go version inside the module (toolchain switch):"; go version; echo "exit=$?"
echo "## gofmt -l ."; gofmt -l .; echo "exit=$? files-needing-gofmt=$(gofmt -l . | wc -l)"
echo "## go vet ./..."; go vet ./...; echo "exit=$?"
echo "## go build ./..."; go build ./...; echo "exit=$?"
echo "## [$(ts)] run 1: go test -count=1 ./...   (tools on PATH: $(which kustomize) $(which kubeconform) $(which helm))"; go test -count=1 ./...; echo "exit=$?"
echo "## [$(ts)] run 2: go test -count=1 -race ./..."; go test -count=1 -race ./...; echo "exit=$?"
echo "## [$(ts)] run 3: CI=true go test -count=1 ./..."; CI=true go test -count=1 ./...; echo "exit=$?"
echo "## [$(ts)] CI=true go test -v: test function tally"; CI=true go test -count=1 -v ./... > $S/sidecar2/logs/go-test-v.txt 2>&1; echo "exit=$?"
echo "  top-level Test functions: $(grep -cE '^--- (PASS|FAIL|SKIP): Test' $S/sidecar2/logs/go-test-v.txt) | PASS=$(grep -cE '^--- PASS' $S/sidecar2/logs/go-test-v.txt) FAIL=$(grep -cE '^--- FAIL' $S/sidecar2/logs/go-test-v.txt) SKIP=$(grep -cE '^--- SKIP' $S/sidecar2/logs/go-test-v.txt) | subtests PASS=$(grep -cE '^    --- PASS' $S/sidecar2/logs/go-test-v.txt) FAIL=$(grep -cE '^    --- FAIL' $S/sidecar2/logs/go-test-v.txt) SKIP=$(grep -cE '^    --- SKIP' $S/sidecar2/logs/go-test-v.txt) | func Test in source: $(grep -rh '^func Test' --include='*_test.go' . | wc -l)"
echo "  per package:"; grep -E '^(ok|FAIL|---)' $S/sidecar2/logs/go-test-v.txt | grep -E '^(ok|FAIL)' 
echo "  deploy package test lines:"; grep -E '^(=== RUN|--- |\s+deploy_test|\s+dockerfile_test|\s+kubeconform)' $S/sidecar2/logs/go-test-v.txt | grep -iE 'deploy|Dockerfile|GoMod|Image|Native|Classic|Manual|Both|kubeconform' | head -20
echo "## [$(ts)] G-2-15: CI=true WITHOUT kustomize/kubeconform/helm on PATH -> the manifest tests must FAIL naming the tool (not skip)"
echo "  PATH=/usr/local/go/bin:/usr/bin:/bin (kustomize: $(PATH=/usr/local/go/bin:/usr/bin:/bin which kustomize 2>&1 | head -1))"
PATH=/usr/local/go/bin:/usr/bin:/bin CI=true go test -count=1 -v ./deploy/ 2>&1 | grep -E '^(=== RUN|--- |FAIL|ok|PASS)|not on PATH' | head -30; echo "exit=${PIPESTATUS[0]}"
echo "## [$(ts)] laptop behaviour: no CI, no tools -> skip (and the whole suite stays green)"
PATH=/usr/local/go/bin:/usr/bin:/bin go test -count=1 -v ./deploy/ 2>&1 | grep -E '^(--- |FAIL|ok|PASS)|not on PATH' | head -20; echo "exit=${PIPESTATUS[0]}"
PATH=/usr/local/go/bin:/usr/bin:/bin go test -count=1 ./... 2>&1 | tail -8; echo "exit=${PIPESTATUS[0]}"
echo "## [$(ts)] coverage (CI=true, tools on PATH)"; CI=true go test -count=1 -cover ./... 2>&1; echo "exit=$?"
echo "## [$(ts)] DONE"
