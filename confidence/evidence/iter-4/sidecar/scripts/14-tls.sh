#!/bin/bash
# F-79 (+ G-3-17 end to end, + G-4-24): TLS to the endpoint with a private CA, CS_CA_FILE, CS_INSECURE_SKIP_VERIFY
# spellings, a CA file without certificates, a TLS 1.1-only endpoint; the proxy variables: reports honour
# HTTPS_PROXY / HTTP_PROXY / NO_PROXY (and the lower-case names), probes never use a proxy.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
N="vs4-tlsb-pod vs4-tlsb-app vs4-t1 vs4-t2 vs4-t3 vs4-t4 vs4-t5 vs4-t6 vs4-t7 vs4-t8 vs4-t9 vs4-t10 vs4-t11 vs4-t12"
cleanup $N
$W/bin/stub -mode backend -port 19336 -ctl 19337 -tls -cert $W/bin/tls/srv.pem -key $W/bin/tls/srv.key > $W/work/stub-19336.txt 2>&1 & echo $! > $W/work/stub-19336.pid
$W/bin/stub -mode backend -port 19339 > $W/work/stub-19339.txt 2>&1 & echo $! > $W/work/stub-19339.pid   # plain-http service
$W/bin/stub -mode backend -port 19331 > $W/work/stub-19331.txt 2>&1 & echo $! > $W/work/stub-19331.pid   # an HTTP "proxy" that records
openssl s_server -accept 19338 -cert $W/bin/tls/srv.pem -key $W/bin/tls/srv.key -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' -www -quiet > $W/work/s_server.txt 2>&1 & echo $! > $W/work/s_server.pid
sleep 1
echo "TLS 1.1-only server check: $(echo | timeout 5 openssl s_client -connect 127.0.0.1:19338 -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' 2>&1 | grep -E 'Protocol|Cipher is' | head -2 | tr '\n' ' ')"
pod vs4-tlsb-pod -p 127.0.0.1:19380:9465 -p 127.0.0.1:19381:9466 -p 127.0.0.1:19382:9467 -p 127.0.0.1:19383:9468 -p 127.0.0.1:19384:9469 -p 127.0.0.1:19385:9470 -p 127.0.0.1:19386:9471 -p 127.0.0.1:19387:9473 -p 127.0.0.1:19389:9474 -p 127.0.0.1:19391:9475 -p 127.0.0.1:19392:9476
app vs4-tlsb-pod vs4-tlsb-app -mode actuator -port 8080; sleep 0.5
PODIP=$(docker inspect -f '{{.NetworkSettings.IPAddress}}' vs4-tlsb-pod); echo "pod IP (non-loopback address of the app): $PODIP"
E="-e CS_ENDPOINT=https://172.17.0.1:19336 -e CS_TENANT=vs4-tls -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s"
CA="-v $W/bin/tls/ca.pem:/etc/cs-ca/ca.pem:ro"
sidecar vs4-tlsb-pod vs4-t1 $E -e CS_SERVICE=no-ca -e POD_NAME=no-ca-0
sidecar vs4-tlsb-pod vs4-t2 $E $CA -e CS_SERVICE=with-ca -e POD_NAME=with-ca-0 -e CS_CA_FILE=/etc/cs-ca/ca.pem -e CS_LISTEN=:9466
sidecar vs4-tlsb-pod vs4-t3 $E -e CS_SERVICE=skip-yes -e POD_NAME=skip-yes-0 -e CS_INSECURE_SKIP_VERIFY=yes -e CS_LISTEN=:9467
sidecar vs4-tlsb-pod vs4-t4 $E -e CS_SERVICE=skip-No -e POD_NAME=skip-No-0 -e CS_INSECURE_SKIP_VERIFY=No -e CS_LISTEN=:9468
sidecar vs4-tlsb-pod vs4-t5 -e CS_ENDPOINT=https://172.17.0.1:19338 -e CS_TENANT=vs4-tls -e CS_INTERVAL=2s -e CS_SERVICE=tls11 -e POD_NAME=tls11-0 -e CS_INSECURE_SKIP_VERIFY=true -e CS_LISTEN=:9469
sidecar vs4-tlsb-pod vs4-t6 $E $CA -e CS_SERVICE=dead-proxy -e POD_NAME=dead-proxy-0 -e CS_CA_FILE=/etc/cs-ca/ca.pem -e HTTPS_PROXY=http://172.17.0.1:19399 -e CS_LISTEN=:9470
sidecar vs4-tlsb-pod vs4-t7 $E $CA -e CS_SERVICE=no-proxy -e POD_NAME=no-proxy-0 -e CS_CA_FILE=/etc/cs-ca/ca.pem -e HTTPS_PROXY=http://172.17.0.1:19399 -e NO_PROXY=172.17.0.1 -e CS_LISTEN=:9471
docker run -d --name vs4-t8 --network container:vs4-tlsb-pod $SEC -v $W/work/empty-ca.pem:/w/empty-ca.pem:ro $E -e CS_SERVICE=empty-ca -e CS_CA_FILE=/w/empty-ca.pem -e CS_LISTEN=:9472 $IMG >/dev/null
sidecar vs4-tlsb-pod vs4-t9 $E $CA -e CS_SERVICE=lower-proxy -e POD_NAME=lower-proxy-0 -e CS_CA_FILE=/etc/cs-ca/ca.pem -e https_proxy=http://172.17.0.1:19399 -e CS_LISTEN=:9473
# http endpoint where nothing listens (19398); HTTP_PROXY = the recording stub: the report must reach the "proxy"
sidecar vs4-tlsb-pod vs4-t10 -e CS_ENDPOINT=http://172.17.0.1:19398 -e CS_TENANT=vs4-tls -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s -e CS_SERVICE=via-http-proxy -e POD_NAME=via-http-proxy-0 -e HTTP_PROXY=http://172.17.0.1:19331 -e CS_LISTEN=:9474
# http endpoint (the plain stub 19339) with only a dead HTTPS_PROXY: an http:// endpoint does not use HTTPS_PROXY
sidecar vs4-tlsb-pod vs4-t11 -e CS_ENDPOINT=http://172.17.0.1:19339 -e CS_TENANT=vs4-tls -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s -e CS_SERVICE=https-proxy-only -e POD_NAME=https-proxy-only-0 -e HTTPS_PROXY=http://172.17.0.1:19399 -e CS_LISTEN=:9475
# probes never use a proxy: the app probed on the pod's NON-loopback address with dead HTTP(S)_PROXY for everything but the service
sidecar vs4-tlsb-pod vs4-t12 -e CS_ENDPOINT=http://172.17.0.1:19339 -e CS_TENANT=vs4-tls -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s -e CS_SERVICE=probe-no-proxy -e POD_NAME=probe-no-proxy-0 -e CS_HOST=$PODIP -e HTTP_PROXY=http://172.17.0.1:19399 -e HTTPS_PROXY=http://172.17.0.1:19399 -e http_proxy=http://172.17.0.1:19399 -e NO_PROXY=172.17.0.1 -e CS_LISTEN=:9476
sleep 7
for x in "19380 no-ca (verification on, private CA unknown)" "19381 with-ca (CS_CA_FILE mounted read-only)" "19382 CS_INSECURE_SKIP_VERIFY=yes" "19383 CS_INSECURE_SKIP_VERIFY=No (must verify)" "19384 TLS 1.1-only endpoint (skip-verify on; MinVersion TLS 1.2)" "19385 dead HTTPS_PROXY, https endpoint" "19386 same + NO_PROXY=172.17.0.1" "19387 dead https_proxy (lower case), https endpoint" "19389 http endpoint (nothing listens there) + HTTP_PROXY=recording stub" "19391 http endpoint + only a dead HTTPS_PROXY" "19392 probe on the pod IP with dead HTTP(S)_PROXY/http_proxy, NO_PROXY=service host"; do
  set -- $x; p=$1; shift; echo "== $*"; echo "   $(st $p | sed -E 's/comps=[^ ]+ //')"
