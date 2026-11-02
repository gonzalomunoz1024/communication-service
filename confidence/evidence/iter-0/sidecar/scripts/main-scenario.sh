#!/bin/bash
# Pod A (sc-pod-main): sidecar already running (started before the app). Now: app joins -> UP; kill app -> DOWN notice;
# restart app -> recovery; kill+restart sidecar -> no new notice; docker stop sidecar -> leaving; RSS/CPU samples.
P=sc-pod-main; H='X-Client-Id: sc-verifier'; B=http://localhost:8080
ts(){ date -u +%H:%M:%S; }
status(){ curl -s --max-time 3 http://127.0.0.1:49465/status | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("lastReport") or {}; print("  /status: target=%s upSeen=%s last=%s msg=%r sendError=%r sent=%s" % (d.get("target"), d["upSeen"], r.get("status"), r.get("message",""), d.get("sendError",""), d["reportsSent"]))' 2>/dev/null || echo "  /status: unreachable"; }
mon(){ curl -s -H "$H" "$B/v1/health/monitors?tenantId=sc-pod" | python3 -c 'import json,sys; d=json.load(sys.stdin); [print("  monitor: lastStatus=%s summary=%r unhealthy=%s healthy=%s incidents=%s openNotice=%s" % (m["state"].get("lastStatus"), m["state"].get("lastSummary"), m["state"].get("unhealthyStreak"), m["state"].get("healthyStreak"), m["state"].get("incidents"), m["state"].get("openNoticeId") or m["state"].get("noticeId"))) for m in d]'; }
MID(){ curl -s -H "$H" "$B/v1/health/monitors?tenantId=sc-pod" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])'; }
inst(){ curl -s -H "$H" "$B/v1/health/monitors/$(MID)/instances" | python3 -c 'import json,sys; [print("  instance: id=%s status=%s left=%s lastSeen=%s sidecar=%s version=%s ns=%s node=%s cluster=%s comps=%s" % (i["instanceId"], i["status"], i["left"], i["lastSeenAt"], i.get("sidecar"), i.get("version"), i.get("namespace"), i.get("node"), i.get("cluster"), i.get("components"))) for i in json.load(sys.stdin)]'; }
feed(){ curl -s -H "$H" "$B/v1/feed?tenantId=sc-pod" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  feed:", [(i["type"], i["severity"], i["title"], i["status"]) for i in d["items"]] or "empty")'; }
stats(){ docker stats --no-stream --format '  stats {{.Name}}: cpu={{.CPUPerc}} mem={{.MemUsage}}' $P-sidecar 2>/dev/null; }
echo "[$(ts)] STEP A: app container joins the pod (fakeapp:ci, UID 1001)"
docker run -d --name $P-app --network container:$P fakeapp:ci >/dev/null; sleep 7; status; mon; inst; feed; stats
echo "[$(ts)] STEP B: 25 s of steady state (heartbeat 10 s) then stats"; sleep 25; status; mon; stats
echo "[$(ts)] STEP C: app answers DOWN (db DOWN) -> expect DOWN after retry delay, OUTAGE notice after the 2nd DOWN report (failureThreshold 2, heartbeat 10 s)"
curl -s -X POST 'http://127.0.0.1:48080/__set?status=DOWN&db=DOWN' >/dev/null; sleep 8; status; mon; inst; feed; sleep 14; echo "[$(ts)] after the heartbeat:"; status; mon; feed
echo "[$(ts)] STEP D: app recovers -> UP; notice retired after recoveryThreshold 2 UP reports"
curl -s -X POST 'http://127.0.0.1:48080/__set?status=UP&db=UP' >/dev/null; sleep 8; status; mon; feed; sleep 14; echo "[$(ts)] after the heartbeat:"; status; mon; feed
echo "[$(ts)] STEP E: kill the app container (connection refused) -> DOWN (unreachable); the port is gone so the sidecar rediscovers; then restart the app"
docker kill $P-app >/dev/null; sleep 9; status; mon; feed; echo "[$(ts)] restart app"; docker start $P-app >/dev/null; sleep 9; status; mon; feed; sleep 12; echo "[$(ts)] after heartbeat:"; status; mon; feed
echo "[$(ts)] STEP F: sidecar crash (docker kill -s KILL) and restart (emulates a liveness restart) -> UP again, same monitor, no new notice"
docker kill -s KILL $P-sidecar >/dev/null; sleep 2; echo "  sidecar state: $(docker inspect $P-sidecar --format '{{.State.Status}} exit={{.State.ExitCode}}')"; inst; docker start $P-sidecar >/dev/null; sleep 7; status; mon; inst; feed
echo "[$(ts)] STEP G: steady state 30 s, stats"; sleep 30; stats; status; mon
echo "[$(ts)] STEP H: docker stop sidecar (SIGTERM, 30 s grace) -> leaving report, left=true, exit 0"
T0=$(date +%s.%N); docker stop -t 30 $P-sidecar >/dev/null; T1=$(date +%s.%N); echo "  stop took $(python3 -c "print(round($T1-$T0,2))") s; exit code $(docker inspect $P-sidecar --format '{{.State.ExitCode}}')"; sleep 1; inst; mon; feed
echo "[$(ts)] SIDECAR LOG (whole run):"; docker logs $P-sidecar 2>&1
echo "[$(ts)] DONE (containers left running for inspection: $P, $P-app; sidecar stopped)"
