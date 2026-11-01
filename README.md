# communication-service

Shared, API-driven customer communications platform. Publisher teams (pods) publish dynamic
communications — **incidents, changes, outages, maintenance windows, and health notices** —
and consumer surfaces (first: **VMForge**) read them via a filtered feed and a live SSE stream.
Multi-tenant by design; message expiration and admin oversight built in.

Outages reach consumers two ways, and consumers cannot tell them apart:

1. **A human publishes** (`POST /v1/communications`): an SRE declares an outage, incident,
   change or maintenance window for their service.
2. **A health check detects it** (`/v1/health/**`): the service probes a system's health
   endpoint (Spring Actuator understood natively) or the system pushes its own health, and the
   resulting outage / degradation is published, kept current and retired automatically.

Either way, a dependent system subscribes to `/v1/feed/stream?tenantId=…&service=<the system>`
(or polls `/v1/feed`) and reacts to `created` / `updated` / `retired` events.

## Stack

- Java 21 · Spring Boot 3.4 · WebFlux (Reactor/Netty) · Reactive MongoDB · Gradle (Kotlin DSL)
- Vertical-slice hexagonal architecture: each slice has `adapters/{inbound,outbound}`,
  `application`, `domain`, `ports/{inbound,outbound}`
- CQRS flavor: structural read/write separation — `publishing` (commands), `feed` (queries + SSE),
  `admin` (oversight), `health` (automated publishing from health checks); shared aggregate +
  outbound ports in `common`
- OpenAPI via springdoc: **http://localhost:8080/swagger-ui.html**

## Run

```bash
# prerequisite: local MongoDB on 27017 (e.g. `brew services start mongodb-community`)
./gradlew bootRun

./gradlew test              # unit tests
./gradlew integrationTest   # *IT tests against embedded MongoDB (downloads mongod once; no Docker)
./gradlew check             # both (also run by `build`)
```

## Core semantics

- **Lifecycle**: `DRAFT → (publish) → SCHEDULED/ACTIVE → EXPIRED` (by time) or `RETIRED`
  (explicit). EXPIRED and RETIRED are terminal; nothing is ever hard-deleted except via the
  admin purge endpoint. Every mutation appends to an embedded audit history (capped at 50).
- **Expiration is computed on read**: the feed filters by time predicates and returns an
  *effective* status derived from `startsAt`/`expiresAt`, so visibility is exact to the
  millisecond regardless of the background sweeper. The sweeper (every 30s, configurable via
  `communication.sweep.interval-ms`) converges stored status and pushes `activated`/`expired`
  SSE events; concurrent-save conflicts are skipped, making it safe to run multi-instance.
- **Idempotency**: `externalRef` (e.g. an INC/CHG ticket id) is unique per tenant (partial
  unique index); a duplicate publish returns 409.
- **Tickets (optional)**: a communication can carry the ServiceNow incident behind it
  (`ticket.number`, e.g. `INC0012345`; `ticket.system` names another tracker). The number is
  trimmed, upper-cased and checked against `communication.tickets.number-pattern`; with
  `communication.servicenow.instance-url` set, `ticket.url` links straight to the incident. The
  ticket rides on the feed and SSE payloads, can be attached later with `PUT`, and `externalRef`
  defaults to its number so the same incident is not published twice by accident (set
  `externalRef` yourself for a second notice on one ticket). Nothing calls ServiceNow; syncing
  the ticket's status is a separate, later switch.
- **Concurrency**: documents carry a version (`@Version`); `PUT` requires `expectedVersion`
  and mismatches return 409.
- **SSE contract**: on subscribe, one `snapshot` event per currently-visible item, then live
  `created/updated/activated/expired/retired` events filtered server-side per subscriber;
  `id:` is a global sequence number from the shared event log; keepalive comments every 15s.
  A client that reconnects with `Last-Event-ID` (browsers do this on their own; `?lastEventId=`
  for curl) gets every event it missed, in order, while the log still holds it
  (`communication.events.retention`, default 1 day); otherwise it gets a fresh snapshot.
