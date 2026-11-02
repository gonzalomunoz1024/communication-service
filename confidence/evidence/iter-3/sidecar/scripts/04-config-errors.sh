#!/bin/bash
# F-67 / G-3-14 / G-3-17: the binary from the vs3 image run on the host with invalid and edge environments.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
B=$W/bin/health-sidecar-vs3
BASE="CS_ENDPOINT=http://127.0.0.1:19399 CS_TENANT=vs3-cfg CS_SERVICE=cfg CS_LISTEN=127.0.0.1:19398 CS_INTERVAL=1s"
bad(){ # $1 label, rest env assignments; expect exit 2 and one ERROR line
  local label=$1; shift
  out=$(env -i "$@" $B 2>&1); code=$?
  echo "[$label] env: $* -> exit=$code lines=$(echo "$out" | wc -l)"
  echo "$out" | jq -c '{level,msg,error}' 2>/dev/null | cut -c1-400 || echo "$out" | head -3
}
good(){ # $1 label, rest env: must start; SIGTERM after 1.5 s; exit 0
  local label=$1; shift
  env -i "$@" $B > $W/work/good.out 2>&1 & local pid=$!
  sleep 1.5; kill -TERM $pid; wait $pid; code=$?
  echo "[$label] env: $* -> started, exit after SIGTERM=$code; first line: $(head -1 $W/work/good.out | jq -c '{level,msg,service,instance,probe}' 2>/dev/null)"
}
echo "### 1. required variables and the shape of the error (one ERROR line, every variable at once)"
bad "no env"
bad "endpoint scheme" CS_ENDPOINT=ftp://x CS_TENANT=t CS_SERVICE=s
bad "several at once" CS_ENDPOINT=ftp://x CS_PROBE=grpc CS_SCHEME=ftp CS_INTERVAL=500ms CS_PORT=70000 CS_LOG_LEVEL=loud CS_INSECURE_SKIP_VERIFY=maybe
echo "### 2. each invalid value alone, with the rest valid"
for kv in CS_PROBE=grpc CS_PROBE=http CS_PORT=abc CS_PORT=-1 CS_PORT=70000 CS_SCHEME=ftp CS_INTERVAL=soon CS_INTERVAL=999ms CS_HEARTBEAT=1x CS_PROBE_TIMEOUT=3 CS_REPORT_TIMEOUT=ten CS_STARTUP_GRACE=5mins CS_RETRY_DELAY=2 CS_IGNORE_PORTS=1-2-3 CS_IGNORE_PORTS=9-1 CS_IGNORE_PORTS=a CS_INSECURE_SKIP_VERIFY=maybe CS_INSECURE_SKIP_VERIFY=2 CS_INSECURE_SKIP_VERIFY=enabled CS_LOG_LEVEL=loud CS_LOG_LEVEL=warning CS_LOG_LEVEL=trace CS_LOG_LEVEL=DEBUG+1; do
  bad "$kv" $BASE $kv
done
bad "CS_CA_FILE missing" $BASE CS_CA_FILE=/nonexistent/ca.pem
printf 'not a certificate\n' > $W/work/empty-ca.pem
bad "CS_CA_FILE without certificates" $BASE CS_CA_FILE=$W/work/empty-ca.pem
echo "[CS_SERVICE required when underivable] not reachable from the environment: with POD_NAME and CS_SERVICE empty the hostname is used (section 5, last case); covered by config_test.go only"
echo "### 3. G-3-17: every documented boolean spelling starts (verification state checked against a TLS stub in 14-tls)"
for v in true TRUE True 1 yes YES on On false FALSE 0 no No off OFF " true "; do good "CS_INSECURE_SKIP_VERIFY='$v'" $BASE "CS_INSECURE_SKIP_VERIFY=$v"; done
echo "### 4. G-3-14: the documented log levels start, in any case; the level applies from the first line"
for v in debug DEBUG info Warn error " ERROR "; do good "CS_LOG_LEVEL='$v'" $BASE "CS_LOG_LEVEL=$v"; done
echo "### 5. DeriveService and defaults (no CS_SERVICE)"
for pn in payments-api-7f9c6d5b4-x2k4q payments-api-x2k4q ledger-0 web-abcde bare my-app-1a2b3c4d5-zzzzz; do
  good "POD_NAME=$pn" CS_ENDPOINT=http://127.0.0.1:19399 CS_TENANT=t CS_LISTEN=127.0.0.1:19398 POD_NAME=$pn
done
good "no POD_NAME (hostname $(hostname))" CS_ENDPOINT=http://127.0.0.1:19399 CS_TENANT=t CS_LISTEN=127.0.0.1:19398
echo "### 6. edge durations the README does not mention: zero / negative timeouts and delays are accepted"
for kv in CS_REPORT_TIMEOUT=0s CS_REPORT_TIMEOUT=-5s CS_PROBE_TIMEOUT=0s CS_PROBE_TIMEOUT=-1s CS_RETRY_DELAY=-2s CS_STARTUP_GRACE=-1m CS_HEARTBEAT=-30s; do good "$kv" $BASE $kv; done
