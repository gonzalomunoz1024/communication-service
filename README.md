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

- Java 21 · Spring Boot 4.0 (Spring Framework 7, Jackson 3) · WebFlux (Reactor/Netty) · Reactive MongoDB ·
  Gradle (Kotlin DSL)
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
./gradlew check             # every gate below (also run by `build`)
```

### Container image

The root `Dockerfile` puts the jar Gradle built on a distroless Java 21 runtime, as a non-root
user; the image build itself needs no network, and the artefact tested is the artefact shipped.
MongoDB stays outside the image: point the container at it.

```bash
./gradlew bootJar
docker build -t communication-service:local .
docker run --rm -p 8080:8080 \
  -e SPRING_MONGODB_URI=mongodb://host.docker.internal:27017/communication communication-service:local
# on Linux add --add-host=host.docker.internal:host-gateway, or a Docker network with Mongo on it
```

`SPRING_MONGODB_URI` is the name Spring Boot 4 reads; `SPRING_DATA_MONGODB_URI` (and
`--spring.data.mongodb.uri`), the name before Spring Boot 4, still works.

Any `application.yml` setting can be passed the same way as an environment variable
(`COMMUNICATION_HEALTH_DEFAULTS_FAILURETHRESHOLD=…`). The end-to-end suite under
[`e2e/`](e2e/README.md) starts this image, the health sidecar and a fake publisher app with
`docker compose` and drives them from a browser.

### Build gates

`./gradlew check` is the merge gate; CI runs exactly this. It fails on any of:

| Gate | What it enforces | Report |
|---|---|---|
| `compileJava`, `compileTestJava` | `-Xlint:deprecation -Xlint:removal -Xlint:unchecked -Werror`: a deprecated, removal-scheduled or unchecked use is a compile error | compiler output |
| `test`, `integrationTest` | unit tests; `*IT` tests against embedded MongoDB | `build/reports/tests/test/`, `build/reports/tests/integrationTest/` |
| `spotbugsMain` | SpotBugs on the main classes (effort max, confidence medium and up); findings that are false by design are listed, each with its reason, in `config/spotbugs/exclude.xml` | `build/reports/spotbugs/main.html` |
| `jacocoTestCoverageVerification` | coverage of the unit and integration runs together: lines >= 92 %, branches >= 84 % (only the Spring wiring, the `*Config` classes and `*Properties` records in `config/`, and the main class are not counted; 96.1 % of lines and 84.4 % of branches when the branch gate was set) | `build/reports/jacoco/test/html/index.html`, `.../jacocoTestReport.xml` |
| `cyclonedxBom` | CycloneDX SBOM of what ships: the runtime classpath only (`cyclonedxDirectBom` includes `runtimeClasspath`), for the vulnerability scan CI runs on it | `build/reports/cyclonedx/bom.json` |
| `verifySbomScope` | that SBOM lists no build or test tool (SpotBugs, BCEL, JaCoCo, JUnit, Mockito, AssertJ, embedded MongoDB, Lombok); their advisories must not fail the scan of an application they never run in | task output |

CI also scans what ships, which no Gradle task does: the SBOM above with `anchore/scan-action` (a
known vulnerability rated high or critical fails the job), and each image a job builds, this one
(`communication-service:ci`, the root `Dockerfile` over the jar) and the sidecar's (`health-sidecar:ci`),
with Trivy 0.58.1, pinned by digest in `ci.yml`. A CRITICAL or HIGH vulnerability that has a fixed
version fails the job wherever it is: in the base image's packages, the jar's libraries or the sidecar
binary's Go standard library. The same scan on a laptop (the first run downloads Trivy's database and,
for a jar, its Java index, about 1 GB together, into the `trivy-cache` volume):

```bash
./gradlew bootJar && docker build -t communication-service:local .
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache \
  ghcr.io/aquasecurity/trivy:0.58.1 \
  image --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 communication-service:local
```

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`: three independent
jobs, one per deliverable, each with its own timeout; a newer push to the same branch cancels the
run in progress and the workflow token is read-only.

