#!/bin/bash
# F-81 and the non-root / restricted-v2 hard gate: the image under five UID/GID choices with the restricted-v2 context
# emulated (--read-only with no tmpfs, --cap-drop ALL, no-new-privileges, Docker's default seccomp = RuntimeDefault),
# reporting to private backend A; /proc evidence, an 8 s strace of every thread, no shell, --network none.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
T=vs4-r2; USERS=("" "4242:0" "65534:65534" "1000660000:0" "1000700123:1000700123")
echo "### image: $(docker inspect -f 'User={{.Config.User}} Entrypoint={{json .Config.Entrypoint}} Exposed={{json .Config.ExposedPorts}}' $IMG)"
for i in 0 1 2 3 4; do n=vs4-r2-$i; cleanup $n-pod $n-app $n-sc; done; cleanup vs4-r2-nonet
for i in 0 1 2 3 4; do
  n=vs4-r2-$i; hp=$((19390+i)); u=${USERS[$i]}
  pod $n-pod -p 127.0.0.1:$hp:9465; app $n-pod $n-app -mode actuator -port 8080
  U=""; [ -n "$u" ] && U="--user $u"
  docker run -d --name $n-sc --network container:$n-pod $U --read-only --cap-drop ALL --security-opt no-new-privileges \
    -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=r2-$i -e POD_NAME=r2-$i-0 -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s $IMG >/dev/null
done
sleep 6
for i in 0 1 2 3 4; do
  n=vs4-r2-$i; hp=$((19390+i)); u=${USERS[$i]:-image default}; pid=$(docker inspect -f '{{.State.Pid}}' $n-sc)
  echo "### --user $u"
  echo "  running=$(docker inspect -f '{{.State.Running}}' $n-sc) healthz=$(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:$hp/healthz) status=$(raw $hp | jq -c '{last:.lastReport.status,reportsSent,sendError}')"
  echo "  $(grep -E '^(Uid|Gid|Groups|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs|Seccomp|VmRSS|Threads):' /proc/$pid/status | tr -s '\t ' ' ' | paste -sd'|')"
  echo "  rootfs: $(awk '$2=="/"{print $3, $4}' /proc/$pid/mounts | cut -c1-60); fds: $(ls -l /proc/$pid/fd | awk 'NR>1{print $NF}' | sed -E 's/[0-9]+/N/g' | sort | uniq -c | tr -s ' ' | paste -sd',')"
done
echo "### service view: $(mon $T | grep -c 'UP (1 of 1 pod UP)') of 5 monitors UP (1 of 1 pod UP)"
pid=$(docker inspect -f '{{.State.Pid}}' vs4-r2-3-sc); P=""; for t in $(ls /proc/$pid/task); do P="$P -p $t"; done
echo "### strace -f of every thread of the 1000660000:0 sidecar for 8 s (file, write, network calls)"
timeout -s INT 8 strace -f -qq $P -e trace=%file,write,writev,sendto,sendmsg,connect,socket,bind -o $W/work/strace-r2.txt 2>/dev/null
echo "  calls: $(sed -E 's/^[0-9]+ +//; s/\(.*//' $W/work/strace-r2.txt | sort | uniq -c | tr -s ' ' | paste -sd',')"
echo "  file-path calls (open/stat/mkdir/unlink...): $(grep -cE 'open|stat|mkdir|unlink|rename|chmod|access' $W/work/strace-r2.txt)"
echo "  errors EACCES/EPERM/EROFS: $(grep -cE 'EACCES|EPERM|EROFS' $W/work/strace-r2.txt)"
echo "  write targets: $(grep -oE '^[0-9]+ +(write|writev)\([0-9]+' $W/work/strace-r2.txt | awk -F'(' '{print $2}' | sort | uniq -c | tr -s ' ' | paste -sd',') (fd -> $(for f in $(grep -oE '^[0-9]+ +(write|writev)\([0-9]+' $W/work/strace-r2.txt | awk -F'(' '{print $2}' | sort -u); do printf '%s=%s ' $f "$(readlink /proc/$pid/fd/$f)"; done))"
echo "### no shell in the image"
docker exec vs4-r2-3-sc sh -c true > $W/work/exec.txt 2>&1; e=$?; cut -c1-160 $W/work/exec.txt; echo "  docker exec exit $e"
docker run --rm --entrypoint /bin/sh $IMG -c true > $W/work/run-sh.txt 2>&1; e=$?; head -1 $W/work/run-sh.txt | cut -c1-330; echo "  docker run --entrypoint /bin/sh exit $e"
echo "### --network none: serves /healthz in its own namespace, reports fail"
docker run -d --name vs4-r2-nonet --network none --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=r2-nonet -e POD_NAME=r2-nonet-0 -e CS_INTERVAL=2s $IMG >/dev/null; sleep 3
np=$(docker inspect -f '{{.State.Pid}}' vs4-r2-nonet)
echo "  /healthz via nsenter: $(nsenter -t $np -n curl -s -w ' (HTTP %{http_code})' 127.0.0.1:9465/healthz)"
echo "  /status sendError: $(nsenter -t $np -n curl -s 127.0.0.1:9465/status | jq -r '.sendError // "-"' | cut -c1-160)"
for i in 0 1 2 3 4; do n=vs4-r2-$i; cleanup $n-sc $n-app $n-pod; done; cleanup vs4-r2-nonet
echo "end $(ts)"
