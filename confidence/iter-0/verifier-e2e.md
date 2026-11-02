# E2E Integration Verifier — iteration 0

Verifier: E2E Integration Verifier (grader only; no repository code was changed). Date: 2026-11-01/02.
Stack under test: a private copy of the whole system, built from the working tree at `confidence-loop/2026-11-01`
(= `main` after PR #8): backend A `:18081` and backend B `:18082` (same Mongo database `e2e`, both from
`build/libs/communication-service-0.0.1-SNAPSHOT.jar`, with `communication.sweep.interval-ms=2000`,
`communication.health.sweep-interval-ms=1000`, `communication.health.stale-grace-after-start-ms=0`),
Vite dev server `:3001` proxying `/v1` to A, and an emulated pod: container `e2e-app` (image `fakeapp:ci`,
an Actuator-style app whose health is flipped with `POST /__set`) plus `e2e-sidecar` (image `health-sidecar:ci`
built from `sidecar/Dockerfile`) joined to its network namespace and run as UID 1000660000 with a read-only root
filesystem, all capabilities dropped and `no-new-privileges`. Environment constraints are in
`confidence/evidence/environment.md` (no kind/OpenShift here: the "pod" is two Docker containers sharing one
network namespace).

## 1. Verdict and score

**E2E system score: 67 / 100. Hard gate tripped: yes — four Feature Matrix rows fail end to end
(F-20, F-61, F-88, F-92).** The happy paths all work: a human publishes in the UI and a second browser sees it
live in 0.3 s; the sidecar finds the app over localhost, the backend rolls the pod up, debounces and publishes
an OUTAGE that appears in the UI, swaps it for a HEALTH notice on degradation and retires it on recovery with an
audit note; two backend nodes fan events out to each other; SIGTERM makes the pod leave cleanly; a paused
(silent) pod is declared down naming the pod. What fails is recovery after a backend restart (the browser is
never told, and the resume path answers 500), a dead app that is reported UNKNOWN instead of DOWN, a safety
valve that is tripped by scaled-to-zero services, a 15 s delay before any SSE response for empty tenants, and a
high 409 rate for simultaneous pod reports.

| Category | Weight | Score | Why |
|---|---|---|---|
| Builds & static checks | 10 | 7 | Jar, dev server and both images built and ran from the working tree (`environment.md`); no dependency/security scan was run by this verifier, so those points are not awarded. |
| Feature completeness | 30 | 26.4 | 29 of the 33 rows owned here pass (87.9 %): F-20, F-61, F-88, F-92 fail (section 3). |
| Automated test health | 20 | 8 | The only cross-service automated tests in the repo are `CommunicationServiceE2EIT` (5) and `HealthMonitoringE2EIT` (4); the orchestrator's first ever run of them has 1 failure (`reconnectingWithLastEventIdReplaysWhatWasMissed`, the same 500 as GAP-e2e-1). Nothing in the repo tests UI↔backend or sidecar↔backend end to end; flakiness (3×) is the Backend Verifier's measurement. |
| Integration & contracts | 20 | 14 | UI→backend (header, `?clientId=`, shapes, 400/409 surfacing), sidecar→backend wire contract (captured and replayed verbatim, 202), node↔node fan-out and the per-pod rollup all match. SSE resume contract broken (500); SSE connection is not acknowledged for up to 15 s; burst reports answered 409. Sidecar↔main-container contract verified in an emulated pod, not a real one. |
| Resilience & ops | 10 | 5 | Sidecar backs off and recovers when the backend is down; silent pod → DOWN naming it; slow probe target → DOWN with a timeout message. But: UI shows "Live" on a dead stream and never heals; a crashed app never opens an outage; SIGTERM holds the JVM 30 s on open streams. |
| Usability | 10 | 7 | Provisional, deferring to the Usability Reviewer: every flow could be completed unaided; friction: 15 s "Connecting" on an empty tenant, a stale "Live" badge after a backend restart. |
| **Total** | | **67.4 → 67** | Hard gate (rows failing E2E) caps at 80; not binding. |