| Job | What runs | Fails when |
|---|---|---|
| `backend` | Temurin 21, `./gradlew check` ([Build gates](#build-gates)); `build/reports/**` is kept as the `backend-reports` artifact; the CycloneDX SBOM is scanned with `anchore/scan-action` | a gate fails, or a runtime dependency has a known vulnerability rated high or critical |
| `frontend` | Node 22, in `frontend/`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm audit --omit=dev --audit-level=high` | lint, types, tests or the production build fail, or a shipped dependency has a high advisory |
| `sidecar` | Go from `sidecar/go.mod` plus kustomize, helm and kubeconform, in `sidecar/`: `gofmt -l .`, `go vet ./...`, `CI=true go test -race ./...` (the manifest tests fail instead of skipping when a tool is missing), `govulncheck ./...` (pinned, v1.9.0), `docker build` of the image | a file is not gofmt-formatted, vet, a test or the race detector fails, a known Go vulnerability, or the image build fails |

The `backend` and `sidecar` jobs end by scanning the image they built with Trivy and fail when it has
a critical or high vulnerability that has a fix ([Build gates](#build-gates)). The `backend` job builds
its image (`./gradlew bootJar`, `docker build`) once `check` has passed and scans it also when the SBOM
scan failed, so one run reports both.

Every step is a plain command a developer can run locally; CI configures nothing a laptop
would not.

### Operations

Only the health endpoint is exposed, and it sits outside `/v1`, so probes need no `X-Client-Id`:

| Probe | Path | Meaning |
|---|---|---|
| liveness | `GET /actuator/health/liveness` | the process is alive; `DOWN` only when the application context is broken, so a failing database never restarts the pod |
| readiness | `GET /actuator/health/readiness` | ready for traffic: the context is up **and** MongoDB answers a ping within `communication.mongo.readiness-timeout` (0.8 s); `503 {"status":"DOWN"}` while Mongo is unreachable, so a Service stops routing to the pod until it recovers |
| overall | `GET /actuator/health` | the same two plus every indicator, without details (the endpoint is unauthenticated) |

Nothing else under `/actuator` is served (404).

**When Mongo is down.** The service needs its database to start (it creates its indexes first;
when Mongo cannot be reached it gives up after `communication.mongo.server-selection-timeout`,
5 s, exits, and the pod is restarted until it can). Once running it survives losing the database: every call
that needs it answers `503 {"error":"database unavailable"}` after that timeout (about 20 s for a database
that hangs instead, see the end of this paragraph), readiness reports
`DOWN` within a kubelet's default probe timeout (1 s; it waits
`communication.mongo.readiness-timeout`, 0.8 s, for a ping) so the pod leaves the Service while
liveness stays `UP`, open SSE streams stay up on keepalives, and
each scheduler logs one WARN line per skipped run (`health sweep skipped: database unavailable: …`,
`status sweep skipped: …`) without a stack trace. The event log's poller, which runs every
`communication.events.poll-interval-ms` (500 ms), logs one WARN line when its polls start failing
(`event log poll skipped: database unavailable: …`) and one INFO line when they work again
(`event log poll resumed: database reachable again after <n> skipped poll(s)`), the polls in
between at DEBUG. However often it is probed, readiness logs two
lines per outage: `WARN readiness DOWN: MongoDB did not answer a ping: …` when it starts and
`INFO readiness UP: MongoDB answers again` when it ends (the stack trace at DEBUG).
A stream opened during the outage reads the event log's head before it answers, so it gets the
same `503 {"error":"database unavailable"}` (JSON, before any byte of the stream) after that
timeout, and the client's own backoff applies. One whose snapshot (or resume) query gives up after
the answer was committed with its `: connected` comment (the database went away in between) ends
with one WARN line (`feed stream closed: database unavailable: …`) and the client reconnects with
its backoff. The driver's detail, which names the cluster's addresses, appears in the log only (one WARN
line per answered call, the stack trace at DEBUG); the driver's own cluster monitor logs at WARN and
above only (`logging.level.org.mongodb.driver.cluster`), so connectivity changes print no INFO stack
traces. Calls succeed again within one server selection of Mongo coming back. The waits are
`communication.mongo.server-selection-timeout` (5 s), `connect-timeout` (5 s) and `read-timeout`
(15 s per socket read); they win over the same options given on the URI. How long a call waits for
its 503 depends on how the database fails. One that refuses connections (stopped, nothing listening
on its port) costs one `server-selection-timeout`: 5 s. One that stops answering on connections
already open (a frozen process, `docker pause`, a network black hole) holds a call for `read-timeout`,
15 s, and the driver retries a read once, which waits one more `server-selection-timeout`: about 20 s
(15 s for a write, which a standalone server does not retry). Once the driver has given up on such a
server (within 15 s with a paused mongod) later calls get their 503 after 5 s again.

## Core semantics

- **Lifecycle**: `DRAFT → (publish) → SCHEDULED/ACTIVE → EXPIRED` (by time) or `RETIRED`
  (explicit). EXPIRED and RETIRED are terminal; nothing is ever hard-deleted except via the
  admin purge endpoint. Every mutation appends to an embedded audit history (capped at 50).
- **Expiration is computed on read**: the feed filters by time predicates and returns an
  *effective* status derived from `startsAt`/`expiresAt`, so visibility is exact to the
  millisecond regardless of the background sweeper. The sweeper (every 30s, configurable via
  `communication.sweep.interval-ms`) converges stored status and pushes `activated`/`expired`
  SSE events; concurrent-save conflicts are skipped, making it safe to run multi-instance.
  The publisher and admin answers (`GET /v1/communications/{id}`, both lists, and what publish,
  update and retire return) carry the same effective status, computed when answering: nothing
  is written by a read. The lists' `status` filter matches the stored status, which can trail
  the effective one by up to one sweep interval.
- **Idempotency**: `externalRef` (e.g. an INC/CHG ticket id) is a permanent idempotency key:
  usable once per tenant for the life of the store (unique index on `(tenantId, externalRef)`,
  retired and expired notices included). Repeating it is how a client retries the same publish
  safely: the 409 names the notice that already holds it. A follow-up notice on the same ticket,
  or one published after the first was retired, needs a new value (`INC0012345-2`): the 409
  suggests the first one the tenant does not hold yet, in its sentence and as
  `"suggestedExternalRef": "INC0012345-3"` beside `error` (counting on from `n` for a reference
  that ends in `-n`, `n` up to 99; when the next 50 values are all taken it says so and suggests
  none).
- **Tickets (optional)**: a communication can carry the ServiceNow incident behind it
  (`ticket.number`, e.g. `INC0012345`; `ticket.system` names another tracker). The number is
  trimmed, upper-cased and checked against `communication.tickets.number-pattern`; with
  `communication.servicenow.instance-url` set, `ticket.url` links straight to the incident. The
  ticket rides on the feed and SSE payloads, can be attached later with `PUT`, and `externalRef`
  defaults to its number so the same incident is not published twice by accident (set
  `externalRef` yourself, e.g. `INC0012345-2`, for a second notice on one ticket). Nothing calls
  ServiceNow; syncing the ticket's status is a separate, later switch.
- **Concurrency**: documents carry a version (`@Version`); `PUT` requires `expectedVersion`,
  the `version` you last read (every answer and `GET /v1/communications/{id}` carry it), and a
  mismatch returns 409 so two editors never overwrite each other blindly.
- **SSE contract**: on subscribe, one `snapshot` event per currently-visible item, then live
  `created/updated/activated/expired/retired` events filtered server-side per subscriber;
  `id:` is a global sequence number from the shared event log; the stream opens with a
  `: connected` comment (so headers arrive at once, even when nothing is visible yet) and sends
  keepalive comments every 15s.
  A client that reconnects with `Last-Event-ID` (browsers do this on their own; `?lastEventId=`
  for curl) gets every event it missed, in order, while the log still holds it
  (`communication.events.retention`, default 1 day); otherwise it gets a fresh snapshot.
  With both (a page opened with `?lastEventId=`, then retried by the browser with a fresher
  header) the stream resumes after the larger id, so nothing already received is sent again.
  Frames are delivered at least once, never skipped: a `snapshot` frame's `id:` is the log head
  read just before the snapshot was built (not the node's fan-out cursor, which can trail it by
  one poll), so a resume from it can repeat an event whose change the snapshot already showed;
  consumers dedupe on the communication's `(id, version)`, carried in every payload.
- **Multi-instance**: events go through a shared log in Mongo (`communication_events`) that every
  instance appends to and tails (`communication.events.poll-interval-ms`, default 500 ms), so a
  notice published through any node reaches subscribers on every node. It is a poll, not a change
  stream, so a standalone Mongo works; live latency is bounded by the interval. On shutdown
  (SIGTERM) a node completes its open streams at once instead of holding the graceful-shutdown
  wait for 30 s; clients reconnect to another node (browsers do it by themselves) and resume
  with `Last-Event-ID`.
- **Scheduled visibility**: future-dated items are hidden from the feed, except SCHEDULED
  MAINTENANCE within the lookahead window (`communication.feed.upcoming-window`, default 7d).
  Drafts are invisible to consumers everywhere; EXPIRED/RETIRED stay retrievable by permalink.
- All timestamps are UTC `Instant`s (ISO-8601 on the wire).

## API (v1)

### Identify yourself

Every `/v1/**` request must carry `X-Client-Id: <your repository name>`; without it the service
answers `401 {"error": "missing X-Client-Id header …"}`. Browser `EventSource` cannot set headers,
so the stream also accepts `?clientId=`. Every request is logged with its id
(`client=vmforge-tools POST /v1/communications -> 201 (12 ms)`) so a notice can be traced to the
system that sent it. It is identification, not authentication: nothing is verified.
In Swagger UI click **Authorize** once and paste your repository name under `X-Client-Id`; every
operation there documents the `401` you get without it. `communication.client-id.required=false`
switches the check off for local experiments; requests are still logged, those without a valid id
as `client=-`.

### Publisher commands

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/communications` | 201 + Location; 400 validation (incl. a malformed `ticket.number`); 409 when the tenant has already used `externalRef`: it is a permanent idempotency key, the body names the notice holding it; repeat the value only to retry the same publish, give a follow-up notice a new one |
| GET | `/v1/communications/{id}` | any status (the effective one, as in the feed: `EXPIRED` once past `expiresAt`), includes audit history; 404 |
| GET | `/v1/communications?tenantId=…&status=&type=&page=&size=` | publisher's own list |
| PUT | `/v1/communications/{id}` | partial update; `expectedVersion` is required and is the `version` you last read (every answer and `GET /v1/communications/{id}` carry it); 409 `expectedVersion N does not match current version M` means someone saved in between: re-read, re-apply, send the new version; 409 also once the item is EXPIRED/RETIRED |
| POST | `/v1/communications/{id}/publish` | DRAFT → SCHEDULED/ACTIVE; 409 if not DRAFT |
| POST | `/v1/communications/{id}/retire` | optional `{actor, note}`; idempotent on RETIRED; 409 once past `expiresAt` (whether or not the sweeper has run) |

**Input errors** answer `400 {"error": "…"}` naming the field (for JSON that does not parse, the
line and column) and the rule. A value that cannot be read is quoted
(`type: 'BOGUS' is not one of […]`); validation lists every failing field at once
(`publisher: must not be blank; title: must not be blank`).
`affectedServices` takes up to 20 service names: a JSON `null` entry answers
`affectedServices[1]: must not be null`, an empty or blank one `affectedServices[1]: must not be blank`.
An `endsAt` or `expiresAt` that is not after `startsAt` names both values, and a `startsAt` you did
not send is the publish time: `expiresAt 2026-10-01T09:00:00Z must be after startsAt, which defaulted to now (2026-11-02T10:15:00.123Z)`
(with `startsAt` sent: `endsAt … must be after startsAt …`). A `PUT` without `expectedVersion` answers
`expectedVersion is required: send the version from your last GET of this notice; a 409 means someone changed it since`.
A field the publishing endpoints or monitor registration do not know (publish, update, retire,
inside `ticket`, and `POST /v1/health/monitors`) is a 400 too, `unknown field 'sevrity'; known
fields: …`, so a misspelled optional field cannot change what is published, or how a monitor
judges, without a word. Health reports keep accepting keys they do not know: a
forwarded Actuator document carries `groups` and whatever its producer adds.

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
| POST | `/v1/health/monitors` | register; 201 + `Location: /v1/health/monitors/<monitorId>` (the `id` in the body); with `url` the service is probed (pull), without it is push-only; 409 if (tenantId, service) exists; a field it does not know is a 400 naming it |
| GET | `/v1/health/monitors?tenantId=…` | monitors with live state (streaks, open notice) |
| GET | `/v1/health/monitors/{id}` | one monitor; 404 |
| POST | `/v1/health/monitors/{id}/probe` | probe now instead of waiting for the interval; 409 for push-only; the target is probed once, and when the scheduler saves the monitor meanwhile (its own probe of it) that observation is applied again to the monitor as the scheduler left it (up to 3 attempts) before a 409 `modified concurrently` is returned |
| DELETE | `/v1/health/monitors/{id}` | 204; retires any notice the monitor has open |
| POST | `/v1/health/reports` | push a health report; first contact auto-registers a push-only monitor; 202 |
| GET | `/v1/health/monitors/{id}/instances` | the pods that report for a monitor (last status, last seen, left cleanly or not); 404 |

A monitor is one `(tenantId, service)` and publishes as `publisher` (default `health-monitor`; a
monitor registered by the health sidecar's first report takes the sidecar's `CS_PUBLISHER`,
`health-sidecar` by default). Updates and retirements of its notices are signed with the same
name, so the history of an automated notice names one actor.
Per-monitor policy, all optional at registration (defaults in `application.yml` under
`communication.health.defaults`): `intervalSeconds` (≥5), `timeoutMs`, `failureThreshold`,
`recoveryThreshold`, `downSeverity` (≥ MINOR), `degradedSeverity`, `audience`,
`staleAfterSeconds` (push-only: silent longer than this counts as DOWN), `minHealthyPercent`
(services that report per pod: share of live pods that must be UP, default 50).

**Services with many pods (the health sidecar)**

A report that names its `instance` (`{"id": "<pod>", "node", "cluster", "namespace", "version",
"leaving"}`) is recorded per pod and the service's status is rolled up from every live pod
before the debounce sees it, so pods of one service never reset each other's streaks:

- a pod is live while heard from within `staleAfterSeconds` (auto-registered: 90 s) and has
  not sent `leaving: true`; pods still reporting `UNKNOWN` (starting) are live but not counted.
  While every live pod is `UNKNOWN` the monitor's message carries the first one's own words
  (`1 pod starting, none reporting yet (web-1: no health target found after 5m0s: …; set CS_PORT
  and CS_PATH)`, cut at 160 characters).
  The window must stay well above the sidecar's heartbeat plus its retry cap (30 s + 30 s with the
  sidecar's defaults), so a short outage of the service itself never makes a healthy pod look
  silent; lower `instance-stale-after-seconds` only together with `CS_HEARTBEAT`;
- all counted pods UP → UP; none UP → DOWN (DEGRADED if one still serves in part); some UP →
  DEGRADED when any pod reports a failing dependency or fewer than `minHealthyPercent` are UP,
  otherwise UP ("4 of 5 pods UP": readiness already keeps callers away from the bad pod);
- a service whose pods all said goodbye was scaled to zero and is never declared stale; one
  whose pods went silent is DOWN after the window, naming them.

Two pods reporting in the same instant collide on the monitor's version check; the service
re-applies the report after short, growing, randomised pauses (up to eight attempts over a few
seconds) before answering 409, so a whole fleet reporting at once is still accepted.

**Staleness safety valve.** The sweep refuses to trust silence for 5 minutes after it starts and
while more than 30 % of silence-capable monitors, and at least two of them, are silent together,
so our own restart or an egress problem never reads as everyone's outage while one silent service
out of three is still declared DOWN. Services scaled to zero count on neither side, and neither
does a monitor that has been silent for longer than `stale-forget-after` (a day): it belongs to a
decommissioned service or a forgotten test, so the sweep leaves it alone (its state and any notice
it has open stay as they are, nothing is deleted) instead of letting it keep the valve paused for
good. Delete such monitors (`DELETE /v1/health/monitors/{id}`) to clean up; a service that reports
again is counted again. The valve logs one WARN line when it pauses and one INFO line when it
resumes.

| `communication.health.…` | Default | Meaning |
|---|---|---|
| `stale-grace-after-start-ms` | `300000` | silence is not evaluated this long after the service starts |
| `stale-pause-fraction` | `0.3` | share of silence-capable monitors silent at once above which silence is not trusted |
| `stale-pause-min-silent` | `2` | the share rule needs at least this many silent monitors (and three capable ones) |
| `stale-forget-after` | `PT24H` | a monitor silent for longer is left alone and counts on neither side of the share |

[`sidecar/`](sidecar/README.md) holds the OpenShift sidecar that produces these reports
with no change to the app, plus Kustomize, Helm and plain-YAML snippets to attach it.

**How observations become communications**

- Status vocabulary, for the overall status and every component, in any case (the health
  sidecar reads the same words the same way):
  `UP`, `OK`, `PASS`, `HEALTHY`, `GREEN`, `SERVING` → UP;
  `DOWN`, `FAIL`, `FAILED`, `ERROR`, `UNHEALTHY`, `OUT_OF_SERVICE`, `FATAL`, `RED`, `NOT_SERVING` → DOWN;
  `UNKNOWN` or no status carries no information; any other word (`WARN`, `DEGRADED`, …) → DEGRADED.
  A word is trimmed of the characters up to U+0020 (spaces, tabs, control characters) and of no
  other white space, on both sides alike (`"pass\u00a0"` is an unknown word); a status that is
  nothing but such characters is no status.
  A document that is `UP` overall but has a component that is DOWN or DEGRADED is treated as
  DEGRADED. Nested components (composite indicators, legacy `details` nesting) are flattened to
  dotted names (`db.primary`); a pushed Boot 2.0/2.1-style document whose components sit under a
  top-level `details` map is read the same way as one with `components`.
- Probes read `/actuator/health`-style JSON when there is one (any version), otherwise judge by
  HTTP status (2xx up). Connection errors and timeouts are DOWN.
- Debounced: `failureThreshold` consecutive observations of the same unhealthy status open a
  notice; `recoveryThreshold` consecutive `UP`s retire it (audit note `recovered: …`). A single
  blip publishes nothing.
- **DOWN → `OUTAGE`** at `downSeverity`; **DEGRADED → `HEALTH`** notice at `degradedSeverity`;
  title `<service> is down|degraded`; the body is plain text like the bodies people write: the
  status as of the observation (UTC, to the second), where it came from (the probed URL and its
  answer, the service's own message, its pods with the failing ones named, or how long it has
  been silent) and the failing components with their details; `affectedServices=[service]`,
  `externalRef=health:<monitorId>:<incident#>` (the incident's idempotency key).
- While open: new failing components update the notice in place (`updated` SSE event); a change
  of kind (DOWN ↔ DEGRADED) retires it and opens the right type; recovery retires it. If an
  operator retires an automated notice by hand, the monitor respects it and starts counting
  again: the failing observation that notices the retirement is the first of the new count, so
  a service that keeps failing gets a fresh notice after `failureThreshold` failing observations
  (threshold 3: reopened on the third one).
- Notices are published through the same rules as human ones (`PublishingUseCase`), so feed,
  SSE, permalinks and audit history work unchanged. The scheduler (`communication.health.sweep-interval-ms`,
  default 5s) probes monitors whose interval elapsed. Every instance runs it, so each probe claims
  its slot first (the monitor is saved with the probe time under the optimistic version check):
  one instance probes a due monitor per interval and the others leave it alone, saying so at
  DEBUG. Opening a notice claims the monitor the same way, so several instances never
  double-publish.

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

The dates are computed from now (GNU `date`; the macOS fallback uses `-v`), so they hold on any
day. The ticket numbers hold once per store: a tenant uses an `externalRef` once, ever, so where
`vmforge` has already published `INC0012345` the first example answers 409 naming the notice that
holds it (the comment after it says why), and the second does the same for `INC0012345-2`; change
the ticket number (or the `externalRef`) to publish again. `<id>` is the `id` in a publish answer
(also the last path segment of its `Location` header); `<monitorId>` likewise for
`POST /v1/health/monitors`, or `.[].id` in the monitor list.

```bash
# dates relative to now (ISO-8601 UTC)
in2h=$(date -u -d '+2 hours' +%FT%TZ 2>/dev/null || date -u -v+2H +%FT%TZ)
tomorrow01=$(date -u -d 'tomorrow 01:00' +%FT%TZ 2>/dev/null || date -u -v+1d -v1H -v0M -v0S +%FT%TZ)
tomorrow03=$(date -u -d 'tomorrow 03:00' +%FT%TZ 2>/dev/null || date -u -v+1d -v3H -v0M -v0S +%FT%TZ)

# publish an outage tied to its ServiceNow incident (externalRef defaults to the number), expiring in two hours
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MAJOR",
  "title":"API degradation in eu-west","body":"We are investigating elevated errors.",
  "affectedServices":["vm-api"],"ticket":{"number":"INC0012345"},
  "expiresAt":"'"$in2h"'"}'

# externalRef (here the ticket number) is a permanent idempotency key, usable once per tenant: sending
# the request above again is a safe retry (409 naming the notice that holds INC0012345); a follow-up
# notice on the same incident gets its own value
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"OUTAGE","severity":"MINOR",
  "title":"API degradation in eu-west: residual errors","affectedServices":["vm-api"],
  "ticket":{"number":"INC0012345"},"externalRef":"INC0012345-2","expiresAt":"'"$in2h"'"}'

# schedule a maintenance window for tomorrow night (expiry defaults to the window end)
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications -H 'Content-Type: application/json' -d '{
  "tenantId":"vmforge","publisher":"vmforge-sre","type":"MAINTENANCE","severity":"INFO",
  "title":"Planned upgrade","startsAt":"'"$tomorrow01"'","endsAt":"'"$tomorrow03"'"}'

# what VMForge shows its customers right now
curl -s -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed?tenantId=vmforge&service=vm-api'

# live stream (keep open in a second terminal; -N disables buffering)
curl -N -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed/stream?tenantId=vmforge'

# resume after a disconnect: everything after event 1234 in order, then live (browsers send Last-Event-ID)
curl -N -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/feed/stream?tenantId=vmforge&lastEventId=1234'

# change the body: send back the version you last read as expectedVersion (409 if someone else got there first)
curl -s -H 'X-Client-Id: vmforge-tools' -X PUT localhost:8080/v1/communications/<id> \
  -H 'Content-Type: application/json' -d '{"body":"Mitigation in progress.","expectedVersion":0}'

# retire (the stream terminal shows the retired event)
curl -s -H 'X-Client-Id: vmforge-tools' -X POST localhost:8080/v1/communications/<id>/retire \
  -H 'Content-Type: application/json' -d '{"actor":"admin","note":"resolved"}'

# admin: everything retired, across tenants, with audit history
curl -s -H 'X-Client-Id: vmforge-tools' 'localhost:8080/v1/admin/communications?status=RETIRED'

# health: what the monitors currently think, and force a probe (<monitorId> = .[].id in the list)
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
