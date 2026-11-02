#!/usr/bin/env bash
# api-walk4.sh — a developer with the root README and curl, iteration 4 (shared backend :8080, tenant ux4-api)
API=${API:-http://localhost:8080}; H='X-Client-Id: vmforge-tools'; CT='Content-Type: application/json'
T=${T:-ux4-api}; B=$(dirname "$0")/../logs/body4.tmp
say(){ printf '\n### %s\n' "$*"; }
call(){ local label=$1 m=$2 p=$3 d=$4; shift 4 2>/dev/null || shift $#
  local out; out=$(curl -s -o "$B" -w '%{http_code} %{time_total}s' -X "$m" "$API$p" -H "$H" -H "$CT" ${d:+-d "$d"} "$@")
  printf '%s -> %s\n   %s\n' "$label" "$out" "$(head -c 1200 "$B")"; }
jget(){ python3 -I -c "import json,sys;d=json.load(open('$B'));print(d$1)" 2>/dev/null; }
in2h=$(date -u -d '+2 hours' +%FT%TZ); tomorrow01=$(date -u -d 'tomorrow 01:00' +%FT%TZ); tomorrow03=$(date -u -d 'tomorrow 03:00' +%FT%TZ)
say "E0 identification"
printf 'no header -> '; curl -s -w ' %{http_code}\n' "$API/v1/feed?tenantId=$T"
printf 'bad id    -> '; curl -s -w ' %{http_code}\n' -H 'X-Client-Id: bad id!' "$API/v1/feed?tenantId=$T"
printf 'stream, no header, no ?clientId -> '; curl -s --max-time 3 -w ' %{http_code}\n' "$API/v1/feed/stream?tenantId=$T"
printf 'stream with ?clientId= -> '; curl -s --max-time 2 -o /dev/null -w '%{http_code} %{content_type}\n' "$API/v1/feed/stream?tenantId=$T&clientId=vmforge-tools"
say "C1 cookbook example 1 VERBATIM on the shared store (vmforge already holds INC0012345, so this writes nothing)"
call "C1-verbatim" POST /v1/communications '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR",
  "title":"API degradation in eu-west","body":"We are investigating elevated errors.",
  "affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},
  "expiresAt":"'"$in2h"'"}'
