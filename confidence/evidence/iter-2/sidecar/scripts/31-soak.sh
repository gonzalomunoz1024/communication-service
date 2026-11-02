#!/bin/bash
# vs2 F-87: two sidecars for 10 min: A at the default cadence (15 s / 30 s) and B at 1 s / 2 s, each in its own emulated pod with an actuator stub and a recording backend stub; sample /proc every 30 s
. $(dirname $0)/lib.sh
for p in a b; do docker rm -f vs2-soak-$p-sidecar vs2-soak-$p-app vs2-soak-$p-backend vs2-soak-$p >/dev/null 2>&1; done
docker run -d --name vs2-soak-a -p 127.0.0.1:19383:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null; docker run -d --name vs2-soak-b -p 127.0.0.1:19384:9465 $V $IMG /bin-ro/stub -mode hold >/dev/null
for p in a b; do docker run -d --name vs2-soak-$p-app --network container:vs2-soak-$p $V $IMG /bin-ro/stub -mode actuator -port 9003 >/dev/null; docker run -d --name vs2-soak-$p-backend --network container:vs2-soak-$p $V $IMG /bin-ro/stub -mode backend -port 9100 -code 202 >/dev/null; done; sleep 1
COMMON="$SEC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_TENANT=vs2-soak -e CS_IGNORE_PORTS=9100"
docker run -d --name vs2-soak-a-sidecar --network container:vs2-soak-a $COMMON -e CS_SERVICE=soak-default -e POD_NAME=soak-default-1 health-sidecar:vs2 >/dev/null
docker run -d --name vs2-soak-b-sidecar --network container:vs2-soak-b $COMMON -e CS_SERVICE=soak-fast -e POD_NAME=soak-fast-1 -e CS_INTERVAL=1s -e CS_HEARTBEAT=2s health-sidecar:vs2 >/dev/null
PA=$(docker inspect vs2-soak-a-sidecar --format '{{.State.Pid}}'); PB=$(docker inspect vs2-soak-b-sidecar --format '{{.State.Pid}}'); HZ=$(getconf CLK_TCK)
echo "== soak start $(date -u +%FT%TZ): A = defaults (CS_INTERVAL=15s CS_HEARTBEAT=30s) pid $PA port 19383; B = CS_INTERVAL=1s CS_HEARTBEAT=2s pid $PB port 19384; limits in the snippets: 50m CPU / 32Mi; CLK_TCK=$HZ"
echo "t(s) | A: rss_kB hwm_kB thr fds cpu% sent | B: rss_kB hwm_kB thr fds cpu% sent"
cpu(){ awk '{print $14+$15}' /proc/$1/stat; }
CA0=$(cpu $PA); CB0=$(cpu $PB); T0=$(date +%s)
for n in $(seq 1 20); do sleep 30
  CA1=$(cpu $PA); CB1=$(cpu $PB); T1=$(date +%s); dt=$((T1-T0))
  pa=$(python3 -c "print(round(($CA1-$CA0)*100/$HZ/$dt,2))"); pb=$(python3 -c "print(round(($CB1-$CB0)*100/$HZ/$dt,2))")
  ra=$(grep -E '^(VmRSS|VmHWM|Threads)' /proc/$PA/status | awk '{print $2}' | tr '\n' ' '); rb=$(grep -E '^(VmRSS|VmHWM|Threads)' /proc/$PB/status | awk '{print $2}' | tr '\n' ' ')
  sa=$(curl -s --max-time 2 http://127.0.0.1:19383/status | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["reportsSent"], (d.get("lastReport") or {}).get("status"), d.get("sendError","")[:30])'); sb=$(curl -s --max-time 2 http://127.0.0.1:19384/status | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["reportsSent"], (d.get("lastReport") or {}).get("status"), d.get("sendError","")[:30])')
  echo "$((n*30)) | A: $ra $(ls /proc/$PA/fd | wc -l) $pa% $sa | B: $rb $(ls /proc/$PB/fd | wc -l) $pb% $sb"
  CA0=$CA1; CB0=$CB1; T0=$T1
done
echo "== soak end $(date -u +%FT%TZ)"
for p in a b; do echo "sidecar $p log levels: $(docker logs vs2-soak-$p-sidecar 2>&1 | python3 -c 'import json,sys,collections; c=collections.Counter(); [c.update([json.loads(l)["level"]]) for l in sys.stdin if l.strip()]; print(dict(c))')"; echo "  backend stub $p saw $(docker run --rm --network container:vs2-soak-$p $V $IMG /bin-ro/req http://127.0.0.1:9100/__requests | python3 -c 'import sys,json; t=sys.stdin.read(); print(len(json.loads(t.split(" ",1)[1])))' 2>/dev/null) reports"; done
for p in a b; do docker rm -f vs2-soak-$p-sidecar vs2-soak-$p-app vs2-soak-$p-backend vs2-soak-$p >/dev/null 2>&1; done; echo "DONE"
