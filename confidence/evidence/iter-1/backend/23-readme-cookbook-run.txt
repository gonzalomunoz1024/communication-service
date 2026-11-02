# README cookbook run against a private iteration-1 instance (:18903), commands verbatim except the port

## # dates relative to now (ISO-8601 UTC)
evaluated
```

```

## # publish an outage tied to its ServiceNow incident (externalRef defaults to the number), expiring in two hours
rc=0
```
{"id":"825cf177-4127-47f7-a805-fd918d054c46","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T01:35:04.803943598Z","expiresAt":"2026-11-02T03:35:04Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T01:35:04.803943598Z","updatedAt":"2026-11-02T01:35:04.803943598Z","version":0,"history":[{"at":"2026-11-02T01:35:04.803943598Z","actor":"vmforge-sre","action":"created (ACTIVE)"}]}
```

## # schedule a maintenance window for tomorrow night (expiry defaults to the window end)
rc=0
```
{"id":"ff0fc120-f92c-4ad7-8aea-593ad663c420","tenantId":"vmforge","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO","title":"Planned upgrade","affectedServices":[],"audience":"CUSTOMERS","status":"SCHEDULED","startsAt":"2026-11-03T01:00:00Z","endsAt":"2026-11-03T03:00:00Z","expiresAt":"2026-11-03T03:00:00Z","createdAt":"2026-11-02T01:35:05.016461491Z","updatedAt":"2026-11-02T01:35:05.016461491Z","version":0,"history":[{"at":"2026-11-02T01:35:05.016461491Z","actor":"vmforge-sre","action":"created (SCHEDULED)"}]}
```

## # what VMForge shows its customers right now
rc=0
```
{"items":[{"id":"825cf177-4127-47f7-a805-fd918d054c46","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T01:35:04.803Z","expiresAt":"2026-11-02T03:35:04Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"updatedAt":"2026-11-02T01:35:04.803Z"}],"page":0,"size":20,"totalElements":1,"hasNext":false}
```

## # live stream (keep open in a second terminal; -N disables buffering)
rc=124
```
:connected

id:2
event:snapshot
data:{"seq":2,"type":"SNAPSHOT","at":"2026-11-02T01:35:05.247935712Z","communication":{"id":"825cf177-4127-47f7-a805-fd918d054c46","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T01:35:04.803Z","expiresAt":"2026-11-02T03:35:04Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T01:35:04.803Z","updatedAt":"2026-11-02T01:35:04.803Z","version":0,"history":[{"at":"2026-11-02T01:35:04.803Z","actor"
```

## # resume after a disconnect: everything after event 1234 in order, then live (browsers send Last-Event-ID)
rc=124
```
:connected

id:2
event:snapshot
data:{"seq":2,"type":"SNAPSHOT","at":"2026-11-02T01:35:08.252250854Z","communication":{"id":"825cf177-4127-47f7-a805-fd918d054c46","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T01:35:04.803Z","expiresAt":"2026-11-02T03:35:04Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T01:35:04.803Z","updatedAt":"2026-11-02T01:35:04.803Z","version":0,"history":[{"at":"2026-11-02T01:35:04.803Z","actor"
```

## # change the body: send back the version you last read as expectedVersion (409 if someone else got there first)
rc=0
```
{"id":"825cf177-4127-47f7-a805-fd918d054c46","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"Mitigation in progress.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T01:35:04.803Z","expiresAt":"2026-11-02T03:35:04Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T01:35:04.803Z","updatedAt":"2026-11-02T01:35:11.281276882Z","version":1,"history":[{"at":"2026-11-02T01:35:04.803Z","actor":"vmforge-sre","action":"created (ACTIVE)"},{"at":"2026-11-02T01:35:11.281276882Z","actor":"vmforge-sre","action":"updated"}]}
```

