#!/usr/bin/env bash
# README debugging cause 1: sendError set (wrong CS_ENDPOINT), read from outside the container
docker rm -f ux2-sc-wrong >/dev/null 2>&1
docker run -d --name ux2-sc-wrong -p 127.0.0.1:19615:9465 -e CS_ENDPOINT=http://127.0.0.1:9 -e CS_TENANT=ux2-sidecar -e CS_SERVICE=lonely -e CS_STARTUP_GRACE=5s health-sidecar:ci >/dev/null
sleep 8
echo "/status fields:"; curl -s 127.0.0.1:19615/status | python3 -I -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ('sendError','reportsSent','lastSendAt','upSeen','target')}); print('lastReport:',d['lastReport']['status'],repr(d['lastReport'].get('message')))"
echo "log (last 3 lines):"; docker logs ux2-sc-wrong 2>&1 | tail -3 | cut -c1-240
docker rm -f ux2-sc-wrong >/dev/null; echo removed