- **Multi-instance**: events go through a shared log in Mongo (`communication_events`) that every
  instance appends to and tails (`communication.events.poll-interval-ms`, default 500 ms), so a
  notice published through any node reaches subscribers on every node. It is a poll, not a change
  stream, so a standalone Mongo works; live latency is bounded by the interval.
- **Scheduled visibility**: future-dated items are hidden from the feed, except SCHEDULED
  MAINTENANCE within the lookahead window (`communication.feed.upcoming-window`, default 7d).
  Drafts are invisible to consumers everywhere; EXPIRED/RETIRED stay retrievable by permalink.
- All timestamps are UTC `Instant`s (ISO-8601 on the wire).

## API (v1)

### Identify yourself

Every `/v1/**` request must carry `X-Client-Id: <your repository name>`; without it the service
answers `401 {"error": "missing X-Client-Id header …"}`. Browser `EventSource` cannot set headers,
so the stream also accepts `?clientId=`. The id is logged with each request so a notice can be
traced to the system that sent it. It is identification, not authentication: nothing is verified.
In Swagger UI use **Authorize** once; `communication.client-id.required=false` switches the check
off for local experiments.

### Publisher commands

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/communications` | 201 + Location; 400 validation (incl. a malformed `ticket.number`); 409 duplicate externalRef |
| GET | `/v1/communications/{id}` | any status, includes audit history; 404 |
| GET | `/v1/communications?tenantId=…&status=&type=&page=&size=` | publisher's own list |
| PUT | `/v1/communications/{id}` | partial update + required `expectedVersion`; 409 on conflict/terminal |
| POST | `/v1/communications/{id}/publish` | DRAFT → SCHEDULED/ACTIVE; 409 if not DRAFT |
| POST | `/v1/communications/{id}/retire` | optional `{actor, note}`; idempotent on RETIRED; 409 on EXPIRED |

### Consumer feed

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/feed?tenantId=…` | filters: `service, type, severity (min), audience, activeAt, includeUpcoming, page, size (≤100)` |
| GET | `/v1/feed/{id}` | permalink; DRAFT/unknown → 404 |
| GET | `/v1/feed/stream?tenantId=…` | SSE; same filters minus paging |

### Admin (path-segregated under `/v1/admin/**` for future auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/admin/communications` | cross-tenant search, any status, `publisher`/`from`/`to` filters |
| GET | `/v1/admin/tenants` | per-tenant counts by status |
| POST | `/v1/admin/communications/{id}/retire` | admin override |
| DELETE | `/v1/admin/communications/{id}` | hard purge (destroys audit); 204 |

### Health monitoring (automated publishing)

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/health/monitors` | register; with `url` the service is probed (pull), without it is push-only; 409 if (tenantId, service) exists |
| GET | `/v1/health/monitors?tenantId=…` | monitors with live state (streaks, open notice) |
| GET | `/v1/health/monitors/{id}` | one monitor; 404 |
| POST | `/v1/health/monitors/{id}/probe` | probe now instead of waiting for the interval; 409 for push-only |
| DELETE | `/v1/health/monitors/{id}` | 204; retires any notice the monitor has open |
| POST | `/v1/health/reports` | push a health report; first contact auto-registers a push-only monitor; 202 |

A monitor is one `(tenantId, service)` and publishes as `publisher` (default `health-monitor`).
Per-monitor policy, all optional at registration (defaults in `application.yml` under
`communication.health.defaults`): `intervalSeconds` (≥5), `timeoutMs`, `failureThreshold`,
`recoveryThreshold`, `downSeverity` (≥ MINOR), `degradedSeverity`, `audience`,
`staleAfterSeconds` (push-only: silent longer than this counts as DOWN).

**How observations become communications**

- Status vocabulary is Spring Actuator's: `UP`; `DOWN` / `OUT_OF_SERVICE` / `FATAL` → DOWN;
  `UNKNOWN` carries no information; anything else (`WARN`, `DEGRADED`, …) → DEGRADED. A document
  that is `UP` overall but has a `DOWN` component is treated as DEGRADED. Nested components
  (composite indicators, legacy `details` nesting) are flattened to dotted names (`db.primary`).
- Probes read `/actuator/health`-style JSON when there is one (any version), otherwise judge by
  HTTP status (2xx up). Connection errors and timeouts are DOWN.
- Debounced: `failureThreshold` consecutive observations of the same unhealthy status open a
  notice; `recoveryThreshold` consecutive `UP`s retire it (audit note `recovered: …`). A single
  blip publishes nothing.
- **DOWN → `OUTAGE`** at `downSeverity`; **DEGRADED → `HEALTH`** notice at `degradedSeverity`;
  title `<service> is down|degraded`, body lists failing components with details,
  `affectedServices=[service]`, `externalRef=health:<monitorId>:<incident#>`.
