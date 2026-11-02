# Backend Verifier report — iteration 1 (2026-11-02)

Verifier: independent grader for iteration 1 (did not write any production or test code; a different verifier
instance from iteration 0). Code under test: branch `confidence-loop/2026-11-01` at `0e14838` (origin/main `191a0c5`
plus the 28 iteration-1 commits). Scope: every Feature Matrix row whose services include `BE`, except F-90/F-91/F-92
(E2E verifier); for rows shared with the frontend or sidecar only the backend side is graded. Evidence files are under
`confidence/evidence/iter-1/backend/` (referenced as `ev/…`); check ids (A-…, B-…, C-…, C3-…, D-…) are the rows of the
tables inside those files, which end with the full request/response transcripts. The HTTP checks ran against the shared
backend on :8080 (iteration-1 jar, tenants `be1-*`) and against private instances started from the same jar on
:18900–:18903 and :18908–:18912 (all stopped again; the shared stack was never touched). `git status` shows only new
files under `confidence/`.

## 1. Verdict and scores

**Backend confidence: 87 / 100 (iteration 0: 72 claimed, 68 audited → +19). Hard gates tripped: none.**

| Category | Weight | Score | Why (evidence) |
|---|---|---|---|
| Builds & static checks | 10 | 7 | `clean compileJava compileTestJava`, `bootJar` and the new `cyclonedxBom` succeed (`ev/01`, `ev/05`, `ev/04-cyclonedx.txt`); the compiler prints four `[removal]` warnings for `IndexOperations.ensureIndex` (`ev/01b`, GAP-5). The build still has no linter or static-analysis gate; SpotBugs 4.9.3 run by the verifier from a scratch project finds 50 low/medium findings and nothing of priority 1 or in the CORRECTNESS category (`ev/08`, GAP-7). Dependency scan: every online source is still blocked (`ev/07-ghsa-scan.txt`); the version comparison shows every advisory named in iteration 0 closed by the resolved versions (Netty 4.1.135, Spring 6.2.19, Boot 3.5.16, logback 1.5.34, swagger-ui 5.32.2; `ev/04-resolved-versions.txt`, `ev/07-dependency-cve-review.txt`) and the SBOM exists for a scanner that nothing runs yet (GAP-8). Awarded: clean build 3/3, static analysis 2/3 (verifier-run only), dependencies 2/4 (closed by version, no scan). |
| Feature completeness | 30 | 30 | 65 of 65 owned rows verified PASS (section 3), including the three that failed in iteration 0 (F-20, F-41, F-61) and F-30, which now exists. 65/65 × 30. |
| Automated test health | 20 | 17 | Unit: 188/188 in 3 consecutive `--rerun-tasks` runs; integration: 39/39 in 3 runs (`ev/02-*`, `ev/03-*`; was 164 + 26 with one deterministic failure). 0 skipped, no `@Disabled`/assumptions, no flakes in 6 runs. Test code grew from 190 to 227 `@Test` methods; the diff of `src/test` removes no test, assertion or verification line (`ev/06-test-integrity.txt`), and the ten regression tests named in `iter-1/fixes.md` are present and green in the JUnit XML (`ev/02b`). Deductions: still no coverage tooling for the backend, so "new and changed code is covered" is shown only by the named tests, not measured; two of the deprecation warnings are in ITs. |
| Integration & contracts | 20 | 18 | 400+ HTTP contract checks: publishing/feed/admin/client-id/errors/OpenAPI 110/113 (`ev/20`; the 3 FAILs are script artefacts re-verified in `ev/20b` 3/3 and `ev/20c` 2/2, and an inverted expectation for the now-existing `/actuator/health`), health 78/80 (`ev/21`; B-41e/f = GAP-3 semantics, feature verified by D-5), gap re-checks 41/42 (`ev/22`; D-6-c re-run clean in `ev/22b` 3/3), two-instance fan-out/sweeper/scheduler/staleness 18/19 (`ev/25`; C-48a re-run clean in `ev/25c` 3/3), `ev/25b` 2/3 (C-44a explained by `ev/25d`), README cookbook verbatim (`ev/23`), OpenAPI (`ev/24`). Every browser/sidecar contract holds: `Last-Event-ID` and `?lastEventId=` replay (D-1), `:connected` within 5 ms (D-4), error bodies name field/values/limit/verb/media type (D-21), 20 simultaneous pod reports → 20 × 202 (D-7). Deductions: a Mongo timeout surfaces the driver's raw cluster description in `{"error": …}` (`ev/28`, GAP-1); a forced probe racing the scheduler can answer 409 (`ev/23`, GAP-4). |
| Resilience & ops | 10 | 7 | Verified: liveness/readiness groups (D-8), readiness 503 while Mongo is down and 200 within 3 s of its return (`ev/27`), SIGTERM with two open SSE streams → streams end within 19 ms, "Graceful shutdown complete", process gone after 5.4 s (`ev/26`; was 30 s), an SSE stream opened before a 60 s Mongo outage stays up on keepalives and delivers the first notice published after recovery (`ev/28`), staleness valve pauses/resumes with one WARN/INFO each (`ev/22b`, `ev/25`), scaled-to-zero ignored (`ev/22b`), optimistic-lock conflicts skipped across instances, INFO access log per request (`ev/30`). Deductions: readiness and every API call block for the driver's default 30 s before answering 503/500 when Mongo is unreachable (GAP-1); each scheduled sweep logs an ERROR with a full stack trace during such an outage (GAP-6); the valve can stay paused indefinitely behind abandoned monitors (GAP-2). |
| Usability | 10 | 8 (provisional) | API-level only, deferring to the Usability Reviewer (in iteration 0 the auditor replaced this category with the reviewer's API score; with reviewer score U the total here is 79 + U/10). Better than iteration 0: every rejection names the field, the allowed values, the limit, the allowed verbs or the media types (D-21), the README cookbook runs as written (`ev/23`), Swagger documents the 401 and the `X-Client-Id` scheme (`ev/24`), `expectedVersion` and monitor ids are explained. Deductions: raw driver text on a Mongo timeout (GAP-1), the "threshold + 1" re-open rule is undocumented (GAP-3), a 409 "modified concurrently" on a forced probe reads as the caller's fault (GAP-4). |
| **Weighted total** | | **87** | no cap applies |

Hard gates:
- Any matrix item fails E2E: **no** (65/65 PASS).
- Test skipped/deleted/loosened without justification: **no** — `ev/06-test-integrity.txt`: 16 test files changed (+865/−14 lines), no removed `@Test`/assertion/verification lines, no skip markers; the touched existing tests listed in `iter-1/fixes.md` keep their assertions.
- Sidecar non-root / restricted-v2: not this verifier's area.
- Critical/high security finding open: **not tripped on the evidence available** — every advisory counted open in iteration 0 is closed by version (`ev/07-dependency-cve-review.txt`); no scanner could run (OSV, deps.dev, OSS Index unreachable; GitHub Advisory DB refused by the repository-bound token, `ev/07-ghsa-scan.txt`), so the residual risk is "unscanned", not "known open".

## 2. Commands run

| # | Command | Exit | Evidence |
|---|---|---|---|
| 1 | `./gradlew --max-workers=2 --no-daemon clean compileJava compileTestJava` | 0 | `ev/01-gradle-build.txt`, `ev/01b-deprecation-warnings.txt` (4 `[removal]`) |
| 2 | `./gradlew … test --rerun-tasks` ×3 | 0, 0, 0 | `ev/02-gradle-test-run1..3.txt` + `-counts.txt` (20 classes, 188 tests, 0 failures/errors/skipped each; 57 s / 32 s / 24 s) |
| 3 | `./gradlew … integrationTest --rerun-tasks` ×3 (seeded mongod 7.0.45, tests unchanged) | 0, 0, 0 | `ev/03-gradle-integrationTest-run1..3.txt` + `-counts.txt` (8 classes, 39 tests, 0 failures each) |
| 4 | `./gradlew … dependencies --configuration runtimeClasspath` | 0 | `ev/04-gradle-dependencies-full.txt`, `ev/04-resolved-versions.txt` |
| 5 | `./gradlew … cyclonedxBom` | 0 | `ev/04-cyclonedx.txt` (`build/reports/cyclonedx/bom.json`, 135 purls) |
| 6 | `./gradlew … bootJar` | 0 | `ev/05-gradle-bootJar.txt` (39.1 MB) |
| 7 | `git diff origin/main..HEAD -- src/test`, `@Test` counts, skip-marker grep | 0 | `ev/06-test-integrity.txt` |
| 8 | SBOM scan attempts: `gh api /advisories` (403 repository-bound), `api.osv.dev`, `api.deps.dev`, `ossindex.sonatype.org` (all unreachable) + version comparison | blocked | `ev/07-ghsa-scan.txt`, `ev/07-dependency-cve-review.txt` |
| 9 | SpotBugs 4.9.3 `-effort:max -low` on `build/classes/java/main`, auxclasspath = the jar's `BOOT-INF/lib` (scratch Gradle project, repository build untouched) | 0 | `ev/08-spotbugs.txt` (50 findings: 42 P2, 8 P3; 41 EI_EXPOSE_REP*) |
| 10 | regression tests from `iter-1/fixes.md` looked up in the JUnit XML of runs 2–3 | 0 | `ev/02b-regression-tests-present.txt` (10/10 present, 0 failures) |
| 11 | `docker exec mongo7 mongosh … getIndexes()` for the four collections + counters | 0 | `ev/10-mongo-indexes.txt` |
| 12 | `python3 -I runner.py check_a_publishing_feed_admin.py` (113 checks, shared :8080, tenants `be1-a-*`, `be1-feed-*`, `be1-sse-*`) | 0 | `ev/20-http-publishing-feed-admin.txt` (110/113) |
| 13 | `check_a2_tenants.py` (tenant summary with the real field name) | 0 | `ev/20b-http-admin-tenants.txt` (3/3) |
| 14 | `check_a23.py` (admin publisher filter with the iteration-1 publisher name) | 0 | `ev/20c-http-admin-publisher-filter.txt` (2/2) |
| 15 | `check_b_health.py` (80 checks, :8080 + stub Actuator on :18905) | 0 | `ev/21-http-health.txt` (78/80) |
| 16 | `check_d_gaps.py` (42 checks re-verifying G-1-1/4/5/6/7/8/20/21/24 on :8080 and the private :18902) | 0 | `ev/22-http-gap-rechecks.txt` (41/42) |
| 17 | `check_d2_valve.py` (G-1-6 scaled-to-zero scenario on a fresh database, private :18908, health sweep 1 s, stale grace 0) | 0 | `ev/22b-valve-fresh-db.txt` (3/3) |
| 18 | README cookbook, every command verbatim except the port (private :18903); then 5 + 10 forced probes | 0 | `ev/23-readme-cookbook-run.txt`, `ev/23b-probe-now-race.txt` (15/15 → 200) |
| 19 | OpenAPI document and Swagger UI checks (`/v3/api-docs`, `/swagger-ui.html`) | 0 | `ev/24-openapi-contract.txt` |
| 20 | `check_c_private.py` (two instances :18900/:18901 on db `be1-verify`, sweep 2 s, health sweep 1 s, stale grace 0) | 0 | `ev/25-http-private-pair-18900-18901.txt` (18/19 + addendum) |
| 21 | `check_c2_private.py` (private :18902, db `be1-verify-bv2`) | 0 | `ev/25b-http-private-pair-18902-18901.txt` (2/3) |
| 22 | `check_c3_pods.py` (private :18903, fresh db `be1-verify-bv3`) | 0 | `ev/25c-http-pods-18903.txt` (3/3) |
| 23 | `GET /v1/health/monitors` on :18902 to explain C-44a | 0 | `ev/25d-valve-state-18902.txt` |
| 24 | SIGTERM to a private instance (:18910) with two open `/v1/feed/stream` connections | 0 | `ev/26-sigterm-open-streams.txt` |
| 25 | readiness while its own Mongo container is stopped and after restart (:18911, `be1-mongo2`) | 0 | `ev/27-readiness-mongo-down.txt` |
| 26 | `GET /v1/feed`, `POST /v1/communications` and an already-open stream during a 60 s Mongo stop (:18912, `be1-mongo3`) | 0 | `ev/28-api-and-stream-mongo-down.txt` |
| 27 | log review of the shared backend (access log, level counts, WARN/ERROR) | 0 | `ev/30-backend-logging.txt` |

Check scripts (`lib.py`, `runner.py`, `check_*.py`, `stub_actuator.py`, `cookbook-*.sh`) live in the scratchpad
`…/scratchpad/backend1/`; they are the iteration-0 scripts with the `be1-` prefix, new ports and the new `check_d*`
files. Numbers in the tables: iteration 0 ran 309 backend checks, iteration 1 ran 440.

## 3. Feature verdicts

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | ev/20 A-01a–d; IT `publishFeedStreamRetireRoundTrip` | 201 + `Location`, ACTIVE/SCHEDULED by `startsAt`, audience default, `created` frame live |
| F-02 | PASS | A-02a–e | draft invisible (feed and permalink 404), publish → ACTIVE, second publish 409 |
| F-03 | PASS | A-03a/b | history present; unknown id → 404 `{error}` |
| F-04 | PASS | A-04a–c | any status, `status=` filter, paging fields |
| F-05 | PASS | A-05a–d; ev/22 D-20-c | partial update, version+1, 409 stale, 400 missing `expectedVersion`, 409 on RETIRED and now on a time-expired item |
| F-06 | PASS | A-06a–c; ev/25 C-13a; ev/22 D-20-b/d | retire + audit note, idempotent, actor default; retire after `expiresAt` but before the sweep → 409 and history untouched (G-1-20 closed; iteration-0 note gone) |
| F-07 | PASS | ev/20 A-07 group (11); ev/22 D-21-a/b/h/i | every invalid body → 400 naming the field, now with the allowed values / expected shape (G-1-21) |
| F-08 | PASS | A-08; IT `duplicateExternalRefWithinTenantIsConflict` | 201 / 409 / 201 in another tenant |
| F-09 | PASS | A-09a–h; IT `ticketContracts` | normalisation, defaults, 400 bad number/ftp url, 409 same ticket, PUT attaches with audit, feed carries ticket |
| F-10 | PASS | A-10, A-10b | `expiresAt` ← `endsAt`; `startsAt` ← now |
| F-11 | PASS | A-11a–c; D-20-d | ordered entries, cap 50, actor fallback; a refused retire writes nothing |
| F-12 | PASS | A-12; IT `staleVersionIsConflict` | 8 parallel PUTs, one `expectedVersion`: 1 × 200, 7 × 409 |
| F-13 | PASS | A-13a–c, ev/25 C-13a/b, A-05d; D-20-a–c | DRAFT/SCHEDULED → RETIRED; stored EXPIRED and time-expired both block retire/update with 409 |
| F-14 | PASS | A-14a–l (+a2); D-21-h | all filters, severity ordering, size cap 100, bad page/size/tenant → 400, `type=BOGUS` names the allowed values |
| F-15 | PASS | A-15a/b; D-20-a | EXPIRED on read before the sweep; `activeAt` honoured |
| F-16 | PASS | A-16a/b | upcoming MAINTENANCE shown, future OUTAGE hidden, `includeUpcoming=false` |
| F-17 | PASS | A-17a/b, ev/25 C-17, A-02c | retired/expired permalinks 200; draft/unknown 404 |
| F-18 | PASS | A-18a–c/e; ev/22 D-4-s/D-4-p | `:connected` comment and headers after 5 ms (shared) / 48 ms (private), then snapshot, `created/updated/retired` in order, monotonic ids, keepalive ≤ 17 s (G-1-4 closed: was 15 s on an empty tenant). Snapshot + `created` overlap for an item created within one poll interval of subscribing is unchanged and by design (`FeedUseCase`) |
| F-19 | PASS | A-19 | `service=` isolation both ways |
| F-20 | PASS | A-20a–e; ev/22 D-1-a–e; ev/25 C-21d; IT `reconnectingWithLastEventIdReplaysWhatWasMissed` ×3 | `Last-Event-ID` header and `?lastEventId=` → 200 with exactly the missed frames in order, then live; future id → snapshot; non-numeric header ignored; cross-node resume works (G-1-1 closed, was 500) |
| F-21 | PASS | ev/25 C-21a–e | publish on :18900 → `created` on :18901 within the window and the reverse, global monotonic ids, `events_ttl_idx` 86400 s, cross-node resume |
| F-22 | PASS | ev/25 C-22a/b | 2 s sweep: `activated` frame + stored ACTIVE + audit `SCHEDULED -> ACTIVE`; `expired` frame + stored EXPIRED by `sweeper` |
| F-23 | PASS | A-23a/c/d; ev/20c (2/2) | cross-tenant, `publisher`, `from`/`to`, status set, history. The A-23b FAIL in ev/20 used the iteration-0 publisher name in its URL (script artefact), re-run in ev/20c |
| F-24 | PASS | ev/20b (3/3) | per-tenant `counts` + `total` equal the publisher listing; the A-24 FAIL in ev/20 compared the wrong field name (the printed data are identical) |
| F-25 | PASS | A-25 | admin retire with admin actor + `retired` frame |
| F-26 | PASS | A-26 | 204, then 404 on GET and second DELETE |
| F-27 | PASS | A-27a–k; D-4-c; D-8-health/liveness/readiness; unit `ClientIdWebFilterTest` (+2); ev/30 | 401/400 contracts, `?clientId=` on GET and stream, OPTIONS/docs exempt, admin and health routes enforced; Actuator reachable without an id and nothing else exposed; every identified request now logged at INFO `client=<id> <verb> <path> -> <status> (<ms>)` (G-1-22 closed) |
| F-28 | PASS | A-28a–i; D-21-a–i | malformed JSON (line/column), bad enum/date/page → 400 with the rule; unknown path → 404 naming the path and Swagger; wrong verb → 405 with `Allow`; 300 KB → 413 naming the 256 KB limit and property; text/plain → 415 naming the accepted types (G-1-21 closed) |
| F-29 | PASS | A-29a–c; ev/24; IT `openApiSpecIsServed`, `OpenApiContractIT` (2) | 16 paths / 20 operations, `apiKey` scheme `X-Client-Id` with a description, global security, 401 documented on 20/20 operations, Swagger UI 302 → 200 |
| F-30 | PASS (note) | D-8-health/liveness/readiness/h, D-8-xenv/xbean/xconf/xlogg; ev/27; IT `OperationsEndpointsIT` (5) | `/actuator/health` with groups `liveness`, `readiness` (readiness includes Mongo, details hidden), only `health` exposed; readiness → 503 while Mongo is stopped and 200 within 3 s of its return. Note GAP-1: the 503 arrives after 30 s. The matrix text ("there is NO Actuator") is outdated and should be rewritten; no backend Dockerfile/manifests still (declared out of scope by Gonzalo) |
| F-31 | PASS | ev/21 B-31a/c–f | 201 + `Location`, defaults as `application.yml`, 409 duplicate, 400 bad urls, push-only without `url` |
| F-32 | PASS | B-32 group (11) | each out-of-range policy value and missing tenant/service → 400 naming the field |
| F-33 | PASS | B-33a–d | list all / by tenant, get one, unknown 404 |
| F-34 | PASS (note) | B-34a/b; ev/23b (15/15 → 200) | probe-now updates `lastProbeAt`/streak; push-only → 409. Note GAP-4: one forced probe in the cookbook run lost a race against the scheduler (409) |
| F-35 | PASS | B-35a/b | 204, notice retired with `monitor deleted` + `retired` frame, second delete 404 |
| F-36 | PASS | B-36a–d; D-24-a/b | first push auto-registers push-only, 202 + monitor; missing fields → 400; a legacy top-level `details` map is now read (G-1-24 closed) |
| F-37 | PASS | B-37a–e, B-34a | document wins over HTTP status, plain 200/500, closed port, 200 ms timeout → DOWN in < 2.5 s |
| F-38 | PASS | B-38 group (9), B-38a/b; D-24-a/b | status vocabulary, composite flattening, UP-with-DOWN-component → DEGRADED, `details` accepted and `components` win over `details` |
| F-39 | PASS | B-39a–d; D-5-a | 2nd DOWN opens, 1st UP keeps, 2nd UP retires `recovered: UP`; DOWN→DEGRADED restarts the streak |
| F-40 | PASS | B-40a/b; D-5-d | OUTAGE/MAJOR, title/body/affectedServices/publisher/audience, `externalRef=health:<id>:<incident>` (second incident → `:2`) |
| F-41 | PASS (note) | B-41a–d; ev/22 D-5-b/c/d; IT `anOperatorRetiringTheAutoNoticeMakesTheMonitorCountAgain` | updates in place, kind change retires + re-opens; after an operator retires the notice the monitor notices it on the next observation (`notice … closed externally; counting again`) and opens incident #2 after the threshold (G-1-5 closed). Note GAP-3: B-41e/f show the re-open needs `failureThreshold + 1` failing observations after the retire, because the noticing observation resets the streak to 0 |
| F-42 | PASS | unit `openClaimsTheMonitorBeforePublishingAnOutage`, `lostClaimRacePublishesNothing`, `publishFailureReleasesTheClaim` (ev/02 XML); IT `MongoHealthMonitorRepositoryAdapterIT.staleVersionIsConflict`; ev/25 cross-instance 409 skips | not reproducible as a race over HTTP; tests + observed multi-instance conflict handling |
| F-43 | PASS | ev/25 C-43/C-43b; ev/25b C-43/C-43b | DOWN stub opens a notice in 13 s without `/probe`; a closed-port monitor opens its own while the other keeps being probed |
| F-44 | PASS | ev/25 C-44a/b; ev/22 D-6-a/b; ev/22b (`silent is down`); ev/25c C3-48a | push-only `staleAfterSeconds=5`, silent 9 s → DOWN `no health report received since …`, OUTAGE in the feed, one UP report → `recovered: UP`. The C-44a FAIL in ev/25b is not the feature: that instance's valve had been paused since 01:34:44 by the monitors my own D-6 scenario left silent in the same database (ev/25d: 14 of 14 stale-capable monitors silent) — see GAP-2 |
| F-45 | PASS (note) | ev/25 C-45a/b; ev/22 D-6-d; ev/22b D-6-d; WARN/INFO lines in ev/25 addendum; unit `silenceIsNotTrustedDuringTheStartupGrace` | 2 of 4 and 3 of 5 silent → nothing declared, WARN once; 1 of 3 and 1 of 4 silent → declared; resume logged once. Startup grace by unit test only. Note GAP-2 |
| F-46 | PASS | B-46a–c; D-7-b | upsert by pod, ordered, all fields, unknown monitor 404; 20 instance records after a 20-pod burst |
| F-47 | PASS | B-47a–h | rollup rules incl. `minHealthyPercent`, UNKNOWN pods `(n starting)` not tallied |
| F-48 | PASS | ev/25c C3-48a–c; B-48a/b; ev/22b D-6-c/c2; ev/25 C-48b/c | `leaving:true` drops the pod at once; one pod left + one silent → DOWN naming the silent pod; all left → `UNKNOWN (no live pod reports)` with no notice and no effect on the valve (G-1-6 closed); silent pod back → notice retired. The C-48a FAIL in ev/25 is the valve pause from the C-44/C-45 monitors left silent in that database (addendum in ev/25) |
| F-49 | PASS | B-49a, B-47h | auto-registered instance monitor gets `staleAfterSeconds=90`; explicit value kept |
| F-50 | PASS | B-50/B-50b; ev/22 D-7-a/c; IT `aFleetOfPodsReportingInTheSameInstantIsAccepted` | 20 parallel first-contact reports → 20 × 202, 0 × 409, and again on the existing monitor (G-1-7 closed: was 11–14 × 409); a persistent conflict still answers 409 as documented |
| F-51 | PASS | ev/10 | the same index set as iteration 0 (`feed_idx`, `sweep_*`, unique partial `external_ref_idx`, `events_tenant_seq_idx`, `events_ttl_idx` 86400, `monitor_tenant_service_idx`, `instance_*`), counters doc |
| F-56 (BE side) | PASS | A-01a | the form's `POST /v1/communications` contract |
| F-57 (BE side) | PASS | A-07 group, A-08, A-28; D-21 | every rejection is `{"error": text}` naming the field/rule |
| F-58 (BE side) | PASS | A-14a–l | `size=100` honoured, filters as the UI sends them |
| F-60 (BE side) | PASS | A-18a–c, A-27e, D-4-c | frames and `?clientId=`, response committed at once |
| F-61 (BE side) | PASS | A-20a; D-1-b | the browser's automatic reconnect with `Last-Event-ID` gets 200 + replay (G-1-1 closed) |
| F-62 (BE side) | PASS | A-06a–c | retire with note/actor, idempotent |
| F-64 (BE side) | PASS | A-27d/e | header and `?clientId=` |
| F-70 (BE side) | PASS | B-38 (WARN), B-38b | WARN → DEGRADED |
| F-72 (BE side) | PASS | B-38 (UNKNOWN), B-47e | UNKNOWN carries no information; `starting` pods not tallied |
| F-74 (BE side) | PASS | B-50; D-7-a/c | 409 is the retryable class the sidecar handles; bursts no longer produce it |
| F-75 | PASS | B-46a, B-75 group (3), B-36a | instance fields round-trip, `id` 253 ok / 254 → 400, instance without id → 400 |
| F-76 (BE side) | PASS | B-48a | `leaving:true` marks the record left immediately |
| F-88 (BE side) | PASS | ev/25c C3-48a, B-47e, D-6-a | silence → DOWN naming the pod; UNKNOWN during startup opens nothing |
| F-89 (BE side) | PASS (note) | ev/30, ev/25, ev/28 | INFO access log per request (733 INFO / 3 WARN lines on the shared backend, the WARNs being the two springdoc defaults and one valve pause), `opened OUTAGE …`, `retired notice …`, `closed externally; counting again`, valve WARN/INFO once per transition. Note GAP-6: ERROR + stack trace per scheduled sweep while Mongo is down |

Totals: 65 rows owned, 65 scored, **65 PASS, 0 FAIL** (iteration 0: 61 PASS, 3 FAIL, F-30 unscorable).

Status of the backend gaps of iteration 1: G-1-1, G-1-4, G-1-5, G-1-6, G-1-7, G-1-8, G-1-9, G-1-20, G-1-21, G-1-22,
G-1-23, G-1-24 — all re-verified closed with fresh evidence (rows F-20/F-61/F-21, F-18, F-41, F-45/F-48, F-50, F-30,
section 1 builds, F-06/F-13, F-28/F-07, F-27/F-29 + ev/23, ev/26, F-36/F-38). No regression found in any previously
passing row.

## 4. Gaps

| Gap | Severity | Feature | Root cause | Reproduced by | Suggested fix | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-backend1-1 | minor (ops) | F-30, F-14, F-01, F-28 | The Mongo client runs with the driver's default `serverSelectionTimeoutMS` = 30 000 (`application.yml:9-10` sets only the URI; no `MongoClientSettingsBuilderCustomizer`). While Mongo is unreachable, `/actuator/health/readiness` answers 503 only after 30.0 s and every API call answers 500 after 30.0 s; the 500 body is the driver's raw message (`Timed out while waiting for a server … Client view of cluster state is {… address=localhost:27020 …}`) through `GlobalExceptionHandler`'s generic path, which names an internal address to the caller | ev/27 (503 after 30 021 / 30 018 ms), ev/28 (`GET /v1/feed -> 500 (30 041 ms)`, `POST -> 500 (30 015 ms)`; liveness 7 ms; recovery 39 ms) | `serverSelectionTimeoutMS=3000&connectTimeoutMS=3000` on the URI (or a customizer), and map `MongoTimeoutException` / `DataAccessResourceFailureException` to 503 `{"error":"database unavailable, retry later"}` | `OperationsEndpointsIT` variant with Mongo stopped asserting readiness 503 in < 5 s; `@WebFluxTest` for the 503 mapping |
| GAP-backend1-2 | major (design; F-45 behaves as specified, needs a product decision) | F-44, F-45 | `HealthSweepUseCase.java:109-121`: the pause share counts every stale-capable monitor that is silent, with no upper bound on how long it has been silent. Monitors nobody will ever report to again (decommissioned services whose auto-registered monitors were not deleted, test monitors) therefore keep the valve paused for good, and from then on no genuinely silent service is declared DOWN anywhere in that database; the WARN is logged once at the transition | ev/25b C-44a (a fresh monitor silent 9 s stayed UNKNOWN) + ev/25d (valve paused since 01:34:44, 14 of 14 stale-capable monitors silent for 10–23 min, no `resumed` line); ev/25 addendum (same effect at 01:37:37 on :18900/:18901) | stop counting monitors silent for longer than N × `staleAfterSeconds` (or a `stale-abandoned-after`, e.g. 24 h) towards the share, flag them in `GET /v1/health/monitors` and repeat the WARN every few minutes while paused; or auto-retire the monitor after that period | `HealthSweepUseCaseTest`: "monitors silent for days do not keep the valve paused"; a `HealthMonitoringE2EIT` with two abandoned monitors and one freshly silent service |
| GAP-backend1-3 | minor (semantics/doc) | F-41 | `HealthMonitor.withClosedByOperator()` (`HealthMonitor.java:195-200`) resets `unhealthyStreak` to 0 on the observation that notices the operator's retire (`HealthObservationUseCase.reconcileOpen`, `:81-100`), so the re-open needs `failureThreshold + 1` failing observations after the retire; the README says only "starts counting again" | ev/21 B-41e/f (threshold 2: streak 0 after the first probe, no notice after the second) vs ev/22 D-5-c/d (third probe opens incident #2) | count the noticing observation when it is itself failing (reset to 1), or document "threshold + 1" in the README | `HealthObservationUseCaseTest` asserting the exact number of observations to the second notice |
| GAP-backend1-4 | minor | F-34, F-43 | `POST /v1/health/monitors/{id}/probe` and the scheduled probe observe the same monitor concurrently; the loser surfaces the optimistic-lock conflict to the caller as 409 `monitor … was modified concurrently; reload and retry` (push reports retry with backoff since G-1-7, forced probes do not) | ev/23 cookbook step "force a probe" (1 of 1 → 409); ev/23b 15/15 → 200 afterwards | retry the on-demand probe once on `OptimisticLockingFailureException`, or serialise observations per monitor | `HealthMonitorUseCaseTest` probe-now racing a sweep |
| GAP-backend1-5 | minor (build) | builds & static | `IndexOperations.ensureIndex` is deprecated for removal in Spring Data MongoDB 4.5 and used in `MongoCommunicationEventsAdapter.java:191`, `MongoCommunicationRepositoryAdapter.java:61`, `MongoHealthInstanceRepositoryAdapterIT.java:37`, `MongoHealthMonitorRepositoryAdapterIT.java:44` → four `[removal]` warnings on every build since the 3.5.16 bump | ev/01b | replace with `createIndex` (same semantics) | compile with `-Xlint:removal -Werror` |
| GAP-backend1-6 | minor (logs) | F-89 | while Mongo is unreachable every scheduled sweep ends in Spring's `TaskUtils$LoggingErrorHandler`: `ERROR Unexpected error occurred in scheduled task` with a full stack trace (6 blocks and 322 log lines during a 60 s outage), instead of one WARN per outage | ev/28 | catch `MongoTimeoutException`/`DataAccessResourceFailureException` in `PublishingSweep`/`HealthSweepUseCase` and log one line per state change | n/a (log hygiene) |
| GAP-backend1-7 | minor (build) | builds & static | no linter / static-analysis gate in `build.gradle.kts`; a verifier-run SpotBugs reports 50 findings: 41 `EI_EXPOSE_REP*` on records holding `List`/`Map` fields, 3 `URF_UNREAD_FIELD` in Mongo document classes, 2 `DM_CONVERT_CASE` (`toLowerCase/toUpperCase` without `Locale`: `GlobalExceptionHandler.java:117`, `RestControllerFeedAdapter.java:89`), 1 `REC_CATCH_EXCEPTION`, 3 `UWF_FIELD_NOT_INITIALIZED_IN_CONSTRUCTOR`; none priority 1, none CORRECTNESS | ev/08 | add the SpotBugs Gradle plugin with an exclude filter for `EI_EXPOSE_REP*` on records, use `Locale.ROOT` in the two case conversions | CI gate (no CI exists) |
| GAP-backend1-8 | minor (process) | builds & static | the build now produces an SBOM (`cyclonedxBom`) but nothing consumes it: no scanner step, no CI workflow in the repository | ev/04-cyclonedx.txt, ev/07-* | a CI job running `grype sbom:build/reports/cyclonedx/bom.json` (or Trivy) with a fail-on-high threshold | CI gate |

Observations that are not gaps: snapshot + `created` overlap within one poll interval (by design); blank `status` on a
report → 400 (API contract); cross-instance sweep conflicts skipped with a WARN; the process needs 5.4 s to exit after
SIGTERM although the streams end within 19 ms and the web server logs `Graceful shutdown complete` 9 ms after the signal
(the rest is event-loop/resource disposal with no log line; well inside the 10 s criterion of G-1-23); the shared backend
on :8080 has run since 01:05 under all verifiers with 0 ERROR lines (ev/30).

## 5. Not exercised here, and why

- Dependency/security scan: `api.osv.dev`, `api.deps.dev` and `ossindex.sonatype.org` do not answer through the sandbox
  proxy (curl exit 000) and the GitHub Advisory Database refuses the repository-bound token (403, ev/07-ghsa-scan.txt);
  no Trivy/Grype. Only the version comparison in ev/07-dependency-cve-review.txt was possible.
- TTL expiry actually removing `communication_events`/`health_instances` after 24 h and the `collMod` on a retention
  change: index parameters verified (ev/10, C-21e), expiry not waited for.
- Startup staleness grace (300 s): unit test only (`silenceIsNotTrustedDuringTheStartupGrace`); my instances ran with
  `stale-grace-after-start-ms=0` to make the other staleness rules observable within minutes.
- Notice-claim race (F-42) as a real race over HTTP: not deterministically reproducible; relied on the three unit tests,
  the repository IT and the observed cross-instance 409 skips.
- Kubelet behaviour against the 30 s readiness answer (GAP-1) and the backend behind a real OpenShift Route: no cluster.
- Two check failures were caused by my own test design, not by the code, and are documented rather than hidden: the
  staleness valve is per database, so the monitors that earlier scenarios left silent paused it for later scenarios in
  the same database (ev/25 C-48a, ev/25b C-44a, ev/22 D-6-c). Each was re-run on a fresh database (ev/25c, ev/22b) and
  passed; the underlying product risk is GAP-backend1-2.
- Environment: the private instances :18900–:18903, :18906–:18908, :18910–:18912, the stub on :18905 and the containers
  `be1-mongo`, `be1-mongo2`, `be1-mongo3` are all stopped; the shared stack (:8080, :3000, `mongo7`, `app`, `sidecar`)
  and the other verifiers' instances (:19150, :19300, :19501, :19502, :19700, `e2e1-*`, `ux1-fake`) were not touched.
