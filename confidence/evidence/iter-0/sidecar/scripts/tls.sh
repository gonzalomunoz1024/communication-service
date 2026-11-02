#!/bin/bash
# Pod C (sc-pod-tls): HTTPS backend stub with a private CA; sidecar without CA (x509 error), with CS_CA_FILE (ok), with CS_INSECURE_SKIP_VERIFY (ok); HTTPS_PROXY env never used for localhost probes.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
IMG=gcr.io/distroless/static-debian12:latest; V="-v $S/sidecar/bin:/bin-ro:ro"; P=sc-pod-tls; C=$S/sidecar/tls-certs
ts(){ date -u +%H:%M:%S; }
status(){ curl -s --max-time 3 http://127.0.0.1:59465/status | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("lastReport") or {}; print("  /status: target=%s last=%s sendError=%r sent=%s" % (d.get("target"), r.get("status"), d.get("sendError",""), d["reportsSent"]))' 2>/dev/null || echo "  /status unreachable"; }
rm -rf $C; mkdir -p $C; cd $C
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 2 -subj "/CN=sc-test-ca" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost" >/dev/null 2>&1
printf "subjectAltName=IP:127.0.0.1,DNS:localhost\n" > ext.cnf
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out server.pem -days 2 -extfile ext.cnf >/dev/null 2>&1
chmod 644 ca.pem server.pem server.key; echo "[$(ts)] certs: $(openssl x509 -in server.pem -noout -subject -ext subjectAltName | tr '\n' ' ')"
docker rm -f $P-sidecar $P-backend $P-app $P >/dev/null 2>&1
docker run -d --name $P -p 127.0.0.1:59465:9465 -p 127.0.0.1:59100:9100 $V $IMG /bin-ro/stub -mode hold >/dev/null
docker run -d --name $P-backend --network container:$P $V -v $C:/certs:ro $IMG /bin-ro/stub -mode backend -port 9100 -code 202 -tls -cert /certs/server.pem -key /certs/server.key >/dev/null
docker run -d --name $P-app --network container:$P fakeapp:ci >/dev/null; sleep 1
COMMON="--network container:$P --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges -e CS_TENANT=sc-tls -e CS_SERVICE=tls-app -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_IGNORE_PORTS=9100 -e POD_NAME=tls-app-1"
echo "[$(ts)] CASE 1: https endpoint, no CA configured -> expect x509 send error, reports fail"
docker run -d --name $P-sidecar $COMMON -e CS_ENDPOINT=https://127.0.0.1:9100 health-sidecar:verify >/dev/null; sleep 6; status; docker logs $P-sidecar 2>&1 | grep -E "report failed|x509|certificate" | head -2; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] CASE 2: CS_CA_FILE=/certs/ca.pem (read-only mount) -> expect reports accepted"
docker run -d --name $P-sidecar $COMMON -v $C/ca.pem:/certs/ca.pem:ro -e CS_ENDPOINT=https://127.0.0.1:9100 -e CS_CA_FILE=/certs/ca.pem health-sidecar:verify >/dev/null; sleep 6; status; docker logs $P-sidecar 2>&1 | grep -E "reported|failed" | head -2; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] CASE 3: CS_INSECURE_SKIP_VERIFY=true -> expect reports accepted"
docker run -d --name $P-sidecar $COMMON -e CS_ENDPOINT=https://127.0.0.1:9100 -e CS_INSECURE_SKIP_VERIFY=true health-sidecar:verify >/dev/null; sleep 6; status; docker logs $P-sidecar 2>&1 | grep -E "reported|failed" | head -2; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] CASE 4: HTTPS_PROXY/HTTP_PROXY set to a dead proxy -> localhost probe must still work (target found, UP), while the report goes through the proxy and fails (documented behaviour: proxy honoured for reports)"
docker run -d --name $P-sidecar $COMMON -e CS_ENDPOINT=http://127.0.0.1:9100 -e HTTP_PROXY=http://127.0.0.1:1 -e HTTPS_PROXY=http://127.0.0.1:1 health-sidecar:verify >/dev/null; sleep 6; status; docker logs $P-sidecar 2>&1 | grep -E "target found|report failed" | head -2; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] CASE 5: same with NO_PROXY=127.0.0.1 -> reports accepted"
docker run -d --name $P-sidecar $COMMON -e CS_ENDPOINT=http://127.0.0.1:9100 -e HTTP_PROXY=http://127.0.0.1:1 -e HTTPS_PROXY=http://127.0.0.1:1 -e NO_PROXY=127.0.0.1 health-sidecar:verify >/dev/null; sleep 6; status; docker rm -f $P-sidecar >/dev/null
echo "[$(ts)] backend stub saw $(curl -s http://127.0.0.1:59100/__requests -k --cacert $C/ca.pem 2>/dev/null | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null) requests in total (cases 2,3,5)"
docker rm -f $P-backend $P-app $P >/dev/null 2>&1; echo "[$(ts)] DONE"
