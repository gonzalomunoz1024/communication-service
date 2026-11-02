# Backend Verifier report: iteration 4 (2026-11-02)

**Code under test.** Branch `confidence-loop/2026-11-01` at `d10369b`. Its code is identical to `1cd3f13`: HEAD changes
only `confidence/` files. The stack is Spring Boot 4.0.9 (Spring Framework 7.0.10, Jackson 3.1.7, Netty 4.2.19) on
WebFlux with reactive MongoDB.

**Method.** This is a full re-verification, not a delta. I re-ran every gate and ran the suites three times. I exercised
every owned matrix row over HTTP against real backends: the shared :8080 (the iteration-4 jar, sha256 `64e07ece…`),
private instances on :19100–:19191 and the image on :19180/:19181. I checked each iteration-4 backend change against the
iteration-3 jar (an A/B run) wherever behaviour was meant to differ.

**Where things are.**
- Evidence: `confidence/evidence/iter-4/backend/`, cited as `ev/NN`.
- Scripts, raw logs and Trivy output: `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/backend4/`,
  cited as `<scratch>`.
- My data uses tenants `vb4-*`, databases `vb4_*` and containers `vb4-*`. The shared stack was never stopped or reconfigured.

## 1. Verdict and scores

**Backend confidence: 90 / 100, and no hard gate tripped.** Iteration 3 scored 80: it was capped by the open dependency
findings and stood at 91 before the cap.

**What got better.**
- The dependency findings that capped iteration 3 are gone. The SBOM the CI job scans has 0 vulnerabilities at any
  severity. As a positive control, the same scanner and database still find iteration 3's 3 CRITICAL and 10 HIGH (`ev/07`).
- Readiness now answers within the kubelet's 1 s.
- A forced probe no longer loses to the scheduler.
- Monitor registration is strict.
- The 409 suggests a free follow-up value.
- The OpenAPI document matches the service's real answers.
- Every iteration-4 backend change is confirmed (section 3b), with two partial exceptions below.

**The new finding is GAP-backend4-1 (major).** It is not a regression. Freeze the database (SIGSTOP; README.md:153-154
names "a frozen process, `docker pause`, a network black hole") and keep more than one call in flight. The driver then
pauses its connection pool. The resulting error is not recognised as "database unavailable", which has three effects:
- **HTTP answers.** 93 of 108 calls on iteration 4 answered **500 with the driver's message**, which names the database
  server's address (`… address=127.0.0.1:19198} is paused because another operation failed`). That covers the feed,
  list, publish and the stream.
- **The stream.** A stream gets that 500 framed as an SSE `data:` event, not the JSON 503 that G-4-10 promises.
- **Logs.** The health sweep logs an ERROR with a stack trace, and the event-log poller logs "poll failed" WARNs.

README.md:127-129, :141-143 and :146 promise the opposite: a 503, JSON before any byte, and driver detail in the log only.
The iteration-3 jar gives the same 500s on the plain endpoints in the same rounds (62 of 72), so this has been open since
iteration 3. It was found now because I froze the database with concurrent load (`ev/35`).

**Gate decision on F-28.** I did not trip the matrix gate. F-28's row (400 / ResponseStatus / anything else 500, the body
`{"error": …}`, no stack trace) holds as written: these answers are 500 with an `{"error"}` JSON body and no stack trace.
The failure sits in the database-unavailable contract of the G-2/G-3/G-4 closures. If the orchestrator reads F-28's "no
stack traces leak" as "no internal detail leaks", F-28 fails under a hung database and the 80 cap applies; the evidence
for that reading is `ev/35`.

