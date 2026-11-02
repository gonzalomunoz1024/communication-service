#!/bin/bash
# G-4-16 (and G-3-30): padded and white-space-only status words read the same on both sides, end to end.
# Both sides now trim exactly the characters up to U+0020 (Java String.trim()). Table: ASCII space, tab, U+0001,
# U+00A0, U+2003, and words that are only white space; plus two case-mapping probes (dotless i, sharp s: Java's
# toUpperCase(Locale.ROOT) uses full case mapping, Go's strings.ToUpper simple mapping). Private backend A.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
T=vs4-voc; U=$BE/v1/health/reports
# JSON-escaped words; expected reading after trimming chars <= U+0020: UP / failing (DEGRADED) / UNKNOWN (not failing)
BS=$'\x5c'   # a backslash: the words are JSON escapes, decoded by the service and by the sidecar
WORDS=( 'pass ' ' pass' "${BS}tpass${BS}t" "pass${BS}u0001" "${BS}u0001fail" "pass${BS}u00a0" "${BS}u00a0pass" "pass${BS}u2003" ' ' "${BS}t" "${BS}u0001" "${BS}u00a0" "${BS}u2003" '' "fa${BS}u0131l" "pa${BS}u00dF" )
EXPECT=( UP UP UP UP DOWN failing failing failing UNKNOWN UNKNOWN UNKNOWN failing failing UNKNOWN DOWN case? )
key(){ echo -n "$1" | md5sum | cut -c1-6; }
echo "### 1. service side (curl, the word as component c of an UP report) -> lastSummary"
for k in "${!WORDS[@]}"; do w=${WORDS[$k]}; s="sv-$(key "$w")"
  c=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" -H 'Content-Type: application/json' -d '{"tenantId":"'$T'","service":"'$s'","status":"UP","components":{"c":{"status":"'"$w"'"}}}' $U)
  printf '  %-14s expect %-8s -> HTTP %s, service: %s\n' "\"$w\"" "${EXPECT[$k]}" "$c" "$(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r --arg s $s '.[] | select(.service==$s) | .state.lastSummary')"
done
echo "### 1b. service side, the word as the overall status -> lastStatus"
for k in "${!WORDS[@]}"; do w=${WORDS[$k]}; s="so-$(key "$w")"
  c=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" -H 'Content-Type: application/json' -d '{"tenantId":"'$T'","service":"'$s'","status":"'"$w"'"}' $U)
  printf '  %-14s -> HTTP %s, service: %s\n' "\"$w\"" "$c" "$(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r --arg s $s '.[] | select(.service==$s) | "\(.state.lastStatus) | \(.state.lastSummary)"')"
done
echo "### 2. through the sidecar (live pods, CS_INTERVAL=3s CS_HEARTBEAT=30s, debug): sends in 40 s (every probe ~12 = the"
echo "###    sidecar counts c as failing; heartbeat ~2 = not failing) and the service's reading of those reports"
N=""; for k in "${!WORDS[@]}"; do N="$N vs4-voc$k-pod vs4-voc$k-app vs4-voc$k-sc"; done
cleanup $N
for k in "${!WORDS[@]}"; do w=${WORDS[$k]}; n=voc$k
  pod vs4-$n-pod; app vs4-$n-pod vs4-$n-app -mode actuator -port 8080
done
sleep 1
for k in "${!WORDS[@]}"; do w=${WORDS[$k]}; n=voc$k
  pid=$(docker inspect -f '{{.State.Pid}}' vs4-$n-pod)
  nsenter -t $pid -n curl -s -XPOST "http://127.0.0.1:8080/__doc" --data-binary '{"status":"UP","components":{"c":{"status":"'"$w"'"}}}' >/dev/null
  sidecar vs4-$n-pod vs4-$n-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=$T -e CS_SERVICE=side-$k -e POD_NAME=side-$k-0 -e CS_INTERVAL=3s -e CS_HEARTBEAT=30s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug
done
sleep 42
for k in "${!WORDS[@]}"; do w=${WORDS[$k]}; n=voc$k
  printf '  %-14s expect %-8s sidecar sends in 40 s: %-3s service: %s\n' "\"$w\"" "${EXPECT[$k]}" "$(docker logs vs4-$n-sc 2>&1 | grep -c '"msg":"reported"')" "$(curl -s -H "$H" "$BE/v1/health/monitors?tenantId=$T" | jq -r --arg s side-$k '.[] | select(.service==$s) | .state.lastSummary')"
done
echo "### 3. one sidecar's report as the service received it (the word is passed through raw in components)"
docker logs vs4-voc5-sc 2>&1 | head -3 | jq -c 'select(.msg=="reported") | {status,message}'
echo "### 4. notices opened for this tenant (a HEALTH notice per service the service reads as DEGRADED)"
feed $T | sort | uniq -c | head -20
cleanup $N
echo "end $(ts)"
