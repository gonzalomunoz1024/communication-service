# communication-service

Shared, API-driven customer communications platform. Publisher teams (pods) publish dynamic
communications — **incidents, changes, outages, maintenance windows, and health notices** —
and consumer surfaces (first: **VMForge**) read them via a filtered feed and a live SSE stream.
Multi-tenant by design; message expiration and admin oversight built in.

## Stack

- Java 21 · Spring Boot 3.4 · WebFlux (Reactor/Netty) · Reactive MongoDB
- Vertical-slice hexagonal architecture: each slice has `adapters/{inbound,outbound}`,
  `application`, `domain`, `ports/{inbound,outbound}`
- CQRS flavor: structural read/write separation — `publishing` (commands), `feed` (queries + SSE),
  `admin` (oversight); shared aggregate + outbound ports in `common`
- OpenAPI via springdoc: **http://localhost:8080/swagger-ui.html**

## Run

```bash
# prerequisite: local MongoDB on 27017 (e.g. `brew services start mongodb-community`)
./mvnw spring-boot:run

# all tests (unit + integration; integration tests use embedded Mongo, no Docker needed)
./mvnw verify
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
- **Concurrency**: documents carry a version (`@Version`); `PUT` requires `expectedVersion`
  and mismatches return 409.
- **SSE contract**: on subscribe, one `snapshot` event per currently-visible item, then live
  `created/updated/activated/expired/retired` events filtered server-side per subscriber;
  monotonic `id:` sequence; keepalive comments every 15s. Reconnects are self-healing (fresh
  snapshot); `Last-Event-ID` replay is a documented v2 gap.
- **Scheduled visibility**: future-dated items are hidden from the feed, except SCHEDULED
  MAINTENANCE within the lookahead window (`communication.feed.upcoming-window`, default 7d).
  Drafts are invisible to consumers everywhere; EXPIRED/RETIRED stay retrievable by permalink.
- All timestamps are UTC `Instant`s (ISO-8601 on the wire).

## API (v1)

### Publisher commands

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/communications` | 201 + Location; 400 validation; 409 duplicate externalRef |
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

## Curl cookbook

```bash
# publish an outage correlated to an INC ticket, expiring at 18:00 UTC
curl -s -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR",
  "title":"API degradation in eu-west","body":"We are investigating **elevated errors**.",
  "affectedServices":["vm-api"],"externalRef":"INC0012345",
  "expiresAt":"2026-10-14T18:00:00Z"}'

# schedule a maintenance window (expiry defaults to the window end)
curl -s -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO",
  "title":"Planned upgrade","startsAt":"2026-10-15T01:00:00Z","endsAt":"2026-10-15T03:00:00Z"}'

# what VMForge shows its customers right now
curl -s 'localhost:8080/v1/feed?tenantId=vmforge&service=vm-api'

# live stream (keep open in a second terminal; -N disables buffering)
curl -N 'localhost:8080/v1/feed/stream?tenantId=vmforge'

# retire (the stream terminal shows the retired event)
curl -s -X POST localhost:8080/v1/communications/<id>/retire \
  -H 'Content-Type: application/json' -d '{"actor":"admin","note":"resolved"}'

# admin: everything retired, across tenants, with audit history
curl -s 'localhost:8080/v1/admin/communications?status=RETIRED'
```

## Known v1 constraints (deliberate)

- **No auth**: endpoints are open; tenant/publisher are request fields. Admin routes are
  path-segregated so a gateway/filter can protect `/v1/admin/**` wholesale when identity lands.
- **In-process event bus**: SSE fan-out is single-node. Scaling out means swapping the
  `CommunicationEventsPort` adapter for Mongo change streams or a broker — no domain changes.
- **No `Last-Event-ID` replay**: reconnecting SSE clients get a fresh snapshot instead.
- Out of scope: IDP health-check integration (the feed/SSE ports are where it would plug in).