| Category | Weight | Score | Why (evidence) |
|---|---|---|---|
| Builds & static checks | 10 | 10 | **Check run.** `check --rerun-tasks` exit 0 in 3 m 7 s, 12 tasks executed, 0 javac warnings under `-Werror` (`ev/01`).<br>**SpotBugs** (effort max, confidence medium): 3177 lines in 96 classes, 0 warnings, no new exclusion (`ev/08`).<br>**JaCoCo:** LINE 1545/1590 = 0.9717 and BRANCH 825/954 = 0.8648, against gates of 0.92 and 0.84 (`ev/05`).<br>**`verifySbomScope`:** 113 runtime components, no build or test tool (`ev/09`).<br>**Trivy:** the build SBOM and the jar's embedded SBOM have 0 vulnerabilities; the iteration-3 SBOM, scanned the same way, shows 3 CRITICAL and 10 HIGH, so the scanner works (`ev/07`).<br>**Image OS packages:** 0 with a fix (`ev/07` §4). |
| Feature completeness | 30 | 30 | 65 of 65 owned rows PASS (section 3), six of them with a note. 533 scripted checks in `ev/20`–`ev/44`, 522 PASS. The 11 FAILs are:<br>• 4 artefacts of my scripts, re-verified clean (`ev/20b`, `ev/33` re-run);<br>• 4 checks of GAP-1;<br>• 2 of GAP-2;<br>• 1 of GAP-4.<br>Also covered: the README cookbook run verbatim twice (`ev/37`), configuration-driven paths (`ev/38`), SIGTERM (`ev/43`), the image (`ev/36`) and indexes on a fresh database (`ev/10`). |
| Automated test health | 20 | 17 | **Runs.** 325 cases (270 unit + 55 IT, up from 297) in each of three executed runs, 0 skipped (`ev/02`). Test integrity: +28 `@Test`, no test file deleted, renamed or skipped, and each of the 18 removed assertion lines is replaced by an equal or stronger one (`ev/06`).<br>**−2, flaky IT:** `CommunicationServiceE2EIT.openApiSpecIsServed` failed run 2 at 5.07 s against the 5 s default timeout. It took 3.62 and 3.37 s in the other runs; iteration 3 took 1.2–1.6 s. Gradle exit 1 in one run of three (GAP-3).<br>**−1:** no test covers a paused pool (GAP-1), `lastProbeAt` order (GAP-2) or control-character-only input (GAP-4). |
| Integration & contracts | 20 | 16 | **Passing runs:**<br>• :8080 publishing, feed, SSE, admin, client id, errors and OpenAPI: 110/113, with the 3 FAILs re-verified 9/9 (`ev/20`, `ev/20b`);<br>• health: 80/80 (`ev/21`);<br>• iteration-3 contracts: 51/51 (`ev/22`);<br>• two-node pair: 19/19 (`ev/25`);<br>• iteration-1/2 gap re-checks: 42/42 (`ev/29`);<br>• G-4 API changes: 26/26 (`ev/32`);<br>• OpenAPI against real answers: 48/49, plus the re-run 1/1 (`ev/33`);<br>• wire A/B, 90 cases: 79 identical, 3 intended, plus the documented nesting change (`ev/30`);<br>• image with both Mongo URI variables (`ev/36`).<br>**Deductions (−4):**<br>• −2 GAP-1: a hung database gives 500s that carry driver detail on every endpoint;<br>• −1 GAP-4: Boot 4's `@NotBlank` now accepts control-character-only titles, tenants and publishers, and turns a lone U+2003 status into a 400;<br>• −1 GAP-2 and GAP-5: a forced probe moves `lastProbeAt` backwards, so the scheduler probes early; four wire differences are undocumented, one of them the user-visible `byte offset: #UNKNOWN`. |
| Resilience & ops | 10 | 8 | **Stopped database** (`ev/34`):<br>• 503 `{"error":"database unavailable"}` after 5.0–5.1 s on all 19 operations, and the stream's JSON 503 before any byte;<br>• readiness 503 in 0.807–0.814 s (iteration 3: 1.00–1.01 s), liveness 200;<br>• one WARN and one INFO from the poller, two readiness lines, 0 ERROR, 0 stack lines;<br>• recovery without a restart, and an open stream survives.<br>**Frozen database, sequential calls:** 20.03 / 15.02 / 5.01 s, each a 503.<br>**SIGTERM:** 2 open streams closed in 10–14 ms, exit 143 after 4.1 s (`ev/43`).<br>**Image:** UID 65532, base digest equal to the live tag (`ev/36`).<br>**G-4-7:** no `onErrorDropped` in any log (`ev/44`).<br>**−2 GAP-1, frozen database with load:** the health sweep logs `ERROR Unexpected error occurred in scheduled task` with a ~60-line trace (HealthSweepUseCase.java:76-82 catches only `DataAccessResourceFailureException`); the poller logs `event log poll failed: …UncategorizedMongoDbException…`; 30 of 36 streams answer an SSE-framed 500 (`ev/35`). |
| Usability (provisional; defer to the reviewer) | 10 | 9 | **API level only.** The 409 now names a free follow-up value. One 400 lists every unknown field, nested ones by path. A typo in a monitor's policy is a 400 naming it. The all-UNKNOWN rollup quotes the pod's own words. The cookbook runs verbatim (`ev/32`, `ev/37`).<br>**Nits:**<br>• a truncated body's 400 reads `(start marker at [Source: REDACTED (…INCLUDE_SOURCE_IN_LOCATION disabled); byte offset: #UNKNOWN])` (GAP-5);<br>• during a hung database a caller reads the driver's pool message instead of "database unavailable" (GAP-1);<br>• a title of U+0001 is accepted (GAP-4). |

**Weighted total: 10 + 30 + 17 + 16 + 8 + 9 = 90.**

**Hard gates, none tripped:**
- **Matrix items:** 65/65 owned rows PASS; see the F-28 note above.
- **Tests:** none skipped, deleted or loosened (`ev/06`).
- **Sidecar non-root / restricted-v2:** the Sidecar Verifier's area, not assessed here. The backend image runs as UID
  65532 (`ev/36`).
- **Open critical/high security finding:** none.
  - The SBOMs show 0.
  - The image has 0 fixable findings. Its 4 HIGH are in `libuuid1` 2.41.5-0+deb13u1, status "affected", with no fix.
    The repository's documented image policy is `--ignore-unfixed` (ci.yml:63-67, README.md:90), and fixes.md:26-30
    records them.
  - GAP-1's disclosure (an internal host:port and cluster id, only while the database hangs) rates low (CWE-209), not
    high.

## 2. Commands

All runner scripts are `python3 -I <scratch>/scripts/runner.py <script> <evidence> <title>`. Their exit code is the
runner's; the result column carries the check count.

