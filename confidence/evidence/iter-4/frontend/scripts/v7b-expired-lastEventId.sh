#!/bin/bash
# F-20 / F-92 follow-up to v7: the v7 check assumed seq 1 had left the shared log, but the shared log (retention P1D) still holds
# every event since 2026-11-01T23:27Z, so ?lastEventId=1 was a legitimate replay. Here retention expiry is emulated on MY private
# stack only: backend C (:19202) on database vf4_mongodown in container vf4-mongo. Three notices are published for a fresh tenant,
# then every event with seq <= the second one's seq is deleted from communication_events (what the TTL index does after a day),
# and the stream is read with ids below, at and above the oldest retained seq, as ?lastEventId= and as the Last-Event-ID header.
set -u
API=http://127.0.0.1:19202; CID=vf4-verifier; T="vf4-exp-$(date +%s)"
hdr=(-H "X-Client-Id: $CID" -H "Content-Type: application/json")
pub() { curl -s -o /dev/null -w '%{http_code}' "${hdr[@]}" -X POST "$API/v1/communications" -d "{\"tenantId\":\"$T\",\"publisher\":\"vf4-verifier\",\"type\":\"OUTAGE\",\"severity\":\"MAJOR\",\"title\":\"$1\"}"; }
frames() { curl -s -N --max-time 3 "${hdr[@]}" "$@" | grep -E '^(event:|id:)' | paste -d' ' - - | sed 's/event: //; s/id: /#/' | tr '\n' ' '; }
echo "tenant $T on backend C ($API, db vf4_mongodown)"
echo "publish: $(pub 'exp one') $(pub 'exp two') $(pub 'exp three')"
sleep 1
SEQS=$(docker exec vf4-mongo mongosh --quiet vf4_mongodown --eval "print(db.communication_events.find({tenantId:'$T'},{_id:1}).sort({_id:1}).toArray().map(d=>d._id).join(' '))")
echo "event seqs of the tenant: $SEQS"
set -- $SEQS; S1=$1; S2=$2; S3=$3
echo "before deletion: ?lastEventId=$((S1-1)) -> $(frames "$API/v1/feed/stream?tenantId=$T&lastEventId=$((S1-1))")"
echo "before deletion: ?lastEventId=$S1 -> $(frames "$API/v1/feed/stream?tenantId=$T&lastEventId=$S1")"
DEL=$(docker exec vf4-mongo mongosh --quiet vf4_mongodown --eval "print(JSON.stringify(db.communication_events.deleteMany({_id:{\$lte:$S2}})))")
OLDEST=$(docker exec vf4-mongo mongosh --quiet vf4_mongodown --eval "print(db.communication_events.find({},{_id:1}).sort({_id:1}).limit(1).toArray().map(d=>d._id)[0])")
echo "deleted every event with seq <= $S2: $DEL; oldest retained seq is now $OLDEST (expected $S3)"
echo "after deletion (gap no longer retained): ?lastEventId=$((S2-1)) -> $(frames "$API/v1/feed/stream?tenantId=$T&lastEventId=$((S2-1))")"
echo "after deletion (gap no longer retained): Last-Event-ID: $((S2-1)) header -> $(frames -H "Last-Event-ID: $((S2-1))" "$API/v1/feed/stream?tenantId=$T")"
echo "after deletion (boundary, whole gap retained): ?lastEventId=$S2 -> $(frames "$API/v1/feed/stream?tenantId=$T&lastEventId=$S2")"
echo "after deletion (nothing missed): ?lastEventId=$S3 -> $(frames "$API/v1/feed/stream?tenantId=$T&lastEventId=$S3")"
echo "never issued: ?lastEventId=999999999 -> $(frames "$API/v1/feed/stream?tenantId=$T&lastEventId=999999999")"
echo "expected: ids below oldest-1 and never-issued ids -> three snapshot frames (one per notice, stamped with the head), no created; boundary -> created#$S3 only; nothing missed -> no frames"