- While open: new failing components update the notice in place (`updated` SSE event); a change
  of kind (DOWN ↔ DEGRADED) retires it and opens the right type; recovery retires it. If an
  operator retires an automated notice by hand, the monitor respects it and starts counting again.
- Notices are published through the same rules as human ones (`PublishingUseCase`), so feed,
  SSE, permalinks and audit history work unchanged. The scheduler (`communication.health.sweep-interval-ms`,
  default 5s) probes monitors whose interval elapsed; opening a notice claims the monitor first
  (optimistic version), so several instances never double-publish.

**Spring Boot app integration, two options**

```bash
# pull: point a monitor at the app's Actuator health endpoint
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/health/monitors -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","service":"vm-api","url":"http://vm-api:8080/actuator/health",
  "intervalSeconds":15,"failureThreshold":2,"recoveryThreshold":2}'

# push: the app forwards its own health document (same shape as /actuator/health) plus tenant+service,
# e.g. from a scheduled task or a HealthIndicator listener; dependencies that are down are listed
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/health/reports -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","service":"vm-api","status":"DOWN",
  "components":{"db":{"status":"DOWN","details":{"error":"Connection refused"}},"ping":{"status":"UP"}},
  "message":"primary database unreachable"}'
```

Push-only services should also set `staleAfterSeconds` (register the monitor explicitly) so a
hard crash, which can no longer push anything, is still detected.

## Curl cookbook

```bash
# publish an outage tied to its ServiceNow incident (externalRef defaults to the number), expiring at 18:00 UTC
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR",
  "title":"API degradation in eu-west","body":"We are investigating **elevated errors**.",
  "affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},
  "expiresAt":"2026-10-14T18:00:00Z"}'

# schedule a maintenance window (expiry defaults to the window end)
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO",
  "title":"Planned upgrade","startsAt":"2026-10-15T01:00:00Z","endsAt":"2026-10-15T03:00:00Z"}'

# what VMForge shows its customers right now
curl -s -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed?tenantId=vmforge&service=vm-api'

# live stream (keep open in a second terminal; -N disables buffering)
curl -N -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed/stream?tenantId=vmforge'

# resume after a disconnect: everything after event 1234 in order, then live (browsers send Last-Event-ID)
curl -N -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed/stream?tenantId=vmforge&lastEventId=1234'

# retire (the stream terminal shows the retired event)
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications/<id>/retire \
  -H 'Content-Type: application/json' -d '{"actor":"admin","note":"resolved"}'

# admin: everything retired, across tenants, with audit history
curl -s -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/admin/communications?status=RETIRED'

# health: what the monitors currently think, and force a probe
curl -s -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/health/monitors?tenantId=vmforge'
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/health/monitors/<monitorId>/probe
```

## Known v1 constraints (deliberate)

- **Identification, not auth**: every `/v1` call must name its caller in `X-Client-Id` (repository
  name), which is logged but never verified; tenant/publisher are still request fields. Admin routes
  are path-segregated so a gateway/filter can protect `/v1/admin/**` wholesale when identity lands.
- **Event fan-out is polled**: live events reach subscribers within the poll interval (500 ms by
  default). Mongo change streams would make it immediate but need a replica set; they would sit
  behind the same `CommunicationEventsPort`.
- **Probe targets are not restricted**: registering a monitor makes the service GET that URL, so
  monitor registration belongs behind the same auth as publishing; an allow-list of probe hosts is
  the v2 hardening.
- **Health evaluation is single-store**: a notice claim and its communication are two writes
  (claim first, with compensation on failure), not one transaction.
