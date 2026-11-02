#!/bin/bash
# G-4-28: the CI gofmt step (ci.yml:119-126) run verbatim in sidecar/ with the go1.27.3 toolchain; the other CI steps were
# run in 01 (go vet; CI=true go test -race ./...) and 40 (govulncheck@v1.9.0, with -db = the vulndb mirror).
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/env.sh
cd /home/claude/communication-service/sidecar
echo "gofmt from: $(command -v gofmt) ($(go version))"
echo "--- ci.yml lines 119-126 as written:"; sed -n 119,126p ../.github/workflows/ci.yml
echo "--- running the step's script with bash -e:"
bash -e -c '
unformatted=$(gofmt -l .)
if [ -n "$unformatted" ]; then
  echo "gofmt -l lists files that are not formatted:"
  echo "$unformatted"
  exit 1
fi'
echo "step exit=$?"
