# Backend Verifier report — iteration 0 (2026-11-01)

Verifier: independent grader (did not write any production or test code). Scope: every Feature Matrix row whose
services include `BE`, except F-90/F-91/F-92 (E2E verifier). For rows shared with the frontend or sidecar only the
backend side is graded here. All evidence files are under `confidence/evidence/iter-0/backend/` (referenced below as
`ev/…`). Repository code was not modified; `git status` shows only `confidence/` as new.

## 1. Verdict and scores

**Backend confidence: 72 / 100. Hard gate tripped (cap 80): yes — F-20 and F-61 fail (SSE resume answers HTTP 500).**

| Category | Weight | Score | Why (evidence) |
|---|---|---|---|
| Builds & static checks | 10 | 4 | `clean compileJava compileTestJava` and `bootJar` succeed (`ev/01-gradle-build.txt`, `ev/05-gradle-bootJar.txt`). No lint / static-analysis / coverage / dependency-scan plugin exists in `build.gradle.kts` (0 for those). Dependency scan could not run (api.osv.dev and NVD blocked by the egress policy); a knowledge-based review (`ev/07-dependency-cve-review.txt`) finds NVD-HIGH advisories in transitive Netty 4.1.116 (CVE-2025-24970, CVE-2025-55163, CVE-2025-58056) with low / unconfirmed exploitability here. Only the "clean build" part is awarded. |
| Feature completeness | 30 | 28.6 | 61 of 64 scored rows verified PASS (section 3). FAIL: F-20 (resume), F-41 (operator-retired notice not respected while the failure is unchanged), F-61 backend side (same root cause as F-20). F-30 is an inventory note (no health endpoint), scored under resilience, not counted in the ratio. 61/64 = 95.3 % × 30. |
| Automated test health | 20 | 11 | Unit: 164/164 pass in 3 consecutive runs (`ev/02-gradle-test-summary.txt`). Integration (never run before in this environment): 26 tests, **1 deterministic failure in all 3 runs** — `CommunicationServiceE2EIT.reconnectingWithLastEventIdReplaysWhatWasMissed` (`ev/03-gradle-integrationTest-summary.txt`, `ev/03-E2EIT-run1..3-failure.txt`). No skipped, `@Disabled` or assumption-guarded tests (`ev/06-test-inventory-from-xml.txt`, `grep` of `src/test`). No flakes observed (6 runs, identical results). No coverage tooling, so "new and changed code is covered" cannot be shown; critical paths do have E2E ITs. The failing test is a real bug, not a test problem. |
| Integration & contracts | 20 | 15 | 200+ HTTP contract checks against the running backend: publishing/feed/admin/client-id/error/OpenAPI (`ev/20-…`, 107/112 → 109/112 after the two expectation errors in A-24 were re-checked in `ev/20b-…`; remaining FAILs are F-20 and the A-13c nuance), health (`ev/21-…` 75/80), two-instance fan-out + sweeper (`ev/22-…` 8/9), scheduler/staleness/valve (`ev/23-…` 8/9, the one FAIL was my test design, re-run clean in `ev/24-…` 3/3). The one broken contract is `Last-Event-ID` / `?lastEventId=` → 500 on every node, which is the browser-reconnect contract with the frontend and the documented resume contract. Sidecar wire contract (report shape, 202, instance fields, 253-char limit, 409 retryable) verified. Oversized request → 413 but with body `{"error":"unexpected error"}`. |
| Resilience & ops | 10 | 5 | Verified: optimistic locking across two instances (sweep conflicts skipped, `ev/31-…`), staleness safety valve pauses and resumes (`ev/23-…` C-45a/b and the WARN lines in `ev/30-…`), probe timeout honoured (B-37a: 200 ms → DOWN in < 2.5 s), closed port / 5xx / slow target all become observations, graceful shutdown logged. Missing: no health/liveness/readiness endpoint and no Actuator (F-30; nothing for an OpenShift probe to call), no Dockerfile/manifests for the backend, an operator-retired notice is not noticed while the failure persists unchanged (GAP-2), the client id is logged only at DEBUG although the README says it is logged with each request (GAP-7). |
| Usability | 10 | 8 (provisional) | API-level only, deferring to the Usability Reviewer: every rejection is `{"error": …}` naming the field or rule (A-07, B-32, A-28), `Location` headers on creates, Swagger UI with an `Authorize` scheme for `X-Client-Id` (A-29b/c), idempotent retire. Deductions: generic 413 message, stale `openCommunicationId` after an operator retire. |
| **Weighted total** | | **71.6 → 72** | cap 80 applies (hard gate) but is not binding |

