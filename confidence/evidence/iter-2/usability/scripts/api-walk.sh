#!/usr/bin/env bash
# api-walk.sh — a developer with the root README and curl, iteration 2 (shared backend :8080, tenant ux2-api)
API=${API:-http://localhost:8080}; H='X-Client-Id: vmforge-tools'; CT='Content-Type: application/json'
T=ux2-api; B=$(dirname "$0")/../logs/body.tmp
say(){ printf '\n### %s\n' "$*"; }
call(){ # label method path [data] [extra curl args]
  local label=$1 m=$2 p=$3 d=$4; shift 4 2>/dev/null || shift $#
  local out; out=$(curl -s -o "$B" -w '%{http_code} %{time_total}s' -X "$m" "$API$p" -H "$H" -H "$CT" ${d:+-d "$d"} "$@")
  printf '%s -> %s\n   %s\n' "$label" "$out" "$(head -c 700 "$B")"
}
in2h=$(date -u -d '+2 hours' +%FT%TZ); tomorrow01=$(date -u -d 'tomorrow 01:00' +%FT%TZ); tomorrow03=$(date -u -d 'tomorrow 03:00' +%FT%TZ)
say "E0 identification: no header, bad header"
printf 'no header -> '; curl -s -w ' %{http_code}\n' "$API/v1/feed?tenantId=$T"
printf 'bad id    -> '; curl -s -w ' %{http_code}\n' -H 'X-Client-Id: bad id!' "$API/v1/feed?tenantId=$T"
say "C1 cookbook example 1 VERBATIM (tenant vmforge, INC0012345) on this shared store"
call "C1-verbatim" POST /v1/communications '{"tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},"expiresAt":"'"$in2h"'"}'
say "C1' the same example in a tenant that has never seen it ($T)"
curl -s -D "$B.h" -o "$B" -X POST "$API/v1/communications" -H "$H" -H "$CT" -d '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},"expiresAt":"'"$in2h"'"}'
grep -i -E '^(HTTP|Location)' "$B.h" | tr -d '\r'; head -c 600 "$B"; echo
ID=$(python3 -I -c "import json,sys;print(json.load(open('$B'))['id'])"); VER=$(python3 -I -c "import json;print(json.load(open('$B'))['version'])"); echo "id=$ID version=$VER"
say "C1b the same request again (README: a safe retry, 409 naming the holder)"
call "C1b-retry" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},"expiresAt":"'"$in2h"'"}'
grep -q "$ID" "$B" && echo "   (409 names the holder id $ID: yes)" || echo "   (409 names the holder id: NO)"
say "C2 follow-up example (externalRef INC0012345-2)"
call "C2-followup" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MINOR","title":"API degradation in eu-west: residual errors","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},"externalRef":"INC0012345-2","expiresAt":"'"$in2h"'"}'
ID2=$(python3 -I -c "import json;print(json.load(open('$B')).get('id'))")
say "C3 maintenance example"
call "C3-maintenance" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO","title":"Planned upgrade","startsAt":"'"$tomorrow01"'","endsAt":"'"$tomorrow03"'"}'
ID3=$(python3 -I -c "import json;print(json.load(open('$B')).get('id'))")
say "C4 feed, stream (3 s), resume"
call "C4-feed" GET "/v1/feed?tenantId=$T&service=vm-api" ''
python3 -I -c "import json;d=json.load(open('$B'));print('   items:',len(d['items']),'total:',d.get('totalElements'),'keys:',sorted(d.keys()))"
echo "stream (first 1200 bytes within 3 s):"; curl -s -N --max-time 3 -H "$H" "$API/v1/feed/stream?tenantId=$T" | head -c 1200; echo
FIRSTID=$(curl -s -N --max-time 3 -H "$H" "$API/v1/feed/stream?tenantId=$T" | grep -m1 '^id:' | tr -dc 0-9)
echo "resume from lastEventId=$((FIRSTID-1)):"; curl -s -N --max-time 3 -H "$H" "$API/v1/feed/stream?tenantId=$T&lastEventId=$((FIRSTID-1))" | grep -E '^(id|event):' | head -8
say "C5 PUT with expectedVersion"
call "C5-put-v0" PUT /v1/communications/$ID '{"body":"Mitigation in progress.","expectedVersion":0}'
call "C5-put-v0-again" PUT /v1/communications/$ID '{"body":"Mitigation in progress (2).","expectedVersion":0}'
call "C5-put-omitted" PUT /v1/communications/$ID '{"body":"no version"}'
call "C5-put-string" PUT /v1/communications/$ID '{"body":"x","expectedVersion":"latest"}'
say "C6 retire, retire again, republish the same externalRef after retire"
call "C6-retire" POST /v1/communications/$ID/retire '{"actor":"admin","note":"resolved"}'
call "C6-retire-again" POST /v1/communications/$ID/retire '{"actor":"admin","note":"resolved"}'
call "C6-republish-after-retire" POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},"expiresAt":"'"$in2h"'"}'
say "C7 admin, permalink, history, monitors"
call "C7-admin-retired" GET "/v1/admin/communications?status=RETIRED&tenantId=$T" ''
python3 -I -c "import json;d=json.load(open('$B'));print('   type:',type(d).__name__, 'n:', len(d.get('items',d)) if isinstance(d,(dict,list)) else '')"
call "C7-get-one" GET /v1/communications/$ID ''
python3 -I -c "import json;d=json.load(open('$B'));print('   status:',d['status'],'version:',d['version'],'history:',[h.get('action') or h.get('type') or list(h.keys())[0] for h in d.get('history',[])])"
call "C7-permalink" GET /v1/feed/$ID ''
call "C7-tenants" GET /v1/admin/tenants ''
call "C7-monitors" GET "/v1/health/monitors?tenantId=$T" ''
call "C7-probe-wrong-id" POST /v1/health/monitors/not-a-monitor/probe ''
say "E error texts"
call "E1-enum-severity" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"HUGE","title":"t"}'
call "E2-enum-type" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"DOWNTIME","severity":"MAJOR","title":"t"}'
call "E3-malformed-json" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t",}'
call "E4-past-expiresAt-no-startsAt" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","expiresAt":"2020-01-01T00:00:00Z"}'
call "E5-expiresAt-word" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","expiresAt":"tomorrow"}'
call "E6-unknown-field" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","sevrity":"MAJOR"}'
call "E7-services-null" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","affectedServices":["a",null]}'
call "E8-missing-all" POST /v1/communications '{}'
call "E9-severity-floor" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"INFO","title":"t"}'
call "E10-bad-ticket" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","ticket":{"number":"INC12"}}'
call "E11-size-500" GET "/v1/feed?tenantId=$T&size=500" ''
python3 -I -c "import json;d=json.load(open('$B'));print('   size:',d.get('size'),'page:',d.get('page'))"
call "E12-wrong-path" GET /v1/nothing ''
printf 'E13-text-plain -> '; curl -s -w ' %{http_code}\n' -X POST "$API/v1/communications" -H "$H" -H 'Content-Type: text/plain' -d 'hello'
call "E14-not-found" GET /v1/communications/doesnotexist ''
call "E15-maintenance-no-end" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"MAINTENANCE","severity":"INFO","title":"t"}'
call "E16-draft" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"draft","draft":true}'
DID=$(python3 -I -c "import json;d=json.load(open('$B'));print(d.get('id'))"); echo "   draft id=$DID status=$(python3 -I -c "import json;print(json.load(open('$B')).get('status'))")"
call "E16b-publish-draft" POST /v1/communications/$DID/publish ''
call "E16c-publish-again" POST /v1/communications/$DID/publish ''
call "E17-put-retired" PUT /v1/communications/$ID '{"body":"late","expectedVersion":2}'
call "E18-expire-then-retire" POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"short","expiresAt":"'"$(date -u -d '+2 seconds' +%FT%TZ)"'"}'
EID=$(python3 -I -c "import json;print(json.load(open('$B')).get('id'))"); sleep 3
call "E18b-retire-expired" POST /v1/communications/$EID/retire '{"actor":"a"}'
say "H health monitoring from the README"
curl -s -D "$B.h" -o "$B" -X POST "$API/v1/health/monitors" -H "$H" -H "$CT" -d '{"tenantId":"'$T'","service":"vm-api","staleAfterSeconds":120}'; grep -i -E '^(HTTP|Location)' "$B.h" | tr -d '\r'; head -c 500 "$B"; echo
MID=$(python3 -I -c "import json;print(json.load(open('$B')).get('id'))")
call "H2-probe-push-only" POST /v1/health/monitors/$MID/probe ''
call "H3-report" POST /v1/health/reports '{"tenantId":"'$T'","service":"vm-api","status":"DOWN","components":{"db":{"status":"DOWN","details":{"error":"Connection refused"}},"ping":{"status":"UP"}},"message":"primary database unreachable"}'
call "H4-monitor" GET /v1/health/monitors/$MID ''
call "H5-instances" GET /v1/health/monitors/$MID/instances ''
call "H6-register-dup" POST /v1/health/monitors '{"tenantId":"'$T'","service":"vm-api"}'
call "H7-delete" DELETE /v1/health/monitors/$MID ''
say "D README paths vs OpenAPI"
python3 -I - <<PY
import json,re
doc=json.load(open('$(dirname "$0")/../logs/api-docs.json'))
paths=set(doc['paths'])
readme=open('/home/claude/communication-service/README.md').read()
found=set(re.findall(r'`(?:GET|POST|PUT|DELETE)?\s*(/v1/[A-Za-z0-9/{}_\-]+)', readme)) | set(re.findall(r'\|\s*`(/v1/[^`?]+)', readme))
norm=lambda p: re.sub(r'<[^>]+>|\{[^}]+\}','{id}',p).rstrip('/')
api={norm(p) for p in paths}
missing=sorted({p for p in found if '*' not in p and norm(p) not in api})
print('README /v1 paths:',len(found),'| OpenAPI paths:',len(paths),'| README paths absent from OpenAPI:',missing or 'none')
PY
say "cleanup: retire what is still active in $T"
for i in $ID2 $ID3 $DID; do curl -s -o /dev/null -w "retire $i -> %{http_code}\n" -X POST "$API/v1/communications/$i/retire" -H "$H" -H "$CT" -d '{"actor":"ux2-reviewer","note":"review cleanup"}'; done