## 2. Commands run

Scripts are copied under `confidence/evidence/iter-0/e2e/scripts/`; raw outputs (trimmed) next to them.

| # | Command (from the scratchpad `e2e/` folder) | Exit | Evidence |
|---|---|---|---|
| 1 | `java -jar …jar --server.port=18081 …`, same on 18082; `COMM_BACKEND=http://127.0.0.1:18081 npm run dev -- --port 3001 --host 127.0.0.1`; `docker run … e2e-app`, `docker run … --network container:e2e-app --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges … e2e-sidecar` | 0 | `environment.md`, `e2e-sidecar-log.txt` |
| 2 | `python3 -I http_checks.py` (105 HTTP/SSE contract checks against A and B) | 7 | `http-contracts-run1.txt` — of the 7 FAIL lines, 1 is the script's own fault (F-27 `?clientId=` case: the script waited 10 s for headers that arrive after 15 s, see GAP-e2e-5; curl confirms HTTP 200 `text/event-stream`), 2 are GAP-e2e-7 (minor), 2 are GAP-e2e-1, 1 is GAP-e2e-6, 1 is GAP-e2e-4 |
| 3 | follow-up python (F-48 re-test with the valve untripped, F-50 load at 20 parallel / 20 req/s / 5 req/s / ~33 req/s random) | 0 | `http-contracts-followup-f48-f50.txt` |
| 4 | `curl -sN -o /dev/null -w '%{http_code} %{time_starttransfer}'` on `/v1/feed/stream` for an empty tenant (header and `?clientId=`), a non-empty tenant, and the shared backend | 0 | section 4, GAP-e2e-5 (15.005 s / 15.005 s / 0.0066 s / 15.004 s) |
| 5 | `node ui_flows.js` (Playwright, 36 checks: publish with ticket, second-context live watcher, resolve, filters, Live switch, server-error banner, inline validation, draft) | 2 | `ui-flows.txt`, `screenshots/f90-*.png`, `f57-server-error.png`, `f58-filters.png` — the 2 FAIL lines are benign: Chromium logs a console error for the deliberate 409, and `net::ERR_ABORTED` is the EventSource being closed on filter change / Live off |
| 6 | `node pod_flows.js p91` (19 checks: sidecar flow through app, sidecar, backend and UI) | 0 | `pod-flow-f91.txt`, `screenshots/f91-*.png` |
| 7 | `node pod_flows.js p92` (backend A killed and restarted while the UI and the sidecar were connected; publish through B meanwhile) | 5 | `pod-flow-f92-backend-down.txt`, `screenshots/f92-backend-down.png`, `f61-after-restart.png` — 2 of the 5 are the script's (a 10 s wait while the JVM shut down gracefully for 30 s; wrong field name `lastSendError` vs `sendError`), 3 are GAP-e2e-2 |
| 8 | `node reconnect_probe.js` (in-page `EventSource` instrumentation + `curl -N` via the proxy and direct, across SIGTERM/restart of A) | 0 | `browser-reconnect-probe.txt`, `screenshots/f61-probe-after-restart.png` |
| 9 | `node pod_flows.js silent ordering slow` (paused sidecar → stale; sidecar started before the app; app container stopped/started/moved port; sidecar SIGKILL; slow probe target; wire capture; id limits; WARN pass-through) | 3 | `pod-flow-silent-ordering-slow.txt`, `sidecar2-log.txt` — 1 of the 3 is the script's regex (`"no response within 500ms"` is a timeout message), 2 are GAP-e2e-3 |
| 10 | `grep` of backend A's log for valve, notice and shutdown lines | 0 | `backendA-log-excerpts.txt` |

