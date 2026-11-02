#!/bin/bash
# vs2 F-69 extras: (i) the only listening app port speaks TLS -> discovery switches to https; (ii) /health answers 302 -> a redirect is an answer (not followed), target kept as UP
. $(dirname $0)/lib.sh; P=vs2-l2; C=$W/tls-certs
status(){ st 19388; }
docker rm -f $P-sidecar $P-tlsapp $P-redir $P-backend $P >/dev/null 2>&1
docker run -d --name $P -p 127.0.0.1:19388:9465 -p 127.0.0.1:19389:9100 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name $P-backend --network container:$P $V $IMG /bin-ro/stub -mode backend -port 9100 -code 202 >/dev/null
COMMON="--network container:$P $SEC -e CS_ENDPOINT=http://127.0.0.1:9100 -e CS_TENANT=vs2-l2 -e CS_SERVICE=l2-app -e POD_NAME=l2-app-1 -e CS_IGNORE_PORTS=9100 -e CS_INTERVAL=2s -e CS_RETRY_DELAY=0s"
echo "[$(ts)] (i) actuator stub served over TLS on 9006 (self-signed, CN=localhost) is the only app port"
docker run -d --name $P-tlsapp --network container:$P $V -v $C:/certs:ro $IMG /bin-ro/stub -mode actuator -port 9006 -tls -cert /certs/server.pem -key /certs/server.key >/dev/null; sleep 1
docker run -d --name $P-sidecar $COMMON health-sidecar:vs2 >/dev/null; sleep 5; echo "  $(status)"; docker logs $P-sidecar 2>&1 | grep 'target found' | cut -c1-200; docker rm -f $P-sidecar $P-tlsapp >/dev/null
echo "[$(ts)] (ii) stub 'redirect' on 9007: /health -> 302 /elsewhere, everything else 404"
docker run -d --name $P-redir --network container:$P $V $IMG /bin-ro/stub -mode redirect -port 9007 >/dev/null; sleep 1
docker run -d --name $P-sidecar $COMMON health-sidecar:vs2 >/dev/null; sleep 5; echo "  $(status)"; docker logs $P-sidecar 2>&1 | grep 'target found' | cut -c1-200
echo "  requests recorded by the redirect stub target? (the sidecar must not have followed to /elsewhere): sidecar log lines mentioning elsewhere: $(docker logs $P-sidecar 2>&1 | grep -c elsewhere)"
docker rm -f $P-sidecar $P-redir $P-backend $P >/dev/null 2>&1; echo "[$(ts)] DONE"
