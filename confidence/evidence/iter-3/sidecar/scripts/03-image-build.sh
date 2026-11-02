#!/bin/bash
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; W=$S/sidecar3; R=/home/claude/communication-service
sec(){ echo; echo "### $*"; }
REV=$(git -C $R rev-parse HEAD)
sec "1. UBI registry reachability (expected blocked)"
echo "\$ curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://registry.access.redhat.com/v2/"; curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 https://registry.access.redhat.com/v2/ 2>&1; echo "exit=$?"
echo "\$ docker pull registry.access.redhat.com/ubi9/ubi-micro:9.5"; timeout 60 docker pull registry.access.redhat.com/ubi9/ubi-micro:9.5 2>&1 | tail -2; echo "exit=${PIPESTATUS[0]}"
sec "2. docker build from the repository Dockerfile (bases substituted)"
echo "\$ docker build -t health-sidecar:vs3 --build-arg GO_IMAGE=local/go-toolset:1.25 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot --build-arg VERSION=1.0.0-vs3 --build-arg REVISION=$REV $R/sidecar"
docker build --progress=plain -t health-sidecar:vs3 --build-arg GO_IMAGE=local/go-toolset:1.25 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot --build-arg VERSION=1.0.0-vs3 --build-arg REVISION=$REV $R/sidecar > $W/logs/docker-build.txt 2>&1; echo "exit=$?"
grep -E '^#[0-9]+ \[|DONE|ERROR|naming to' $W/logs/docker-build.txt | tail -16
sec "3. image config"
docker image inspect health-sidecar:vs3 --format 'User={{.Config.User}} Entrypoint={{json .Config.Entrypoint}} Cmd={{json .Config.Cmd}} ExposedPorts={{json .Config.ExposedPorts}} Env={{json .Config.Env}} WorkingDir={{.Config.WorkingDir}} Size={{.Size}}'
docker image inspect health-sidecar:vs3 --format '{{json .Config.Labels}}' | jq .
echo "go-toolset image Go: $(docker run --rm --entrypoint go local/go-toolset:1.25 version 2>&1)"
sec "4. binary"
cid=$(docker create health-sidecar:vs3); docker cp $cid:/usr/local/bin/health-sidecar $W/bin/health-sidecar-vs3 >/dev/null; docker export $cid > $W/work/vs3-rootfs.tar; docker rm $cid >/dev/null
ls -la $W/bin/health-sidecar-vs3
go version -m $W/bin/health-sidecar-vs3 2>&1 | head -12
echo "readelf NEEDED/INTERP:"; readelf -d $W/bin/health-sidecar-vs3 2>&1 | grep -cE 'NEEDED' ; readelf -l $W/bin/health-sidecar-vs3 2>&1 | grep -c INTERP
echo "strings has main.version=1.0.0-vs3:"; strings $W/bin/health-sidecar-vs3 | grep -c '1.0.0-vs3'
sec "5. image filesystem (non-distroless entries, setuid, owner/mode of what the Dockerfile adds)"
tar -tvf $W/work/vs3-rootfs.tar | grep -E 'health-sidecar|ca-bundle|etc/passwd|etc/group' 
echo "setuid/setgid files: $(tar -tvf $W/work/vs3-rootfs.tar | awk '$1 ~ /s/' | wc -l)"
echo "shells: $(tar -tvf $W/work/vs3-rootfs.tar | grep -cE 'bin/(ba)?sh$')"
echo "CA bundle certs: $(tar -xOf $W/work/vs3-rootfs.tar etc/pki/tls/certs/ca-bundle.crt | grep -c 'BEGIN CERTIFICATE')"
echo "tests/deploy/README in image: $(tar -tf $W/work/vs3-rootfs.tar | grep -cE '_test.go|deploy/|README')"
sec "6. docker history (layers the Dockerfile adds)"
docker history --no-trunc --format '{{.Size}}\t{{.CreatedBy}}' health-sidecar:vs3 | head -12 | cut -c1-170
sec "7. run with no environment: exit 2 naming both required variables"
docker run --rm health-sidecar:vs3; echo "exit=$?"
