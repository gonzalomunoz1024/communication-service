#!/bin/bash
# 14b (G-4-24, the probe half; 14 ran this case with an empty pod IP, so it proved nothing): the app is probed on the
# pod's NON-loopback address (CS_HOST=<pod IP>), which Go's ProxyFromEnvironment would send through a proxy.
#   P1: dead HTTP_PROXY/HTTPS_PROXY/http_proxy, NO_PROXY = the service host only -> the probe must still read the app.
#   P2: HTTP_PROXY = a recording stub, report endpoint where nothing listens -> the report must reach the recording
#       "proxy" (control: the same process does proxy a non-loopback http URL) and no probe GET may reach it.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
N="vs4-pnp-pod vs4-pnp-app vs4-pnp-1 vs4-pnp-2"
cleanup $N
$W/bin/stub -mode backend -port 19325 > $W/work/stub-19325.txt 2>&1 & P25=$!   # recording "proxy"
$W/bin/stub -mode backend -port 19326 > $W/work/stub-19326.txt 2>&1 & P26=$!   # plain-http service
sleep 0.5
pod vs4-pnp-pod -p 127.0.0.1:19327:9465 -p 127.0.0.1:19328:9466
app vs4-pnp-pod vs4-pnp-app -mode actuator -port 8080; sleep 0.5
PODIP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' vs4-pnp-pod)
echo "pod IP (non-loopback address of the app): '$PODIP'"
[ -n "$PODIP" ] || { echo "NO POD IP: abort"; cleanup $N; kill $P25 $P26; exit 1; }
C="-e CS_TENANT=vs4-tls -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s -e CS_HOST=$PODIP"
sidecar vs4-pnp-pod vs4-pnp-1 $C -e CS_ENDPOINT=http://172.17.0.1:19326 -e CS_SERVICE=probe-no-proxy -e POD_NAME=probe-no-proxy-0 -e HTTP_PROXY=http://172.17.0.1:19399 -e HTTPS_PROXY=http://172.17.0.1:19399 -e http_proxy=http://172.17.0.1:19399 -e NO_PROXY=172.17.0.1
sidecar vs4-pnp-pod vs4-pnp-2 $C -e CS_ENDPOINT=http://172.17.0.1:19324 -e CS_SERVICE=probe-vs-report -e POD_NAME=probe-vs-report-0 -e HTTP_PROXY=http://172.17.0.1:19325 -e CS_LISTEN=:9466
sleep 8
echo "== P1 (dead proxies, NO_PROXY=service host) /status:"; echo "   $(st 19327)"
echo "   log: $(docker logs vs4-pnp-1 2>&1 | grep -m1 'health target found' | cut -c1-260)"
echo "   requests at the plain service stub 19326: $(nreq 19326)"
echo "== P2 (HTTP_PROXY = recording stub 19325; endpoint 19324 has no listener) /status:"; echo "   $(st 19328)"
echo "   log: $(docker logs vs4-pnp-2 2>&1 | grep -m1 'health target found' | cut -c1-260)"
echo "   every request the recording proxy received (method, path; a probe would be GET /actuator/health):"
reqs 19325 | python3 -I -c 'import json,sys
r=json.load(sys.stdin); r=r if isinstance(r,list) else r.get("requests",[])
import collections; c=collections.Counter((x.get("method") or x.get("m"), x.get("path") or x.get("p")) for x in r)
print("   ", dict((" ".join(map(str,k)),v) for k,v in c.items()) or "(none)")'
cleanup $N; kill $P25 $P26 2>/dev/null
echo "end $(ts)"
