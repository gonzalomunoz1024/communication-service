# 23 - README cookbook run verbatim (port 19150 instead of 8080), 2026-11-02T04:11:25Z

```
in2h=2026-11-02T06:11:25Z tomorrow01=2026-11-03T01:00:00Z tomorrow03=2026-11-03T03:00:00Z

### publish an outage tied to its ServiceNow incident (expect 201)
HTTP 01

{"id":"ed0bbe40-d5ce-4289-8ee1-8609c47db55e","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T04:11:25.517271523Z","expiresAt":"2026-11-02T06:11:25Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T04:11:25.517271523Z","updatedAt":"2026-11-02T04:11:25.517271523Z","version":0,"history":[{"at":"2026-11-02T04:11:25.517271523Z","actor":"vmforge-sre","action":"created (ACTIVE)"}]}2
id=ed0bbe40-d5ce-4289-8ee1-8609c47db55e

### send the request above again: safe retry (expect 409 naming the notice that holds INC0012345)
HTTP 409
{"error": "externalRef 'INC0012345' is already used by notice ed0bbe40-d5ce-4289-8ee1-8609c47db55e in tenant vmforge. externalRef is a permanent idempotency key: repeat it only to retry the same publish; give a follow-up notice a new value (for example INC0012345-2)."}

### follow-up notice on the same incident with its own externalRef (expect 201)
HTTP 201
{"id": "b32432a4-f785-4067-9a31-97d52302e352", "tenantId": "vmforge", "publisher": "vmforge-sre", "type": "OUTAGE", "severity": "MINOR", "title": "API degradation in eu-west: residual errors", "affectedServices": ["vm-api"], "audience": "CUSTOMERS", "status": "ACTIVE", "startsAt": "2026-11-02T04:11:25.831156319Z", "expiresAt": "2026-11-02T06:11:25Z", "externalRef": "INC0012345-2", "ticket": {"system": "servicenow", "number": "INC0012345"}, "createdAt": "2026-11-02T04:11:25.831156319Z", "updatedAt": "2026-11-02T04:11:25.831156319Z", "version": 0, "history": [{"at": "2026-11-02T04:11:25.831156319Z", "actor": "vmforge-sre", "action": "created (ACTIVE)"}]}

### schedule a maintenance window for tomorrow night (expect 201 SCHEDULED, expiresAt = endsAt)
HTTP 201
{"id": "975f41da-298b-4911-9462-211566ab8610", "tenantId": "vmforge", "publisher": "vmforge-sre", "type": "MAINTENANCE", "severity": "INFO", "title": "Planned upgrade", "affectedServices": [], "audience": "CUSTOMERS", "status": "SCHEDULED", "startsAt": "2026-11-03T01:00:00Z", "endsAt": "2026-11-03T03:00:00Z", "expiresAt": "2026-11-03T03:00:00Z", "createdAt": "2026-11-02T04:11:25.873159318Z", "updatedAt": "2026-11-02T04:11:25.873159318Z", "version": 0, "history": [{"at": "2026-11-02T04:11:25.873159318Z", "actor": "vmforge-sre", "action": "created (SCHEDULED)"}]}

### what VMForge shows its customers right now (expect 200, two active outages for vm-api)
HTTP 200
{"items": [{"id": "ed0bbe40-d5ce-4289-8ee1-8609c47db55e", "tenantId": "vmforge", "publisher": "vmforge-sre", "type": "OUTAGE", "severity": "MAJOR", "title": "API degradation in eu-west", "body": "We are investigating **elevated errors**.", "affectedServices": ["vm-api"], "audience": "CUSTOMERS", "status": "ACTIVE", "startsAt": "2026-11-02T04:11:25.517Z", "expiresAt": "2026-11-02T06:11:25Z", "externalRef": "INC0012345", "ticket": {"system": "servicenow", "number": "INC0012345"}, "updatedAt": "2026-11-02T04:11:25.517Z"}, {"id": "b32432a4-f785-4067-9a31-97d52302e352", "tenantId": "vmforge", "publisher": "vmforge-sre", "type": "OUTAGE", "severity": "MINOR", "title": "API degradation in eu-west: 

### live stream for 3 s (expect :connected + snapshot frames)
:connected

id:3
event:snapshot
data:{"seq":3,"type":"SNAPSHOT","at":"2026-11-02T04:11:25.991596571Z","communication":{"id":"ed0bbe40-d5ce-4289-8ee1-8609c47db55e","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T04:11:25.517Z","expiresAt":"2026-11-02T06:11:25Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T04:11:25.517Z","updatedAt":"2026-11-02T04:11:25.517Z","version":0,"history":[{"at":"2026-11-02T04:11:25.517Z","actor":"vmforge-sre","action":"created (ACTIVE)"}]}}

id:3
event:snapshot
data:{"seq":3,"type":"SNAPSHOT","at":"2026-11-02T04:11:25.991596571Z","communication":{"id":"b32432a4-f785-4067-9a31-97d52302e352","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MINOR","title":"API degradation in eu-west: residual errors","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T04:11:25.831Z","expiresAt":"2026-11-02T06:11:25Z","externalRef":"INC0012345-2","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T04:11:25.831Z","updatedAt":"2026-11-02T04:11:25.831Z","version":0,"history":[{"at":"2026-11-02T04:11:25.831Z","actor":"vmforge-sre","action":"created (ACTIVE)"}]}}

id:3
event:snapshot
data:{"seq":3,"type":"SNAPSH

### resume after a disconnect from event 1234 for 3 s (on this fresh database 1234 is beyond the log: documented snapshot fallback)
id:3
event:snapshot
id:3
event:snapshot
id:3
event:snapshot
id:2
event:created

### change the body with expectedVersion 0 (expect 200, version 1)
HTTP 200
{"id": "ed0bbe40-d5ce-4289-8ee1-8609c47db55e", "tenantId": "vmforge", "publisher": "vmforge-sre", "type": "OUTAGE", "severity": "MAJOR", "title": "API degradation in eu-west", "body": "Mitigation in progress.", "affectedServices": ["vm-api"], "audience": "CUSTOMERS", "status": "ACTIVE", "startsAt": "2026-11-02T04:11:25.517Z", "expiresAt": "2026-11-02T06:11:25Z", "externalRef": "INC0012345", "ticket": {"system": "servicenow", "number": "INC0012345"}, "createdAt": "2026-11-02T04:11:25.517Z", "updatedAt": "2026-11-02T04:11:29.041765436Z", "version": 1, "history": [{"at": "2026-11-02T04:11:25.517Z", "actor": "vmforge-sre", "action": "created (ACTIVE)"}, {"at": "2026-11-02T04:11:29.041765436Z", "

### retire (expect 200 RETIRED)
HTTP 200
{"id": "ed0bbe40-d5ce-4289-8ee1-8609c47db55e", "tenantId": "vmforge", "publisher": "vmforge-sre", "type": "OUTAGE", "severity": "MAJOR", "title": "API degradation in eu-west", "body": "Mitigation in progress.", "affectedServices": ["vm-api"], "audience": "CUSTOMERS", "status": "RETIRED", "startsAt": "2026-11-02T04:11:25.517Z", "expiresAt": "2026-11-02T06:11:25Z", "externalRef": "INC0012345", "ticket": {"system": "servicenow", "number": "INC0012345"}, "createdAt": "2026-11-02T04:11:25.517Z", "updatedAt": "2026-11-02T04:11:29.096063729Z", "version": 2, "history": [{"at": "2026-11-02T04:11:25.517Z", "actor": "vmforge-sre", "action": "created (ACTIVE)"}, {"at": "2026-11-02T04:11:29.041Z", "actor

### admin: everything retired, across tenants, with audit history (expect 200, 1 item)
HTTP 200
{"items": [{"id": "ed0bbe40-d5ce-4289-8ee1-8609c47db55e", "tenantId": "vmforge", "publisher": "vmforge-sre", "type": "OUTAGE", "severity": "MAJOR", "title": "API degradation in eu-west", "body": "Mitigation in progress.", "affectedServices": ["vm-api"], "audience": "CUSTOMERS", "status": "RETIRED", "startsAt": "2026-11-02T04:11:25.517Z", "expiresAt": "2026-11-02T06:11:25Z", "externalRef": "INC0012345", "ticket": {"system": "servicenow", "number": "INC0012345"}, "createdAt": "2026-11-02T04:11:25.517Z", "updatedAt": "2026-11-02T04:11:29.096Z", "version": 2, "history": [{"at": "2026-11-02T04:11:25.517Z", "actor": "vmforge-sre", "action": "created (ACTIVE)"}, {"at": "2026-11-02T04:11:29.041Z", "

### health: pull monitor on the app's Actuator endpoint (README 'Health monitoring' example; expect 201)
HTTP 01

{"id":"86f6d927-8741-48f9-ad7c-8af53b2cf9e1","tenantId":"vmforge","service":"vm-api","url":"http://vm-api:8080/actuator/health","policy":{"publisher":"health-monitor","intervalSeconds":15,"timeoutMs":5000,"failureThreshold":2,"recoveryThreshold":2,"downSeverity":"MAJOR","degradedSeverity":"MINOR","audience":"CUSTOMERS","minHealthyPercent":50},"state":{"lastStatus":"UNKNOWN","unhealthyStreak":0,"healthyStreak":0,"incidents":0},"createdAt":"2026-11-02T04:11:29.191979968Z","updatedAt":"2026-11-02T04:11:29.191979968Z","version":0}2
monitorId=86f6d927-8741-48f9-ad7c-8af53b2cf9e1

### health: push a report for another service (expect 202, auto-registered push-only monitor)
HTTP 202
{"id": "e56eb4e8-f51e-49e6-8c70-a4d23a61e96d", "tenantId": "vmforge", "service": "vm-billing", "policy": {"publisher": "health-monitor", "intervalSeconds": 30, "timeoutMs": 5000, "failureThreshold": 2, "recoveryThreshold": 2, "downSeverity": "MAJOR", "degradedSeverity": "MINOR", "audience": "CUSTOMERS", "minHealthyPercent": 50}, "state": {"lastStatus": "DOWN", "lastReportAt": "2026-11-02T04:11:29.329528485Z", "lastSummary": "DOWN (primary database unreachable): db DOWN", "unhealthyStreak": 1, "healthyStreak": 0, "incidents": 0}, "createdAt": "2026-11-02T04:11:29.347998716Z", "updatedAt": "2026-11-02T04:11:29.329528485Z", "version": 1}

### health: what the monitors currently think (expect 200, two monitors)
HTTP 200
[{"id": "86f6d927-8741-48f9-ad7c-8af53b2cf9e1", "tenantId": "vmforge", "service": "vm-api", "url": "http://vm-api:8080/actuator/health", "policy": {"publisher": "health-monitor", "intervalSeconds": 15, "timeoutMs": 5000, "failureThreshold": 2, "recoveryThreshold": 2, "downSeverity": "MAJOR", "degradedSeverity": "MINOR", "audience": "CUSTOMERS", "minHealthyPercent": 50}, "state": {"lastStatus": "UNKNOWN", "unhealthyStreak": 0, "healthyStreak": 0, "incidents": 0}, "createdAt": "2026-11-02T04:11:29.191Z", "updatedAt": "2026-11-02T04:11:29.191Z", "version": 0}, {"id": "e56eb4e8-f51e-49e6-8c70-a4d23a61e96d", "tenantId": "vmforge", "service": "vm-billing", "policy": {"publisher": "health-monitor",

### force a probe x5 (expect 200 each; the host vm-api does not resolve here, so the probe records DOWN)
200 200 200 200 200 
{"lastStatus":"DOWN","unhealthyStreak":5,"lastSummary":"DOWN (probe failed: Failed to resolve 'vm-api' [A(1)] after 2 queries )","openCommunicationId":"14414c5f-0894-40c8-a8c0-53d649a979af"}
```
