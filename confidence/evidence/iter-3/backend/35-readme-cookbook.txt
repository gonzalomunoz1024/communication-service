# 35 - README cookbook run verbatim, twice (private :19150, default configuration, db vb3_cookbook)

Extraction (scripts/cookbook_extract.py): the two bash blocks of the current README.md - 'Spring Boot app integration, two options' (health pull + push) and '## Curl cookbook' - turned into scripts/cookbook-iter3.sh. Changes to the README text: localhost:8080 -> localhost:19150 only; 'timeout 3' in front of the two curl -N streams; <id> = .id of the first publish answer and <monitorId> = .[0].id of the monitor list, as the README says; an added -w '\n%{http_code}' and | head -c 900 for the transcript. Script exit 0 both runs.

## Run 1: README comment -> HTTP status
| README comment (trimmed) | answer |
|---|---|
| [HEALTH] pull: point a monitor at the apps Actuator health endpoint | 201 |
| [HEALTH] push: the app forwards its own health document (same shape as /actuator/health) plus tenant+service, / e.g... | 202 |
| [COOKBOOK] dates relative to now (ISO-8601 UTC) | (variable assignment, no HTTP call) |
| [COOKBOOK] (tomorrow01= / tomorrow03= date lines) | (variable assignment, no HTTP call) |
| [COOKBOOK] (tomorrow01= / tomorrow03= date lines) | (variable assignment, no HTTP call) |
| [COOKBOOK] publish an outage tied to its ServiceNow incident (externalRef defaults to the number), expiring in two ... | 201 |
| [COOKBOOK] externalRef (here the ticket number) is a permanent idempotency key, usable once per tenant: sending / t... | 201 |
| [COOKBOOK] schedule a maintenance window for tomorrow night (expiry defaults to the window end) | 201 |
| [COOKBOOK] what VMForge shows its customers right now | 200 implied (body longer than the 900-byte transcript cut, status line cut) |
| [COOKBOOK] live stream (keep open in a second terminal; -N disables buffering) | stream: :connected id:3 event:snapshot id:3 event:snapshot |
| [COOKBOOK] resume after a disconnect: everything after event 1234 in order, then live (browsers send Last-Event-ID) | stream: :connected id:3 event:snapshot id:3 event:snapshot |
| [COOKBOOK] change the body: send back the version you last read as expectedVersion (409 if someone else got there f... | 200 |
| [COOKBOOK] retire (the stream terminal shows the retired event) | 200 |
| [COOKBOOK] admin: everything retired, across tenants, with audit history | 200 |
| [COOKBOOK] health: what the monitors currently think, and force a probe (<monitorId> = .[].id in the list) | 200 |
| [COOKBOOK] (POST /v1/health/monitors/<monitorId>/probe) | 200 |
id=c063de48-3c1f-4cbd-97dd-47e0e5f288f5; monitorId=87f7b351-b222-40fb-a514-48f473d5c3bb

## Run 2: README comment -> HTTP status
| README comment (trimmed) | answer |
|---|---|
| [HEALTH] pull: point a monitor at the apps Actuator health endpoint | 409 |
| [HEALTH] push: the app forwards its own health document (same shape as /actuator/health) plus tenant+service, / e.g... | 202 |
| [COOKBOOK] dates relative to now (ISO-8601 UTC) | (variable assignment, no HTTP call) |
| [COOKBOOK] (tomorrow01= / tomorrow03= date lines) | (variable assignment, no HTTP call) |
| [COOKBOOK] (tomorrow01= / tomorrow03= date lines) | (variable assignment, no HTTP call) |
| [COOKBOOK] publish an outage tied to its ServiceNow incident (externalRef defaults to the number), expiring in two ... | 409 |
| [COOKBOOK] externalRef (here the ticket number) is a permanent idempotency key, usable once per tenant: sending / t... | 409 |
| [COOKBOOK] schedule a maintenance window for tomorrow night (expiry defaults to the window end) | 201 |
| [COOKBOOK] what VMForge shows its customers right now | 200 implied (body longer than the 900-byte transcript cut, status line cut) |
| [COOKBOOK] live stream (keep open in a second terminal; -N disables buffering) | stream: :connected id:8 event:snapshot id:8 event:snapshot |
| [COOKBOOK] resume after a disconnect: everything after event 1234 in order, then live (browsers send Last-Event-ID) | stream: :connected id:8 event:snapshot id:8 event:snapshot |
| [COOKBOOK] change the body: send back the version you last read as expectedVersion (409 if someone else got there f... | 404 |
| [COOKBOOK] retire (the stream terminal shows the retired event) | 404 |
| [COOKBOOK] admin: everything retired, across tenants, with audit history | 200 |
| [COOKBOOK] health: what the monitors currently think, and force a probe (<monitorId> = .[].id in the list) | 200 |
| [COOKBOOK] (POST /v1/health/monitors/<monitorId>/probe) | 200 |
id=; monitorId=87f7b351-b222-40fb-a514-48f473d5c3bb

## Run 2's 409 bodies (documented: README cookbook comments)
{"error":"a monitor already exists for service 'vm-api' in tenant 'vmforge'"}
{"error":"externalRef 'INC0012345' is already used by notice c063de48-3c1f-4cbd-97dd-47e0e5f288f5 in tenant vmforge. externalRef is a permanent idempotency key: repeat it only to retry the same publish; give a follow-up notice a new value (for example INC0012345-2)."}
{"error":"externalRef 'INC0012345-2' is already used by notice 97310e5f-b662-4786-8ed7-a860095f8265 in tenant vmforge. externalRef is a permanent idempotency key: repeat it only to retry the same publish; give a follow-up notice a new value (for example INC0012345-2-2)."}

## Selected answers of run 1
{"id":"87f7b351-b222-40fb-a514-48f473d5c3bb","tenantId":"vmforge","service":"vm-api","url":"http://vm-api:8080/actuator/health","policy":{"publisher":"health-monitor","intervalSeconds":15,"timeoutMs":5000,"failureThreshold":2,"recoveryThreshold":2,"downSeverity":"MAJOR","degradedSeverity":"MINOR","audience":"CUSTOMERS","minHealthyPercent":50},"state":{"lastStatus":"DOWN","lastReportAt":"2026-11-02T07:18:04.953409703Z
stream frames (run 1): 4 snapshot frames over the two streams, first line ':connected', 'curl: (23)' = head -c closing the pipe, as intended

Reading: every README command works as written on a fresh instance; run 2 shows the documented repeat behaviour (pull monitor 409 'a monitor already exists', ticket-number externalRef 409 naming the notice and the INC0012345-2 advice, the follow-up's own externalRef 409); the maintenance window has no idempotency key, so run 2 creates a second one (201), consistent with the README. Because run 2's first publish is a 409, <id> is empty there and the PUT/retire lines answer 404 - a consequence of running the block twice, not of the README; the 409 text gives the id to use.
