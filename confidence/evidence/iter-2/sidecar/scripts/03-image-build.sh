#!/bin/bash
# vs2: build the sidecar image from the repository Dockerfile (UBI bases substituted: registry blocked), inspect it, read the binary
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; W=$S/sidecar2
cd /home/claude/communication-service
REV=$(git rev-parse HEAD)
echo "== $(date -u +%FT%TZ) head $REV"
echo "## Dockerfile defaults (what production would pull):"; grep -nE '^ARG (GO_IMAGE|BASE_IMAGE)' sidecar/Dockerfile
printf "## registry.access.redhat.com reachability: HTTP %s (CONNECT via proxy)\n" "$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://registry.access.redhat.com/v2/)"
echo "## builder stand-in: local/go-toolset:1.25 = $(docker run --rm local/go-toolset:1.25 go version) with the UBI CA bundle path; base stand-in gcr.io/distroless/static-debian12:latest"
echo "## docker build -t health-sidecar:vs2 --build-arg GO_IMAGE=local/go-toolset:1.25 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:latest --build-arg VERSION=1.0.0-vs2 --build-arg REVISION=$REV sidecar/"
docker build -t health-sidecar:vs2 --build-arg GO_IMAGE=local/go-toolset:1.25 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:latest --build-arg VERSION=1.0.0-vs2 --build-arg REVISION=$REV sidecar/ > $W/logs/docker-build.txt 2>&1; rc=$?
echo "exit=$rc"; grep -E 'ERROR|error|DONE|naming to|writing image|exporting' $W/logs/docker-build.txt | head -12
echo "## docker image inspect health-sidecar:vs2"
docker image inspect health-sidecar:vs2 --format 'User={{.Config.User}} ExposedPorts={{json .Config.ExposedPorts}} Entrypoint={{json .Config.Entrypoint}} Cmd={{json .Config.Cmd}} WorkingDir={{.Config.WorkingDir}} Size={{.Size}} bytes'
echo "Labels:"; docker image inspect health-sidecar:vs2 --format '{{json .Config.Labels}}' | python3 -c 'import json,sys; [print("  %s = %s" % kv) for kv in sorted(json.load(sys.stdin).items())]'
echo "Size: $(docker image inspect health-sidecar:vs2 --format '{{.Size}}') bytes = $(python3 -c "print(round($(docker image inspect health-sidecar:vs2 --format '{{.Size}}')/1e6,1))") MB (distroless stand-in; UBI micro size not measurable here)"
echo "## layers:"; docker history health-sidecar:vs2 --format '{{.Size}}\t{{.CreatedBy}}' | cut -c1-150
echo "## binary extracted from the image"
cid=$(docker create health-sidecar:vs2); docker cp -q $cid:/usr/local/bin/health-sidecar $W/bin/health-sidecar-vs2; docker cp -q $cid:/etc/pki/tls/certs/ca-bundle.crt $W/ca-bundle.crt; docker rm $cid >/dev/null
ls -la $W/bin/health-sidecar-vs2 $W/ca-bundle.crt
echo "go version -m:"; go version -m $W/bin/health-sidecar-vs2 | grep -E 'health-sidecar|^\s+(path|mod|build)' | grep -vE 'vcs\.' | head -14
echo "CA bundle certificates: $(grep -c 'BEGIN CERT' $W/ca-bundle.crt)"
echo "binary is static: $(readelf -d $W/bin/health-sidecar-vs2 2>/dev/null | grep -c NEEDED) NEEDED entries; $(readelf -l $W/bin/health-sidecar-vs2 2>/dev/null | grep -c INTERP) INTERP"
echo "## image filesystem (setuid/world-writable check)"; docker export $cid 2>/dev/null; cid=$(docker create health-sidecar:vs2); docker export $cid | tar -tv 2>/dev/null | awk '{print $1, $2, $6}' | grep -vE '^d' | head -20; docker export $cid | tar -tv 2>/dev/null | grep -cE '^-..s|^-.....s' | sed 's/^/setuid-setgid files: /'; docker rm $cid >/dev/null
echo "## run with no environment -> exit 2 listing both required variables"
docker run --rm health-sidecar:vs2; echo "exit=$?"
echo "## run as an arbitrary UID with the restricted-v2 flags and a wrong endpoint, 4 s, then stop (sanity; full matrix in 30-restricted-v2)"
docker rm -f vs2-smoke >/dev/null 2>&1
docker run -d --name vs2-smoke --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1:19399:9465 -e CS_ENDPOINT=http://127.0.0.1:1 -e CS_TENANT=vs2 -e CS_SERVICE=smoke -e CS_PORT=9465 -e CS_PATH=/healthz -e CS_INTERVAL=1s health-sidecar:vs2 >/dev/null; sleep 4
echo "/status: $(curl -s http://127.0.0.1:19399/status | cut -c1-400)"; docker rm -f vs2-smoke >/dev/null
echo "## DONE"
