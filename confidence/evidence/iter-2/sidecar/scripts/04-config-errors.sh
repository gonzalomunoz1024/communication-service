#!/bin/bash
# vs2 F-67: invalid environments -> exit 2 naming the variable(s); DeriveService; a valid pinned run on the host binary (extracted from health-sidecar:vs2)
. $(dirname $0)/lib.sh; B=$W/bin/health-sidecar-vs2
run(){ local label="$1"; shift; out=$(env -i "$@" $B 2>&1); rc=$?; printf "  %-62s exit=%s %s\n" "$label" "$rc" "$(echo "$out" | python3 -c 'import json,sys
for l in sys.stdin:
    try: d=json.loads(l); print(d.get("level"), d.get("msg"), "|", (d.get("error") or "").replace("\n"," // "))
    except Exception: print(l.strip()[:200])' | head -3 | tr '\n' ' ')"; }
echo "== $(date -u +%FT%TZ) binary $(go version -m $B | head -1)"
run "no env" 
run "CS_ENDPOINT only" CS_ENDPOINT=http://x
run "endpoint without scheme" CS_ENDPOINT=cs.example.com CS_TENANT=t POD_NAME=a-1
bg(){ local label="$1"; shift; env -i "$@" $B > $W/logs/cfg-bg.txt 2>&1 & local pid=$!; sleep 1.2; kill -TERM $pid 2>/dev/null; wait $pid; local rc=$?; printf "  %-62s exit=%s (after SIGTERM) %s\n" "$label" "$rc" "$(head -1 $W/logs/cfg-bg.txt | cut -c1-230)"; }
bg "no CS_SERVICE, bare pod name without suffix (Q3: derived unchanged)" CS_ENDPOINT=http://127.0.0.1:1 CS_TENANT=t POD_NAME=bare CS_INTERVAL=1s CS_LISTEN=127.0.0.1:0 CS_PORT=1 CS_PROBE=tcp
bg "no CS_SERVICE, no POD_NAME (hostname fallback?)" CS_ENDPOINT=http://127.0.0.1:1 CS_TENANT=t CS_PROBE=tcp CS_PORT=1 CS_LISTEN=127.0.0.1:0 CS_INTERVAL=1s
run "CS_PROBE=bogus" CS_ENDPOINT=http://x CS_TENANT=t POD_NAME=a-1 CS_PROBE=bogus
run "CS_PROBE=tcp without CS_PORT" CS_ENDPOINT=http://x CS_TENANT=t POD_NAME=a-1 CS_PROBE=tcp
run "CS_PORT=70000" CS_ENDPOINT=http://x CS_TENANT=t POD_NAME=a-1 CS_PORT=70000
run "CS_PORT=abc" CS_ENDPOINT=http://x CS_TENANT=t POD_NAME=a-1 CS_PORT=abc
run "CS_SCHEME=ftp" CS_ENDPOINT=http://x CS_TENANT=t POD_NAME=a-1 CS_SCHEME=ftp
run "CS_INTERVAL=500ms" CS_ENDPOINT=http://x CS_TENANT=t POD_NAME=a-1 CS_INTERVAL=500ms
run "CS_INTERVAL=soon" CS_ENDPOINT=http://x CS_TENANT=t POD_NAME=a-1 CS_INTERVAL=soon
run "CS_IGNORE_PORTS=1-2-3" CS_ENDPOINT=http://x CS_TENANT=t POD_NAME=a-1 CS_IGNORE_PORTS=1-2-3
run "CS_CA_FILE missing" CS_ENDPOINT=https://x CS_TENANT=t POD_NAME=a-1 CS_CA_FILE=/nonexistent.pem
run "CS_INSECURE_SKIP_VERIFY=maybe" CS_ENDPOINT=http://x CS_TENANT=t POD_NAME=a-1 CS_INSECURE_SKIP_VERIFY=maybe
run "several errors at once (probe, scheme, interval)" CS_PROBE=bogus CS_SCHEME=ftp CS_INTERVAL=0s
echo "## DeriveService (CS_SERVICE empty): run with CS_PORT pinned and read /status.service"
for pn in payments-api-7f9c6d5b4-x2k4q payments-api-x2k4q ledger-0 web-abcde bare; do
  env -i CS_ENDPOINT=http://127.0.0.1:1 CS_TENANT=t POD_NAME=$pn CS_PORT=19390 CS_PROBE=tcp CS_LISTEN=127.0.0.1:19390 CS_INTERVAL=1s $B >/dev/null 2>&1 & pid=$!; sleep 0.8
  printf "  POD_NAME=%-32s -> service=%s instance=%s\n" $pn "$(curl -s http://127.0.0.1:19390/status | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["service"])')" "$(curl -s http://127.0.0.1:19390/status | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["instance"])')"; kill -TERM $pid; wait $pid 2>/dev/null; done
echo "## valid pinned run on the host (README 'try it on a laptop' shape) with CS_HEARTBEAT < CS_INTERVAL (raised) and CS_PATH without leading slash; SIGTERM -> exit 0"
env -i CS_ENDPOINT=http://127.0.0.1:1 CS_TENANT=retail CS_SERVICE=demo CS_PORT=19391 CS_PATH=status CS_LISTEN=127.0.0.1:19391 CS_INTERVAL=1s CS_HEARTBEAT=1ms $B > $W/logs/host-run.txt 2>&1 & pid=$!; sleep 2.5
echo "  /status: $(curl -s http://127.0.0.1:19391/status | cut -c1-330)"; T0=$(date +%s.%N); kill -TERM $pid; wait $pid; echo "  exit=$? after $(python3 -c "print(round($(date +%s.%N)-$T0,2))") s"; cut -c1-220 $W/logs/host-run.txt | head -6
echo "## DONE"
