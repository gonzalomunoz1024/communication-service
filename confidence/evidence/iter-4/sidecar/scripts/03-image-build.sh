#!/bin/bash
# 03: the repository Dockerfile built with stand-in bases (UBI blocked); image facts; G-4-2 (an older builder fails).
W=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4
. $W/scripts/env.sh
R=/home/claude/communication-service
sec(){ echo; echo "### $*"; }
REV=$(git -C $R rev-parse HEAD)
sec "1. UBI registry reachability (expected blocked)"
echo "\$ curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://registry.access.redhat.com/v2/"; curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 https://registry.access.redhat.com/v2/ 2>&1; echo "exit=$?"
echo "\$ docker pull registry.access.redhat.com/ubi9/go-toolset:1.27"; timeout 60 docker pull registry.access.redhat.com/ubi9/go-toolset:1.27 2>&1 | tail -2; echo "exit=${PIPESTATUS[0]}"
echo "\$ docker pull registry.access.redhat.com/ubi9/ubi-micro:9.5"; timeout 60 docker pull registry.access.redhat.com/ubi9/ubi-micro:9.5 2>&1 | tail -2; echo "exit=${PIPESTATUS[0]}"
sec "2. Dockerfile defaults and the stand-in builder"
grep -nE '^ARG (GO_IMAGE|BASE_IMAGE)|^ENV|^USER|^EXPOSE|^ENTRYPOINT' $R/sidecar/Dockerfile
echo "stand-in builder: $(docker run --rm --entrypoint go local/go-toolset:1.27 version 2>&1); env GOTOOLCHAIN=$(docker run --rm --entrypoint go local/go-toolset:1.27 env GOTOOLCHAIN 2>&1)"
sec "3. docker build from the repository Dockerfile (bases substituted)"
echo "\$ docker build -t health-sidecar:vs4 --build-arg GO_IMAGE=local/go-toolset:1.27 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot --build-arg VERSION=1.0.0-vs4 --build-arg REVISION=$REV $R/sidecar"
docker build --progress=plain -t health-sidecar:vs4 --build-arg GO_IMAGE=local/go-toolset:1.27 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot --build-arg VERSION=1.0.0-vs4 --build-arg REVISION=$REV $R/sidecar > $W/logs/docker-build.txt 2>&1; echo "exit=$?"
grep -E '^#[0-9]+ \[|ERROR|naming to' $W/logs/docker-build.txt | sort -u | tail -16
sec "4. image config"
docker image inspect health-sidecar:vs4 --format 'User={{.Config.User}} Entrypoint={{json .Config.Entrypoint}} Cmd={{json .Config.Cmd}} ExposedPorts={{json .Config.ExposedPorts}} Env={{json .Config.Env}} WorkingDir={{.Config.WorkingDir}} Size={{.Size}}'
docker image inspect health-sidecar:vs4 --format '{{json .Config.Labels}}' | python3 -I -m json.tool
sec "5. binary"
cid=$(docker create --name vs4-cp health-sidecar:vs4); docker cp $cid:/usr/local/bin/health-sidecar $W/bin/health-sidecar-vs4 >/dev/null; docker export $cid > $W/work/vs4-rootfs.tar; docker rm $cid >/dev/null
ls -la $W/bin/health-sidecar-vs4
go version -m $W/bin/health-sidecar-vs4 2>&1 | head -14
echo "dynamic section NEEDED entries: $(readelf -d $W/bin/health-sidecar-vs4 2>&1 | grep -c NEEDED); INTERP: $(readelf -l $W/bin/health-sidecar-vs4 2>&1 | grep -c INTERP)"
echo "binary holds main.version=1.0.0-vs4: $(strings $W/bin/health-sidecar-vs4 | grep -c '^1.0.0-vs4$')"
sec "6. image filesystem"
tar -tvf $W/work/vs4-rootfs.tar | grep -E 'health-sidecar|ca-bundle|etc/passwd$|etc/group$'
echo "setuid/setgid regular files: $(tar -tvf $W/work/vs4-rootfs.tar | awk 'substr($1,1,1)=="-" && $1 ~ /[sS]/' | wc -l); setgid directories (distroless base): $(tar -tvf $W/work/vs4-rootfs.tar | awk 'substr($1,1,1)=="d" && $1 ~ /[sS]/ {print $NF}' | tr "\n" " ")"
echo "shells: $(tar -tvf $W/work/vs4-rootfs.tar | grep -cE 'bin/(ba|da)?sh$')"
echo "CA bundle certs at the UBI path: $(tar -xOf $W/work/vs4-rootfs.tar etc/pki/tls/certs/ca-bundle.crt | grep -c 'BEGIN CERTIFICATE')"
echo "repository tests, deploy/ or README in the image: $(tar -tf $W/work/vs4-rootfs.tar | grep -cE '_test\.go$|(^|/)deploy/|health-sidecar/README|sidecar/README') (distroless doc files named README: $(tar -tf $W/work/vs4-rootfs.tar | grep -c 'usr/share/doc/.*README'))"
echo "files in image: $(tar -tf $W/work/vs4-rootfs.tar | grep -vc '/$')"
sec "7. docker history (layers the Dockerfile adds)"
docker history --no-trunc --format '{{.Size}}\t{{.CreatedBy}}' health-sidecar:vs4 | head -10 | cut -c1-170
sec "8. run with no environment: exit 2 naming both required variables"
docker run --rm --name vs4-noenv health-sidecar:vs4; echo "exit=$?"
sec "9. G-4-2: an older builder stops the build (GOTOOLCHAIN=local)"
for OLD in golang:1.25 golang:1.24; do
echo "builder $OLD: $(docker run --rm --entrypoint go $OLD version 2>&1)"
echo "\$ docker build -t health-sidecar:vs4-old --build-arg GO_IMAGE=$OLD --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot $R/sidecar"
docker build --progress=plain -t health-sidecar:vs4-old --build-arg GO_IMAGE=$OLD --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot $R/sidecar > $W/logs/docker-build-old.txt 2>&1; echo "exit=$?"
grep -E 'requires go|ERROR' $W/logs/docker-build-old.txt | head -4
done
echo "image health-sidecar:vs4-old exists: $(docker image inspect health-sidecar:vs4-old >/dev/null 2>&1 && echo yes || echo no)"
