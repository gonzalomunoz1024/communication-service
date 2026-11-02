#!/bin/bash
# F-79 (+ G-3-17 end to end): TLS to the endpoint with a private CA, CS_CA_FILE, CS_INSECURE_SKIP_VERIFY spellings,
# a CA file without certificates, TLS 1.1-only endpoint, HTTPS_PROXY / NO_PROXY.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
N="vs3-tlsb-pod vs3-tlsb-app vs3-t1 vs3-t2 vs3-t3 vs3-t4 vs3-t5 vs3-t6 vs3-t7 vs3-t8"
cleanup $N
$W/bin/stub -mode backend -port 19336 -ctl 19337 -tls -cert $W/bin/tls/srv.pem -key $W/bin/tls/srv.key > $W/work/stub-19336.txt 2>&1 & echo $! > $W/work/stub-19336.pid
openssl s_server -accept 19338 -cert $W/bin/tls/srv.pem -key $W/bin/tls/srv.key -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' -www -quiet > $W/work/s_server.txt 2>&1 & echo $! > $W/work/s_server.pid
sleep 1
echo "TLS 1.1-only server check: $(echo | timeout 5 openssl s_client -connect 127.0.0.1:19338 -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' 2>&1 | grep -E 'Protocol|Cipher is' | head -2 | tr '\n' ' ')"
pod vs3-tlsb-pod -p 127.0.0.1:19380:9465 -p 127.0.0.1:19381:9466 -p 127.0.0.1:19382:9467 -p 127.0.0.1:19383:9468 -p 127.0.0.1:19384:9469 -p 127.0.0.1:19385:9470 -p 127.0.0.1:19386:9471
app vs3-tlsb-pod vs3-tlsb-app -mode actuator -port 8080; sleep 0.5
E="-e CS_ENDPOINT=https://172.17.0.1:19336 -e CS_TENANT=vs3-tls -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s"
CA="-v $W/bin/tls:/etc/cs-ca:ro"
sidecar vs3-tlsb-pod vs3-t1 $E -e CS_SERVICE=no-ca -e POD_NAME=no-ca-0
sidecar vs3-tlsb-pod vs3-t2 $E $CA -e CS_SERVICE=with-ca -e POD_NAME=with-ca-0 -e CS_CA_FILE=/etc/cs-ca/ca.pem -e CS_LISTEN=:9466
sidecar vs3-tlsb-pod vs3-t3 $E -e CS_SERVICE=skip-yes -e POD_NAME=skip-yes-0 -e CS_INSECURE_SKIP_VERIFY=yes -e CS_LISTEN=:9467
sidecar vs3-tlsb-pod vs3-t4 $E -e CS_SERVICE=skip-No -e POD_NAME=skip-No-0 -e CS_INSECURE_SKIP_VERIFY=No -e CS_LISTEN=:9468
sidecar vs3-tlsb-pod vs3-t5 -e CS_ENDPOINT=https://172.17.0.1:19338 -e CS_TENANT=vs3-tls -e CS_INTERVAL=2s -e CS_SERVICE=tls11 -e POD_NAME=tls11-0 -e CS_INSECURE_SKIP_VERIFY=true -e CS_LISTEN=:9469
sidecar vs3-tlsb-pod vs3-t6 $E $CA -e CS_SERVICE=dead-proxy -e POD_NAME=dead-proxy-0 -e CS_CA_FILE=/etc/cs-ca/ca.pem -e HTTPS_PROXY=http://172.17.0.1:19399 -e CS_LISTEN=:9470
sidecar vs3-tlsb-pod vs3-t7 $E $CA -e CS_SERVICE=no-proxy -e POD_NAME=no-proxy-0 -e CS_CA_FILE=/etc/cs-ca/ca.pem -e HTTPS_PROXY=http://172.17.0.1:19399 -e NO_PROXY=172.17.0.1 -e CS_LISTEN=:9471
docker run -d --name vs3-t8 --network container:vs3-tlsb-pod $SEC -v $W/work:/w:ro $E -e CS_SERVICE=empty-ca -e CS_CA_FILE=/w/empty-ca.pem -e CS_LISTEN=:9472 $IMG >/dev/null
sleep 6
for x in "19380 no-ca (verification on, private CA unknown)" "19381 with-ca (CS_CA_FILE mounted read-only)" "19382 CS_INSECURE_SKIP_VERIFY=yes" "19383 CS_INSECURE_SKIP_VERIFY=No (must verify)" "19384 TLS 1.1-only endpoint (skip-verify on; MinVersion TLS 1.2)" "19385 dead HTTPS_PROXY, non-loopback endpoint" "19386 same + NO_PROXY=172.17.0.1"; do
  set -- $x; p=$1; shift; echo "== $*"; echo "   $(st $p | sed -E 's/comps=[^ ]+ //')"
done
echo "== empty CA file: container state $(docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}}' vs3-t8)"; docker logs vs3-t8 2>&1 | jq -c '{level,msg,error}'
echo "== requests that reached the TLS stub, by service:"; curl -s 127.0.0.1:19337/__requests | jq -r '[.[] | .body.service] | group_by(.) | map("\(.[0])=\(length)") | join(" ")'
echo "== probes are never proxied: the dead-proxy sidecar still reads its app (lastReport UP above, target http://127.0.0.1:8080/...)"
cleanup $N; kill $(cat $W/work/stub-19336.pid) $(cat $W/work/s_server.pid) 2>/dev/null
echo "end $(ts)"