Hard gates:
- Any matrix item fails E2E: **yes** (F-20, F-61) → cap 80.
- Test skipped/deleted/loosened: **no** (none found; none modified by me).
- Sidecar non-root: not this verifier's area.
- Critical/high security finding open: **not confirmed either way** — no scanner could run; the knowledge-based review lists NVD-HIGH ids in Netty 4.1.116 whose exploitable paths (TLS termination, HTTP/2, decompression) are not enabled here, except CVE-2025-58056 (chunked request smuggling behind a proxy) which is plausible in the intended OpenShift deployment. The verifier's position: treat as open (GAP-4) until a real scan says otherwise; the auditor decides whether it trips the gate.

## 2. Commands run

| # | Command | Exit | Evidence |
|---|---|---|---|
| 1 | `./gradlew --max-workers=2 --no-daemon clean compileJava compileTestJava` | 0 | `ev/01-gradle-build.txt` |
| 2 | `./gradlew --max-workers=2 --no-daemon test` ×3 | 0, 0, 0 | `ev/02-gradle-test-run1..3.txt`, `ev/02-gradle-test-summary.txt` (164 tests, 0 failures each run) |
| 3 | `./gradlew --max-workers=2 --no-daemon integrationTest` ×3 (seeded mongod 7.0.45, tests unchanged) | 1, 1, 1 | `ev/03-gradle-integrationTest-run1..3.txt`, `ev/03-gradle-integrationTest-summary.txt` (26 tests, 1 failure each run), `ev/03-E2EIT-run1..3-failure.txt` |
| 4 | `./gradlew --max-workers=2 --no-daemon dependencies --configuration runtimeClasspath` | 0 | `ev/04-gradle-dependencies-full.txt`, `ev/04-runtime-classpath-flat.txt` (77 artifacts), `ev/04-resolved-versions.txt` |
| 5 | `./gradlew --max-workers=2 --no-daemon bootJar` | 0 | `ev/05-gradle-bootJar.txt` (37.5 MB jar) |
| 6 | JUnit XML inventory (every test case name and result; grep for `@Disabled/@Ignore/assume*/@EnabledIf`) | 0 | `ev/06-test-inventory-from-xml.txt` (189 ok, 1 fail, 0 skipped) |
| 7 | Knowledge-based dependency/CVE review (OSV: `curl https://api.osv.dev/v1/query` → CONNECT 403) | n/a | `ev/07-dependency-cve-review.txt` |
| 8 | `docker exec mongo7 mongosh --quiet communication --eval 'printjson(db.<coll>.getIndexes())'` for the 4 collections + counters | 0 | `ev/10-mongo-indexes.txt` |
| 9 | `python3 -I runner.py check_a_publishing_feed_admin.py` (112 checks, shared backend :8080, tenants `be-a-*`, `be-feed-*`, `be-sse-*`) | 0 | `ev/20-http-publishing-feed-admin.txt` |
| 10 | `python3 -I runner.py check_a2_tenants.py` (tenant summary re-check with the real field name `counts`) | 0 | `ev/20b-http-admin-tenants.txt` |
| 11 | `python3 -I runner.py check_b_health.py` (80 checks, :8080 + stub Actuator on :18555 with fixed and mutable health documents, tenants `be-h-*`) | 0 | `ev/21-http-health.txt` |
| 12 | `python3 -I runner.py check_c_private.py` (private instances :18090/:18091 from the prebuilt jar, db `be-verify`, sweep 2 s, health sweep 1 s, stale grace 0, poll 200 ms) | aborted after 9 checks (see §5) | `ev/22-http-private-instances.txt` |
| 13 | `python3 -I runner.py check_c2_private.py` first attempt (db `be-verify` shared with another verifier) | 0, 1 FAIL caused by the shared db | `ev/23a-…ABORTED-shared-db….txt` |
| 14 | `python3 -I runner.py check_c2_private.py` (private instance :28090, own db `be-verify-bv2`) | 0 | `ev/23-http-private-instance-part2.txt` |
| 15 | `python3 -I runner.py check_c3_pods.py` (private instance :28091, fresh db `be-verify-bv3`) | 0 | `ev/24-http-private-pods-silence.txt` |
| 16 | Log review of the private instances and the shared backend (`grep` for notice/sweep/staleness/rejection lines, level counts) | 0 | `ev/30-backend-logging.txt`, `ev/31-multi-instance-sweep-conflicts.txt` |
| 17 | 300 KB and 20 KB request bodies against `POST /v1/communications` | n/a | recorded in §4 GAP-9 (413 `unexpected error` / 400 `body: size must be between 0 and 16384`) |

