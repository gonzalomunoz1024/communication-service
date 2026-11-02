#!/bin/bash
# vs2 G-2-16: with CS_INTERVAL=3s CS_HEARTBEAT=30s (default CS_RETRY_DELAY=2s) count reports over 30 s while UP, while DOWN and while UNKNOWN (grace);
# INFO log lines only on transitions; a 400-rejected DOWN report waits for the heartbeat; recorded gaps between reports
. $(dirname $0)/lib.sh; P=vs2-policy
docker rm -f $P-sidecar $P-grace $P-app $P-backend $P >/dev/null 2>&1
set -e
docker run -d --name $P -p 127.0.0.1:19372:9465 -p 127.0.0.1:19373:9100 -p 127.0.0.1:19374:9003 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name $P-backend --network container:$P $V $IMG /bin-ro/stub -mode backend -port 9100 -code 202 >/dev/null
docker run -d --name $P-app --network container:$P $V $IMG /bin-ro/stub -mode actuator -port 9003 >/dev/null; sleep 1
set +e
COMMON="--network container:$P $SEC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_TENANT=vs2-policy -e CS_SERVICE=policy-app -e POD_NAME=policy-app-1 -e CS_IGNORE_PORTS=9100 -e CS_INTERVAL=3s -e CS_HEARTBEAT=30s"
gaps(){ reqs 19373 | python3 -c '
import json,sys,datetime
rs=json.load(sys.stdin); ts=[datetime.datetime.fromisoformat(r["at"].replace("Z","+00:00")) for r in rs]
st=[r["body"].get("status") if isinstance(r["body"],dict) else "?" for r in rs]
g=[round((ts[i]-ts[i-1]).total_seconds(),1) for i in range(1,len(ts))]
print("  recorded:", len(rs), "statuses:", " ".join(st), "| gaps(s):", g)'; }
echo "[$(ts)] PHASE 1 (UP): start the sidecar (CS_INTERVAL=3s CS_HEARTBEAT=30s, retry delay default 2s), wait 5 s, then count reports in the next 30 s"
docker run -d --name $P-sidecar $COMMON health-sidecar:vs2 >/dev/null; sleep 5; echo "  $(st 19372)"
N0=$(nreq 19373); sleep 30; N1=$(nreq 19373); echo "  reports in 30 s while UP: $((N1-N0)) (expect 0 or 1: only the heartbeat)"; gaps
echo "[$(ts)] PHASE 2 (DOWN): app answers DOWN; count reports in 30 s after the first DOWN report"
LOGMARK=$(date -u +%FT%T.%NZ); curl -s -X POST 'http://127.0.0.1:19374/__set?status=DOWN&db=DOWN' >/dev/null
for i in $(seq 1 20); do sleep 0.5; st 19372 | grep -q 'status=DOWN' && break; done; echo "  first DOWN seen: $(st 19372)"
N0=$(nreq 19373); sleep 30; N1=$(nreq 19373); echo "  reports in 30 s while DOWN: $((N1-N0)) (expect one per probe: tick = 3s + jitter <=0.6s + 2s retry -> 5-6)"; gaps
echo "  log lines since the DOWN (default level): $(docker logs --since "$LOGMARK" $P-sidecar 2>&1 | wc -l)"; docker logs --since "$LOGMARK" $P-sidecar 2>&1 | cut -c1-200
echo "[$(ts)] PHASE 3 (UP again, then DOWN again): transitions -> exactly one INFO 'reported' line each"
LOGMARK=$(date -u +%FT%T.%NZ); curl -s -X POST 'http://127.0.0.1:19374/__set?status=UP&db=UP' >/dev/null; sleep 8; echo "  $(st 19372)"
curl -s -X POST 'http://127.0.0.1:19374/__set?status=DOWN&db=DOWN' >/dev/null; sleep 12; echo "  $(st 19372)"
echo "  log lines since: $(docker logs --since "$LOGMARK" $P-sidecar 2>&1 | wc -l) (expect 2: UP, DOWN)"; docker logs --since "$LOGMARK" $P-sidecar 2>&1 | cut -c1-200
echo "[$(ts)] PHASE 4 (rejected while DOWN): stub answers 400 -> one 'report rejected', then no retry until the heartbeat (30 s) or a change"
curl -s -X POST 'http://127.0.0.1:19373/__code?c=400' >/dev/null; LOGMARK=$(date -u +%FT%T.%NZ); sleep 7; N0=$(nreq 19373); echo "  after the rejection: $(st 19372)"
sleep 20; N1=$(nreq 19373); echo "  requests in the 20 s after the rejected one: $((N1-N0)) (expect 0)"
echo "  log since: "; docker logs --since "$LOGMARK" $P-sidecar 2>&1 | cut -c1-220
curl -s -X POST 'http://127.0.0.1:19373/__code?c=202' >/dev/null; sleep 15; N2=$(nreq 19373); echo "  stub back to 202; after the heartbeat the DOWN body is accepted and every probe is sent again: +$((N2-N1)) requests in 15 s; $(st 19372)"
docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] PHASE 5 (UNKNOWN during the startup grace): sidecar with every port ignored, CS_STARTUP_GRACE=5m -> UNKNOWN 'starting' is sent every probe"
curl -s -X POST 'http://127.0.0.1:19373/__reset' >/dev/null
docker run -d --name $P-grace $COMMON -e CS_IGNORE_PORTS=9100,9003 -e CS_STARTUP_GRACE=5m health-sidecar:vs2 >/dev/null; sleep 16; echo "  $(st 19372)"; echo "  reports in ~16 s (CS_INTERVAL=3s): $(nreq 19373)"; gaps
docker rm -f $P-grace $P-app $P-backend $P >/dev/null 2>&1; echo "[$(ts)] DONE"
