#!/bin/bash
# 15e (F-38 "component detail text capped at 200 chars, error first"): one report with a DOWN component whose details hold a
# 300-character error and two other keys, against private backend A; read back what the service stored and wrote.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
T=vs4-cap; ERR=$(printf 'E%.0s' $(seq 1 300))
body=$(jq -cn --arg e "$ERR" '{tenantId:"vs4-cap",service:"cap",status:"UP",components:{db:{status:"DOWN",details:{zeta:"last",error:$e,alpha:"first"}}},instance:{id:"cap-0"}}')
echo "  POST -> $(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "$H" -d "$body" $BE/v1/health/reports)"
id=$(monid $T cap)
curl -s -H "$H" "$BE/v1/health/monitors/$id/instances" | jq -r '.[0].failingComponents // .[0].components // .[0] | tostring' | head -c 600; echo
curl -s -H "$H" "$BE/v1/health/monitors/$id/instances" | jq -r '[.. | objects | select(has("detail")) | .detail][0] as $d | "  stored detail: length=\($d|length) starts=\($d[0:12]) ends=\($d[-12:])"'
echo "  lastSummary: $(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r '.[0].state.lastSummary // .[0].lastSummary' | cut -c1-200)"