Check scripts (`lib.py`, `runner.py`, `check_*.py`, `stub_actuator.py`) live in the scratchpad `…/scratchpad/backend/`; each evidence file ends with the full request/response transcript.

## 3. Feature verdicts

Check ids (A-…, B-…, C-…) refer to the tables in the evidence files; test names refer to runs 1–3 of commands 2–3.

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | A-01a–d; IT `publishFeedStreamRetireRoundTrip` | 201 + Location, ACTIVE/SCHEDULED by `startsAt`, audience default, `created` frame live |
| F-02 | PASS | A-02a–e | draft invisible in feed and permalink (404), publish → ACTIVE, publish again → 409 |
| F-03 | PASS | A-03a/b | history present; unknown → 404 `{error}` |
| F-04 | PASS | A-04a–c | any status, `status=` filter, `page/size/hasNext/totalElements` |
| F-05 | PASS | A-05a–d | partial update keeps other fields, version+1, 409 stale, 400 missing `expectedVersion`, 409 on RETIRED |
| F-06 | PASS (note) | A-06a–c, C-13a | retire + audit note, idempotent, actor defaults to publisher, stored-EXPIRED → 409. Note GAP-5: an item that has expired by time but is still stored ACTIVE (before the 30 s sweep) can be retired with 200 (A-13c) |
| F-07 | PASS | A-07 ×11 | every invalid body → 400 naming the field/rule |
| F-08 | PASS | A-08; IT `duplicateExternalRefWithinTenantIsConflict` | 201 / 409 / 201 in another tenant |
| F-09 | PASS | A-09a–h; IT `ticketContracts` (url with configured instance) | trim/upper-case, system default, externalRef default, 400 bad number / ftp url, 409 second notice on the same ticket, PUT attaches with audit, feed carries ticket |
| F-10 | PASS | A-10, A-10b | expiresAt defaults to endsAt; startsAt defaults to now |
| F-11 | PASS | A-11a–c | 4 ordered entries, cap at 50 after 60 updates, actor fallback |
| F-12 | PASS | A-12; IT `staleVersionIsConflict` | 8 parallel PUTs with one `expectedVersion`: 1×200, 7×409 |
| F-13 | PASS (note) | A-13a/b, C-13a/b, A-05d | DRAFT→RETIRED, SCHEDULED→RETIRED, stored EXPIRED blocks retire and update (409); see GAP-5 for the time-expired-but-stored-ACTIVE window |
| F-14 | PASS | A-14a–m | service/type/min-severity/audience/activeAt filters, severity ordering, size cap 100, page=-1 / size=0 / missing or blank tenant → 400, paging math, FeedItem shape without history |
| F-15 | PASS | A-15a/b, A-14f | EXPIRED on read 2.5 s after `expiresAt`, absent from feed before the sweep; `activeAt` in the future shows the future item |
| F-16 | PASS | A-16a/b | upcoming MAINTENANCE shown, future OUTAGE hidden, `includeUpcoming=false` hides both |
| F-17 | PASS | A-17a/b, C-17, A-02c | retired and expired permalinks 200, draft/unknown 404 |
| F-18 | PASS (note) | A-18a–e | snapshot first, then `created/updated/retired` in order, monotonic ids, payload shape, `:keepalive` within 17 s. Note: an item created within the last poll interval before subscribing arrives as snapshot **and** `created` (A-18b); documented as harmless in `FeedUseCase.java:86-90` (clients upsert) |
| F-19 | PASS | A-19 | `service=a` stream never sees service b's events and vice versa |
| **F-20** | **FAIL** | A-20a, A-20c, C-21d, IT `reconnectingWithLastEventIdReplaysWhatWasMissed` ×3 | `Last-Event-ID` header and `?lastEventId=` → **HTTP 500** `{"error":"Due to limitations of the org.bson.Document, you can't add a second 'seq' expression …"}`. Fallback paths work: unknown id → snapshot (A-20d), non-numeric header ignored (A-20e). GAP-1 |
| F-21 | PASS | C-21a–c, C-21e | publish on :18090 → `created` on :18091 within the 4 s window and the reverse direction, global monotonic ids, `events_ttl_idx` 86400 s. Cross-node resume (C-21d) fails for the F-20 reason |
| F-22 | PASS | C-22a/b; log `sweep applied 2 status transition(s)` (`ev/30`) | with a 2 s sweep: `activated` frame + stored ACTIVE + audit `SCHEDULED -> ACTIVE`; `expired` frame + stored EXPIRED by actor `sweeper` |
| F-23 | PASS | A-23a–d | cross-tenant, `publisher`, `from`/`to`, status set, history included |
| F-24 | PASS | A-24a–c (`ev/20b`) | field is `counts` (not `byStatus` as I first assumed); totals and per-status counts equal the publisher listing; sorted by tenant |
| F-25 | PASS | A-25 | admin retire → RETIRED with admin actor and a `retired` frame |
| F-26 | PASS | A-26 | 204, then 404 on GET and on a second DELETE |
| F-27 | PASS | A-27a–k; unit `ClientIdWebFilterTest` | 401 JSON without id, 400 on `bad id!` and 101 chars, `?clientId=` accepted on GET and stream, stream without any id 401, OPTIONS exempt, `/v3/api-docs` and Swagger exempt, admin and health routes enforced |
| F-28 | PASS (note) | A-28a–i | invalid enum (query and body), malformed JSON, bad date, bad page → 400 `{error}` with no stack trace; unknown route → 404 JSON; PATCH → 405/404 JSON; unknown JSON field ignored. Note GAP-9 (413 message) |
| F-29 | PASS | A-29a–c; IT `openApiSpecIsServed` | all 16 `/v1` paths present, `apiKey` scheme on `X-Client-Id` applied globally, Swagger UI served |
| F-30 | N/A → gap | A-30 | `/actuator/health` 404, no Actuator dependency, no Dockerfile/manifests (`ls`). Scored in resilience & ops as GAP-3, not in the feature ratio |
| F-31 | PASS | B-31a–f | 201 + Location, defaults exactly as `application.yml`, 409 duplicate (tenant, service), 400 for `not a url` / `ftp://`, overrides and push-only when `url` absent |
| F-32 | PASS | B-32 ×11 | each out-of-range policy value → 400 naming the field; missing tenant/service → 400 |
| F-33 | PASS | B-33a–d | list all / by tenant with state, get one, unknown 404 |
| F-34 | PASS | B-34a/b | probe-now updates `lastProbeAt`/streak; push-only → 409 |
| F-35 | PASS | B-35a/b | 204, notice retired with `monitor deleted`, `retired` frame, second delete 404 |
| F-36 | PASS | B-36a–d | first push auto-registers push-only with the report's publisher, 202 + monitor; missing status/tenant/service → 400 |
| F-37 | PASS | B-37a–f, B-34a | document wins over HTTP status (503+DOWN → DOWN with components), plain 200 → UP, plain 500 → DOWN, closed port → DOWN `probe failed`, 200 ms timeout → DOWN in 1.6 s |
| F-38 | PASS (note) | B-38 ×9, B-38a/b, B-37e | OK/HEALTHY → UP, OUT_OF_SERVICE/FATAL/UNHEALTHY → DOWN, WARN/WEIRD → DEGRADED, UNKNOWN leaves streaks untouched, blank → 400 by bean validation (API contract), UP-with-DOWN-component → DEGRADED, composite `db.primary` flattened. Note GAP-10: a top-level legacy `details` map on a **push** report is ignored (B-38c) |
| F-39 | PASS | B-39a–d, B-41c | 2nd DOWN opens, 1st UP keeps open, 2nd UP retires with `recovered: UP`; DOWN→DEGRADED restarts the streak |
| F-40 | PASS | B-40a–c | OUTAGE/MAJOR, `<service> is down`, affectedServices, publisher, audience, `externalRef=health:<id>:1`, body with probe url, component and error text; push notice body carries the message and "reported by" |
| **F-41** | **FAIL (partial)** | B-41a–d PASS; B-41e/f FAIL | updates in place with `updated` frame, kind change retires (`reclassified as DEGRADED`) and opens HEALTH/MINOR with incident #3 — but after an operator retires the notice by hand the monitor keeps it as open and keeps counting (streak 3, same `openCommunicationId`); no new notice after the threshold. GAP-2 |
| F-42 | PASS | unit `openClaimsTheMonitorBeforePublishingAnOutage`, `lostClaimRacePublishesNothing`, `publishFailureReleasesTheClaim`; IT `MongoHealthMonitorRepositoryAdapterIT.staleVersionIsConflict`; live: `ev/31` shows the second instance skipping on `409 CONFLICT … modified concurrently` | not reproducible as a race over HTTP; verified by tests plus the observed multi-instance conflict handling |
| F-43 | PASS | C-43, C-43b | with a 1 s health sweep and `intervalSeconds=5` a DOWN stub opens a notice in 13 s without `/probe`; a closed-port monitor opens its own notice while the other keeps being probed |
| F-44 | PASS | C-44a/b | push-only `staleAfterSeconds=5`, silent 9 s → DOWN `no health report received since …`, OUTAGE in the feed; one UP report → `recovered: UP` |
| F-45 | PASS | C-45a/b; WARN `2 of 4 push-only monitors are silent at once; not declaring them DOWN …` (`ev/30`); unit `silenceIsNotTrustedDuringTheStartupGrace` | 2 of 4 silent → nothing declared; 1 of 4 silent → declared. Startup grace only by unit test (I ran with grace 0) |
| F-46 | PASS | B-46a–c | upsert by pod, ordered by id, all fields incl. `sidecar`, `left`, `lastSeenAt`; unknown monitor 404 |
| F-47 | PASS | B-47a–h | 4/5 UP → UP `4 of 5 pods UP (DOWN: pod-e)`; 2/5 → DEGRADED; UP pod with failing component → DEGRADED; all DOWN → DOWN `0 of 5`; UNKNOWN pod `(1 starting)` not tallied; none UP + one DEGRADED → DEGRADED; `minHealthyPercent=100` at 4/5 → DEGRADED. Reading confirmed in `HealthRollup.java:55-66`: "failing dependency" means a pod that is UP with a DOWN component (a DOWN pod naming components is just DOWN) |
| F-48 | PASS | B-48a/b, C3-48a–c (`ev/24`) | `leaving:true` → `left=true` and dropped from the count at once, comes back on the next report; one pod left + one silent → OUTAGE naming `pod-b`; all left → `UNKNOWN (no live pod reports)` and no notice; silent pod returns → notice retired |
| F-49 | PASS | B-49a, B-47h | auto-registered instance monitor gets `staleAfterSeconds=90`; explicit 20 kept |
| F-50 | PASS (note) | B-50, B-50b | 20 parallel first-contact reports → one monitor, 20 instance records, 202/409 mix; persistent conflict → 409 as documented. Note GAP-6: 12–14 of 20 collided three times in a row |
| F-51 | PASS | `ev/10` | `communications`: `feed_idx`, `sweep_expiry_idx`, `sweep_activation_idx`, `affectedServices`, unique partial `external_ref_idx`; `communication_events`: `events_tenant_seq_idx`, `events_ttl_idx` 86400; `health_monitors`: unique `monitor_tenant_service_idx`; `health_instances`: `instance_monitor_idx`, `instance_ttl_idx` 86400; `counters` doc present |
| F-56 (BE side) | PASS | A-01a | `POST /v1/communications` contract the form relies on |
| F-57 (BE side) | PASS | A-07, A-08, A-28 | every rejection is `{"error": text}` the UI can show |
| F-58 (BE side) | PASS | A-14a–m | `size=100` honoured, filters as the UI sends them |
| F-60 (BE side) | PASS | A-18a–d, A-27e | frames and `?clientId=` |
| **F-61 (BE side)** | **FAIL** | A-20a | the browser's automatic reconnect sends `Last-Event-ID` and gets 500; per the EventSource specification a non-200 response fails the connection permanently, so the UI loses live updates after any drop until reload. Same root cause as F-20 |
| F-62 (BE side) | PASS | A-06a–c | retire with note/actor, idempotent |
| F-64 (BE side) | PASS | A-27d/e | header and `?clientId=` both accepted |
| F-70 (BE side) | PASS | B-38 (WARN), B-38b | WARN → DEGRADED |
| F-72 (BE side) | PASS | B-38 (UNKNOWN), B-47e | UNKNOWN carries no information; `starting` pods not tallied |
| F-74 (BE side) | PASS | B-50 | 409 is what a concurrent report gets, the sidecar's retryable class |
| F-75 | PASS | B-46a, B-75a–c, B-36a | instance fields round-trip, `id` 253 ok / 254 → 400, instance without id → 400 |
| F-76 (BE side) | PASS | B-48a | `leaving:true` marks the record left immediately |
| F-88 (BE side) | PASS | C3-48a, B-47e | silence → DOWN naming the pod; UNKNOWN during startup opens nothing |
| F-89 (BE side) | PASS (note) | `ev/30`, `ev/31` | INFO `opened OUTAGE … for <tenant>/<service>`, INFO `retired notice …: recovered/monitor deleted`, WARN staleness pause, WARN `skipping monitor … 409 CONFLICT`, INFO `rejected GET /v1/feed with 401: …`, INFO `sweep applied N status transition(s)`. Note GAP-7: the client id itself is only at DEBUG (`ClientIdWebFilter.java:72`) |

