#!/usr/bin/env bash
# Developer walk, iteration 1: the root README "Curl cookbook" run as written (only `-w` appended to show the status code,
# and <id>/<monitorId> filled in as the README explains), then the error walk from iteration 0 (tenant ux1-api).
U=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/usability/iter1
W='-w \n-> HTTP %{http_code}\n'
jid() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s.split("\n-> HTTP")[0]).id||"")}catch{console.log("")}})'; }
say() { echo; echo "### $*"; }
echo "# API walk, iteration 1 — $(date -u +%FT%TZ), code $(git -C /home/claude/communication-service rev-parse --short HEAD), service $(curl -s localhost:8080/actuator/health/readiness)"

say "C0 dates relative to now (verbatim)"
in2h=$(date -u -d '+2 hours' +%FT%TZ 2>/dev/null || date -u -v+2H +%FT%TZ)
tomorrow01=$(date -u -d 'tomorrow 01:00' +%FT%TZ 2>/dev/null || date -u -v+1d -v1H -v0M -v0S +%FT%TZ)
tomorrow03=$(date -u -d 'tomorrow 03:00' +%FT%TZ 2>/dev/null || date -u -v+1d -v3H -v0M -v0S +%FT%TZ)
echo "in2h=$in2h tomorrow01=$tomorrow01 tomorrow03=$tomorrow03"

say "S0 live stream opened in a second terminal (verbatim command, kept open for the walk)"
timeout 70 curl -sN -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed/stream?tenantId=vmforge' > $U/stream-vmforge.txt 2>&1 &
sleep 1

say "C1 publish an outage tied to its ServiceNow incident (verbatim)"
r1=$(curl -s $W -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR",
  "title":"API degradation in eu-west","body":"We are investigating **elevated errors**.",
  "affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},
  "expiresAt":"'"$in2h"'"}'); echo "$r1" | cut -c1-700; id=$(echo "$r1" | jid); echo "id=$id"

say "C2 schedule a maintenance window for tomorrow night (verbatim)"
r2=$(curl -s $W -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO",
  "title":"Planned upgrade","startsAt":"'"$tomorrow01"'","endsAt":"'"$tomorrow03"'"}'); echo "$r2" | cut -c1-500; id2=$(echo "$r2" | jid); echo "id2=$id2"

say "C3 what VMForge shows its customers right now (verbatim)"
curl -s $W -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed?tenantId=vmforge&service=vm-api' | cut -c1-600

say "C4 live stream (verbatim, 4 s)"
timeout 4 curl -N -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed/stream?tenantId=vmforge' 2>&1 | head -c 600; echo "[closed after 4 s]"

say "C5 resume after a disconnect, verbatim lastEventId=1234 (4 s)"
timeout 4 curl -N -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed/stream?tenantId=vmforge&lastEventId=1234' 2>&1 | head -c 800; echo "[closed after 4 s]"

say "C6 change the body with expectedVersion:0 (verbatim with <id>)"
curl -s $W -H 'X-Client-Id: vmforge-tools' -X PUT localhost:8080/v1/communications/$id \
  -H 'Content-Type: application/json' -d '{"body":"Mitigation in progress.","expectedVersion":0}' | cut -c1-400
say "C6b the same PUT again with the stale expectedVersion:0 (someone else got there first)"
curl -s $W -H 'X-Client-Id: vmforge-tools' -X PUT localhost:8080/v1/communications/$id \
  -H 'Content-Type: application/json' -d '{"body":"Mitigation in progress.","expectedVersion":0}' | cut -c1-400

say "C7 retire (verbatim with <id>)"
curl -s $W -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications/$id/retire \
  -H 'Content-Type: application/json' -d '{"actor":"admin","note":"resolved"}' | cut -c1-300

say "C8 admin: everything retired, across tenants (verbatim; first 400 chars)"
curl -s $W -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/admin/communications?status=RETIRED' | cut -c1-400; echo

say "C9 health: monitors for vmforge, and a probe with a made-up <monitorId>"
curl -s $W -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/health/monitors?tenantId=vmforge' | cut -c1-300
curl -s $W -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/health/monitors/not-a-monitor/probe | cut -c1-300

say "C10 what the second terminal received (event ids), then a real resume from the first id"
sleep 2; grep -E '^(id|event):' $U/stream-vmforge.txt | paste - - | head -12
first=$(grep -E '^id:' $U/stream-vmforge.txt | head -1 | awk '{print $2}'); echo "first id seen = $first"
echo "--- resume from lastEventId=$first (4 s): events replayed in order?"
timeout 4 curl -sN -H 'X-Client-Id: vmforge-tools' "localhost:8080/v1/feed/stream?tenantId=vmforge&lastEventId=$first" 2>&1 | grep -E '^(id|event):' | paste - - | head -10
echo "--- the browser way: Last-Event-ID header"
timeout 4 curl -sN -H 'X-Client-Id: vmforge-tools' -H "Last-Event-ID: $first" 'localhost:8080/v1/feed/stream?tenantId=vmforge' 2>&1 | grep -E '^(id|event):' | paste - - | head -6

say "C11 clean-up: retire the maintenance so vmforge is left as found"
curl -s $W -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications/$id2/retire -H 'Content-Type: application/json' -d '{"actor":"ux1-reviewer","note":"walk finished"}' | cut -c1-200

