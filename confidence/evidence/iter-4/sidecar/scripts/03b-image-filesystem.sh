#!/bin/bash
# 03b: section 6 of 03-image-build.sh re-run with the corrected counts (setuid regular files vs setgid directories of the base; repository files vs the base image doc files) on the exported rootfs of health-sidecar:vs4.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
sec(){ echo; echo "### $1"; }
sec "6. image filesystem"
tar -tvf $W/work/vs4-rootfs.tar | grep -E 'health-sidecar|ca-bundle|etc/passwd$|etc/group$'
echo "setuid/setgid regular files: $(tar -tvf $W/work/vs4-rootfs.tar | awk 'substr($1,1,1)=="-" && $1 ~ /[sS]/' | wc -l); setgid directories (distroless base): $(tar -tvf $W/work/vs4-rootfs.tar | awk 'substr($1,1,1)=="d" && $1 ~ /[sS]/ {print $NF}' | tr "\n" " ")"
echo "shells: $(tar -tvf $W/work/vs4-rootfs.tar | grep -cE 'bin/(ba|da)?sh$')"
echo "CA bundle certs at the UBI path: $(tar -xOf $W/work/vs4-rootfs.tar etc/pki/tls/certs/ca-bundle.crt | grep -c 'BEGIN CERTIFICATE')"
echo "repository tests, deploy/ or README in the image: $(tar -tf $W/work/vs4-rootfs.tar | grep -cE '_test\.go$|(^|/)deploy/|health-sidecar/README|sidecar/README') (distroless doc files named README: $(tar -tf $W/work/vs4-rootfs.tar | grep -c 'usr/share/doc/.*README'))"
echo "files in image: $(tar -tf $W/work/vs4-rootfs.tar | grep -vc '/$')"
echo "rootfs exported from: $(docker image inspect -f "{{.Id}}" health-sidecar:vs4)"