## 3. Feature verdicts (rows with two or more services, plus F-90..F-92)

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | http-contracts-run1 F-01 ×5 | 201 + Location, ACTIVE/SCHEDULED by startsAt, audience default, `created` frame with `id` = seq |
| F-02 | PASS | run1 F-02 ×8; ui-flows F-02 | draft invisible everywhere, no event; publish → 200 ACTIVE + CREATED; again → 409; UI "Draft saved" without View in feed |
| F-06 | PASS | run1 F-06 ×5 | note + actor in history; idempotent; actor defaults to publisher; EXPIRED → 409 |
| F-07 | PASS | run1 F-07 11/13; ui-flows F-55 ×3, F-57 | every bean/domain rule → 400 naming the field; UI mirrors them inline. Unparseable JSON → generic text (GAP-e2e-7, minor) |
| F-09 | PASS | run1 F-09 ×6, F-08 ×2; ui-flows F-09 ×2 | normalised number, externalRef default, 409 on reuse, PUT attach with audit, chip in the feed card (no link: `servicenow.instance-url` unset) |
| F-14 | PASS | run1 F-14 ×13 | all filters, ordering, paging math, cap 100, 400s |
| F-15 | PASS | run1 F-15 ×3 | feed ACTIVE while stored SCHEDULED; gone 0.2 s after expiresAt while stored ACTIVE; permalink EXPIRED |
| F-16 | PASS | run1 F-16 ×3, F-17; ui-flows F-16 | P7D window, includeUpcoming=false, UI "Upcoming / Starts in" |
| F-18 | PASS | run1 F-18 ×8 (+ `expired` in F-06) | snapshot per item, activated/updated/retired/expired, ids increasing, `:keepalive` at 15.005 s. Headers only with the first frame (GAP-e2e-5) |
| F-20 | **FAIL** | run1 F-20: header and `?lastEventId=` → **HTTP 500** `{"error":"… you can't add a second 'seq' expression …"}`; fallbacks (never-issued id, non-numeric) → snapshot OK | GAP-e2e-1 |
| F-21 | PASS | run1 F-21 ×3 | publish via B → `created` on A in 0.62 s, retire via A → B, same seq on both nodes; B served while A was down (pod-flow-f92) |
| F-27 | PASS | run1 F-27 7/8 + curl (cmd 4) | 401/400 bodies, OPTIONS exempt, docs exempt, `?clientId=` stream 200 `text/event-stream`, UI header on every call (ui-flows F-64), sidecar `X-Client-Id` = `CS_CLIENT_ID` (F-75) |
| F-36 | PASS | run1 F-36 ×4 | 202 + monitor, push-only, publisher from report, 400s |
| F-38 | PASS | run1 F-38 ×7 | OK/healthy→UP, OUT_OF_SERVICE/FATAL→DOWN, WARN→DEGRADED, nested `db.primary` flattened, UP+DOWN component → DEGRADED |
| F-46 | PASS | run1 F-46 ×4, F-49 | ordered by id, upsert, rollup "2 of 2 pods UP", 404 |
| F-48 | PASS* | run1 F-48 (leaving, scaled-to-zero); followup F-48 (silent → "silent is down", body names p1, p2; recovery); pod-flow-silent (paused sidecar → OUTAGE naming the pod after 87 s; unpause → retired in 11 s) | *first attempt was blocked by the safety valve counting the scaled-to-zero service as silent: GAP-e2e-4 |
| F-50 | PASS* | run1 F-50; followup F-50 | contract as written holds (3 attempts then 409, all pods recorded, rollup "20 of 20"), but 20 simultaneous reports → 13–14 × 409; ~33 req/s random → 3 %; 20 req/s staggered → 0 %: GAP-e2e-6 |
| F-56 | PASS | ui-flows F-56 ×4 | 201 with the frontend's client id, confirmation card, publisher remembered, View in feed |
| F-57 | PASS | ui-flows F-57; pod-flow-f92 ("Couldn't load the feed 502 Bad Gateway" + Try again) | banner with the service text; feed error state with retry |
| F-58 | PASS | ui-flows F-58 ×3 | sections/counts, `severity=` and `service=` in the query, All types |
| F-60 | PASS | ui-flows F-60 ×6; pod-flow-f91 (automated notices arrive live) | created/updated/retired applied live; Paused/Connecting/Live states. "Connecting" lasts 15 s on an empty tenant (GAP-e2e-5) |
| F-61 | **FAIL** | reconnect-probe: after SIGTERM of A the in-page `EventSource` stays `readyState 1`, no `error` event, UI badge "Live" for 75 s; after restart no reconnect, item published meanwhile never appears (+40 s); `curl -N` via the proxy never ended, direct `curl` ended after 30 s; a manual `Last-Event-ID` probe → 500 | GAP-e2e-2 (+ GAP-e2e-1 once a reconnect does happen) |
| F-62 | PASS | ui-flows F-62 ×2 | inline confirm, note and actor in history, card removed in both contexts |
| F-64 | PASS | ui-flows F-64 | 6/6 feed GETs with `X-Client-Id: communication-frontend`, stream with `clientId=`; cross-origin static build not exercised (Q2) |
| F-70 | PASS | pod-flow-slow F-70 | app `WARN` → sidecar reports `WARN` → backend DEGRADED |
| F-72 | PASS | pod-flow-ordering F-72 | sidecar first: UNKNOWN "starting: waiting for the app to listen", monitor "UNKNOWN (1 pod starting…)", no notice; app up 2 s after start |
| F-74 | PASS | pod-flow-f92 F-74; e2e-sidecar-log | "report failed; will retry … connection refused" at +0, +3.1, +3.4, +6.4 s …; resumed 22.9 s after A was back (sendError cleared) |
| F-75 | PASS | pod-flow-slow F-75 ×4 | headers and body captured from the real sidecar, accepted verbatim by the backend; id 253 OK / 254 → 400 |
| F-76 | PASS | pod-flow-f91 F-76 | `docker stop` → "leaving report sent", exit 0 in 97 ms, instance `left=true` at once |
| F-88 | **FAIL** | pod-flow-ordering F-88 ×2; sidecar2-log | app container stopped: one DOWN ("connection refused"), then "health target gone; will rediscover" and **UNKNOWN "no health target found yet"** for the 40 s the app was down → no notice; app back → nothing to retire. Other sub-items pass (ordering, SIGKILL+restart, port move → rediscovery F-77) | GAP-e2e-3 |
| F-89 | PASS | pod-flow-f91 F-89, ordering F-89; backendA-log-excerpts | JSON slog lines; backend INFO on notice open/retire and WARN on the valve |
| F-90 | PASS | ui-flows F-90 ×4, screenshots | second context saw the card 319–328 ms after the click; consumer filter; resolve → gone both sides; permalink RETIRED with note |
| F-91 | PASS | pod-flow-f91 (19/19), screenshots f91-* | DOWN → OUTAGE in 17.1 s (change report + next 10 s heartbeat), DEGRADED swap in 16.1 s, recovery 16.1 s, SIGTERM/left, restart |
| F-92 | **FAIL** | pod-flow-f92, reconnect-probe, pod-flow-slow, run1 F-27/F-20 | passes: backend down (UI error state on refresh, sidecar backoff/recovery, B unaffected), silent pod, slow probe target, bad input (UI 409/400 text), missing/invalid id, unknown Last-Event-ID; fails: browser never notices the dead stream and never heals (GAP-e2e-2), resume 500 (GAP-e2e-1); not exercised: Mongo down, slow backend from the sidecar's side (`CS_REPORT_TIMEOUT`), sidecar 4xx-permanent path |

