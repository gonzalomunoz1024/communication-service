#!/bin/bash
# vs2: HTTPS backend stub with a private CA; no CA (x509), CS_CA_FILE, CS_INSECURE_SKIP_VERIFY; HTTP(S)_PROXY honoured for a non-loopback endpoint, never for probes; TLS 1.2 minimum
. $(dirname $0)/lib.sh; P=vs2-tls; C=$W/tls-certs
status(){ curl -s --max-time 3 http://127.0.0.1:19378/status | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("lastReport") or {}; print("  /status: target=%s last=%s sendError=%r sent=%s" % (d.get("target"), r.get("status"), d.get("sendError",""), d["reportsSent"]))' 2>/dev/null || echo "  /status unreachable"; }
rm -rf $C; mkdir -p $C; cd $C
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 2 -subj "/CN=vs2-test-ca" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost" >/dev/null 2>&1
printf "subjectAltName=IP:127.0.0.1,DNS:localhost\n" > ext.cnf
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out server.pem -days 2 -extfile ext.cnf >/dev/null 2>&1
chmod 644 ca.pem server.pem server.key; echo "[$(ts)] certs: $(openssl x509 -in server.pem -noout -subject -ext subjectAltName | tr '\n' ' ')"
docker rm -f $P-sidecar $P-backend $P-app $P >/dev/null 2>&1
docker run -d --name $P -p 127.0.0.1:19378:9465 -p 127.0.0.1:19379:9100 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name $P-backend --network container:$P $V -v $C:/certs:ro $IMG /bin-ro/stub -mode backend -port 9100 -code 202 -tls -cert /certs/server.pem -key /certs/server.key >/dev/null
docker run -d --name $P-app --network container:$P fakeapp:ci >/dev/null; sleep 1
COMMON="--network container:$P $SEC -e CS_TENANT=vs2-tls -e CS_SERVICE=tls-app -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_IGNORE_PORTS=9100 -e POD_NAME=tls-app-1"
echo "[$(ts)] CASE 1: https endpoint, no CA configured -> x509 send error, reports fail"
docker run -d --name $P-sidecar $COMMON -e CS_ENDPOINT=https://127.0.0.1:9100 health-sidecar:vs2 >/dev/null; sleep 6; status; docker logs $P-sidecar 2>&1 | grep -E "report failed|x509|certificate" | head -1 | cut -c1-300; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] CASE 2: CS_CA_FILE=/certs/ca.pem (read-only mount) -> reports accepted"
docker run -d --name $P-sidecar $COMMON -v $C/ca.pem:/certs/ca.pem:ro -e CS_ENDPOINT=https://127.0.0.1:9100 -e CS_CA_FILE=/certs/ca.pem health-sidecar:vs2 >/dev/null; sleep 6; status; docker logs $P-sidecar 2>&1 | grep -E "reported|failed" | head -1 | cut -c1-200; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] CASE 3: CS_INSECURE_SKIP_VERIFY=true -> reports accepted"
docker run -d --name $P-sidecar $COMMON -e CS_ENDPOINT=https://127.0.0.1:9100 -e CS_INSECURE_SKIP_VERIFY=true health-sidecar:vs2 >/dev/null; sleep 6; status; docker logs $P-sidecar 2>&1 | grep -E "reported|failed" | head -1 | cut -c1-200; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] CASE 3b: CS_CA_FILE pointing at a file with no certificate -> exit 2 before running"
docker run --rm $COMMON -v $C/ext.cnf:/certs/empty.pem:ro -e CS_ENDPOINT=https://127.0.0.1:9100 -e CS_CA_FILE=/certs/empty.pem health-sidecar:vs2 2>&1 | cut -c1-250; echo "  exit=${PIPESTATUS[0]}"
echo "[$(ts)] CASE 4b: HTTP_PROXY/HTTPS_PROXY = dead proxy, NON-loopback endpoint (the private backend at $BEC) -> probe unaffected (UP), reports fail with proxyconnect"
docker run -d --name $P-sidecar $COMMON -e CS_TENANT=vs2-proxy -e CS_ENDPOINT=$BEC -e HTTP_PROXY=http://127.0.0.1:1 -e HTTPS_PROXY=http://127.0.0.1:1 health-sidecar:vs2 >/dev/null; sleep 6; status; docker logs $P-sidecar 2>&1 | grep -E "target found|report failed" | head -2 | cut -c1-260; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] CASE 5b: same with NO_PROXY=172.17.0.1 -> reports accepted"
docker run -d --name $P-sidecar $COMMON -e CS_TENANT=vs2-proxy -e CS_ENDPOINT=$BEC -e HTTP_PROXY=http://127.0.0.1:1 -e HTTPS_PROXY=http://127.0.0.1:1 -e NO_PROXY=172.17.0.1 health-sidecar:vs2 >/dev/null; sleep 6; status; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] CASE 6: the sidecar's TLS floor: what the stub negotiated (TLS 1.3 expected; Go refuses < 1.2 by MinVersion report/client.go:65)"
echo "  stub saw $(curl -s --cacert $C/ca.pem https://127.0.0.1:19379/__requests | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') requests (cases 2 and 3)"
echo "  openssl s_client -tls1_1 to the stub (server side refuses old TLS; sanity of the test server): $(echo | openssl s_client -connect 127.0.0.1:19379 -tls1_1 2>&1 | grep -E 'alert|error|Protocol' | head -1)"
docker rm -f $P-backend $P-app $P >/dev/null 2>&1; echo "[$(ts)] DONE"