Totals: 65 rows owned; 64 scored (F-30 excluded as a non-feature); **61 PASS, 3 FAIL** (F-20, F-41, F-61).

## 4. Gaps

| Gap | Severity | Feature | Root cause | Reproduced by | Suggested fix | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-backend-1 | **blocker** | F-20, F-61, F-21 (cross-node resume) | `CommunicationEventMongoRepository.java:15` declares the derived query `findByTenantIdAndSeqGreaterThanAndSeqLessThanEqualOrderBySeqAsc`; Spring Data MongoDB cannot put two criteria on one field in a derived query and throws `… can't add a second 'seq' expression …` when `MongoCommunicationEventsAdapter.streamAfter` (`MongoCommunicationEventsAdapter.java:144-147`) calls it; `GlobalExceptionHandler.handleGeneric` turns it into 500 | A-20a/A-20c (`ev/20`), C-21d (`ev/22`), IT failure ×3 (`ev/03-E2EIT-run1-failure.txt`) | replace the derived method with `@Query("{ 'tenantId': ?0, 'seq': { '$gt': ?1, '$lte': ?2 } }")` + `Sort` (or a `Criteria` in the adapter) | the existing IT catches it (it had never been run); `MongoCommunicationEventsAdapterTest` uses a fake repository so the query was never parsed — an `@DataMongoTest` for `CommunicationEventMongoRepository` would catch it on first call |
| GAP-backend-2 | major | F-41 | `HealthObservationUseCase.observe` (`:58-67`) only re-reads the open notice in `update()` (signature change, `:98-106`); a `NONE` transition saves the monitor unchanged, so a notice retired by an operator stays "open" in the monitor state while the failing set is unchanged; `HealthMonitor.withClosedByOperator()` (`HealthMonitor.java:195-200`) is only reachable from `update()`. README promises "the monitor respects it and starts counting again" | B-41e/B-41f (`ev/21`): after a manual retire, two more DEGRADED probes → streak 3, same `openCommunicationId`, no new notice | while `state.hasOpen()`, check `publishing.get(openId)` for a terminal status on every observation (or at least on each one that would otherwise be NONE), or have the retire path clear monitors that point at the communication | `HealthObservationUseCaseTest`: "a notice retired by hand while the same failure persists is cleared and re-opened after failureThreshold"; `HealthMonitoringE2EIT` variant |
| GAP-backend-3 | major | F-30 (rubric: health endpoints, probes) | no `spring-boot-starter-actuator`, no `/actuator/health`, no liveness/readiness groups, no Dockerfile or deployment manifests for the backend (`build.gradle.kts:22-37`, repo tree) | A-30 → 404 | add Actuator with `management.endpoint.health.probes.enabled=true` and the Mongo indicator, expose only `health` (outside `/v1`, so no client id needed); add the missing deploy artefacts or document who owns them | IT asserting `/actuator/health/readiness` 200 (and 503 with Mongo unreachable) |
| GAP-backend-4 | major | builds & static checks | `build.gradle.kts` pins Spring Boot 3.4.1 (Dec 2024): Netty 4.1.116 (CVE-2025-24970, CVE-2025-55163, CVE-2025-58056 rated HIGH by NVD; CVE-2025-58057 medium), Spring Framework 6.2.1 (CVE-2025-41234 medium, CVE-2025-22233 low), logback 1.5.12 (CVE-2024-12798/12801), swagger-ui 5.18.3 (DOMPurify CVE-2025-26791). No scanner, no linter in the build | `ev/04-*`, `ev/07-dependency-cve-review.txt` (knowledge-based; OSV/NVD unreachable here) | bump to the current Boot 3.4.x/3.5.x patch; add OWASP dependency-check or CycloneDX + scanner and a linter to the build/CI | CI gate (none exists; no `.github/workflows`) |
| GAP-backend-5 | minor | F-06, F-13 | `PublishingUseCase.retire` (`:127-144`) and update switch on the **stored** status; an item past `expiresAt` but not yet swept is still `ACTIVE` in store, so retire returns 200 and rewrites history that the 409 message says must not be rewritten; the feed already reports it EXPIRED | A-13c vs A-15a (`ev/20`), C-13a (`ev/22`) | use `Communication.effectiveStatus(now)` (`Communication.java:137-149`) in retire/update | `PublishingUseCaseTest`: retire/update after `expiresAt` but before the sweep → 409 |
| GAP-backend-6 | minor | F-50 | `HealthMonitorUseCase.java:92-96` retries a conflicting report `REPORT_ATTEMPTS-1 = 2` times immediately (`Retry.max`, no backoff/jitter), so a burst of pods collides again; 12–14 of 20 simultaneous reports end in 409. Instance records are still written (20/20) and the sidecar retries, so nothing is lost, but each 409 costs a sidecar backoff | B-50, B-50b (`ev/21`) | `Retry.backoff(2, 50ms).jitter(0.5)`, or serialize the rollup per monitor | unit test with N concurrent reports expecting ≤ 1 final 409 |
| GAP-backend-7 | minor | F-27, F-89 | README "The id is logged with each request" — `ClientIdWebFilter.java:72` logs at DEBUG; default level is INFO; only rejections are logged at INFO. There is no request/access log | `ev/30` (shared backend log: 18 `rejected` lines, 0 accepted-request lines after thousands of calls) | log at INFO, or add the id to the audit `actor`/MDC and fix the README | n/a (documentation + logging) |
| GAP-backend-8 | minor | config | `communication.feed.default-page-size`, `max-page-size`, `communication.limits.title-max`, `body-max-bytes` in `application.yml` are never read (`grep` of `src/main/java` finds no reader; `Page.java:8` `MAX_SIZE=100`, `Communication.java:33-34` constants) | code grep | bind them (`@ConfigurationProperties`) or delete them and the README text that implies they work | n/a |
| GAP-backend-9 | minor | F-28 | a body above WebFlux's 256 KB codec limit → 413 with `{"error":"unexpected error"}` (`DataBufferLimitException` has no message; `GlobalExceptionHandler.safe()`); 20 KB → proper 400 | §2 command 17 | map `DataBufferLimitException` to a message naming the limit | `RestControllerPublishingAdapterTest` (`@WebFluxTest`) with an oversized body |
| GAP-backend-10 | minor (doc) | F-38, F-36 | `HealthReportCommand.java:19-30` binds `components` only; a Spring Boot 2.0/2.1-style document with a top-level `details` map pushed as-is is read as plain UP, while the probe path (`ActuatorComponent.fromTree`, `:39`) understands it | B-38c (`ev/21`) | accept `details` on the push command through `fromTree`, or state "components only" in the README | `RestControllerHealthAdapterTest` with the legacy shape |

