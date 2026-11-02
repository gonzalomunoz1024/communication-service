#!/bin/bash
# G-3-30 edges: whitespace the two normalisers trim differently (Java String.trim: chars <= U+0020; Go
# strings.TrimSpace: ASCII space/tab/newline/VT/FF/CR + Unicode White_Space such as U+00A0, but not U+0001).
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
T=vs3-voc; U=$BE/v1/health/reports
echo "### service side (curl, component of an UP report; JSON escapes)"
for w in '\tfail\t' ' pass ' 'pass ' 'pass\u0001' ' fail'; do
  s="v-$(echo "$w" | md5sum | cut -c1-6)"
  c=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" -H 'Content-Type: application/json' -d '{"tenantId":"'$T'","service":"'$s'","status":"UP","components":{"c":{"status":"'"$w"'"}}}' $U)
  echo "  \"$w\" -> $c, service: $(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r --arg s $s '.[] | select(.service==$s) | .state.lastSummary')"
done
echo "### sidecar side (live, CS_INTERVAL=3s CS_HEARTBEAT=30s, debug): every probe = the sidecar counts the component failing"
N=""; i=0
for w in 'pass ' 'pass\u0001'; do
  n=voc$i; N="$N vs3-$n-pod vs3-$n-app vs3-$n-sc"; i=$((i+1))
done
cleanup $N; i=0
for w in 'pass ' 'pass\u0001'; do
  n=voc$i; i=$((i+1))
  pod vs3-$n-pod; app vs3-$n-pod vs3-$n-app -mode actuator -port 8080; sleep 0.3
  pid=$(docker inspect -f '{{.State.Pid}}' vs3-$n-pod)
  nsenter -t $pid -n curl -s -XPOST "http://127.0.0.1:8080/__doc" --data-binary '{"status":"UP","components":{"c":{"status":"'"$w"'"}}}' >/dev/null
  sidecar vs3-$n-pod vs3-$n-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=side-$n -e POD_NAME=side-$n-0 -e CS_INTERVAL=3s -e CS_HEARTBEAT=30s -e CS_LOG_LEVEL=debug
done
sleep 40; i=0
for w in 'pass ' 'pass\u0001'; do
  n=voc$i; i=$((i+1))
  echo "  \"$w\": accepted sends in 40 s: $(docker logs vs3-$n-sc 2>&1 | grep -c '"msg":"reported"'); service: $(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r --arg s side-$n '.[] | select(.service==$s) | .state.lastSummary')"
done
echo "  (every probe at 3 s is ~12 in 40 s; the heartbeat is 2)"
feed $T
cleanup $N
