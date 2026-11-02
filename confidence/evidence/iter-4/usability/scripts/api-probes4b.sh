#!/usr/bin/env bash
# api-probes4b.sh — follow-up probes on private backend A (:19600, tenant ux4-api): C5r2 redone, mixed validation, F-34 success path
API=http://localhost:19600; H='X-Client-Id: vmforge-tools'; CT='Content-Type: application/json'; T=ux4-api; B=$(dirname "$0")/../logs/body4b.tmp
say(){ printf '\n### %s\n' "$*"; }
call(){ local label=$1 m=$2 p=$3 d=$4; local out; out=$(curl -s -o "$B" -w '%{http_code}' -X "$m" "$API$p" -H "$H" -H "$CT" ${d:+-d "$d"}); printf '%s -> %s\n   %s\n' "$label" "$out" "$(head -c 900 "$B")"; }
jget(){ python3 -I -c "import json;d=json.load(open('$B'));print(d$1)" 2>/dev/null; }
in2h=$(date -u -d '+2 hours' +%FT%TZ); in1h=$(date -u -d '+1 hours' +%FT%TZ); in3h=$(date -u -d '+3 hours' +%FT%TZ)
say "P1 = C5r2 redone: GET, PUT the whole document (400 names the fields), drop exactly those, expectedVersion = the version read, PUT"
call P1a-publish POST /v1/communications '{"tenantId":"'$T'","publisher":"vmforge-sre","type":"OUTAGE","severity":"MINOR","title":"rmw target","body":"before","affectedServices":["vm-api"]}'
ID=$(jget "['id']"); curl -s -o "$B" -H "$H" "$API/v1/communications/$ID"; cp "$B" "$B.get"; echo "   GET version=$(jget "['version']")"
call P1b-put-whole-document PUT /v1/communications/$ID "$(python3 -I -c "import json;d=json.load(open('$B.get'));d['body']='rmw';d['expectedVersion']=d['version'];print(json.dumps(d))")"
NAMED=$(python3 -I -c "import json,re;e=json.load(open('$B'))['error'];m=re.search(r'unknown fields? (.*?); known',e);print(json.dumps(re.findall(r\"'([^']+)'\",m.group(1))))"); echo "   named: $NAMED"
BODY=$(python3 -I -c "import json;d=json.load(open('$B.get'));v=d['version'];[d.pop(k,None) for k in json.loads('$NAMED')];d['body']='rmw after dropping what the 400 named';d['expectedVersion']=v;print(json.dumps(d))"); echo "   sent keys: $(python3 -I -c "import json,sys;print(sorted(json.loads(sys.argv[1]).keys()))" "$BODY")"
call P1c-put-after-dropping-named PUT /v1/communications/$ID "$BODY"; echo "   body=$(jget "['body']") version=$(jget "['version']")"
say "P2 monitor registration mixing a constraint and a domain rule (README: validation lists every failing field at once)"
call P2a-interval2-and-downINFO POST /v1/health/monitors '{"tenantId":"'$T'","service":"vm-x","intervalSeconds":2,"downSeverity":"INFO"}'
call P2b-downINFO-only POST /v1/health/monitors '{"tenantId":"'$T'","service":"vm-x","downSeverity":"INFO"}'
X=$(jget ".get('id')"); [ -n "$X" ] && [ "$X" != None ] && curl -s -o /dev/null -X DELETE -H "$H" "$API/v1/health/monitors/$X"
call P2c-interval2-and-blank-service POST /v1/health/monitors '{"tenantId":"'$T'","service":"","intervalSeconds":2}'
say "P3 publish mixing constraints and a domain rule"
call P3a-blank-title-and-blank-publisher POST /v1/communications '{"tenantId":"'$T'","publisher":"","type":"OUTAGE","severity":"MINOR","title":""}'
call P3b-blank-title-and-expires-before-starts POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"MAINTENANCE","severity":"MINOR","title":"","startsAt":"'$in3h'","endsAt":"'$in3h'","expiresAt":"'$in1h'"}'
call P3c-expires-before-starts-only POST /v1/communications '{"tenantId":"'$T'","publisher":"p","type":"MAINTENANCE","severity":"MINOR","title":"t","startsAt":"'$in3h'","endsAt":"'$in3h'","expiresAt":"'$in1h'"}'
say "P4 F-34 success path: a probed monitor on A's own health endpoint, probe now, read back, delete"
call P4a-register POST /v1/health/monitors '{"tenantId":"'$T'","service":"vm-self","url":"http://127.0.0.1:19600/actuator/health","intervalSeconds":3600}'
MID=$(jget "['id']"); echo "   lastProbeAt before: $(jget ".get('lastProbeAt')") lastStatus: $(jget ".get('lastStatus')")"
call P4b-probe POST /v1/health/monitors/$MID/probe ''; echo "   lastProbeAt after: $(jget ".get('lastProbeAt')") lastStatus: $(jget ".get('lastStatus')")"
call P4c-delete DELETE /v1/health/monitors/$MID ''
call P5-retire POST /v1/communications/$ID/retire '{"actor":"ux4-reviewer","note":"review cleanup"}'
rm -f "$B" "$B.get"
