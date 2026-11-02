#!/bin/bash
# 40: the security gate for the sidecar (G-4-2 / AUD-3-1): modules, govulncheck on source and binary,
# Trivy on the image (CI's flags) and the binary, with a go1.25.14 control build proving the scanners see the old entries.
W=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
. $W/scripts/env.sh
R=/home/claude/communication-service
sec(){ echo; echo "### $*"; }
cd $R/sidecar
TRIVY(){ flock $S/orch-trivy/.lock docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v $S/orch-trivy/cache/trivy:/root/.cache/trivy -v $W/work/scan:/work mirror.gcr.io/aquasec/trivy:0.58.1 "$@"; }
VULN="go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 -db https://storage.googleapis.com/go-vulndb"
sec "1. module graph (third-party modules) and go.sum"
echo "\$ go list -m all"; go list -m all; echo "exit=$?"; echo "go.sum present: $(test -f go.sum && echo yes || echo no)"
echo "imports outside the standard library: $(go list -deps -f '{{if not .Standard}}{{.ImportPath}}{{end}}' ./... | grep -vc '^github.com/gonzalomunoz1024/communication-service/sidecar')"
sec "2. govulncheck v1.9.0 on the source (Go $(go env GOVERSION))"
echo "\$ $VULN ./..."; $VULN ./... 2>&1 | tail -8; echo "exit=${PIPESTATUS[0]}"
echo "\$ $VULN -show verbose ./... | grep -E 'Go:|Scanner:|DB:|DB updated|No vulnerabilities|Vulnerability #'"; $VULN -show verbose ./... 2>&1 | grep -E 'Go:|Scanner:|DB:|DB updated|No vulnerabilities|Vulnerability #|vulnerabilit' | head -12
sec "3. govulncheck -mode=binary on the image's binary (health-sidecar:vs4)"
echo "\$ $VULN -mode=binary -show verbose $W/bin/health-sidecar-vs4"; $VULN -mode=binary -show verbose $W/bin/health-sidecar-vs4 2>&1 | grep -vE '^\s*$' | tail -12; echo "exit=${PIPESTATUS[0]}"
sec "4. control: the iteration-3 tree (6c15715) built with go1.25.14, the line AUD-3-1 flagged"
rm -rf $W/work/iter3src && mkdir -p $W/work/iter3src && git -C $R archive 6c15715 sidecar | tar -x -C $W/work/iter3src
G125=/root/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.25.14.linux-amd64
( cd $W/work/iter3src/sidecar && env GOROOT=$G125 PATH=$G125/bin:/usr/bin:/bin GOTOOLCHAIN=local CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o $W/bin/control-go12514 ./cmd/health-sidecar; echo "control build exit=$?"; env GOROOT=$G125 PATH=$G125/bin:/usr/bin:/bin go version -m $W/bin/control-go12514 | head -1 )
echo "\$ $VULN -mode=binary $W/bin/control-go12514 | grep -E 'Vulnerability #|Found in|Fixed in|vulnerabilit'"; $VULN -mode=binary $W/bin/control-go12514 2>&1 | grep -E 'Vulnerability #|Found in|Fixed in|Your code is affected|vulnerabilit' | head -24; echo "exit=${PIPESTATUS[0]}"
sec "5. Trivy 0.58.1, CI's image command, on health-sidecar:vs4 (DB of $(TRIVY --version 2>/dev/null | grep -i 'UpdatedAt' | head -1 | xargs))"
echo "\$ trivy image --skip-db-update --skip-java-db-update --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 health-sidecar:vs4"
TRIVY image --skip-db-update --skip-java-db-update --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 health-sidecar:vs4 2>&1 | grep -vE 'INFO|^\s*$' | tail -14; echo "exit=${PIPESTATUS[0]}"
echo "\$ trivy image --skip-db-update --skip-java-db-update --scanners vuln --exit-code 1 health-sidecar:vs4   (every severity, fixed or not)"
TRIVY image --skip-db-update --skip-java-db-update --scanners vuln --exit-code 1 health-sidecar:vs4 2>&1 | grep -vE 'INFO|^\s*$' | tail -14; echo "exit=${PIPESTATUS[0]}"
sec "6. Trivy rootfs on the binaries alone (every severity): vs4 and the go1.25.14 control"
mkdir -p $W/work/scan/vs4 $W/work/scan/control && cp $W/bin/health-sidecar-vs4 $W/work/scan/vs4/ && cp $W/bin/control-go12514 $W/work/scan/control/
echo "\$ trivy rootfs --skip-db-update --skip-java-db-update --scanners vuln --exit-code 1 /work/vs4"
TRIVY rootfs --skip-db-update --skip-java-db-update --scanners vuln --exit-code 1 /work/vs4 2>&1 | grep -vE 'INFO|^\s*$' | tail -10; echo "exit=${PIPESTATUS[0]}"
echo "\$ trivy rootfs --skip-db-update --skip-java-db-update --scanners vuln --exit-code 1 /work/control"
TRIVY rootfs --skip-db-update --skip-java-db-update --scanners vuln --exit-code 1 /work/control 2>&1 | grep -E 'Total:|CVE-|stdlib' | cut -c1-160 | head -24; echo "exit=${PIPESTATUS[0]}"
sec "7. the scanner image CI pins (TRIVY_IMAGE) against the one used here"
grep -n 'TRIVY_IMAGE:' $R/.github/workflows/ci.yml
echo "local mirror.gcr.io/aquasec/trivy:0.58.1 RepoDigests: $(docker image inspect mirror.gcr.io/aquasec/trivy:0.58.1 --format '{{json .RepoDigests}}')"
echo "\$ docker buildx imagetools inspect ghcr.io/aquasecurity/trivy:0.58.1 | head -3"; timeout 60 docker buildx imagetools inspect ghcr.io/aquasecurity/trivy:0.58.1 2>&1 | head -3; echo "exit=${PIPESTATUS[0]}"
