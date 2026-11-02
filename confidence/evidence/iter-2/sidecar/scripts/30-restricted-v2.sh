#!/bin/bash
# vs2 F-81/F-80: the image runs as any UID with --read-only --cap-drop ALL --security-opt no-new-privileges and the default seccomp profile; /proc facts, fds, strace of file writes, --network none
. $(dirname $0)/lib.sh; P=vs2-sec
docker rm -f $P-sidecar $P-app $P-backend $P >/dev/null 2>&1
docker run -d --name $P -p 127.0.0.1:19382:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name $P-app --network container:$P fakeapp:ci >/dev/null
docker run -d --name $P-backend --network container:$P $V $IMG /bin-ro/stub -mode backend -port 9100 -code 202 >/dev/null; sleep 1
echo "== $(date -u +%FT%TZ) image health-sidecar:vs2 User=$(docker inspect health-sidecar:vs2 --format '{{.Config.User}}') | docker $(docker version --format '{{.Server.Version}}') default seccomp profile, no --privileged"
ENV="-e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_TENANT=vs2-sec -e CS_SERVICE=sec-app -e POD_NAME=sec-app-1 -e CS_IGNORE_PORTS=9100 -e CS_INTERVAL=1s -e CS_HEARTBEAT=2s"
facts(){ pid=$(docker inspect $1 --format '{{.State.Pid}}'); echo "    pid=$pid $(grep -E '^(Uid|Gid|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs|Seccomp|Threads|VmRSS|VmHWM):' /proc/$pid/status | tr -s '\t' ' ' | tr '\n' ' ')"; echo "    root mount: $(grep -E ' / ' /proc/$pid/mounts | awk '{print $1, $3, $4}' | head -1) | writable mounts: $(grep -vE '^(proc|sysfs|cgroup|mqueue|devpts|tmpfs /dev|shm)' /proc/$pid/mounts | awk '$4 ~ /^rw/ {print $2}' | tr '\n' ' ')"; echo "    fds: $(ls /proc/$pid/fd | wc -l) -> $(ls -l /proc/$pid/fd | awk 'NR>1{print $NF}' | sed 's#.*/##' | tr '\n' ' ')"; }
i=0
for spec in "image default (no --user)|" "4242:0|--user 4242:0" "65534:65534|--user 65534:65534" "OpenShift-like 1000660000:0|--user 1000660000:0" "non-zero gid, no passwd entry 1000700123:1000700123|--user 1000700123:1000700123"; do
  label=${spec%%|*}; user=${spec#*|}; i=$((i+1))
  docker run -d --name $P-sidecar --network container:$P $user --read-only --cap-drop ALL --security-opt no-new-privileges $ENV health-sidecar:vs2 >/dev/null; sleep 3
  echo "  CASE $i: $label  --read-only --cap-drop ALL --security-opt no-new-privileges"
  echo "    state=$(docker inspect $P-sidecar --format '{{.State.Status}}') healthz=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:19382/healthz) $(st 19382)"; facts $P-sidecar
  if [ $i = 4 ]; then
    pid=$(docker inspect $P-sidecar --format '{{.State.Pid}}')
    echo "    strace 8 s (openat/creat/mkdir/unlink/rename/write*, all threads):"; timeout 8 strace -f -p $pid -e trace=openat,open,creat,mkdir,mkdirat,unlink,unlinkat,rename,renameat,write,pwrite64,writev -o $W/logs/strace-vs2.txt >/dev/null 2>&1
    python3 - $W/logs/strace-vs2.txt <<'PY'
import re,sys,collections
opens=collections.Counter(); writes=collections.Counter(); other=collections.Counter()
for l in open(sys.argv[1]):
    m=re.search(r'\s(\w+)\((.*)\)\s*=\s*(-?\d+|\?)', l)
    if not m: continue
    call,args,ret=m.groups()
    if call in ("openat","open"): opens[re.sub(r'^.*?"(.*?)".*$', r'\1', args)+" flags="+("O_WRONLY/RDWR" if re.search(r'O_WRONLY|O_RDWR|O_CREAT',args) else "O_RDONLY")+" ret="+ret]+=1
    elif call in ("write","pwrite64","writev"): writes["fd "+args.split(",")[0]]+=1
    else: other[call]+=1
print("      opens:", dict(opens) or "none"); print("      writes by fd:", dict(writes) or "none", "(fd 1 = stdout log lines; sockets = probes/reports)"); print("      other:", dict(other) or "none")
PY
    echo "    fd targets at that moment: $(ls -l /proc/$pid/fd | awk 'NR>1{print $NF}' | tr '\n' ' ')"
  fi
  docker rm -f $P-sidecar >/dev/null
done
echo "  CASE 6: --user 1000660000:0 with --network none (no app, no service): the process still serves /healthz in its own namespace"
docker run -d --name $P-sidecar --network none --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges $ENV health-sidecar:vs2 >/dev/null; sleep 3
pid=$(docker inspect $P-sidecar --format '{{.State.Pid}}'); echo "    state=$(docker inspect $P-sidecar --format '{{.State.Status}}') nsenter curl /healthz -> $(nsenter -t $pid -n curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9465/healthz) /status -> $(nsenter -t $pid -n curl -s http://127.0.0.1:9465/status | cut -c1-200)"; docker logs $P-sidecar 2>&1 | tail -1 | cut -c1-200; docker rm -f $P-sidecar >/dev/null
echo "  CASE 7: the image has no shell: docker run --entrypoint /bin/sh -> $(docker run --rm --entrypoint /bin/sh health-sidecar:vs2 2>&1 | head -1 | cut -c1-120)"
echo "  CASE 8: runAsNonRoot admission sanity: the image's USER is numeric ($(docker inspect health-sidecar:vs2 --format '{{.Config.User}}')), so a kubelet can verify non-root without a passwd lookup"
docker rm -f $P-app $P-backend $P >/dev/null 2>&1; echo "DONE"
