#!/usr/bin/env bash
# Cookbook re-run. The first run's `-w` was word-split by my wrapper (the "->" noise and the empty <id>), so C6/C7/C11 hit
# "/v1/communications/" with no id: a script bug, not the README's. Same verbatim commands, status code captured properly.
U=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/usability/iter1
H='X-Client-Id: vmforge-tools'
show() { local body; body=$(cat); local code="${body##*$'\n'}"; echo "${body%$'\n'*}" | cut -c1-${1:-500}; echo "-> HTTP $code"; }
jid() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s.split("\n").slice(0,-1).join("\n")).id||"")}catch(e){console.log("")}})'; }
say() { echo; echo "### $*"; }
echo; echo "# Cookbook re-run — $(date -u +%FT%TZ)"
say "leftovers of the first run retired first (so INC0012345 is free again in vmforge)"
for lid in $(curl -s -H "$H" 'localhost:8080/v1/communications?tenantId=vmforge&status=ACTIVE' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);(d.items||d.content||[]).forEach(c=>console.log(c.id))})') $(curl -s -H "$H" 'localhost:8080/v1/communications?tenantId=vmforge&status=SCHEDULED' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);(d.items||d.content||[]).forEach(c=>console.log(c.id))})'); do echo "retire $lid: $(curl -s -o /dev/null -w '%{http_code}' -H "$H" -X POST localhost:8080/v1/communications/$lid/retire -H 'Content-Type: application/json' -d '{"actor":"ux1-reviewer","note":"first-run leftover"}')"; done

say "C0 dates relative to now (verbatim)"
in2h=$(date -u -d '+2 hours' +%FT%TZ 2>/dev/null || date -u -v+2H +%FT%TZ)
tomorrow01=$(date -u -d 'tomorrow 01:00' +%FT%TZ 2>/dev/null || date -u -v+1d -v1H -v0M -v0S +%FT%TZ)
tomorrow03=$(date -u -d 'tomorrow 03:00' +%FT%TZ 2>/dev/null || date -u -v+1d -v3H -v0M -v0S +%FT%TZ)
echo "in2h=$in2h tomorrow01=$tomorrow01 tomorrow03=$tomorrow03"
say "S0 live stream in a second terminal (verbatim command, kept open 60 s)"
timeout 60 curl -sN -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed/stream?tenantId=vmforge' > $U/stream-vmforge2.txt 2>&1 &
sleep 1
say "C1 publish an outage tied to its ServiceNow incident (verbatim)"
r1=$(curl -s -w '\n%{http_code}' -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR",
  "title":"API degradation in eu-west","body":"We are investigating **elevated errors**.",
  "affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},
  "expiresAt":"'"$in2h"'"}'); echo "$r1" | show 420; id=$(echo "$r1" | jid); echo "<id> = $id"
say "C2 schedule a maintenance window for tomorrow night (verbatim)"
r2=$(curl -s -w '\n%{http_code}' -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO",
  "title":"Planned upgrade","startsAt":"'"$tomorrow01"'","endsAt":"'"$tomorrow03"'"}'); echo "$r2" | show 330; id2=$(echo "$r2" | jid); echo "<id2> = $id2"
say "C3 what VMForge shows its customers right now (verbatim)"
curl -s -w '\n%{http_code}' -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed?tenantId=vmforge&service=vm-api' | show 300
say "C4 live stream (verbatim, closed after 4 s; -N output)"
timeout 4 curl -N -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed/stream?tenantId=vmforge' 2>/dev/null | grep -E '^(id|event):' | paste - - | head -5; echo "[closed]"
say "C5 resume after a disconnect, verbatim lastEventId=1234 (4 s)"
timeout 4 curl -N -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed/stream?tenantId=vmforge&lastEventId=1234' 2>/dev/null | grep -E '^(id|event):' | paste - - | head -5; echo "[closed]"
say "C6 change the body: expectedVersion:0 (verbatim with <id>)"
curl -s -w '\n%{http_code}' -H 'X-Client-Id: vmforge-tools' -X PUT localhost:8080/v1/communications/$id \
  -H 'Content-Type: application/json' -d '{"body":"Mitigation in progress.","expectedVersion":0}' | show 260
say "C6b the same PUT again (stale expectedVersion:0)"
curl -s -w '\n%{http_code}' -H 'X-Client-Id: vmforge-tools' -X PUT localhost:8080/v1/communications/$id \
  -H 'Content-Type: application/json' -d '{"body":"Mitigation in progress.","expectedVersion":0}' | show 260
say "C7 retire (verbatim with <id>)"
curl -s -w '\n%{http_code}' -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications/$id/retire \
  -H 'Content-Type: application/json' -d '{"actor":"admin","note":"resolved"}' | show 200
say "C8 admin: everything retired, across tenants (verbatim; counts only)"
curl -s -w '\n%{http_code}' -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/admin/communications?status=RETIRED' | show 120
say "C9 health: monitors for vmforge (verbatim), then a probe with a made-up <monitorId>"
curl -s -w '\n%{http_code}' -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/health/monitors?tenantId=vmforge' | show 200
curl -s -w '\n%{http_code}' -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/health/monitors/not-a-monitor/probe | show 200
say "C10 the second terminal's events so far, then a real resume from the first id (replay in order?)"
sleep 2; grep -E '^(id|event):' $U/stream-vmforge2.txt | paste - - | head -10
first=$(grep -E '^id:' $U/stream-vmforge2.txt | head -1 | cut -d: -f2 | tr -d ' '); echo "first id seen = $first"
echo "--- ?lastEventId=$first"; timeout 4 curl -sN -H 'X-Client-Id: vmforge-tools' "localhost:8080/v1/feed/stream?tenantId=vmforge&lastEventId=$first" 2>/dev/null | grep -E '^(id|event):' | paste - - | head -8
echo "--- Last-Event-ID: $first header"; timeout 4 curl -sN -H 'X-Client-Id: vmforge-tools' -H "Last-Event-ID: $first" 'localhost:8080/v1/feed/stream?tenantId=vmforge' 2>/dev/null | grep -E '^(id|event):' | paste - - | head -8
say "C11 clean-up: retire the maintenance"
curl -s -w '\n%{http_code}' -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications/$id2/retire -H 'Content-Type: application/json' -d '{"actor":"ux1-reviewer","note":"walk finished"}' | show 100
say "E13 again: feed size=500 — what size comes back?"
curl -s -H 'X-Client-Id: ux1-api' 'localhost:8080/v1/feed?tenantId=ux1-api&size=500' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log(JSON.stringify({page:d.page,size:d.size,totalElements:d.totalElements,items:(d.items||[]).length}))})'
say "clean-up ux1-api: retire what the error walk left active"
for lid in $(curl -s -H 'X-Client-Id: ux1-api' 'localhost:8080/v1/communications?tenantId=ux1-api&status=ACTIVE' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);(d.items||d.content||[]).forEach(c=>console.log(c.id))})'); do curl -s -o /dev/null -H 'X-Client-Id: ux1-api' -X POST localhost:8080/v1/communications/$lid/retire; done; echo "ux1-api active now: $(curl -s -H 'X-Client-Id: ux1-api' 'localhost:8080/v1/feed?tenantId=ux1-api' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).totalElements))')"
wait
