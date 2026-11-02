# dates relative to now (ISO-8601 UTC)
in2h=$(date -u -d '+2 hours' +%FT%TZ 2>/dev/null || date -u -v+2H +%FT%TZ)
tomorrow01=$(date -u -d 'tomorrow 01:00' +%FT%TZ 2>/dev/null || date -u -v+1d -v1H -v0M -v0S +%FT%TZ)
tomorrow03=$(date -u -d 'tomorrow 03:00' +%FT%TZ 2>/dev/null || date -u -v+1d -v3H -v0M -v0S +%FT%TZ)

# publish an outage tied to its ServiceNow incident (externalRef defaults to the number), expiring in two hours
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:19600/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR",
  "title":"API degradation in eu-west","body":"We are investigating elevated errors.",
  "affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},
  "expiresAt":"'"$in2h"'"}'

# externalRef (here the ticket number) is a permanent idempotency key, usable once per tenant: sending
# the request above again is a safe retry (409 naming the notice that holds INC0012345); a follow-up
# notice on the same incident gets its own value
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:19600/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MINOR",
  "title":"API degradation in eu-west: residual errors","affectedServices":["vm-api"],
  "ticket":{"number":"INC0012345"},"externalRef":"INC0012345-2","expiresAt":"'"$in2h"'"}'

# schedule a maintenance window for tomorrow night (expiry defaults to the window end)
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:19600/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO",
  "title":"Planned upgrade","startsAt":"'"$tomorrow01"'","endsAt":"'"$tomorrow03"'"}'

# what VMForge shows its customers right now
curl -s -H 'X-Client-Id: vmforge-tools' 'localhost:19600/v1/feed?tenantId=vmforge&service=vm-api'

# live stream (keep open in a second terminal; -N disables buffering)
timeout 3 curl -N -H 'X-Client-Id: vmforge-tools' 'localhost:19600/v1/feed/stream?tenantId=vmforge'

# resume after a disconnect: everything after event 1234 in order, then live (browsers send Last-Event-ID)
timeout 3 curl -N -H 'X-Client-Id: vmforge-tools' 'localhost:19600/v1/feed/stream?tenantId=vmforge&lastEventId=1234'

# change the body: send back the version you last read as expectedVersion (409 if someone else got there first)
curl -s -H 'X-Client-Id: vmforge-tools' -X PUT localhost:19600/v1/communications/<id> \
  -H 'Content-Type: application/json' -d '{"body":"Mitigation in progress.","expectedVersion":0}'

# retire (the stream terminal shows the retired event)
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:19600/v1/communications/<id>/retire \
  -H 'Content-Type: application/json' -d '{"actor":"admin","note":"resolved"}'

# admin: everything retired, across tenants, with audit history
curl -s -H 'X-Client-Id: vmforge-tools' 'localhost:19600/v1/admin/communications?status=RETIRED'

# health: what the monitors currently think, and force a probe (<monitorId> = .[].id in the list)
curl -s -H 'X-Client-Id: vmforge-tools' 'localhost:19600/v1/health/monitors?tenantId=vmforge'
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:19600/v1/health/monitors/<monitorId>/probe