say "C1' example 1 in $T, then the retry, the follow-up, a third and a fourth notice"
curl -s -D "$B.h" -o "$B" -X POST "$API/v1/communications" -H "$H" -H "$CT" -d '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating elevated errors.","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},"expiresAt":"'"$in2h"'"}'
grep -i -E '^(HTTP|Location)' "$B.h" | tr -d '\r'; head -c 600 "$B"; echo
ID=$(jget "['id']"); VER=$(jget "['version']"); echo "id=$ID version=$VER"
call "C1b-retry" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},"expiresAt":"'"$in2h"'"}'
call "C2-followup" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MINOR","title":"API degradation in eu-west: residual errors","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},"externalRef":"INC0012345-2","expiresAt":"'"$in2h"'"}'
ID2=$(jget ".get('id')")
call "C2b-third-notice-no-ref" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MINOR","title":"third","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"}}'
SUG=$(jget ".get('suggestedExternalRef')"); echo "   suggestedExternalRef=$SUG"
call "C2c-reuse-followup-ref" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MINOR","title":"third","affectedServices":["vm-api"],"externalRef":"INC0012345-2"}'
call "C2d-follow-the-suggestion" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MINOR","title":"third","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},"externalRef":"'"$SUG"'"}'
ID2D=$(jget ".get('id')")
call "C2e-date-like-ref" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO","title":"dated","externalRef":"payments-2026-11-12","startsAt":"'"$tomorrow01"'","endsAt":"'"$tomorrow03"'"}'
IDDATE=$(jget ".get('id')")
call "C2f-date-like-ref-again" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO","title":"dated","externalRef":"payments-2026-11-12","startsAt":"'"$tomorrow01"'","endsAt":"'"$tomorrow03"'"}'
call "C3-maintenance" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO","title":"Planned upgrade","startsAt":"'"$tomorrow01"'","endsAt":"'"$tomorrow03"'"}'
ID3=$(jget ".get('id')")
say "C4 feed, stream, resume"
call "C4-feed" GET "/v1/feed?tenantId=$T&service=vm-api" ''
echo "stream (first 600 bytes within 3 s):"; curl -s -N --max-time 3 -H "$H" "$API/v1/feed/stream?tenantId=$T" | head -c 600; echo
FIRSTID=$(curl -s -N --max-time 3 -H "$H" "$API/v1/feed/stream?tenantId=$T" | grep -m1 '^id:' | tr -dc 0-9)
echo "resume from lastEventId=$((FIRSTID-1)):"; curl -s -N --max-time 3 -H "$H" "$API/v1/feed/stream?tenantId=$T&lastEventId=$((FIRSTID-1))" | grep -E '^(id|event):' | head -6
say "C5 PUT and expectedVersion"
call "C5-put-v0" PUT /v1/communications/$ID '{"body":"Mitigation in progress.","expectedVersion":0}'
call "C5-put-v0-again" PUT /v1/communications/$ID '{"body":"Mitigation in progress (2).","expectedVersion":0}'
call "C5-put-omitted" PUT /v1/communications/$ID '{"body":"no version"}'
call "C5-put-string" PUT /v1/communications/$ID '{"body":"x","expectedVersion":"latest"}'
call "C5-put-null" PUT /v1/communications/$ID '{"body":"x","expectedVersion":null}'
say "C5r read-modify-write: GET the notice, change the body, PUT the whole document back"
curl -s -o "$B" -H "$H" "$API/v1/communications/$ID"; RMW=$(python3 -I -c "import json;d=json.load(open('$B'));d['body']='rmw';d['expectedVersion']=d['version'];print(json.dumps(d))")
echo "   GET keys: $(python3 -I -c "import json;print(sorted(json.load(open('$B')).keys()))")"
call "C5r-put-whole-document" PUT /v1/communications/$ID "$RMW"
RMW2=$(python3 -I - "$B" <<'PY'
import json,sys,re
d=json.load(open(sys.argv[1])); m=re.search(r"unknown fields? (.*?); known fields", d.get('error',''))
bad=re.findall(r"'([^']+)'", m.group(1)) if m else []
print(json.dumps(bad))
PY
)
echo "   the 400 named: $RMW2"
curl -s -o "$B" -H "$H" "$API/v1/communications/$ID"; RMW3=$(python3 -I -c "
import json;d=json.load(open('$B'));bad=json.loads('$RMW2')
for k in bad:
    d.pop(k.split('.')[0],None) if '.' not in k else d.get(k.split('.')[0],{}).pop(k.split('.',1)[1],None)
d['body']='rmw after dropping what the 400 named';d['expectedVersion']=d['version'];print(json.dumps(d))")
call "C5r2-put-after-dropping-named" PUT /v1/communications/$ID "$RMW3"
say "C6 retire, again, republish after retire"
call "C6-retire" POST /v1/communications/$ID/retire '{"actor":"admin","note":"resolved"}'
call "C6-retire-again" POST /v1/communications/$ID/retire '{"actor":"admin","note":"resolved"}'
call "C6-republish-after-retire" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"again","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},"expiresAt":"'"$in2h"'"}'
say "C7 reads"
call "C7-get-one" GET /v1/communications/$ID ''
python3 -I -c "import json;d=json.load(open('$B'));print('   status:',d['status'],'version:',d['version'],'history:',[h.get('action') for h in d.get('history',[])])"
call "C7-permalink" GET /v1/feed/$ID ''
call "C7-probe-wrong-id" POST /v1/health/monitors/not-a-monitor/probe ''
say "E error texts: values, rules, fields"
call "E1-enum-severity" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"HUGE","title":"t"}'
call "E1b-enum-lowercase" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"outage","severity":"major","title":"t lower"}'
ELID=$(jget ".get('id')")
call "E2-enum-type" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"DOWNTIME","severity":"MAJOR","title":"t"}'
call "E3-malformed-json" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t",}'
call "E4-past-expiresAt-no-startsAt" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","expiresAt":"2020-01-01T00:00:00Z"}'
call "E4b-endsAt-before-startsAt" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"MAINTENANCE","severity":"INFO","title":"t","startsAt":"'"$tomorrow03"'","endsAt":"'"$tomorrow01"'"}'
call "E4c-endsAt-past-no-startsAt" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"MAINTENANCE","severity":"INFO","title":"t","endsAt":"2020-01-01T00:00:00Z"}'
call "E5-expiresAt-word" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","expiresAt":"tomorrow"}'
call "E5b-expiresAt-no-zone" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","expiresAt":"2030-01-01T10:00:00"}'
call "E6-unknown-field" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","sevrity":"MAJOR"}'
call "E6b-unknown-in-ticket" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","ticket":{"numbr":"INC0099999"}}'
call "E6c-unknown-on-retire" POST /v1/communications/$ID2/retire '{"actr":"admin","note":"x"}'
call "E6d-unknown-on-put" PUT /v1/communications/$ID2 '{"bdy":"x","expectedVersion":0}'
call "E6e-wrong-case-field" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","Severity":"MAJOR","title":"t"}'
call "E6f-two-unknown" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","expiryAt":"x","service":"vm-api"}'
call "E6g-README-example" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","sevrity":"MAJOR","ticket":{"number":"INC0012399","ulr":"https://x"}}'
call "E6h-unknown-plus-bad-value" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"HUGE","title":"t","sevrity":"MAJOR"}'
call "E6i-unknown-plus-missing" POST /v1/communications '{"tenantId":"'$T'","type":"OUTAGE","severity":"MAJOR","sevrity":"MAJOR"}'
call "E7-services-null" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","affectedServices":["a",null]}'
call "E7b-services-blank" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","affectedServices":["a"," "]}'
call "E7c-services-string" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t sstr","affectedServices":"vm-api"}'
call "E7d-21-services" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","affectedServices":["s1","s2","s3","s4","s5","s6","s7","s8","s9","s10","s11","s12","s13","s14","s15","s16","s17","s18","s19","s20","s21"]}'
call "E7e-ticket-as-string" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","ticket":"INC0012399"}'
call "E7f-title-number" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":123}'
ETID=$(jget ".get('id')"); [ -n "$ETID" ] && [ "$ETID" != None ] && echo "   (accepted: title=$(jget ".get('title')"))"
call "E7g-services-null-on-put" PUT /v1/communications/$ID2 '{"affectedServices":[null],"expectedVersion":0}'
call "E7h-null-array" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t null arr","affectedServices":null}'
ENID=$(jget ".get('id')")
call "E8-missing-all" POST /v1/communications '{}'
call "E8b-empty-body" POST /v1/communications ''
call "E9-severity-floor" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"INFO","title":"t"}'
call "E10-bad-ticket" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","ticket":{"number":"INC12"}}'
call "E11-size-500" GET "/v1/feed?tenantId=$T&size=500" ''
call "E11b-feed-no-tenant" GET "/v1/feed?tenant=$T" ''
call "E11c-feed-severity-lower" GET "/v1/feed?tenantId=$T&severity=major" ''
call "E11d-feed-type-bogus" GET "/v1/feed?tenantId=$T&type=DOWNTIME" ''
call "E12-wrong-path" GET /v1/nothing ''
printf 'E13-text-plain -> '; curl -s -w ' %{http_code}\n' -X POST "$API/v1/communications" -H "$H" -H 'Content-Type: text/plain' -d 'hello'
call "E14-not-found" GET /v1/communications/doesnotexist ''
call "E15-maintenance-no-end" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"MAINTENANCE","severity":"INFO","title":"t"}'
call "E16-draft" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"draft","draft":true}'
DID=$(jget ".get('id')")
call "E16b-publish-draft" POST /v1/communications/$DID/publish ''
call "E16c-publish-again" POST /v1/communications/$DID/publish ''
call "E17-put-retired" PUT /v1/communications/$ID '{"body":"late","expectedVersion":2}'
call "E18-expire-then-get" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"short","expiresAt":"'"$(date -u -d '+2 seconds' +%FT%TZ)"'"}'
EID=$(jget ".get('id')"); sleep 3
call "E18a-get-after-expiry" GET /v1/communications/$EID ''
python3 -I -c "import json;d=json.load(open('$B'));print('   status after expiresAt:',d['status'])"
call "E18b-retire-expired" POST /v1/communications/$EID/retire '{"actor":"a"}'
say "H health monitoring from the README"
curl -s -D "$B.h" -o "$B" -X POST "$API/v1/health/monitors" -H "$H" -H "$CT" -d '{"tenantId":"'$T'","service":"vm-api","staleAfterSeconds":120}'; grep -i -E '^(HTTP|Location)' "$B.h" | tr -d '\r'; head -c 500 "$B"; echo
MID=$(jget ".get('id')")
call "H2-probe-push-only" POST /v1/health/monitors/$MID/probe ''
call "H3-report" POST /v1/health/reports '{"tenantId":"'$T'","service":"vm-api","status":"DOWN","components":{"db":{"status":"DOWN","details":{"error":"Connection refused"}},"ping":{"status":"UP"}},"message":"primary database unreachable"}'
call "H3b-report-groups" POST /v1/health/reports '{"tenantId":"'$T'","service":"vm-api","status":"UP","groups":["liveness","readiness"]}'
call "H3c-report-misspelled-status" POST /v1/health/reports '{"tenantId":"'$T'","service":"vm-api","staus":"DOWN"}'
call "H3d-report-no-tenant" POST /v1/health/reports '{"tenant":"'$T'","service":"vm-api","status":"DOWN"}'
call "H4-monitor" GET /v1/health/monitors/$MID ''
call "H5-instances" GET /v1/health/monitors/$MID/instances ''
call "H6-register-dup" POST /v1/health/monitors '{"tenantId":"'$T'","service":"vm-api"}'
call "H8-register-typo" POST /v1/health/monitors '{"tenantId":"'$T'","service":"vm-typo","url":"http://127.0.0.1:9/actuator/health","intervalSecond":3600,"failureTreshold":5}'
TID=$(jget ".get('id')"); [ -n "$TID" ] && [ "$TID" != None ] && echo "   (accepted!: intervalSeconds=$(jget ".get('intervalSeconds')"))"
call "H8b-register-stale-typo" POST /v1/health/monitors '{"tenantId":"'$T'","service":"vm-push","staleAfterSecond":60}'
TID2=$(jget ".get('id')")
call "H8c-register-null-and-unknown" POST /v1/health/monitors '{"tenantId":"'$T'","service":"vm-x","intervalSeconds":2,"downSeverity":"INFO"}'
TID3=$(jget ".get('id')")
call "H7-delete" DELETE /v1/health/monitors/$MID ''
for x in $TID $TID2 $TID3; do [ -n "$x" ] && [ "$x" != None ] && call "H7b-delete-$x" DELETE /v1/health/monitors/$x ''; done
say "cleanup: retire what is still active or scheduled in $T"
for s in ACTIVE SCHEDULED; do for i in $(curl -s -H "$H" "$API/v1/communications?tenantId=$T&status=$s&size=100" | python3 -I -c "import json,sys;[print(c['id']) for c in json.load(sys.stdin)['items']]"); do curl -s -o /dev/null -w "retire $i -> %{http_code}\n" -X POST "$API/v1/communications/$i/retire" -H "$H" -H "$CT" -d '{"actor":"ux4-reviewer","note":"review cleanup"}'; done; done
curl -s -H "$H" "$API/v1/communications?tenantId=$T&status=ACTIVE&size=100" | python3 -I -c "import json,sys;print('active left:',len(json.load(sys.stdin)['items']))"
curl -s -H "$H" "$API/v1/health/monitors?tenantId=$T" | python3 -I -c "import json,sys;print('monitors left:',len(json.load(sys.stdin)))"