echo; echo "## Error walk (tenant ux1-api): the messages a developer meets on first mistakes"
H='-H X-Client-Id:ux1-api -H Content-Type:application/json'
say "E1 wrong enum value"; curl -s $W $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"HUGE","title":"t"}' | cut -c1-400
say "E2 malformed JSON (trailing comma)"; curl -s $W $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t",}' | cut -c1-400
say "E3 PUT without expectedVersion"; r=$(curl -s $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"for put"}'); pid=$(echo "$r" | jid); curl -s $W $H -X PUT localhost:8080/v1/communications/$pid -d '{"body":"x"}' | cut -c1-400
say "E4 PUT with a stale expectedVersion (99)"; curl -s $W $H -X PUT localhost:8080/v1/communications/$pid -d '{"body":"x","expectedVersion":99}' | cut -c1-400
say "E5 unknown path"; curl -s $W $H localhost:8080/v1/nothing | cut -c1-300
say "E6 non-JSON body"; curl -s $W -H 'X-Client-Id: ux1-api' -H 'Content-Type: text/plain' -X POST localhost:8080/v1/communications -d 'hello' | cut -c1-300
say "E7 oversized body (300 KB title)"; head -c 300000 /dev/zero | tr '\0' 'a' > $U/big.txt; printf '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"%s"}' "$(cat $U/big.txt)" > $U/big.json; curl -s $W $H -X POST localhost:8080/v1/communications --data-binary @$U/big.json | cut -c1-300
say "E8 expiresAt in the past, no startsAt"; curl -s $W $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","expiresAt":"2026-10-14T18:00:00Z"}' | cut -c1-400
say "E9 maintenance with endsAt before startsAt"; curl -s $W $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"MAINTENANCE","severity":"INFO","title":"t","startsAt":"'"$tomorrow03"'","endsAt":"'"$tomorrow01"'"}' | cut -c1-400
say "E10 no X-Client-Id"; curl -s $W localhost:8080/v1/feed?tenantId=ux1-api | cut -c1-300
say "E11 unknown type"; curl -s $W $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"DOWNTIME","severity":"MAJOR","title":"t"}' | cut -c1-400
say "E12 bad ticket number"; curl -s $W $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","ticket":{"number":"INC-42"}}' | cut -c1-400
say "E13 feed size over the cap"; curl -s $W $H 'localhost:8080/v1/feed?tenantId=ux1-api&size=500' | cut -c1-300
say "E14 retire an unknown id"; curl -s $W $H -X POST localhost:8080/v1/communications/00000000-0000-0000-0000-000000000000/retire | cut -c1-300
say "E15 missing required fields"; curl -s $W $H -X POST localhost:8080/v1/communications -d '{"type":"OUTAGE"}' | cut -c1-400
say "E16 outage with severity INFO"; curl -s $W $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"INFO","title":"t"}' | cut -c1-300
say "E17 wrong date format"; curl -s $W $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"t","expiresAt":"tomorrow"}' | cut -c1-400
say "E18 publish with a duplicate externalRef (409 text)"; curl -s $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"first","externalRef":"REF-1"}' > /dev/null; curl -s $W $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"second","externalRef":"REF-1"}' | cut -c1-400
say "E19 retire twice (idempotent?)"; curl -s $W $H -X POST localhost:8080/v1/communications/$pid/retire -d '{"actor":"p"}' | cut -c1-120; curl -s $W $H -X POST localhost:8080/v1/communications/$pid/retire -d '{"actor":"p"}' | cut -c1-120
say "E20 publish a DRAFT then publish it twice"; d=$(curl -s $H -X POST localhost:8080/v1/communications -d '{"tenantId":"ux1-api","publisher":"p","type":"OUTAGE","severity":"MAJOR","title":"draft","draft":true}'); did=$(echo "$d" | jid); echo "draft status: $(echo "$d" | cut -c1-200)"; curl -s $W $H -X POST localhost:8080/v1/communications/$did/publish | cut -c1-200; curl -s $W $H -X POST localhost:8080/v1/communications/$did/publish | cut -c1-300

say "D1 every path in the README tables exists in the OpenAPI document"
node -e '
const fs=require("fs"); const readme=fs.readFileSync("/home/claude/communication-service/README.md","utf8");
fetch("http://localhost:8080/v3/api-docs").then(r=>r.json()).then(doc=>{
 const paths=Object.keys(doc.paths); const norm=p=>p.replace(/\{[^}]+\}/g,"{}").replace(/\?.*$/,"");
 const seen=new Set(); const rows=[]; for (const m of readme.matchAll(/`(GET|POST|PUT|DELETE)?\s*(\/v1\/[^`\s?]+)/g)){ const p=m[2]; if(seen.has(p)) continue; seen.add(p); const ok=paths.some(x=>norm(x)===norm(p)); rows.push(`${ok?"ok ":"MISSING"} ${p}`) }
 for (const m of readme.matchAll(/localhost:8080(\/v1\/[^\s?\x27"`]+)/g)){ const p=m[1].replace(/<id>|<monitorId>/g,"{id}"); if(seen.has(p)) continue; seen.add(p); const ok=paths.some(x=>norm(x)===norm(p)); rows.push(`${ok?"ok ":"MISSING"} ${p} (cookbook)`) }
 console.log(rows.join("\n")); console.log("openapi paths:", paths.length)
})'
wait
