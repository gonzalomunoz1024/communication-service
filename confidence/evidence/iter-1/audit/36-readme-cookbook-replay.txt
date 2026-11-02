# README cookbook run against a private iteration-1 instance (:19800), commands verbatim except the port

## # dates relative to now (ISO-8601 UTC)
evaluated
```

```

## # publish an outage tied to its ServiceNow incident (externalRef defaults to the number), expiring in two hours
rc=0
```
{"id":"bbb8b1cf-8d1c-4e8e-b365-0a5989a154ba","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T02:47:57.313305959Z","expiresAt":"2026-11-02T04:47:57Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T02:47:57.313305959Z","updatedAt":"2026-11-02T02:47:57.313305959Z","version":0,"history":[{"at":"2026-11-02T02:47:57.313305959Z","actor":"vmforge-sre","action":"created (ACTIVE)"}]}
```

## # schedule a maintenance window for tomorrow night (expiry defaults to the window end)
rc=0
```
{"id":"1e211b36-b1e8-4a3f-8909-52d2f5b94145","tenantId":"vmforge","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO","title":"Planned upgrade","affectedServices":[],"audience":"CUSTOMERS","status":"SCHEDULED","startsAt":"2026-11-03T01:00:00Z","endsAt":"2026-11-03T03:00:00Z","expiresAt":"2026-11-03T03:00:00Z","createdAt":"2026-11-02T02:47:57.344789983Z","updatedAt":"2026-11-02T02:47:57.344789983Z","version":0,"history":[{"at":"2026-11-02T02:47:57.344789983Z","actor":"vmforge-sre","action":"created (SCHEDULED)"}]}
```

## # what VMForge shows its customers right now
rc=0
```
{"items":[{"id":"bbb8b1cf-8d1c-4e8e-b365-0a5989a154ba","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T02:47:57.313Z","expiresAt":"2026-11-02T04:47:57Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"updatedAt":"2026-11-02T02:47:57.313Z"}],"page":0,"size":20,"totalElements":1,"hasNext":false}
```

## # live stream (keep open in a second terminal; -N disables buffering)
rc=124
```
:connected

id:86
event:snapshot
data:{"seq":86,"type":"SNAPSHOT","at":"2026-11-02T02:47:57.434603683Z","communication":{"id":"bbb8b1cf-8d1c-4e8e-b365-0a5989a154ba","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T02:47:57.313Z","expiresAt":"2026-11-02T04:47:57Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T02:47:57.313Z","updatedAt":"2026-11-02T02:47:57.313Z","version":0,"history":[{"at":"2026-11-02T02:47:57.313Z","acto
```

## # resume after a disconnect: everything after event 1234 in order, then live (browsers send Last-Event-ID)
rc=124
```
:connected

id:89
event:snapshot
data:{"seq":89,"type":"SNAPSHOT","at":"2026-11-02T02:48:00.441986275Z","communication":{"id":"bbb8b1cf-8d1c-4e8e-b365-0a5989a154ba","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"We are investigating **elevated errors**.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T02:47:57.313Z","expiresAt":"2026-11-02T04:47:57Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T02:47:57.313Z","updatedAt":"2026-11-02T02:47:57.313Z","version":0,"history":[{"at":"2026-11-02T02:47:57.313Z","acto
```

## # change the body: send back the version you last read as expectedVersion (409 if someone else got there first)
rc=0
```
{"id":"bbb8b1cf-8d1c-4e8e-b365-0a5989a154ba","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"Mitigation in progress.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"ACTIVE","startsAt":"2026-11-02T02:47:57.313Z","expiresAt":"2026-11-02T04:47:57Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T02:47:57.313Z","updatedAt":"2026-11-02T02:48:03.442411599Z","version":1,"history":[{"at":"2026-11-02T02:47:57.313Z","actor":"vmforge-sre","action":"created (ACTIVE)"},{"at":"2026-11-02T02:48:03.442411599Z","actor":"vmforge-sre","action":"updated"}]}
```

## # retire (the stream terminal shows the retired event)
rc=0
```
{"id":"bbb8b1cf-8d1c-4e8e-b365-0a5989a154ba","tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR","title":"API degradation in eu-west","body":"Mitigation in progress.","affectedServices":["vm-api"],"audience":"CUSTOMERS","status":"RETIRED","startsAt":"2026-11-02T02:47:57.313Z","expiresAt":"2026-11-02T04:47:57Z","externalRef":"INC0012345","ticket":{"system":"servicenow","number":"INC0012345"},"createdAt":"2026-11-02T02:47:57.313Z","updatedAt":"2026-11-02T02:48:03.493059286Z","version":2,"history":[{"at":"2026-11-02T02:47:57.313Z","actor":"vmforge-sre","action":"created (ACTIVE)"},{"at":"2026-11-02T02:48:03.442Z","actor":"vmforge-sre","action":"updated"},{"at":"202
```

