#!/bin/bash
# F-81 "reads only /proc/net/tcp* of its own netns": strace every thread (file calls) across a rediscovery
# (the app container stops and starts again, so discovery runs and reads the socket tables), restricted-v2 flags as in 30.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
N="vs3-sd-pod vs3-sd-app vs3-sd-sc"; cleanup $N
pod vs3-sd-pod; app vs3-sd-pod vs3-sd-app -mode actuator -port 8080; sleep 0.3
sidecar vs3-sd-pod vs3-sd-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=vs3-r2 -e CS_SERVICE=sd -e POD_NAME=sd-0 -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s
sleep 3
pid=$(docker inspect -f '{{.State.Pid}}' vs3-sd-sc); P=""; for t in $(ls /proc/$pid/task); do P="$P -p $t"; done
( timeout -s INT 14 strace -f -qq $P -e trace=%file,%desc -o $W/work/strace-sd.txt 2>/dev/null ) & SP=$!
sleep 1; docker stop -t 1 vs3-sd-app >/dev/null; echo "  [$(ts)] app container stopped"; sleep 6; docker start vs3-sd-app >/dev/null; echo "  [$(ts)] app container started"
wait $SP
echo "  sidecar log during the window: $(docker logs vs3-sd-sc 2>&1 | jq -r 'select(.msg=="health target gone; will rediscover" or .msg=="health target found") | .time[11:23]+" "+.msg' | tail -3 | paste -sd';')"
echo "  paths opened/stat'ed by the sidecar in 14 s (strace %file,%desc on every thread):"
grep -oE '(openat|open|stat|newfstatat|statx|access|faccessat2?|readlink(at)?|mkdirat|unlinkat|renameat2?)\([^"]*"[^"]*"' $W/work/strace-sd.txt | sed -E 's/\([^"]*"/ "/' | sort | uniq -c | sed 's/^/   /'
echo "  open flags used: $(grep -oE 'openat\([^)]*\)' $W/work/strace-sd.txt | grep -oE 'O_[A-Z]+' | sort | uniq -c | tr -s ' ' | paste -sd',')"
echo "  errors EACCES/EPERM/EROFS: $(grep -cE 'EACCES|EPERM|EROFS' $W/work/strace-sd.txt)"
cleanup $N; echo "end $(ts)"
