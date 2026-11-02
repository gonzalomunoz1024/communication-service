#!/bin/bash
# F-87: 10-minute soak of two emulated pods against private backend A: defaults (15 s / 30 s) and fast (1 s / 2 s).
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
cleanup vs3-soakA-pod vs3-soakA-app vs3-soakA-sc vs3-soakB-pod vs3-soakB-app vs3-soakB-sc
for x in A B; do pod vs3-soak$x-pod; app vs3-soak$x-pod vs3-soak$x-app -mode actuator -port 8080; done
COMMON="-e CS_ENDPOINT=$BEC -e CS_TENANT=vs3-soak -e POD_NAMESPACE=vs3-ns -e NODE_NAME=worker-9"
sidecar vs3-soakA-pod vs3-soakA-sc $COMMON -e CS_SERVICE=soak-default -e POD_NAME=soak-default-7f9c6d5b4-aaaaa
sidecar vs3-soakB-pod vs3-soakB-sc $COMMON -e CS_SERVICE=soak-fast -e POD_NAME=soak-fast-7f9c6d5b4-bbbbb -e CS_INTERVAL=1s -e CS_HEARTBEAT=2s
HZ=$(getconf CLK_TCK); echo "start $(ts) CLK_TCK=$HZ limits: 50m CPU, 32Mi memory"
declare -A last0
for i in $(seq 0 20); do
  for x in A B; do
    pid=$(docker inspect -f '{{.State.Pid}}' vs3-soak$x-sc)
    rss=$(awk '/VmRSS/{print $2}' /proc/$pid/status); hwm=$(awk '/VmHWM/{print $2}' /proc/$pid/status); thr=$(awk '/Threads/{print $2}' /proc/$pid/status)
    fds=$(ls /proc/$pid/fd | wc -l); ticks=$(awk '{print $14+$15}' /proc/$pid/stat)
    cpu="-"; if [ -n "${last0[$x]}" ]; then cpu=$(python3 -c "print('%.3f%%' % (100.0*($ticks-${last0[$x]})/$HZ/30))"); fi; last0[$x]=$ticks
    sent=$(curl -s --max-time 2 http://127.0.0.1:$(docker port vs3-soak$x-pod 9465 2>/dev/null | head -1 | cut -d: -f2)/status 2>/dev/null | jq -r .reportsSent 2>/dev/null)
    echo "t=$((i*30))s $x rss=${rss}kB hwm=${hwm}kB threads=$thr fds=$fds cpu(30s)=$cpu"
  done
  [ $i -lt 20 ] && sleep 30
done
for x in A B; do echo "== $x logs: $(docker logs vs3-soak$x-sc 2>&1 | wc -l) lines, levels: $(docker logs vs3-soak$x-sc 2>&1 | jq -r .level | sort | uniq -c | tr '\n' ' ')"; done
echo "== backend view"; mon vs3-soak
for s in soak-default soak-fast; do echo "instances of $s:"; inst vs3-soak $s; done
cleanup vs3-soakA-pod vs3-soakA-app vs3-soakA-sc vs3-soakB-pod vs3-soakB-app vs3-soakB-sc
echo "end $(ts)"