Observations that are not gaps: snapshot + `created` overlap for items created within one poll interval of subscribing (A-18b; by design, `FeedUseCase.java:86-90`); blank `status` on a report is rejected with 400 rather than treated as UNKNOWN (B-38; a reasonable API contract); multi-instance sweeps skip each other's conflicts with a WARN (`ev/31`).

## 5. Not exercised here, and why

- Dependency/security scan: `api.osv.dev` and the NVD mirrors answer CONNECT 403 through the sandbox proxy; no Trivy/Grype. Only a knowledge-based review was possible (`ev/07`).
- TTL expiry actually removing `communication_events`/`health_instances` after 24 h and the `collMod` on a retention change: index parameters verified (`ev/10`, C-21e), expiry itself not waited for; `collMod` is covered only by `MongoCommunicationEventsAdapterTest` (fake repository).
- Startup staleness grace (300 s): verified by unit test only (`silenceIsNotTrustedDuringTheStartupGrace`); my instances ran with `stale-grace-after-start-ms=0` to make the other staleness rules observable.
- Notice-claim race (F-42) as a real race over HTTP: not reproducible deterministically; relied on the three unit tests, the repository IT and the observed cross-instance 409 skips.
- Backend behind a real OpenShift Route / HAProxy (relevant to CVE-2025-58056) and backend probes: no cluster, and nothing to probe (GAP-3).
- Environment incident: my first private instance on :18090 (db `be-verify`) was terminated by an external SIGTERM at 23:45:20 (log shows `Commencing graceful shutdown`), and monitors from tenant `sc-silent` (the sidecar verifier) appeared in that database — another verifier reused the port/database example from the brief. That aborted check set C once (`ev/22` stops after 9 checks) and made the staleness safety valve pause during the first C2 run (`ev/23a`: `3 of 3 push-only monitors are silent at once`). Reruns on private databases `be-verify-bv2`/`bv3` (`ev/23`, `ev/24`) are the ones scored. The shared stack on :8080 was never touched by me. Other verifiers' instances were listening on 18081, 18082, 18092, 18093 and 18416 when I finished; mine (18090/18091/28090/28091) and my stub on 18555 are stopped.
