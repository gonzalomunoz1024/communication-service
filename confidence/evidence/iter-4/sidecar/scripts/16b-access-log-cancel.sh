#!/bin/bash
# 16b: what backend B's access log says for a report whose CLIENT gives up before the answer (the sidecar's 10 s report
# timeout during a hung database, 16 C1 showed "-> 200 (9999 ms)"). Direct reproduction with curl --max-time 3 while
# vs4-mongo is paused, then a control request that waits for the answer. Only my own Mongo container and backend B.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
L=$W/logs/backend-19302.txt; B=http://127.0.0.1:19302
body='{"tenantId":"vs4-fpb","service":"cancel","status":"UP"}'
curl -s -o /dev/null -w "  warm-up report -> %{http_code} in %{time_total}s\n" -X POST -H 'Content-Type: application/json' -H 'X-Client-Id: vs4-warm' -d "$body" $B/v1/health/reports
docker pause vs4-mongo >/dev/null; echo "  [$(ts)] vs4-mongo paused"
curl -s -o /dev/null --max-time 3 -w "  client gives up: curl --max-time 3 -> http=%{http_code} after %{time_total}s (curl exit " -X POST -H 'Content-Type: application/json' -H 'X-Client-Id: vs4-cancel' -d "$body" $B/v1/health/reports; echo "$?)"
sleep 1
curl -s -o /dev/null --max-time 30 -w "  control: the client waits -> http=%{http_code} after %{time_total}s\n" -X POST -H 'Content-Type: application/json' -H 'X-Client-Id: vs4-wait' -d "$body" $B/v1/health/reports
docker unpause vs4-mongo >/dev/null; echo "  [$(ts)] vs4-mongo unpaused"
sleep 1
echo "  backend B access lines for these three clients:"
grep -E 'client=vs4-(warm|cancel|wait) ' $L | sed -E 's/^.*(client=)/    \1/' | cut -c1-160
echo "  where the logged outcome comes from: $(grep -n 'getStatusCode()' /home/claude/communication-service/src/main/java/com/atlas/communication/config/ClientIdWebFilter.java | head -1)"