## # admin: everything retired, across tenants, with audit history
rc=0
```
{"items":[{"id":"3849b3af-cf69-4899-ab67-14d512046102","tenantId":"audit1-f06-8a8cb0","publisher":"audit1-sre","type":"OUTAGE","severity":"MAJOR","title":"retire me too","affectedServices":["svc"],"audience":"CUSTOMERS","status":"RETIRED","startsAt":"2026-11-02T02:48:02.297Z","createdAt":"2026-11-02T02:48:02.297Z","updatedAt":"2026-11-02T02:48:02.324Z","version":1,"history":[{"at":"2026-11-02T02:48:02.297Z","actor":"audit1-sre","action":"created (ACTIVE)"},{"at":"2026-11-02T02:48:02.324Z","actor":"audit1-sre","action":"ACTIVE -> RETIRED"}]},{"id":"552c6abb-0cae-4108-95a7-54d6350cc531","tenantId":"audit1-f06-8a8cb0","publisher":"audit1-sre","type":"OUTAGE","severity":"MAJOR","title":"retire m
```

## # health: what the monitors currently think, and force a probe (<monitorId> = .[].id in the list)
rc=1
```
[] | stderr: bash: line 5: monitorId: No such file or directory
```

## # pull: point a monitor at the app's Actuator health endpoint
rc=0
```
{"id":"10ae4819-f9a4-4745-bb2a-2b276deda843","tenantId":"vmforge","service":"vm-api","url":"http://vm-api:8080/actuator/health","policy":{"publisher":"health-monitor","intervalSeconds":15,"timeoutMs":5000,"failureThreshold":2,"recoveryThreshold":2,"downSeverity":"MAJOR","degradedSeverity":"MINOR","audience":"CUSTOMERS","minHealthyPercent":50},"state":{"lastStatus":"UNKNOWN","unhealthyStreak":0,"healthyStreak":0,"incidents":0},"createdAt":"2026-11-02T02:48:03.597445575Z","updatedAt":"2026-11-02T0
```

## # push: the app forwards its own health document (same shape as /actuator/health) plus tenant+service,
rc=0
```

```

## # e.g. from a scheduled task or a HealthIndicator listener; dependencies that are down are listed
rc=0
```
{"id":"10ae4819-f9a4-4745-bb2a-2b276deda843","tenantId":"vmforge","service":"vm-api","url":"http://vm-api:8080/actuator/health","policy":{"publisher":"health-monitor","intervalSeconds":15,"timeoutMs":5000,"failureThreshold":2,"recoveryThreshold":2,"downSeverity":"MAJOR","degradedSeverity":"MINOR","audience":"CUSTOMERS","minHealthyPercent":50},"state":{"lastStatus":"DOWN","lastReportAt":"2026-11-02T02:48:03.624761520Z","lastSummary":"DOWN (primary database unreachable): db DOWN","unhealthyStreak"
```

## # health list (after registering)
rc=0
```
[{"id":"10ae4819-f9a4-4745-bb2a-2b276deda843","tenantId":"vmforge","service":"vm-api","url":"http://vm-api:8080/actuator/health","policy":{"publisher":"health-monitor","intervalSeconds":15,"timeoutMs":5000,"failureThreshold":2,"recoveryThreshold":2,"downSeverity":"MAJOR","degradedSeverity":"MINOR","audience":"CUSTOMERS","minHealthyPercent":50},"state":{"lastStatus":"DOWN","lastReportAt":"2026-11-02T02:48:03.624Z","lastSummary":"DOWN (primary database unreachable): db DOWN","unhealthyStreak":1,"h
```

## # force a probe (unresolvable vm-api host -> DOWN expected)
rc=0
```
{"error":"monitor 10ae4819-f9a4-4745-bb2a-2b276deda843 was modified concurrently; reload and retry"}
```


## second run of the first example (UX-21 residual: the externalRef INC0012345 is now taken in vmforge)
{"error":"duplicate externalRef 'INC0012345' for tenant 'vmforge'"}

## the README's F-05 line again: PUT with the stale expectedVersion 0 and without it
{"id":"6a2e1b6d-e923-44b2-a8cd-a84230e3dd5b","tenantId":"vmforge","publisher":"health-monitor","type":"OUTAGE","severity":"MAJOR","title":"vm-api is down","body":"x","affectedServices":["vm-api"],"aud
{"error":"expectedVersion: must not be null"} -> 400

## cmd-18 second part: 5 + 10 forced probes on the cookbook's monitor 10ae4819-f9a4-4745-bb2a-2b276deda843 (unresolvable vm-api host -> DOWN); status codes
200 200 200 200 200 
200 200 200 200 200 200 200 200 200 200 
monitor state: {"lastStatus": "DOWN", "lastReportAt": "2026-11-02T02:53:04.404Z", "lastProbeAt": "2026-11-02T02:53:04.404Z", "lastSummary": "DOWN (probe failed: Failed to resolve 'vm-api' [A(1)] after 2 queries )", "unhealthyStreak": 36, "healthyStreak": 0, "openCommunicationId": "6a2e1b6d-e923-44b2-a8cd-a84230e3d
