#!/bin/bash
# 04: F-67 / G-4-22 / G-3-14 / G-3-17: the vs4 image run with invalid and edge environments, each in its own
# container with no network (--network none, so nothing on this host is probed), restricted-v2 flags.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
BASE=(CS_ENDPOINT=http://127.0.0.1:19399 CS_TENANT=vs4-cfg CS_SERVICE=cfg CS_INTERVAL=1s)
envs(){ local a=(); for kv in "$@"; do a+=(-e "$kv"); done; printf '%s\0' "${a[@]}"; }
bad(){ # $1 label, rest env assignments; expect exit 2 and one ERROR line
  local label=$1; shift; local e=(); for kv in "$@"; do e+=(-e "$kv"); done
  out=$(docker run --rm --network none $SEC "${e[@]}" $IMG 2>&1); code=$?
  echo "[$label] -> exit=$code lines=$(echo "$out" | wc -l)"
  echo "$out" | python3 -I -c 'import json,sys
for l in sys.stdin:
    try: d=json.loads(l); print("   ", json.dumps({k:d.get(k) for k in ("level","msg","error")})[:600])
    except Exception: print("    RAW", l.strip()[:300])'
}
good(){ # $1 label, rest env: must start; SIGTERM after 1.5 s; exit 0
  local label=$1; shift; local e=(); for kv in "$@"; do e+=(-e "$kv"); done
  local cid=$(docker run -d --network none $SEC "${e[@]}" $IMG); sleep 1.5
  local running=$(docker inspect -f '{{.State.Running}}' $cid)
  docker kill -s TERM $cid >/dev/null 2>&1; local code=$(docker wait $cid)
  echo "[$label] -> running after 1.5 s=$running, exit after SIGTERM=$code; first line: $(docker logs $cid 2>&1 | head -1 | python3 -I -c 'import json,sys; d=json.loads(sys.stdin.read()); print(json.dumps({k:d.get(k) for k in ("level","msg","service","instance","probe","error") if k in d}))' 2>/dev/null)"
  docker logs $cid > $W/work/good-last.txt 2>&1; docker rm $cid >/dev/null
}
echo "### 1. required variables and the shape of the error (one ERROR line, every variable at once)"
bad "no env"
bad "endpoint scheme" CS_ENDPOINT=ftp://x CS_TENANT=t CS_SERVICE=s
bad "several at once" CS_ENDPOINT=ftp://x CS_PROBE=grpc CS_SCHEME=ftp CS_INTERVAL=500ms CS_PORT=70000 CS_LOG_LEVEL=loud CS_INSECURE_SKIP_VERIFY=maybe CS_REPORT_TIMEOUT=0 CS_RETRY_DELAY=-1s
echo "### 2. each invalid value alone, with the rest valid"
for kv in CS_PROBE=grpc CS_PROBE=http CS_PORT=abc CS_PORT=-1 CS_PORT=70000 CS_SCHEME=ftp CS_INTERVAL=soon CS_INTERVAL=999ms CS_INTERVAL=0 CS_HEARTBEAT=1x CS_PROBE_TIMEOUT=3 CS_REPORT_TIMEOUT=ten CS_STARTUP_GRACE=5mins CS_RETRY_DELAY=2 CS_IGNORE_PORTS=1-2-3 CS_IGNORE_PORTS=9-1 CS_IGNORE_PORTS=a CS_INSECURE_SKIP_VERIFY=maybe CS_INSECURE_SKIP_VERIFY=2 CS_INSECURE_SKIP_VERIFY=enabled CS_LOG_LEVEL=loud CS_LOG_LEVEL=warning CS_LOG_LEVEL=trace CS_LOG_LEVEL=DEBUG+1; do
  bad "$kv" "${BASE[@]}" $kv
done
bad "CS_CA_FILE missing" "${BASE[@]}" CS_CA_FILE=/nonexistent/ca.pem
echo "### 3. G-4-22: durations the sidecar cannot use (zero or negative timeouts/heartbeat, negative delay/grace) -> exit 2 naming the variable"
for kv in CS_REPORT_TIMEOUT=0s CS_REPORT_TIMEOUT=0 CS_REPORT_TIMEOUT=-5s CS_PROBE_TIMEOUT=0s CS_PROBE_TIMEOUT=-1s CS_HEARTBEAT=0s CS_HEARTBEAT=-30s CS_RETRY_DELAY=-2s CS_RETRY_DELAY=-1ns CS_STARTUP_GRACE=-1m; do bad "$kv" "${BASE[@]}" $kv; done
bad "all five at once" "${BASE[@]}" CS_REPORT_TIMEOUT=0s CS_PROBE_TIMEOUT=-1s CS_HEARTBEAT=0 CS_RETRY_DELAY=-2s CS_STARTUP_GRACE=-1m
echo "### 4. G-4-22: the zero values that stay valid, and small positive ones"
for kv in CS_RETRY_DELAY=0 CS_RETRY_DELAY=0s CS_STARTUP_GRACE=0 CS_STARTUP_GRACE=0s CS_PROBE_TIMEOUT=1ms CS_REPORT_TIMEOUT=1ms CS_HEARTBEAT=1ns; do good "$kv" "${BASE[@]}" $kv; done
echo "### 5. G-3-17: every documented boolean spelling starts (verification state checked against a TLS stub in 14-tls)"
for v in true TRUE True 1 yes YES on On false FALSE 0 no No off OFF " true "; do good "CS_INSECURE_SKIP_VERIFY='$v'" "${BASE[@]}" "CS_INSECURE_SKIP_VERIFY=$v"; done
echo "### 6. G-3-14: the documented log levels start, in any case; the level applies from the first line"
for v in debug DEBUG info Warn error " ERROR "; do good "CS_LOG_LEVEL='$v'" "${BASE[@]}" "CS_LOG_LEVEL=$v"; done
echo "    last run (CS_LOG_LEVEL=' ERROR '): $(wc -l < $W/work/good-last.txt) lines logged"
echo "### 7. DeriveService and defaults (no CS_SERVICE)"
for pn in payments-api-7f9c6d5b4-x2k4q payments-api-x2k4q ledger-0 web-abcde bare my-app-1a2b3c4d5-zzzzz; do
  good "POD_NAME=$pn" CS_ENDPOINT=http://127.0.0.1:19399 CS_TENANT=t POD_NAME=$pn
done
good "no POD_NAME (container hostname)" CS_ENDPOINT=http://127.0.0.1:19399 CS_TENANT=t
echo "[CS_SERVICE required when underivable] not reachable from the environment: with POD_NAME and CS_SERVICE empty the hostname is used; covered by config_test.go only"
