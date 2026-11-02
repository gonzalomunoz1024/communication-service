#!/bin/bash
# Builds & static checks, security part: dependencies, binary build info, govulncheck, CI step, image config.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; W=$S/sidecar3; export PATH=$S/tools:$PATH
cd /home/claude/communication-service/sidecar
echo "### go list -m all (module graph)"; go list -m all 2>&1; echo "exit $?"
echo "### go.mod"; cat go.mod; ls go.sum 2>&1
echo "### the image binary's build info (go version -m)"
c=$(docker create health-sidecar:vs3); ep=$(docker inspect -f '{{index .Config.Entrypoint 0}}' health-sidecar:vs3); docker cp $c:$ep $W/work/hs-bin >/dev/null 2>&1; docker rm $c >/dev/null
go version -m $W/work/hs-bin 2>&1 | grep -vE '^\s+build\s+(-buildmode|GOAMD64)' ; echo "exit $?"
echo "### image config: env and user (no secrets baked in)"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}User={{.Config.User}}' health-sidecar:vs3
echo "### govulncheck @latest (what CI runs)"
timeout 240 go run golang.org/x/vuln/cmd/govulncheck@latest ./... > $W/work/govuln-latest.txt 2>&1; echo "exit $?"; tail -5 $W/work/govuln-latest.txt | cut -c1-300
echo "### govulncheck @v1.1.4"
timeout 240 go run golang.org/x/vuln/cmd/govulncheck@v1.1.4 ./... > $W/work/govuln-114.txt 2>&1; echo "exit $?"; tail -5 $W/work/govuln-114.txt | cut -c1-300
echo "### reachability through the sandbox proxy"
for u in https://vuln.go.dev/index/db.json.gz https://proxy.golang.org/golang.org/x/vuln/@v/list; do echo "  $u -> $(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 $u 2>&1 | tail -1)"; done
echo "### the CI sidecar job's checks (.github/workflows/ci.yml)"
grep -nE 'run: |go-version|setup-|kubeconform/releases|govulncheck' ../.github/workflows/ci.yml | sed -n '1,40p' | grep -nE 'sidecar|go |gofmt|vet|test|govuln|docker build|kustomize|helm|kubeconform' | cut -c1-200
echo "  gofmt in CI: $(grep -c gofmt ../.github/workflows/ci.yml) line(s); -race in CI: $(grep -c -- '-race' ../.github/workflows/ci.yml) line(s)"
