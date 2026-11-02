#!/usr/bin/env bash
# E2E verifier, iteration 4: the repository's e2e suite three times, each on a fresh stack, exactly as e2e/README.md says
# (images from the prebuilt jar in build/libs and frontend/dist; the README's Go 1.27.3 builder stand-in, distroless base).
set -u
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e4
cd /home/claude/communication-service/e2e
export GO_IMAGE=local/go-toolset:1.27 BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot
ms() { date +%s%3N; }
for i in ${RUNS:-1 2 3}; do
  {
    echo "== run $i start $(date -u +%FT%TZ) HEAD $(git rev-parse --short HEAD)"
    t=$(ms); ./stack.sh down; echo "stack.sh down exit=$? took $(( $(ms) - t )) ms"
    t=$(ms); ./stack.sh up; rc=$?; echo "stack.sh up exit=$rc took $(( $(ms) - t )) ms"
  } > $S/logs/suite-up-$i.txt 2>&1
  {
    echo "== container facts (run $i, after up) $(date -u +%FT%TZ)"
    for c in e2e-sidecar e2e-backend e2e-app e2e-mongo; do
      docker inspect -f "$c image={{.Config.Image}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}} netmode={{.HostConfig.NetworkMode}} started={{.State.StartedAt}}" $c
    done
    pid=$(docker inspect -f '{{.State.Pid}}' e2e-sidecar)
    echo "sidecar host pid $pid: $(grep -E '^(Uid|Gid|CapEff|CapPrm|NoNewPrivs|Seccomp):' /proc/$pid/status 2>/dev/null | tr -s '\t' ' ' | paste -sd ';')"
    bpid=$(docker inspect -f '{{.State.Pid}}' e2e-backend)
    echo "backend host pid $bpid: $(grep -E '^(Uid|Gid):' /proc/$bpid/status 2>/dev/null | tr -s '\t' ' ' | paste -sd ';')"
    docker image inspect -f 'health-sidecar:e2e id={{.Id}} labels version={{index .Config.Labels "org.opencontainers.image.version"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} user={{.Config.User}}' health-sidecar:e2e
    docker image inspect -f 'communication-service:e2e id={{.Id}} user={{.Config.User}} created={{.Created}}' communication-service:e2e
    echo "git describe: $(cd .. && git describe --tags --always) HEAD: $(cd .. && git rev-parse HEAD)"
    echo "sidecar first log lines:"; docker logs e2e-sidecar 2>&1 | head -3 | cut -c1-400
    echo "sidecar /status:"; curl -s http://127.0.0.1:28091/status | cut -c1-600; echo
  } > $S/logs/suite-container-facts-$i.txt 2>&1
  t=$(ms)
  { echo "== playwright run $i start $(date -u +%FT%TZ)"; npx playwright test; rc=$?; echo "npx playwright test exit=$rc wall $(( $(ms) - t )) ms end $(date -u +%FT%TZ)"; } > $S/logs/suite-run-$i.txt 2>&1
  ./stack.sh logs > $S/logs/suite-stacklogs-$i.txt 2>&1
  { t=$(ms); ./stack.sh down; echo "stack.sh down exit=$? took $(( $(ms) - t )) ms"; docker ps -a --filter name=e2e- --format '{{.Names}}' | grep -E '^e2e-' || echo "no e2e-* container left"; docker network ls --format '{{.Name}}' | grep -x e2e || echo "no e2e network left"; docker volume ls -q | grep -E '^e2e' || echo "no e2e volume left"; } > $S/logs/suite-down-$i.txt 2>&1
done
echo "chain done $(date -u +%FT%TZ)"