## # retire (the stream terminal shows the retired event)
rc=0
```
{"id":"825cf177-4127-47f7-a805-fd918d054c46","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"Mitigation in progress.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"RETIRED","startsAt":"2026-11-02T01:35:04.803Z","expiresAt":"2026-11-02T03:35:04Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T01:35:04.803Z","updatedAt":"2026-11-02T01:35:11.357981140Z","version":2,"history":[{"at":"2026-11-02T01:35:04.803Z","actor":"vmforge-sre","action":"created (ACTIVE)"},{"at":"2026-11-02T01:35:11.281Z","actor":"vmforge-sre","action":"updated"},{"at":"202
```

## # admin: everything retired, across tenants, with audit history
rc=0
```
{"items":[{"id":"825cf177-4127-47f7-a805-fd918d054c46","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"Mitigation in progress.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"RETIRED","startsAt":"2026-11-02T01:35:04.803Z","expiresAt":"2026-11-02T03:35:04Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T01:35:04.803Z","updatedAt":"2026-11-02T01:35:11.357Z","version":2,"history":[{"at":"2026-11-02T01:35:04.803Z","actor":"vmforge-sre","action":"created (ACTIVE)"},{"at":"2026-11-02T01:35:11.281Z","actor":"vmforge-sre","action":"updated"},{"at":
```

## # health: what the monitors currently think, and force a probe (<monitorId> = .[].id in the list)
rc=1
```
[] | stderr: bash: line 5: monitorId: No such file or directory
```

## # pull: point a monitor at the app's Actuator health endpoint
rc=0
```
{"id":"622504d9-5dcf-410c-bb5a-9c0642ce8b4a","tenantId":"vmforge","service":"vm-api","url":"http://vm-api:8080/actuator/health","policy":{"publisher":"health-monitor","intervalSeconds":15,"timeoutMs":5000,"failureThreshold":2,"recoveryThreshold":2,"downSeverity":"MAJOR","degradedSeverity":"MINOR","audience":"CUSTOMERS","minHealthyPercent":50},"state":{"lastStatus":"UNKNOWN","unhealthyStreak":0,"healthyStreak":0,"incidents":0},"createdAt":"2026-11-02T01:35:11.472943610Z","updatedAt":"2026-11-02T0
```

## # push: the app forwards its own health document (same shape as /actuator/health) plus tenant+service,
rc=0
```

```

## # e.g. from a scheduled task or a HealthIndicator listener; dependencies that are down are listed
rc=0
```
{"id":"622504d9-5dcf-410c-bb5a-9c0642ce8b4a","tenantId":"vmforge","service":"vm-api","url":"http://vm-api:8080/actuator/health","policy":{"publisher":"health-monitor","intervalSeconds":15,"timeoutMs":5000,"failureThreshold":2,"recoveryThreshold":2,"downSeverity":"MAJOR","degradedSeverity":"MINOR","audience":"CUSTOMERS","minHealthyPercent":50},"state":{"lastStatus":"DOWN","lastReportAt":"2026-11-02T01:35:11.546702610Z","lastSummary":"DOWN (primary database unreachable): db DOWN","unhealthyStreak"
```

## # health list (after registering)
rc=0
```
[{"id":"622504d9-5dcf-410c-bb5a-9c0642ce8b4a","tenantId":"vmforge","service":"vm-api","url":"http://vm-api:8080/actuator/health","policy":{"publisher":"health-monitor","intervalSeconds":15,"timeoutMs":5000,"failureThreshold":2,"recoveryThreshold":2,"downSeverity":"MAJOR","degradedSeverity":"MINOR","audience":"CUSTOMERS","minHealthyPercent":50},"state":{"lastStatus":"DOWN","lastReportAt":"2026-11-02T01:35:11.546Z","lastSummary":"DOWN (primary database unreachable): db DOWN","unhealthyStreak":1,"h
```

## # force a probe (unresolvable vm-api host -> DOWN expected)
rc=0
```
{"error":"monitor 622504d9-5dcf-410c-bb5a-9c0642ce8b4a was modified concurrently; reload and retry"}
```

