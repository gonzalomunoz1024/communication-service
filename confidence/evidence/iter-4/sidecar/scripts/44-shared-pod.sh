#!/bin/bash
# 44: the shared pod (app + sidecar, health-sidecar:ci built from the code under test), READ ONLY: /status, its logs
# and docker inspect. No exec, no restart.
echo "### 1. docker inspect sidecar (image, user, read-only rootfs, capabilities, no-new-privileges, network, state)"
docker inspect sidecar --format 'image={{.Config.Image}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} capadd={{.HostConfig.CapAdd}} secopt={{.HostConfig.SecurityOpt}} network={{.HostConfig.NetworkMode}} running={{.State.Running}} restarts={{.RestartCount}} started={{.State.StartedAt}}'
docker image inspect health-sidecar:ci --format 'health-sidecar:ci id={{.Id}} created={{.Created}} user={{.Config.User}} labels={{json .Config.Labels}}' | cut -c1-600
echo "### 2. GET http://127.0.0.1:19465/status and /healthz"
curl -s --max-time 3 -w '\n  http=%{http_code}\n' http://127.0.0.1:19465/status | cut -c1-900
curl -s --max-time 3 -i http://127.0.0.1:19465/healthz | tr -d '\r' | grep -E '^HTTP|^Content-Type|^ok' | sed 's/^/  /'
echo "### 3. docker logs sidecar: line count, shape, and the last lines"
docker logs sidecar > /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/work/shared-sidecar.log 2>&1
F=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/work/shared-sidecar.log
python3 -I - "$F" <<'PY'
import json,sys,collections
lines=open(sys.argv[1]).read().splitlines(); bad=0; c=collections.Counter()
for l in lines:
    try: d=json.loads(l); c[(d.get("level"),d.get("msg"))]+=1
    except Exception: bad+=1
print("  lines:",len(lines),"non-JSON:",bad)
for (lv,m),n in sorted(c.items(), key=lambda x:(-x[1],str(x))): print("   %4d  %-5s %s"%(n,lv,m))
print("  first line:", lines[0][:400] if lines else "-")
print("  last 3 lines:")
for l in lines[-3:]: print("   ", l[:300])
PY
echo "### 4. /status essentials (is it still reporting?) and the image's source tree"
curl -s --max-time 3 http://127.0.0.1:19465/status | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print("  now", __import__("datetime").datetime.utcnow().strftime("%H:%M:%S"), "reportsSent=%s lastSendAt=%s sendError=%s lastReport.status=%s" % (d.get("reportsSent"), (d.get("lastSendAt") or "")[11:23], d.get("sendError"), (d.get("lastReport") or {}).get("status")))' 2>/dev/null
cd /home/claude/communication-service; git diff --quiet ec4cfcb 1cd3f13 -- sidecar; echo "  the label's revision ec4cfcb vs 1cd3f13, sidecar/: git diff --quiet -> exit $? (0 = same sidecar source)"