done
echo "== empty CA file: container state $(docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}}' vs4-t8)"; docker logs vs4-t8 2>&1 | jq -c '{level,msg,error}'
echo "== requests that reached the TLS stub, by service:"; curl -s 127.0.0.1:19337/__requests | jq -r '[.[] | .body.service] | group_by(.) | map("\(.[0])=\(length)") | join(" ")'
echo "== requests that reached the plain-http service stub 19339, by service:"; curl -s 127.0.0.1:19339/__requests | jq -r '[.[] | .body.service] | group_by(.) | map("\(.[0])=\(length)") | join(" ")'
echo "== requests that reached the recording 'proxy' 19331 (method, path, service; a proxied http request carries the absolute URL):"
curl -s 127.0.0.1:19331/__requests | jq -c '[.[] | {m:.method, p:.path, svc:.body.service, ua:.headers["User-Agent"], cid:.headers["X-Client-Id"]}] | unique'
echo "== probes are never proxied: probe-no-proxy reads its app on $PODIP (a non-loopback address Go's ProxyFromEnvironment WOULD proxy):"
docker logs vs4-t12 2>&1 | jq -c 'select(.msg=="health target found") | {msg,target,status}'
cleanup $N; kill $(cat $W/work/stub-19336.pid) $(cat $W/work/stub-19339.pid) $(cat $W/work/stub-19331.pid) $(cat $W/work/s_server.pid) 2>/dev/null
echo "end $(ts)"
