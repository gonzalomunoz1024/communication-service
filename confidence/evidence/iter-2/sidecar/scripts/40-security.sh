#!/bin/bash
# vs2: dependency surface, govulncheck attempts, CI coverage of the scan, image hygiene
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; W=$S/sidecar2; cd /home/claude/communication-service/sidecar
echo "== $(date -u +%FT%TZ)"
echo "## go list -m all (module graph):"; go list -m all; echo "exit=$?"
echo "## non-stdlib packages in the build: $(go list -deps ./... | grep -vE '^(github.com/gonzalomunoz1024/|[a-z0-9/]+$|vendor/)' | grep -v '^golang.org/x' | wc -l) (third-party) / golang.org/x: $(go list -deps ./... | grep -c '^golang.org/x')"
echo "## govulncheck@latest (GOTOOLCHAIN=auto, go1.26.10 is cached locally):"; timeout 180 go run golang.org/x/vuln/cmd/govulncheck@latest ./... 2>&1 | head -6; echo "exit=${PIPESTATUS[0]}"
echo "## govulncheck@v1.1.4:"; timeout 180 go run golang.org/x/vuln/cmd/govulncheck@v1.1.4 ./... 2>&1 | head -4; echo "exit=${PIPESTATUS[0]}"
echo "## vuln.go.dev reachability: HTTP $(curl -s -m 10 -o /dev/null -w '%{http_code}' https://vuln.go.dev/index/db.json) | proxy.golang.org: HTTP $(curl -s -m 10 -o /dev/null -w '%{http_code}' https://proxy.golang.org/golang.org/x/vuln/@v/list)"
echo "## CI workflow steps that cover this (file:line):"; grep -nE 'govulncheck|CI=true go test|setup-kustomize|setup-helm|kubeconform|docker build' ../.github/workflows/ci.yml
echo "## Go release line facts: binary built with $(go version -m $W/bin/health-sidecar-vs2 | head -1 | awk '{print $2}'); go.mod go line $(grep '^go ' go.mod); Dockerfile default builder $(grep -oE 'go-toolset:[0-9.]+' Dockerfile)"
echo "## image: no shell, no package manager, root fs files owned by root, binary not writable by the runtime UID:"
cid=$(docker create health-sidecar:vs2); docker export $cid | tar -tv 2>/dev/null | grep -E 'bin/(sh|bash|busybox)|apt|dpkg/status|rpm' | head -3; docker export $cid | tar -tv 2>/dev/null | grep health-sidecar; docker rm $cid >/dev/null
echo "## secrets in the repository's sidecar tree (grep for key material):"; grep -rniE 'BEGIN (RSA|EC|OPENSSH)? ?PRIVATE KEY|password\s*[:=]|secret\s*[:=]|api[_-]?key' --include='*.go' --include='*.yaml' --include='*.tpl' --include='Dockerfile' . | grep -v _test.go | head -5; echo "  (matches above, if any, are reviewed in the report)"
echo "## DONE"
