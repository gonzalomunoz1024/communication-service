#!/bin/bash
# F-27 / F-36 / F-38 / F-46 / F-48 / F-50 / G-3-30: the service side of the sidecar contract, with curl against
# private backend A, plus the silence rule with a SIGKILLed sidecar.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
T=vs4-ct; U=$BE/v1/health/reports
post(){ curl -s -o $W/work/resp.txt -w '%{http_code}' -H 'Content-Type: application/json' "$@"; }
echo "### 1. caller identification (F-27)"
echo "  no X-Client-Id -> $(post -d '{"tenantId":"'$T'","service":"id","status":"UP"}' $U) $(cat $W/work/resp.txt)"
echo "  X-Client-Id 'bad id!' -> $(post -H 'X-Client-Id: bad id!' -d '{"tenantId":"'$T'","service":"id","status":"UP"}' $U) $(cat $W/work/resp.txt)"
echo "  X-Client-Id vs4-ct-repo -> $(post -H 'X-Client-Id: vs4-ct-repo' -d '{"tenantId":"'$T'","service":"id","status":"UP"}' $U)"
echo "  OPTIONS without header -> $(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS $U)"
echo "  GET /swagger-ui.html without header -> $(curl -s -o /dev/null -w '%{http_code}' $BE/swagger-ui.html)"
echo "### 2. body rules (F-36)"
for b in '{"tenantId":"'$T'","service":"b"}' '{"tenantId":"'$T'","service":"b","status":" "}' '{"service":"b","status":"UP"}' '{"tenantId":"'$T'","status":"UP"}' '{"tenantId":"'$T'","service":"b","status":"UP","groups":["liveness"],"extra":1}'; do
  echo "  $b -> $(post -H "$H" -d "$b" $U) $(head -c 160 $W/work/resp.txt)"
done
echo "### 3. vocabulary on the service side (G-3-30 / F-38): each word as the overall status and as a component of an UP report"
WORDS="UP up OK ok PASS pass HEALTHY Healthy GREEN green SERVING serving DOWN down FAIL fail FAILED failed ERROR error UNHEALTHY OUT_OF_SERVICE FATAL RED red NOT_SERVING not_serving UNKNOWN unknown WARN DEGRADED PARTIAL foo"
printf '  %-15s %-10s %s\n' word overall "component (in an UP report)"
for w in $WORDS " pass " "	fail	"; do
  s1="w1-$(echo "$w" | tr -c 'A-Za-z0-9_' '-')"; s2="w2-$(echo "$w" | tr -c 'A-Za-z0-9_' '-')"
  post -H "$H" -d '{"tenantId":"'$T'","service":"'$s1'","status":"'"$w"'"}' $U >/dev/null
  post -H "$H" -d '{"tenantId":"'$T'","service":"'$s2'","status":"UP","components":{"c":{"status":"'"$w"'"}}}' $U >/dev/null
  r1=$(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r --arg s "$s1" '.[] | select(.service==$s) | .state.lastStatus')
  r2=$(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r --arg s "$s2" '.[] | select(.service==$s) | .state.lastSummary')
  printf '  %-15s %-10s %s\n' "'$w'" "$r1" "$r2"
done
echo "  NBSP-padded 'pass' (U+00A0), component of an UP report:"
post -H "$H" --data-binary "$(printf '{"tenantId":"%s","service":"w-nbsp","status":"UP","components":{"c":{"status":"pass\xc2\xa0"}}}' $T)" $U >/dev/null
echo "   service: $(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r '.[] | select(.service=="w-nbsp") | .state.lastSummary')"
echo "### 4. nested composite + legacy details nesting (F-38)"
post -H "$H" -d '{"tenantId":"'$T'","service":"nested","status":"UP","components":{"db":{"status":"DOWN","components":{"primary":{"status":"DOWN","details":{"error":"Connection refused"}},"replica":{"status":"UP"}}},"cache":{"status":"UP","details":{"redis":{"status":"DOWN","details":{"error":"timeout"}}}}}}' $U >/dev/null
echo "  $(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r '.[] | select(.service=="nested") | .state.lastSummary')"
echo "### 5. per-instance records (F-46): pods a, b, a; unknown monitor 404"
for p in pod-a pod-b pod-a; do post -H "$H" -d '{"tenantId":"'$T'","service":"inst","status":"UP","instance":{"id":"'$p'","namespace":"ns1","node":"n1","cluster":"c1","version":"9","sidecar":"1.0.0-vs4"}}' $U >/dev/null; done
inst $T inst
echo "  unknown monitor -> $(curl -s -o $W/work/resp.txt -w '%{http_code}' -H "$H" $BE/v1/health/monitors/00000000-0000-0000-0000-000000000000/instances) $(cat $W/work/resp.txt)"
echo "### 6. concurrent instance reports (F-50): 3 rounds x 20 in parallel for one service"
for round in 1 2 3; do
  codes=$(for i in $(seq 1 20); do (post -H "$H" -d '{"tenantId":"'$T'","service":"fleet","status":"UP","instance":{"id":"fleet-'$i'"}}' $U; echo) & done; wait)
  echo "  round $round: $(echo "$codes" | grep -v '^$' | sort | uniq -c | tr -s ' ' | tr '\n' ' ')"
done
curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r '.[] | select(.service=="fleet") | "  fleet: \(.state.lastSummary) version=\(.version)"'
echo "### 7. silence vs leaving (F-48): two sidecar pods of one service; one SIGTERMed (leaving), one SIGKILLed (silent)"
cleanup vs4-sil-pod1 vs4-sil-app1 vs4-sil-sc1 vs4-sil-pod2 vs4-sil-app2 vs4-sil-sc2
for i in 1 2; do pod vs4-sil-pod$i; app vs4-sil-pod$i vs4-sil-app$i -mode actuator -port 8080; done; sleep 0.5
for i in 1 2; do sidecar vs4-sil-pod$i vs4-sil-sc$i -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=silent -e POD_NAME=silent-7f9c6d5b4-pod$i -e CS_INTERVAL=3s; done
sleep 5; mon $T | grep silent
docker stop -t 10 vs4-sil-sc1 >/dev/null; echo "  [$(ts)] pod1 sidecar SIGTERM (exit $(docker inspect -f '{{.State.ExitCode}}' vs4-sil-sc1))"
docker kill -s KILL vs4-sil-sc2 >/dev/null; K=$(date +%s); echo "  [$(ts)] pod2 sidecar SIGKILL (no leaving report)"
sleep 2; inst $T silent
for i in $(seq 1 130); do s=$(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r '.[] | select(.service=="silent") | .state.lastSummary'); case "$s" in *"has not reported"*) break;; esac; sleep 1; done
echo "  [$(ts)] +$(( $(date +%s) - K ))s after the SIGKILL: $s"
for i in $(seq 1 15); do feed $T | grep -q "silent is down" && break; sleep 1; done
feed $T | grep "silent" || echo "  no notice for 'silent'"
cleanup vs4-sil-pod1 vs4-sil-app1 vs4-sil-sc1 vs4-sil-pod2 vs4-sil-app2 vs4-sil-sc2
echo "end $(ts)"