Rows passing: 29 (two with asterisks). Rows failing: 4.

## 4. Gaps

| ID | Severity | Feature(s) | Root cause | Reproduced by | Suggested fix | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-e2e-1 | **blocker** | F-20, F-61, F-92 | `CommunicationEventMongoRepository.java:15` derives `findByTenantIdAndSeqGreaterThanAndSeqLessThanEqualOrderBySeqAsc`; Spring Data Mongo cannot put two criteria on `seq` into one derived query, so `MongoCommunicationEventsAdapter.java:144-146` throws on every resume → `GlobalExceptionHandler` → 500 | `curl -N -H 'Last-Event-ID: 1' …/v1/feed/stream?tenantId=…` → 500 `{"error":"Due to limitations of the org.bson.Document, you can't add a second 'seq' expression …"}`; same with `?lastEventId=` (run1 F-20) | replace the derived method with `@Query("{tenantId: ?0, seq: {$gt: ?1, $lte: ?2}}")` or `Criteria.where("seq").gt(after).lte(upTo)` | `CommunicationServiceE2EIT.reconnectingWithLastEventIdReplaysWhatWasMissed` (exists and fails; never run before this loop) |
| GAP-e2e-2 | major | F-61, F-92, F-60 | The UI relies solely on `EventSource.onerror` to notice a dropped stream (`frontend/src/outages/api.ts:262-264`, `useOutageFeed.ts`); it ignores the server's `:keepalive` (15 s). Behind the Vite dev proxy (`vite.config.ts:15-24`) the client socket stays open after the backend dies (curl via proxy never ended; direct curl ended 30 s after SIGTERM), so the badge says "Live" indefinitely and nothing published after the restart arrives until a manual Refresh | reconnect-probe (`browser-reconnect-probe.txt`), `pod-flow-f92` F-61 ×2 | client-side liveness watchdog: if no frame or comment arrives for ~2× the keepalive, close and re-subscribe (show "Reconnecting"); optionally send `retry:` from the server. Then GAP-e2e-1 must also be fixed, or the reconnect dies on the 500 | a vitest for the watchdog (fake timers) and a Playwright test that kills the backend |
| GAP-e2e-3 | major | F-88, F-72, F-91 | `sidecar/internal/agent/agent.go:153-156`: once the target is gone (`observe` sets `a.target = nil`, :170-176), every later tick returns `UNKNOWN "no health target found yet"`; `compose` (:209) keeps it because `upSeen` is true. The backend ignores UNKNOWN, so the one DOWN report never reaches `failureThreshold` | `docker stop e2e-app2` while `e2e-sidecar2` runs: log shows DOWN once, then UNKNOWN for 40 s; monitor summary "UNKNOWN (1 pod starting…)"; no OUTAGE (`pod-flow-silent-ordering-slow.txt`, `sidecar2-log.txt`) | after `upSeen`, a missing target is `DOWN` with message "app is not listening (last target …)"; keep UNKNOWN only before the first UP / during the grace | `agent_test.go`: target disappears after an UP → subsequent reports are DOWN; `HealthMonitoringE2EIT` variant |
| GAP-e2e-4 | major | F-45, F-48 | `HealthSweepUseCase.staleAllowed` (`:85-102`) counts `m.stale(now)` per monitor, which is true for a service whose pods all sent `leaving` (its `lastReportAt` ages), although `evaluate` (`:135`) later exempts it. Scaled-to-zero services therefore push the share of "silent" monitors over `stale-pause-fraction` | run1: `WARN … 2 of 5 push-only monitors are silent at once; not declaring them DOWN` with exactly one silent service and one scaled-to-zero service; the silent one was only declared DOWN after the scaled one was deleted (`backendA-log-excerpts.txt`, followup F-48) | exclude monitors whose instances all left from the stale count (and arguably from `capable`) | `HealthSweepUseCaseTest`: one silent + one scaled-to-zero among ≥3 capable → silent is still declared DOWN |
| GAP-e2e-5 | major | F-18, F-60, F-61, F-27 | `RestControllerFeedAdapter.java:163-187` / `FeedUseCase.stream`: the SSE `Flux` emits nothing for a tenant with no visible items until the first keepalive, and WebFlux commits the response (status + headers) only with the first element | `curl -w %{time_starttransfer}` empty tenant: **15.005 s** (header and `?clientId=` alike, A and the shared backend); non-empty tenant: 0.0066 s. In the UI the badge shows "Connecting" for 15 s on an empty tenant (`pod-flow-f92` F-60) | start the stream with an immediate comment (`:connected`) or `retry:` line so headers flush at once | WebTestClient test: headers of `/v1/feed/stream` for an unknown tenant arrive within 1 s |
| GAP-e2e-6 | major | F-50, F-46, F-91 | `HealthMonitorUseCase.java:41,92-96`: three immediate attempts on the monitor's optimistic lock, no backoff; every instance report rewrites the single monitor document | 20 parallel reports (fresh or existing service) → 6–7 × 202, 13–14 × 409; ~33 req/s random arrivals → 97/100; 20 req/s staggered → 20/20 (run1 F-50, followup) | jittered retry with more attempts, or move streak/rollup updates to an atomic `findAndModify`, or record the instance and let the sweep evaluate; at least make the sidecar's 409 retry jittered so a herd spreads | an IT firing N parallel instance reports asserting ≥ 95 % 202 |
| GAP-e2e-7 | minor | F-07, F-28 | `GlobalExceptionHandler.handleInput` returns `ServerWebInputException.getReason()` = "Failed to read HTTP message" for JSON decode failures (unknown enum value, bad timestamp) | run1 F-07 "unknown type", "malformed JSON timestamp" → 400 without a field name | unwrap `DecodingException`/`InvalidFormatException` to name the path and allowed values | `RestControllerPublishingAdapterTest` case for an unknown enum |
| GAP-e2e-8 | minor (ops) | F-30, F-61 | Spring Boot 3.4 graceful shutdown waits for in-flight requests; open SSE streams never complete, so SIGTERM takes the full 30 s (`Shutdown phase … ends with 1 bean still running after timeout of 30000ms`, `Graceful shutdown aborted`) and direct SSE clients only see the drop then | `backendA-log-excerpts.txt` (two shutdowns, 23:53:38→23:54:08 and 23:55:36→23:56:06); `curl_direct` EXIT=18 at 23:56:06.5 | complete the event streams on shutdown (SmartLifecycle / `Sinks` complete) or set `spring.lifecycle.timeout-per-shutdown-phase` consciously and document the pod `terminationGracePeriodSeconds` | none today; a shutdown IT with an open stream |

Benign observations (not gaps): Chromium prints a console error for every non-2xx API response (the deliberate 409 in F-57); `net::ERR_ABORTED` on stream requests is the EventSource closing when filters change or Live is switched off.

## 5. Not exercised in this sandbox

- **No real pod / cluster**: kind cannot start here and there is no OpenShift, so the sidecar↔main-container contract was verified in Docker (shared network namespace, arbitrary UID, read-only rootfs, dropped capabilities), not under an SCC, and the native-sidecar (init container) form was not run.
- **Mongo down**: the only Mongo is the shared `mongo7` container, which I was not allowed to stop; the backend's behaviour without its database was not observed.
- **Slow backend from the sidecar's side** (`CS_REPORT_TIMEOUT`) and the sidecar's permanent-4xx path were not driven end to end (unit tests exist in `sidecar/internal/agent`).
- **Cross-origin static frontend build** (Q2) and a production reverse proxy in front of the UI (the F-61 proxy behaviour was measured on the Vite dev proxy only).
- **Flakiness 3×** of the backend suites is measured by the Backend Verifier; this report cites the orchestrator's single `./gradlew integrationTest` run (25/26, the failure being GAP-e2e-1).
