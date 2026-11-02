#!/bin/bash
# F-75 (re-run of 13 CASE 5 on its own pod: the 13 re-run moved the flap sidecar out of vs4-var-pod, so :19360 had no sidecar)
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
N="vs4-own-pod vs4-own-app vs4-own-sc"; cleanup $N
pod vs4-own-pod -p 127.0.0.1:19360:9465 -p 127.0.0.1:19361:8080; app vs4-own-pod vs4-own-app -mode actuator -port 8080; sleep 0.3
sidecar vs4-own-pod vs4-own-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=vs4-var -e CS_SERVICE=own -e POD_NAME=own-6d4f8b7c9-ab12c -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s
sleep 4
echo "### the sidecar's own endpoints (:9465 -> 127.0.0.1:19360)"
curl -s -D - 127.0.0.1:19360/healthz | grep -iE '^HTTP|content-type|^ok' | tr -d '\r'
curl -s -D - -o /dev/null 127.0.0.1:19360/status | grep -iE '^HTTP|content-type' | tr -d '\r'
for u in /nope /status/x /; do echo "  GET $u -> $(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:19360$u)"; done
for u in /healthz /status; do echo "  POST $u -> $(curl -s -o /dev/null -w '%{http_code}' -XPOST 127.0.0.1:19360$u) (Allow: $(curl -s -D - -o /dev/null -XPOST 127.0.0.1:19360$u | grep -i '^allow' | tr -d '\r' | cut -d' ' -f2-))"; done
echo "  /status keys (healthy): $(raw 19360 | jq -c 'keys')"
echo "  /status (healthy):"; raw 19360 | jq -c '.' | cut -c1-600
curl -s -XPOST "127.0.0.1:19361/__set?status=DOWN&db=DOWN" >/dev/null; sleep 6
echo "  /status keys (app DOWN): $(raw 19360 | jq -c 'keys')"
echo "  /status (app DOWN):"; raw 19360 | jq -c '.' | cut -c1-700
python3 -I -c "
import socket,time
s=socket.create_connection(('127.0.0.1',19360)); s.settimeout(30); t=time.time()
try:
    d=s.recv(100); print('  silent client (no request line): server closed after %.1fs, got %r' % (time.time()-t, d[:60]))
except Exception as e: print('  silent client: no close within 30 s:', e)
"
cleanup $N; echo "end $(ts)"
