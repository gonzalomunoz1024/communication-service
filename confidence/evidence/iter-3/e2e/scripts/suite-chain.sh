#!/usr/bin/env bash
# Runs the repository's e2e suite three times, each on a fresh stack, as e2e/README.md says
# (images from the prebuilt jar and frontend/dist; Go builder substitute because the UBI registry is blocked).
set -u
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e3
cd /home/claude/communication-service/e2e
export GO_IMAGE=go-toolset:e2e BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot
ms() { date +%s%3N; }
for i in 1 2 3; do
  {
    echo "== run $i start $(date -u +%FT%TZ)"
    ./stack.sh down; echo "stack.sh down exit=$?"
    t=$(ms); ./stack.sh up; rc=$?; echo "stack.sh up exit=$rc took $(( $(ms) - t )) ms"
  } > $S/logs/suite-up-$i.txt 2>&1
  if [ "$i" = 1 ]; then
    {
      echo "== container facts (run 1, after up) $(date -u +%FT%TZ)"
      for c in e2e-sidecar e2e-backend e2e-app e2e-mongo; do
        docker inspect -f "$c image={{.Config.Image}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}} netmode={{.HostConfig.NetworkMode}}" $c
      done
      echo "sidecar process: $(docker top e2e-sidecar -o uid,gid,pid,args | tail -n +2)"
      echo "backend process: $(docker top e2e-backend -o uid,gid,args | tail -n +2 | cut -c1-120)"
      docker image inspect -f 'health-sidecar:e2e labels version={{index .Config.Labels "org.opencontainers.image.version"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} user={{.Config.User}}' health-sidecar:e2e
      echo "git describe: $(cd .. && git describe --tags --always) HEAD: $(cd .. && git rev-parse HEAD)"
      echo "sidecar first log line:"; docker logs e2e-sidecar 2>&1 | head -2
      echo "sidecar /status:"; curl -s http://127.0.0.1:28091/status; echo
    } > $S/logs/suite-container-facts.txt 2>&1
  fi
  t=$(ms)
  { echo "== playwright run $i start $(date -u +%FT%TZ)"; npx playwright test; rc=$?; echo "npx playwright test exit=$rc wall $(( $(ms) - t )) ms end $(date -u +%FT%TZ)"; } > $S/logs/suite-run-$i.txt 2>&1
  ./stack.sh logs > $S/logs/suite-stacklogs-$i.txt 2>&1
  { t=$(ms); ./stack.sh down; echo "stack.sh down exit=$? took $(( $(ms) - t )) ms"; docker ps -a --filter name=e2e- --format '{{.Names}}' | grep -E '^e2e-' || echo "no e2e-* container left"; } > $S/logs/suite-down-$i.txt 2>&1
  cp -r playwright-report $S/logs/playwright-report-$i 2>/dev/null
done
echo "chain done $(date -u +%FT%TZ)"