| # | command | exit code | evidence file |
|---|---|---|---|
| 1 | `./gradlew --max-workers=2 --no-daemon check --rerun-tasks` (12 tasks: compile -Werror, test, integrationTest, JaCoCo report+verification, spotbugsMain, cyclonedxBom, verifySbomScope) | 0 (3 m 7 s) | `ev/01`, `ev/02`, `ev/05`, `ev/08`, `ev/09` |
| 2 | `./gradlew --max-workers=2 --no-daemon test --rerun integrationTest --rerun` (run 2) | 1 (integrationTest: `openApiSpecIsServed` timeout at 5.07 s) | `ev/02` |
| 3 | same (run 3) | 0 (3 m 9 s) | `ev/02` |
| 4 | `sha256sum build/libs/*.jar` before run 1 / after run 3 | 0 (`64e07ece…` both) | `ev/01` |
| 5 | `git grep -c @Test`, `git diff --stat/--name-status -M 6c15715 1cd3f13 -- src/test`, skip-marker grep | 0 | `ev/06` |
| 6 | `check_a_publishing_feed_admin.py` on :8080 | 0 (110/113) | `ev/20` |
| 7 | `check_a18_recheck.py` on :8080 (3 rounds without the snapshot overlap) | 0 (9/9) | `ev/20b` |
| 8 | `check_b_health.py` on :8080 + stub :19160 | 0 (80/80) | `ev/21` |
| 9 | `check_g3_contracts.py` on :8080 | 0 (51/51) | `ev/22` |
| 10 | `check_g32_probe_claim.py` on the pair :19100/:19101 | 0 (3/3) | `ev/24` |
| 11 | `check_c*.py` on the pair :19100/:19101 (db `vb4_pair`) | 0 (19/19) | `ev/25` |
| 12 | `g44_probe_race.py`: pair, :19120, :19125 (default config) and the iteration-3 jar :19121 | 0 (10/11) | `ev/26` |
| 13 | `g44_monotonic.py` (`lastProbeAt` across forced and scheduled probes) | 0 (0/1) | `ev/26b` |
| 14 | `check_g27_probe_race.py` (G-2-7's original 30 + 30 calls) | 0 (3/3) | `ev/26c` |
| 15 | `check_g28_snapshot_head.py` (pair) | 0 (4/4) | `ev/27` |
| 16 | `check_g26_reopen.py` (:19100) | 0 (10/10) | `ev/28` |
| 17 | `check_d*.py` on :8080 + :19120 | 0 (42/42) | `ev/29` |
| 18 | `ab_wire.py`: iteration-3 jar :19131 vs iteration-4 jar :19130, 90 requests, plus the OpenAPI diff | 0 (79 identical) | `ev/30` |
| 19 | `g416_trim.py` + the `@NotBlank` A/B (:19131 vs :19130) | 0 (27/28) | `ev/31` |
| 20 | `g4_api.py` on :8080 (G-4-11, G-4-13, G-4-5, G-4-15, G-4-14) | 0 (26/26) | `ev/32` |
| 21 | `g412_openapi.py` on :19120, plus the push-only example re-run on a clean slate | 0 (48/49, re-run 1/1) | `ev/33` |
| 22 | `g4_outage.py`: `docker stop`/`start`, then `docker kill -s STOP`/`CONT` of `vb4-mongo` under :19110 (iteration 4) and :19111 (iteration 3) | 0 (21/22) | `ev/34` |
| 23 | `g4_frozen_ab.py`: 3 freeze rounds × 36 calls per jar, :19110 vs :19111 | 0 (1/4) | `ev/35` |
| 24 | `docker build --pull=false -t vb4-backend:test .` (repository root) | 0 | `ev/36` |
| 25 | `docker run -d --name vb4-backend[-b] -p 127.0.0.1:1918{0,1}:8080 --add-host=host.docker.internal:host-gateway -e SPRING_MONGODB_URI=… / -e SPRING_DATA_MONGODB_URI=… vb4-backend:test`; `docker top`; `docker stop` | 0, 0; containers exit 143 | `ev/36` |
| 26 | `docker buildx imagetools inspect gcr.io/distroless/java21-debian13:nonroot` | 0 (index digest `b22857e9…` = Dockerfile:1) | `ev/36` |
| 27 | `flock <scratch>/../orch-trivy/.lock docker run … mirror.gcr.io/aquasec/trivy:0.58.1 sbom --skip-db-update --skip-java-db-update /work/build-bom.json` | 0 (0 vulnerabilities) | `ev/07` |
| 28 | same, `/work/jar-bom.json` (`META-INF/sbom/bom.json` from the jar) | 0 (0) | `ev/07` |
| 29 | same, `--list-all-pkgs /work/iter3-bom.json` (positive control) | 0 (3 CRITICAL, 10 HIGH, 16 MEDIUM) | `ev/07` |
| 30 | same, `image --pkg-types os vb4-backend:test` | 0 (77 entries, 0 with a fix) | `ev/07` |
| 31 | `bash <scratch>/cookbook.sh` twice (README blocks, only `localhost:8080` → `:19150`) | 0, 0 | `ev/37` |
| 32 | `check_e_config.py` (:19190: retention PT2H, client id off, ServiceNow URL, upcoming PT1H, grace 20 s); G-4-8 A/B on the iteration-3 jar :19191 | 0 (11/11) | `ev/38` |
| 33 | `check_g29_externalref_openapi.py` on :8080 (G29-b updated for `suggestedExternalRef`) | 0 (17/17) | `ev/39` |
| 34 | `check_nuances.py` on :8080 | 0 (11/11) | `ev/40` |
| 35 | `check_g33_effective.py` on :19105 (status sweep effectively off) | 0 (11/11) | `ev/41` |
| 36 | `check_g25_valve.py` on :19120 | 0 (5/5) | `ev/42` |
| 37 | `sigterm_test.py` (:19141, two open streams) | 0 | `ev/43` |
| 38 | `g47_late.py` (blackholed target 10.255.255.1:81, :19120 vs the iteration-3 jar :19122) | 0 (3/3) | `ev/44` |
| 39 | `docker exec mongo7 mongosh --quiet --eval getIndexes` (read-only) on `communication`, `vb4_cookbook`, `vb4_image` | 0 | `ev/10` |
| 40 | Cleanup: `DELETE /v1/health/monitors/{id}` for the 107 `vb4*` monitors on :8080 | 204 ×107, 0 left | `<scratch>/cleanup-shared.txt` |

## 3. Feature verdicts (owned rows: every BE row except F-90/F-91/F-92, which are whole-stack rows left to the E2E Verifier as in iteration 3)

| ID | verdict | evidence | note |
|---|---|---|---|
| F-01 | PASS | A-01a–d (`ev/20`); `ev/22`; `ev/37` | 201 + Location, ACTIVE/SCHEDULED, `created` frame |
| F-02 | PASS | A-02a–e (`ev/20`) | Draft invisible in feed, stream and permalink; publishes later; a second publish is 409 |
| F-03 | PASS | A-03a/b; G33-a/b (`ev/41`) | Any status with history; unknown id → 404 `{error}`; EXPIRED after `expiresAt` without a write |
| F-04 | PASS | A-04a–c; G33-c/e (`ev/41`) | Filters work; reads report the effective status |
| F-05 | PASS | A-05a–d; G3-8/G3-9 (`ev/22`); D-20-c (`ev/29`); G413-b (`ev/32`) | `expectedVersion` rules; 409 on mismatch; both unknown fields named in one 400 |
| F-06 | PASS | A-06a–c; G26 (`ev/28`); D-20-b, D-5-b (`ev/29`); G413-c (`ev/32`); G33 (`ev/41`) | Idempotent on RETIRED; 409 on EXPIRED; actor and note recorded |
| F-07 | PASS (note) | A-07 (11 cases); G3-7/8/9/32 (`ev/22`); D-21 (`ev/29`); G413-a/d (`ev/32`) | Every input error names the field and value; all unknown fields in one 400. **Note GAP-4:** a control-character-only `title`/`tenantId`/`publisher` (U+0001) is now accepted (201; iteration 3: 400) |
| F-08 | PASS | A-08; G411-a–j (`ev/32`); G29-a–g (`ev/39`); `ev/37` run 2 | 409 names the holder, says the key is permanent, and `suggestedExternalRef` is the first free follow-up value |
| F-09 | PASS | A-09a–h; G411-k (`ev/32`); E-09-a/b (`ev/38`) | Ticket normalised; ServiceNow link from `instance-url`; own URL kept; the default ref gets the same suggestion |
| F-10 | PASS | A-10, A-10b; `ev/37` | MAINTENANCE expiry defaults to `endsAt` |
| F-11 | PASS | A-11a–c; D-20-d (`ev/29`) | History appended and capped at 50 |
| F-12 | PASS | A-12 | 8 parallel PUTs with one version: 1 × 200, 7 × 409 |
| F-13 | PASS | A-13a–c; C-13a/b (`ev/25`); G33-g (`ev/41`) | State machine enforced; 409 texts name the state |
| F-14 | PASS | A-14a–m; D-21-h | `tenantId` required; every filter and paging |
| F-15 | PASS | A-15a/b; D-20-a; G33-f | Effective status on every read path |
| F-16 | PASS | A-16a/b; E-16-a (`ev/38`) | Upcoming window at the default 7 d and at PT1H |
| F-17 | PASS | A-17a/b; C-17 (`ev/25`) | RETIRED/EXPIRED retrievable; drafts and unknown ids → 404 |
| F-18 | PASS (note) | A-18a/c/d/e; A-18b-r1–r3 (`ev/20b`); G28-a/d (`ev/27`); O-1f/l/o (`ev/34`); `ev/37` | `:connected` first; snapshot id = log head; survives an outage; JSON 503 before any byte while the database is stopped. **Note GAP-1:** opened while the database hangs under load, 30/36 streams got an SSE-framed 500 with driver text (O-2c, FRZ-4) |
| F-19 | PASS | A-19 | Server-side per-subscriber filters |
| F-20 | PASS | A-20a/d/e; A-20b/c-r1–r3 (`ev/20b`); G3-11-a–d (`ev/22`); G28-b/c (`ev/27`); O-1h (`ev/34`); D-1 (`ev/29`) | Resume by header or query; the A-20b/c FAILs in `ev/20` are the snapshot overlap of my script, clean in 3 rounds |
| F-21 | PASS | C-21a–e (`ev/25`) | Published on one node, received on the other |
| F-22 | PASS | C-22a/b (`ev/25`) | SCHEDULED → ACTIVE → EXPIRED by the sweeper, with frames |
| F-23 | PASS | A-23a–d; G33-d (`ev/41`) | Admin filters and history; effective status |
| F-24 | PASS | A-24 | Tenant counts match Mongo |
| F-25 | PASS | A-25; `ev/22` | Admin retire: same rules and events |
| F-26 | PASS | A-26 | Purge 204, then 404 |
| F-27 | PASS | A-27a–k, A-27e2; E-27-a, E-G48-a/b (`ev/38`); `ev/36` | 401/400 rules, `?clientId=` for streams. With the check off every request now has an access line (`client=-`; iteration 3: none) |
| F-28 | PASS (note) | A-28a–i; D-21 (`ev/29`); G413 (`ev/32`); G412-b (`ev/33`); O-1a/b/m (`ev/34`); FRZ-1/2 (`ev/35`) | 400/404/409/413/503 bodies are `{error}` sentences; no stack trace leaks; stopped database → 503 on all 19 operations. **Note GAP-1:** with the database hung under load, 93/108 calls answer 500 `{"error":"Connection pool for ServerId{…, address=127.0.0.1:19198} is paused because another operation failed"}`, the same as iteration 3 on the plain endpoints |
| F-29 | PASS | A-29a–c; G412 (49/49, `ev/33`); G29-h–o (`ev/39`); G411-l | Every operation's documented success code is the real one; shared errors documented; every request example accepted as is |
| F-30 | PASS | A-30; D-8 (`ev/29`); N-3 (`ev/40`); O-1c/d/j, O-2a (`ev/34`); `ev/36` | Liveness/readiness groups; readiness 503 in 0.807–0.814 s while Mongo is down; liveness stays 200 |
| F-31 | PASS | B-31a–f (`ev/21`); G45-a–c (`ev/32`); E-45-0 (`ev/38`) | 201 + Location; a misspelled policy field is now a 400 naming it, and nothing is registered |
| F-32 | PASS | B-32 (11 cases); G45-a | Every bound enforced with a sentence |
| F-33 | PASS | B-33a–d | All monitors or one tenant's |
| F-34 | PASS | B-34a/b; G44-a/b/d5/d10/d30 (`ev/26`); G27 (`ev/26c`); G47-a (`ev/44`) | Forced probe of a 3 s endpoint while the scheduler probes it: 200 in 3.0–3.1 s, 30/30 on the pair, 10/10 single, 10/10 at each default interval (iteration-3 jar 0/10) |
| F-35 | PASS | B-35a/b; `<scratch>/cleanup-shared.txt` (107 × 204) | The notice is retired as `monitor deleted` |
| F-36 | PASS (note) | B-36a–d; D-24 (`ev/29`); G413-e (`ev/32`); `ev/31` | Reports stay lenient about unknown keys. **Note GAP-4:** an overall status of a lone U+2003 is 400 `status: must not be blank` (G-4-16's rule says DEGRADED; iteration 3 read UNKNOWN) |
| F-37 | PASS | B-37a–f; G3-30-e (`ev/22`); `ev/31` pull path | Document status wins over the HTTP status; the trim rule on the pull path matches Java and Go |
| F-38 | PASS (note) | B-38 (9 cases), B-38a–c; G3-30 (`ev/22`); `ev/31` | Shared vocabulary; unknown words → DEGRADED. Note GAP-4 (as F-36) |
| F-39 | PASS | B-39a–d; G26 (`ev/28`); D-5-a | Debounce in both directions |
| F-40 | PASS | B-40a–c; G3-25 (`ev/22`); D-5-d | OUTAGE/HEALTH at the policy severities; plain-words body |
| F-41 | PASS | B-41a–f; G26 (`ev/28`); D-5-c | Updated in place; reopens on the threshold-th probe after an operator retire |
| F-42 | PASS | unit `openClaimsTheMonitorBeforePublishingAnOutage`, `lostClaimRacePublishesNothing`, `publishFailureReleasesTheClaim`; IT `staleVersionIsConflict` (3/3 runs, `ev/02`) | Not inducible as a race over HTTP (section 5) |
| F-43 | PASS (note) | G32-a–c (`ev/24`); C-43, C-43b (`ev/25`); G44 (`ev/26`) | One scheduled probe per interval across nodes (gaps 5.02–5.03 s). **Note GAP-2:** while forced probes run, `lastProbeAt` steps backwards (9 of 23 states) and the scheduler re-probes after about 3 s (G44-mono, G44-a-once: 60 target hits for 30 forced calls, budget 50) |
| F-44 | PASS | C-44a/b; D-6 (`ev/29`); G25-a (`ev/42`); E-45-b (`ev/38`) | Silence → DOWN with its sentence; recovers on a report |
| F-45 | PASS | C-45a/b; D-6-d; G25-c/d (`ev/42`); E-45-a/b (`ev/38`) | Valve pauses on mass silence and forgets abandoned monitors; startup grace 20 s: first DOWN 26.0 s after `Starting` (19.8 s after `Started`), not before the grace ended |
| F-46 | PASS | B-46a–c; D-7-b | Per-instance upsert |
| F-47 | PASS | B-47a–h; G415-a–d (`ev/32`) | Rollup rules; the all-UNKNOWN rollup quotes the first pod's words, one line, at most 160 characters |
| F-48 | PASS | B-48a/b; C-48a–c; D-6-c | `leaving:true` marks the instance left; scaled to zero opens nothing |
| F-49 | PASS | B-49a | Auto-registered monitors get the instance staleness window |
| F-50 | PASS | B-50, B-50b; D-7-a/c | 20 parallel reports → 20 × 202 |
| F-51 | PASS | `ev/10`; E-51-a/b (`ev/38`) | All named indexes on a fresh database; TTL 86400, changed in place to 7200 by PT2H with its log line |
| F-56 (BE) | PASS | A-01a; `ev/37` | The form's `POST /v1/communications` contract |
| F-57 (BE) | PASS | A-07, A-28; G3-7/8/9 (`ev/22`); G29-a (`ev/39`) | Every rejection is `{"error": text}` (see GAP-1 for the hung-database 500 text) |
| F-58 (BE) | PASS | A-14a–m | `size=100`; filters as the UI sends them |
| F-60 (BE) | PASS | A-18a/c/d, A-27e/e2; O-1f/l (`ev/34`) | Frames, `?clientId=`, survives an outage |
| F-61 (BE) | PASS | A-20a; A-20b/c-r1–r3 (`ev/20b`); G28-b (`ev/27`); G3-11 (`ev/22`) | Reconnect with `Last-Event-ID` replays |
| F-62 (BE) | PASS | A-06a–c; `ev/22` | Retire with note and actor; idempotent |
| F-64 (BE) | PASS | A-27d/e; `ev/36` | Header and `?clientId=`; 401 without it, also from the image |
| F-70 (BE) | PASS | G3-30 (`ev/22`); B-38; `ev/31` | The service reads every sidecar word the same way, including the trim rule |
| F-72 (BE) | PASS | B-38 (UNKNOWN), B-47e; G415 (`ev/32`) | UNKNOWN during startup opens nothing, and the summary quotes the pod |
| F-74 (BE) | PASS | B-50/B-50b; D-7 (`ev/29`); O-1m (`ev/34`) | 409 only on a persistent conflict; stopped database → 503, retryable |
| F-75 | PASS | B-75a–c, B-46a, B-36a (`ev/21`); G3-8-k (`ev/22`) | The sidecar's real wire request → 202 |
| F-76 (BE) | PASS | B-48a; C-48b | `leaving:true` honoured |
| F-88 (BE) | PASS | C-48a; B-47e; D-6-a; G25-a | Silence → DOWN naming the pod; UNKNOWN during startup opens nothing |
| F-89 (BE) | PASS (note) | E-G48-a/b, E-51-b (`ev/38`); O-1g/i/k/n/p (`ev/34`); G32-b (`ev/24`); `ev/43`; `ev/44` | Stopped database: access lines, notice and valve lines, two readiness lines and one poller WARN + INFO per outage, 0 ERROR. **Note GAP-1:** frozen database under load: 2 scheduler ERRORs with traces and 2 "poll failed" WARNs in 3 rounds (`ev/35`) |

### 3b. Iteration-4 changes and earlier closures

| item | verdict | evidence | note |
|---|---|---|---|
| G-4-1 Boot 4 / Spring 7 / Jackson 3, wire unchanged | CONFIRMED (note) | `ev/30`, `ev/07`, `ev/01` | 90 requests: 79 identical, 3 intended (G-4-13, G-4-5, G-4-11). Nesting deeper than 500 levels is 400 (iteration 3: 202 up to depth 998), as documented. 4 undocumented differences (GAP-5) |
| G-4-3 image base pinned, non-root, OS scan | CONFIRMED | `ev/36`, `ev/07` | Dockerfile digest = live tag's index digest; UID 65532; 77 OS entries, 0 with a fix |
| G-4-4 forced probe vs scheduler | CONFIRMED (note) | `ev/26`, `ev/26c` | 3 s endpoint, 5 s interval, 1 s sweep: every forced probe 200. Side effect GAP-2 (`ev/26b`) |
| G-4-5 strict monitor registration | CONFIRMED | G45-a–d (`ev/32`) | README.md:255 names it |
| G-4-6 readiness within the probe timeout | CONFIRMED | O-1c, O-2a (`ev/34`) | 0.807–0.814 s (0.8 s ping budget + ~8 ms); iteration 3: 1.00–1.01 s |
| G-4-7 late probe failure | CONFIRMED by code and unit test | `ev/44` | A blackholed target does not reproduce the late failure on either jar; 0 `onErrorDropped` in every log |
| G-4-8 access line with the check off | CONFIRMED | E-G48-a/b (`ev/38`) | `client=-` INFO lines; iteration-3 jar: 0 lines |
| G-4-9 one poller WARN per outage | CONFIRMED (stopped) / NOT for a hung database | O-1n/O-1p (`ev/34`); `ev/35` | Hung database under load: also `event log poll failed: …UncategorizedMongoDbException…` WARNs, 2 in 3 rounds (GAP-1) |
| G-4-10 stream 503 before any byte | PARTIAL | O-1f/g/h (`ev/34`); O-2c, FRZ-4 (`ev/35`) | Stopped database: JSON 503, one WARN, also `?clientId=` and resume. Hung database: SSE-framed 500 with driver text (GAP-1) |
| G-4-11 follow-up suggestion | CONFIRMED | G411-a–l (`ev/32`); G29 (`ev/39`) | Per tenant; −99 → −100; −0 is not a counter; 50 taken → none suggested |
| G-4-12 OpenAPI vs real answers | CONFIRMED | `ev/33` | 20 operations; examples accepted as is |
| G-4-13 every unknown field in one 400 | CONFIRMED | G413-a–e (`ev/32`) | Sorted, nested by path; reports stay lenient |
| G-4-14 plain-text README example | CONFIRMED | G414 (`ev/32`); `ev/37` | |
| G-4-15 all-UNKNOWN rollup quotes the pod | CONFIRMED | G415-a–d (`ev/32`) | |
| G-4-16 trim rule ≤ U+0020 | CONFIRMED (note) | `ev/31` | Component and pull paths follow the rule, and the Java and Go tables agree. The push report's overall status still goes through `@NotBlank` (GAP-4). fixes.md misnames the changed character (GAP-6) |
| G-3-1 / G-3-31 database outage behaviour | PASS (stopped; frozen, one call at a time) / FAIL frozen under load | `ev/34`, `ev/35` | GAP-1 |
| G-3-2 one probe per interval across nodes | PASS | G32-a–c (`ev/24`) | See GAP-2 for forced probes |
| G-3-3 effective status on reads | PASS | `ev/41` (11/11) | |
| G-3-4 / G-3-5 coverage scope, SBOM scope | PASS | `ev/05`, `ev/09` | GlobalExceptionHandler 120/120 lines, 109/112 branches |
| G-3-6 outage log hygiene | PASS (stopped) / FAIL frozen under load | O-1i/k (`ev/34`); `ev/35` | GAP-1 |
| G-3-7 / 8 / 9 / 32 input errors | PASS | `ev/22` (51/51) | G3-8-l now names both unknown fields (G-4-13) |
| G-3-10 README stack | PASS | README.md:21 "Spring Boot 4.0"; `ev/37` | |
| G-3-11 / G-3-25 / G-3-30 | PASS | `ev/22` | |
| Iteration-2 closures (G-2-4…G-2-9 and earlier gap re-checks) | PASS | `ev/29` (42/42), `ev/42`, `ev/28`, `ev/26c`, `ev/27`, `ev/39` | |

## 4. Gaps

| ID | severity | feature ID(s) | root cause (file:line) | how reproduced | suggested fix (one line) | test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-backend4-1 | major | F-28, F-18 (G-4-10), F-89 (G-3-6, G-4-9), G-3-31; README.md:127-129, :141-143, :146 | `GlobalExceptionHandler.isDatabaseUnavailable` (GlobalExceptionHandler.java:70-72) and the 503 handler's list (:83-84) know only `DataAccessResourceFailureException`, `MongoTimeoutException` and `MongoSocketException`. With a hung server the driver pauses its pool, and Spring Data MongoDB 5.0.8 translates `MongoConnectionPoolClearedException` into `UncategorizedMongoDbException` (`MongoExceptionTranslator.java:150`). That reaches `handleGeneric` (:184-188), which echoes `ex.getMessage()` (`safe`, :297-299 only replaces null), and on the stream path the 500 is SSE-framed. The same predicate (or a narrower one) gates RestControllerFeedAdapter.java:98, MongoCommunicationEventsAdapter.java:104, HealthSweepUseCase.java:76-82 and StatusSweepUseCase.java:39-45, so the sweep's error escapes to Spring's scheduler (ERROR + trace) and the poller logs "poll failed" each time | `ev/35`: `docker kill -s STOP` of a private mongod under :19110 (iteration 4) and :19111 (iteration 3), bursts of 6 parallel calls at 0–10 s, 3 rounds. Iteration 4: 93/108 → 500 `Connection pool for ServerId{clusterId=…, address=127.0.0.1:19198} is paused because another operation failed` (63/72 plain + 30/36 streams); iteration 3: the same on 62/72 plain calls. A single stream opened during the freeze reproduces it too (O-2c, `ev/34`) | Classify by cause chain (pool-cleared, socket, timeout, resource failure → 503 "database unavailable"), and answer an unclassified 500 with a fixed sentence while logging the detail | An IT that pauses the embedded mongod (SIGSTOP) with concurrent calls and a stream open, or unit tests feeding `UncategorizedMongoDbException(cause = MongoConnectionPoolClearedException)` to the handler, the stream, both sweeps and the poller |
| GAP-backend4-2 | minor | F-43, F-34 (G-4-4) | `HealthMonitorUseCase.probeNow` takes `now` before the probe, and `HealthMonitor.java:153` sets `lastProbeAt = now` for a PROBE report. A forced probe that ends after the scheduler saved its claim (`withProbeClaimed`, HealthSweepUseCase.java:195) writes an older `lastProbeAt`, so `probeDue` (HealthMonitor.java:111-118) fires early | `ev/26b`: forced probes of a 3 s endpoint on the pair, 9 of 23 states step backwards (e.g. v6 10:40:45.045Z → v7 10:40:42.339Z), 25 target hits for 12 forced calls; G44-a-once (`ev/26`): 60 hits for 30 calls (budget 50) | Never move `lastProbeAt` backwards (keep the later of the stored and the new instant), or take `now` when the probe returns | ForcedProbeWhileTheSchedulerProbesIT checks that each call answers 200, but not the number of target hits or `lastProbeAt` order |
| GAP-backend4-3 | minor | F-29 (test health) | CommunicationServiceE2EIT.java:437-445 `openApiSpecIsServed` uses WebTestClient's default 5 s response timeout (the client is only given a header at :50-55). With springdoc 3 the first `/v3/api-docs` takes 2.75–3.6 s, against 1.2–1.6 s in iteration 3 | `ev/02`: run 2 failed at 5.07 s (`Timeout on blocking read for 5000000000 NANOSECONDS`); 3.62 / 3.37 s in runs 1 and 3; Gradle exit 1 | Give that test a longer `responseTimeout` (e.g. 30 s), or build the document once at startup | The test itself is the flake; a CI run would fail about 1 in 3 at this margin |
| GAP-backend4-4 | minor | F-07, F-36, F-38 (G-4-16) | Boot 4 brings Hibernate Validator 9.0.2 (iteration 3: 8.0.3), whose `@NotBlank` lets strings of control characters (U+0001–U+001F) through and rejects U+2003-only ones. CreateCommunicationCommand.java:37 (`title`) and HealthReportCommand.java:26-28 (`tenantId`, `service`, `status`) rely on it, and `externalRef` is not trimmed (PublishingUseCase.java:62). Undocumented | `ev/31`: `title`/`tenantId`/`publisher` = "\u0001" → 201 ACTIVE (iteration 3: 400 `must not be blank`); push report overall `status` " " → 400 (G-4-16 rule: DEGRADED; iteration 3: 202 UNKNOWN); "\u0001" → 202 UNKNOWN (iteration 3: 400) | Apply the same ≤ U+0020 trim rule in a custom constraint for required text and for the report status, and document it | None covers control-character-only input on the publish fields or the report status |
| GAP-backend4-5 | minor (cosmetic) | F-28 (G-4-1) | fixes.md says the only wire difference is nesting deeper than 500 levels. There are four more:<br>• Jackson 3 says "property name" for "field name" (3 cases);<br>• a truncated body's 400 passes Jackson's location text (GlobalExceptionHandler.java:222, `getOriginalMessage()`) and now ends `byte offset: #UNKNOWN])`, after a `Source: REDACTED (…)` that iteration 3 also showed;<br>• Spring's own 406 timestamp `+00:00` → `Z`;<br>• a CORS preflight is 200 instead of 403, still with no `Access-Control-Allow-*` header (posture unchanged) | `ev/30` rows 70 and 89, and the malformed-JSON rows | Cut the `(start marker at [...])` part from the 400 text and list the other three in fixes.md | No test asserts the truncated-body message |
| GAP-backend4-6 | cosmetic (docs) | G-4-16 | iter-4/fixes.md "Deliberate behaviour changes": "a lone U+00A0 now reads DEGRADED (was UNKNOWN)". Iteration 3 already read a lone U+00A0 as DEGRADED on all three paths; the character whose reading changed is U+2003 (UNKNOWN → DEGRADED on the component and pull paths) | `ev/31` A/B table (rows "lone ' '" and "lone ' '") | Correct the sentence | n/a (documentation) |

## 5. What could not be exercised, and why

- **Kubernetes (no cluster; kind does not work in this sandbox).** Not exercised:
  - a kubelet's own probes against readiness/liveness, measured here over HTTP only;
  - rolling deploys and pod restarts;
  - the manifests' securityContext under restricted-v2.

  The image's UID was read with `docker top`.
- **GitHub Actions (no run).**
  - The backend job's new image build and Trivy scan (ci.yml:54-67), the anchore SBOM scan and the Trivy pin were read,
    not run. The pin's digest equals the local mirror image's (`ev/07` §5).
  - The repository's own scan of the image, which includes the jar and needs Trivy's Java DB, was not run. The brief
    forbids downloading that database, so the jar's libraries were scanned only through both SBOMs (`ev/07`).
- **F-42 claim race.** It cannot be induced from outside, so it rests on the unit and IT tests (`ev/02`).
- **G-4-7's real late failure.** A blackholed connect is cancelled by the timeout on both jars, so neither jar has a late
  failure to log (`ev/44`). It rests on the code and its unit test.
- **Long waits.** Not waited out:
  - the 24 h stale-forget, reproduced by backdating in Mongo (`ev/42`);
  - the TTL deletions, where the index values were read (`ev/10`);
  - the default 300 s startup grace, exercised at 20 s (`ev/38`).
- **Network partition.** A real one (iptables) was not available. The frozen database was simulated with
  `docker kill -s STOP`, one of the cases README.md:153-154 names.
- **SpotBugs at LOW confidence.** The verifier-only LOW look was not re-run; the MEDIUM gate, which CI enforces, was.
- **F-90, F-91, F-92.** Whole-stack rows, left to the E2E Verifier.

**Cleanup.**
- The 107 `vb4*` monitors on :8080 were deleted (`<scratch>/cleanup-shared.txt`).
- All my private JVMs and the stub were stopped.
- The containers `vb4-mongo`, `vb4-backend` and `vb4-backend-b` and the image `vb4-backend:test` were removed.
- The `vb4_*` databases on mongo7 (13, about 5 MB) and the `vb4-*` tenants' documents in `communication` are left in
  place, as iterations 2 and 3 left theirs.
