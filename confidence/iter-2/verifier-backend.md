# Backend Verifier report — iteration 2 (2026-11-02)

Verifier: independent grader for iteration 2 (wrote no production or test code; a different instance from the iteration-1
verifier, whose report and the audit's §6 were used only as a map of what to check). Code under test: branch
`confidence-loop/2026-11-01` at `be19645` (`908598a` = last code commit + the documentation commit); the jar used for every
private instance is `scratchpad/communication-service-iter2.jar`, sha256 `491438c7…` identical to `build/libs/` built at
03:49 after `908598a` (03:40). Scope: every Feature Matrix row whose services include `BE` except F-90/F-91/F-92 (E2E
verifier): 65 rows; for rows shared with the frontend or the sidecar only the backend side is graded. Evidence files live in
`confidence/evidence/iter-2/backend/` (cited as `ev/NN`); check ids (A-…, B-…, C-…, C3-…, D-…, G2n-…, N-…) are rows of the
tables inside those files, which end with the request/response transcripts. HTTP checks ran against the shared backend on
:8080 (tenants `vb2-*`) and against private instances started from the same jar on :19100–:19190 (databases `vb2_*`, all
stopped again; the shared stack was never touched). `git status` shows only new files under `confidence/`.

## 1. Verdict and scores

**Backend confidence: 94 / 100 (iteration 1: 87 verifier / 88 audited → +6). Hard gates tripped: none.**

| Category | Weight | Score | Why (evidence) |
|---|---|---|---|
| Builds & static checks | 10 | 9 | `check --rerun-tasks` BUILD SUCCESSFUL in 1 m 29 s with `-Xlint:deprecation,removal,unchecked -Werror` and 0 compiler warnings (`ev/01`; G-2-1 closed). SpotBugs (effort max, confidence medium) analysed 89 classes and reports 0 findings; the gate bites (the fixers' before-run failed the build on 31 findings); the five `exclude.xml` entries are each precise and justified by the code (`ev/08`); a low-confidence run adds 6 P3 style/perf findings on Mongo document fields and one broad catch, none a bug. JaCoCo line gate 0.92 vs measured 0.9553 (`ev/05`). CycloneDX SBOM produced and a CI scan step exists (`ev/09`). Deductions: no vulnerability scan could run here (every database blocked, `ev/07`) and the SBOM the CI job will scan includes build/test tooling (GAP-5). Awarded: clean build 3/3, static analysis 3/3, dependencies 3/4. |
| Feature completeness | 30 | 30 | 65 of 65 owned rows PASS (section 3): 341 scripted HTTP checks (`ev/20`–`ev/29`), 16 cookbook steps verbatim (`ev/23`), the image, SIGTERM and config checks (`ev/28`, `ev/26`, `ev/31`). 65/65 × 30. |
| Automated test health | 20 | 19 | 250 tests (208 unit + 42 integration, up from 188 + 39): three executed runs, 0 failures, 0 errors, 0 skipped, every one of the 250 cases passed 3/3 (`ev/02`). The 14 regression tests named in `iter-2/fixes.md` are present and green. Test integrity: +663/−28 lines in `src/test`, 7 removed assertion lines each replaced by an assertion of the new documented behaviour, no skip markers (`ev/06`). Coverage is now measured and gated. Deduction: the gate's `config/**` exclusion takes `GlobalExceptionHandler` (83.5 % lines, 41/84 branches) and `ClientIdWebFilter` out of the ratio, so 22 lines and 47 branches of production logic are outside the gate although the unfiltered ratio (0.946) would still pass (GAP-4, `ev/05`); branch coverage (0.79–0.82) is not gated. |
| Integration & contracts | 20 | 19 | Publishing/feed/admin/client-id/errors/OpenAPI 108/113 (`ev/20`; the 5 FAILs are script artefacts explained in its addendum and re-verified in `ev/20b` 3/3, `ev/20c` 2/2, `ev/22` D-1, `ev/22f`), health 79/80 (`ev/21`; B-34a = coincident scheduler probe, 8/8 deterministic re-check in the addendum), gap re-checks 41/42 (`ev/22`; D-6-c re-run clean on a fresh database `ev/22b` 3/3), pair 18/19 and second database 8/9 (`ev/25`, `ev/25b`; C-48a = recently-silent valve population, clean on fresh databases `ev/25c` 3/3), G-2-5…G-2-9 39/39 (`ev/22c`–`ev/22g`), README cookbook runs as written including the new retry/follow-up example (`ev/23`), audit nuances 11/11 (`ev/29`). Browser and sidecar contracts hold: `Last-Event-ID`/`?lastEventId=` replay, snapshot id = log head and resume never skips (`ev/22f`), `:connected` first, 503 during an outage is the retryable class for the sidecar (`ev/27b` G24-n), 20-pod bursts 20 × 202. Deductions: `GET /v1/communications/{id}` says ACTIVE after `expiresAt` while retire answers 409 (GAP-3); with two nodes every due probe of a slow endpoint runs twice and the loser logs a WARN per sweep (GAP-2). |
| Resilience & ops | 10 | 8 | Mongo unreachable: `GET`/`POST`/health API answer 503 `{"error":"database unavailable"}` after 5.02 s with no cluster description, readiness 503 after 5.01 s, liveness 200 in 10 ms, readiness 200 again 2.7 s after Mongo returns, the API and writes recover without restart, a stream opened before the outage survives it on keepalives and delivers the first item after recovery, one WARN per skipped sweep and 0 ERROR lines in the outage window, startup against a dead port exits 1 after 13 s instead of hanging (`ev/27`; G-2-4 closed). SIGTERM with two open streams: streams end after 7 ms, "Graceful shutdown complete" after 2 ms, process gone after 4.1 s (`ev/26`). Root `Dockerfile` builds from the jar, runs as uid 65532 with working probes and the client-id guard, stops in 4.4 s (`ev/28`). Valve: abandoned monitors forgotten after 24 h, pause/resume logged once per transition with denominators that exclude them (`ev/22c`). Deductions: a stream opened *during* an outage makes the server log two ERROR blocks with stack traces per attempt because the 503 mapping is applied to a committed SSE response (GAP-1, `ev/27b`); N-node duplicate probing with a WARN per lost race (GAP-2) and framework stack traces per readiness probe during an outage (GAP-6). |
| Usability | 10 | 9 (provisional) | API level only, deferring to the Usability Reviewer. The duplicate-`externalRef` 409 names the holder, says the key is permanent and suggests the follow-up value; the same sentence is in the OpenAPI example, the README API table, the core semantics and the cookbook, which runs verbatim (`ev/22g`, `ev/23`); `expectedVersion` is explained in the schema; 503 bodies are one plain sentence. Deductions: stored vs effective status on GET by id (GAP-3); a `null` element in `affectedServices` gets the generic "Failed to read HTTP message" while every other input error names the field (GAP-7). |
| **Weighted total** | | **94** | no cap applies |

Hard gates:
- Any matrix item fails E2E: **no** (65/65 PASS; every FAIL row in the check tables is a script artefact or a test-design effect, each re-verified cleanly and documented in the evidence file's addendum).
- Test skipped/deleted/loosened without justification: **no** — `ev/06`: 18 test files changed (+663/−28), @Test count 227 → 250, no skip markers; the 7 removed assertion lines are the G-2-6 off-by-one (streak 0 → 1, notice on the threshold-th probe, as the README states), the G-2-8 `position()` → `head()` stub (assertion strengthened with the id and an `InOrder` check) and the G-2-9 409 line replaced by a body assertion.
- Sidecar non-root / restricted-v2: not this verifier's area.
- Open critical/high security finding: **not tripped on the evidence available** — no scanner can run here (`ev/07`); resolved versions are the current patch lines seen by the iteration-1 audit (`ev/09`); residual risk is "unscanned".

Iteration-2 gap closures, each re-verified with its own evidence:

| Gap | Verdict | Evidence |
|---|---|---|
| G-2-1 `[removal]` warnings, `-Werror` | closed | `ev/01`: 0 `warning:` lines in a `--rerun-tasks` compile with `-Werror` on (`build.gradle.kts:54`); the four sites now call `createIndex` |
| G-2-2 SpotBugs + JaCoCo gates | closed | `ev/01`, `ev/08` (89 classes analysed, 0 findings; exclusions judged one by one, all justified; low-confidence leftovers listed), `ev/05` (0.9553 vs 0.92; the `config/**` exclusion hides 22 lines/47 branches of `GlobalExceptionHandler`/`ClientIdWebFilter` → GAP-4) |
| G-2-3 CI workflow | closed as far as checkable | `ev/09` (both workflows parse; every step read), backend step = `ev/01`, frontend steps lint/typecheck/test(141)/build/audit all exit 0 (`ev/09c`), sidecar `go vet` and `CI=true go test` with kustomize/kubeconform/helm exit 0, govulncheck fails here on the blocked `vuln.go.dev` (`ev/09b`). **GitHub Actions cannot run in this sandbox.** SBOM scope → GAP-5 |
| G-2-4 Mongo unreachable | closed | `ev/27`: 503 in 5.02 s with the plain body, readiness 503 in 5.01 s, one WARN per skipped sweep without stack, 0 ERROR, recovery 2.7 s; `ev/27b`: a new stream during the outage → GAP-1 |
| G-2-5 `stale-forget-after` | closed | `ev/22c`: 14 monitors backdated to two days of silence; a fresh monitor silent 11 s is declared DOWN (control: UP while they were recently silent), the forgotten ones keep state/notice/version, the valve still pauses on 3 of 5 recent silences and its WARN says "4 of 7", excluding the 14 |
| G-2-6 reopen after operator retire | closed | `ev/22d`: thresholds 2 and 3, the probe that notices the retire counts as #1 and incident #2 opens on exactly the threshold-th probe |
| G-2-7 forced probe vs scheduler | closed | `ev/22e`: 30 sequential forced probes of a 3 s endpoint on two nodes sweeping every second → 30 × 200, 0 × 409; a 30-probe parallel burst → 28 × 200, 2 × 409 (the documented persistent conflict); scheduler side → GAP-2 |
| G-2-8 snapshot id = log head | closed | `ev/22f`: snapshot ids equal `counters/communication_events` before and after a burst; resume from it yields exactly the later events; 15 publish-while-subscribing races: 0 misses, 5 benign duplicates, no replayed id ≤ the snapshot id |
| G-2-9 `externalRef` wording and docs | closed | `ev/22g` 17/17 (409 names the holder, says permanent, suggests `-2`, stays 409 after the holder is retired, the follow-up value works, ticket-only duplicates too; schema descriptions and 409 responses in `/v3/api-docs`; README table, semantics and cookbook consistent), `ev/23` (cookbook retry → 409 naming the notice) |

## 2. Commands run

| # | Command | Exit | Evidence |
|---|---|---|---|
| 1 | `./gradlew --max-workers=2 --no-daemon check --rerun-tasks` | 0 | `ev/01-gradle-check-run1.txt` (unit 208/0/0, integration 42/0/0, SpotBugs 0, JaCoCo 0.9553, SBOM; 1 m 29 s) |
| 2 | `./gradlew … test integrationTest` ×2 (the orchestrator's plain repeat form) | 0, 0 | `ev/02`: both were Gradle `UP-TO-DATE` no-ops (no test executed), recorded as such |
| 3 | `./gradlew … test --rerun integrationTest --rerun` ×2 (real repeat runs; no clean, `build/libs` untouched, sha unchanged) | 0, 0 | `ev/02-gradle-test-runs.txt` (250 cases 3/3, 0 flakes; 50 s, 56 s) |
| 4 | `./gradlew … -I jacoco-unfiltered.init.gradle -I spotbugs-low.init.gradle jacocoTestReport spotbugsMain` (verifier init scripts in the scratchpad; reports written there, repository build untouched) | 0 | `ev/05-jacoco-coverage.txt`, `ev/08-spotbugs-gate.txt` |
| 5 | `git diff 0e14838..HEAD -- src/test`, @Test counts, skip-marker grep, removed-assertion review | 0 | `ev/06-test-integrity.txt` |
| 6 | reachability of OSV, deps.dev, OSS Index, grype DB, vuln.go.dev, GitHub advisories; `gh api /advisories` | blocked | `ev/07-dependency-scan-attempts.txt` |
| 7 | YAML parse of `ci.yml`/`e2e.yml`, frontend scripts, SBOM scope and versions | 0 | `ev/09-ci-workflow-review.txt` |
| 8 | sidecar CI steps locally: `go vet ./...`, `CI=true go test ./...` (tools on PATH), `go run golang.org/x/vuln/cmd/govulncheck@latest ./...` | 0, 0, 1 | `ev/09b-ci-sidecar-steps-local.txt` (govulncheck: `vuln.go.dev` Forbidden) |
| 9 | frontend CI steps locally: `npm run lint`, `npm run typecheck`, `npm test`, `vite build --outDir <scratch>`, `npm audit --omit=dev --audit-level=high` (`npm ci` skipped: `node_modules` serves the shared dev server) | 0 ×5 | `ev/09c-ci-frontend-steps-local.txt` (141 tests, 0 vulnerabilities) |
| 10 | `docker exec mongo7 mongosh communication … getIndexes()` + counters + database list | 0 | `ev/10-mongo-indexes.txt` |
| 11 | `python3 -I runner.py check_a_publishing_feed_admin.py` (113 checks, :8080) → `check_a2_tenants.py` → `check_a23.py` | 108/113, 3/3, 2/2 | `ev/20`, `ev/20b`, `ev/20c` |
| 12 | `check_b_health.py` (80 checks, :8080 + stub Actuator :19160) | 79/80 | `ev/21-http-health.txt` (+ addendum: 8/8 deterministic re-check of B-34a) |
| 13 | `check_d_gaps.py` (42 checks, :8080 + private :19120) → `check_d2_valve.py` (fresh db, :19131) | 41/42, 3/3 | `ev/22`, `ev/22b` |
| 14 | `check_g25_valve.py` (:19120 + mongosh backdating), `check_g26_reopen.py` (:19100), `check_g27_probe_race.py` (:19100/:19101), `check_g28_snapshot_head.py` (:19100/:19101 + mongosh), `check_g29_externalref_openapi.py` (:8080) | 5/5, 10/10, 3/3, 4/4, 17/17 | `ev/22c`, `ev/22d`, `ev/22e`, `ev/22f`, `ev/22g` |
| 15 | `cookbook-run.sh`: README cookbook + health examples verbatim, port 19150 (private, default config) | 0 | `ev/23-readme-cookbook-run.txt` |
| 16 | `check_c_private.py` (pair :19100/:19101, db `vb2_pair`), `check_c2_private.py` (:19140, db `vb2_c2`), `check_c3_pods.py` (:19130, db `vb2_pods`) | 18/19, 8/9, 3/3 | `ev/25`, `ev/25b`, `ev/25c` |
| 17 | `sigterm_test.py` (:19141 started by the script, two open streams, SIGTERM) | 0 | `ev/26-sigterm-open-streams.txt` |
| 18 | `check_g24_mongo_down.py` (:19110 on container `vb2-mongo`, `docker stop`/`start`), `check_g24b_stream_during_outage.py` | 12/13, 4/4 | `ev/27`, `ev/27b` |
| 19 | `docker build -t vb2-backend:test .` + run on :19180 against mongo7 + probes + `docker stop` | 0 | `ev/28-backend-image.txt` |
| 20 | `check_nuances.py` (audit §6 items, :8080) | 11/11 | `ev/29-audit-nuances.txt` |
| 21 | log review of the shared backend and of the eight private instances | 0 | `ev/30-backend-logging.txt` |
| 22 | private :19190 with `events.retention=PT2H`, `client-id.required=false`, `servicenow.instance-url` | 0 | `ev/31-config-driven-behaviours.txt` |

Scripts (`lib.py`, `runner.py`, `check_*.py`, `cookbook-run.sh`, `sigterm_test.py`, the two init scripts, raw Gradle and
instance logs) are in the scratchpad `…/scratchpad/backend2/`. The iteration-1 scripts were reused with the `vb2-` prefix,
new ports and one corrected expectation (A-30: `/actuator/health` exists since iteration 1); the G-2-x, nuance, image,
SIGTERM and config checks are new. Three evidence files (`ev/20`, `ev/21`, `ev/22`) exceed the ~200-line guideline because
they keep the full transcripts of 235 checks after their tables.

## 3. Feature verdicts

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | ev/20 A-01a–d; IT `publishFeedStreamRetireRoundTrip`; ev/27 G24-j | 201 + `Location`, ACTIVE/SCHEDULED by `startsAt`, audience default, `created` frame live |
| F-02 | PASS | A-02a–e | draft invisible in feed and permalink, publish → ACTIVE, second publish 409 |
| F-03 | PASS (note) | A-03a/b; ev/29 N-1 | history present, unknown → 404; the representation carries the stored status (GAP-3) |
| F-04 | PASS | A-04a–c | any status, `status=` filter, paging |
| F-05 | PASS | A-05a–d; ev/22 D-20-c; ev/25 C-13b | partial update, version+1, 400 without `expectedVersion`, 409 stale / RETIRED / time-expired |
| F-06 | PASS | A-06a–c; D-20-b; C-13a; ev/22d G26-2-b/3-b | retire + note, idempotent, actor default; 409 after `expiresAt` |
| F-07 | PASS (note) | A-07 ×11; D-21-a/b/h/i; ev/22 addendum | every invalid body → 400 naming the field and the rule; a `null` list element → 400 with the generic message, `""` element accepted (GAP-7) |
| F-08 | PASS | A-08; ev/22g G29-a–f; ev/23; IT `duplicateExternalRefWithinTenantIsConflict`, `theExternalRefStaysTakenAfterItsHolderIsRetired` | 409 names the holder and says permanent; still 409 after the holder is retired; follow-up value and other tenant → 201 |
| F-09 | PASS | A-09a–h; ev/31; G29-e | trim/upper-case, defaults, 400 bad number / ftp url, PUT attaches with audit; with `servicenow.instance-url` the ticket gets the documented `nav_to.do…` link |
| F-10 | PASS | A-10/A-10b; ev/23 maintenance step | `expiresAt` ← `endsAt`, `startsAt` ← now |
| F-11 | PASS | A-11a–c; D-20-d | ordered entries, cap 50, actor fallback, refused retire writes nothing |
| F-12 | PASS | A-12; IT `staleVersionIsConflict` | 8 parallel PUTs: 1 × 200, 7 × 409 |
| F-13 | PASS | A-13a–c, A-05d; C-13a/b; D-20-a–c | transitions and terminal states; time-expired treated as EXPIRED by retire/update |
| F-14 | PASS | A-14a–m; D-21-h | all filters, ordering, size cap 100, bad page/size/tenant/enum → 400 |
| F-15 | PASS | A-15a/b; D-20-a; N-1 | feed and permalink compute EXPIRED before the sweep; `activeAt` honoured |
| F-16 | PASS | A-16a/b | upcoming MAINTENANCE within P7D shown, future OUTAGE hidden, `includeUpcoming=false` |
| F-17 | PASS | A-17a/b; C-17; A-02c | retired/expired permalinks 200; draft/unknown 404 |
| F-18 | PASS (note) | A-18a/c/d/e; D-4-s/p; ev/22f G28-a/d; G24-j | `:connected` first, snapshot stamped with the log head, monotonic ids, keepalive. A-18b saw the documented snapshot/live overlap for an item published within one poll of subscribing (addendum) |
| F-19 | PASS | A-19 | `service=` isolation both ways |
| F-20 | PASS | A-20a/d/e; D-1-a–e; G28-b/c; C-21d; IT `reconnectingWithLastEventIdReplaysWhatWasMissed` ×3 | header and query resume, exact replay in order then live, unknown id → snapshot, non-numeric ignored, cross-node resume; A-20b/c resumed from the overlap frame's id and got the correct replay (addendum) |
| F-21 | PASS | ev/25 C-21a–e; ev/31 | fan-out both ways, global ids, `events_ttl_idx` 86400 → 7200 via `collMod` when the retention changes (log line `events_ttl_idx now expires events after PT2H`) |
| F-22 | PASS | C-22a/b | 2 s sweep: `activated`/`expired` frames, stored status, audit by `sweeper` |
| F-23 | PASS | A-23a/c/d; ev/20c | cross-tenant search, publisher, `from`/`to`, status set, history (A-23b = iteration-0 publisher name in the script) |
| F-24 | PASS | ev/20b 3/3 | per-tenant counts + total equal the listing (A-24 compares a field the API does not have) |
| F-25 | PASS | A-25 | admin retire with actor + `retired` frame |
| F-26 | PASS | A-26 | 204, then 404 on GET and on a second DELETE |
| F-27 | PASS | A-27a–k; D-4-c; D-8-*; N-3; ev/28; ev/31; ev/30 | 401/400 contracts, `?clientId=`, OPTIONS/docs/actuator exempt, admin and health enforced, `required=false` switches it off, INFO access line per request |
| F-28 | PASS | A-28a–i; D-21-a–i; ev/27 G24-a/b/e | bodies always `{"error"}`; enums, dates, malformed JSON, 404/405/413/415 name the rule; database unavailable → 503 plain sentence |
| F-29 | PASS | A-29a–c; ev/22g G29-g–n; IT `openApiSpecIsServed`, `OpenApiContractIT` | 16 /v1 paths / 20 operations, apiKey `X-Client-Id` scheme with description applied globally, 401 on 20/20, `externalRef`/`expectedVersion` descriptions and documented 409s, Swagger UI 200 |
| F-30 | PASS (matrix text outdated) | D-8-*; N-3; ev/27 G24-c/d/g/k; ev/28; IT `OperationsEndpointsIT` (6) | Actuator liveness/readiness groups, nothing else exposed, readiness 503 within 5 s of a Mongo outage and 200 within 3 s of recovery, fail-fast startup; a root `Dockerfile` now exists: builds from the jar, runs as uid 65532 |
| F-31 | PASS | ev/21 B-31a–f | 201 + `Location`, defaults, 409 duplicate, 400 bad url, push-only without url |
| F-32 | PASS | B-32 ×11 | every out-of-range policy value and missing tenant/service → 400 naming the field |
| F-33 | PASS | B-33a–d | list all / by tenant, get one, unknown 404 |
| F-34 | PASS | B-34b; ev/22d G26 (10/10); ev/22e G27-a | probe-now applies exactly one observation, push-only → 409, 30/30 forced probes → 200 while the scheduler probes the same monitor; B-34a coincided with the shared scheduler's tick (8/8 deterministic re-check in the addendum) |
| F-35 | PASS | B-35a/b | 204, notice retired `monitor deleted` + `retired` frame, second delete 404 |
| F-36 | PASS | B-36a–d; D-24-a/b; B-38c; ev/23 | first push auto-registers push-only, 202 + monitor, missing fields → 400, legacy `details` read |
| F-37 | PASS | B-37a–f; ev/23 | document wins over HTTP status, plain 200/500, closed port, 200 ms timeout → DOWN in < 2.5 s, unresolvable host → `probe failed: …` |
| F-38 | PASS | B-38 ×9, B-38a/b/c; D-24-a/b | vocabulary, composite flattening, UP-with-DOWN-component → DEGRADED, `components` win over `details` |
| F-39 | PASS | B-39a–d; D-5-a; G26-2-a/3-a | threshold opens, first UP keeps, second UP retires, DOWN→DEGRADED restarts the streak |
| F-40 | PASS | B-40a–c; D-5-d; G26-x-e | OUTAGE/MAJOR, title/body/affectedServices/publisher/audience, `externalRef=health:<id>:<n>` |
| F-41 | PASS | B-41a–f; D-5-c/d; ev/22d | update in place, kind change retires + reopens, operator retire respected, reopen on the threshold-th failing observation (G-2-6 closed; B-41e/f now pass) |
| F-42 | PASS | unit `openClaimsTheMonitorBeforePublishingAnOutage`, `lostClaimRacePublishesNothing`, `publishFailureReleasesTheClaim` (ev/02); IT `MongoHealthMonitorRepositoryAdapterIT.staleVersionIsConflict`; ev/22e G27-c | not reproducible as a race over HTTP; tests + 38 observed cross-node conflict skips |
| F-43 | PASS (note) | ev/25 C-43/C-43b; ev/25b C-43/C-43b; G27-c | scheduler opens a notice without `/probe`; one failing monitor never stops the sweep; two nodes probe the same due monitor (GAP-2) |
| F-44 | PASS | C-44a/b (ev/25, ev/25b); D-6-a/b; ev/22c G25-a; ev/22b | silent push-only monitor → DOWN `no health report received since …`, OUTAGE in the feed, one UP report → `recovered: UP` |
| F-45 | PASS | C-45a/b; D-6-d; ev/22c G25-c/d; valve lines in ev/25 addendum; unit `silenceIsNotTrustedDuringTheStartupGrace` | 2 of 4 and 3 of 5 silent → nothing declared, WARN once; 1 of 3/4 → declared; resume logged once; forgotten monitors out of both sides; startup grace by unit test only |
| F-46 | PASS | B-46a–c; D-7-b | upsert by pod, ordered, all fields, unknown monitor 404, 20 records after a 20-pod burst |
| F-47 | PASS | B-47a–h | every rollup rule incl. `minHealthyPercent`; UNKNOWN pods `(n starting)` |
| F-48 | PASS | ev/25c C3-48a–c; ev/22b (3/3); B-48a/b; C-48b/c | `leaving:true` drops the pod at once, left + silent → DOWN naming the silent pod, all left → `UNKNOWN (no live pod reports)` with no notice; C-48a/D-6-c failed only in databases where earlier scenarios had just gone silent (valve paused as specified; addenda) |
| F-49 | PASS | B-49a; B-47h | auto-registered instance monitor gets `staleAfterSeconds=90`; explicit value kept |
| F-50 | PASS | B-50/B-50b; D-7-a/c; IT `aFleetOfPodsReportingInTheSameInstantIsAccepted` | 20 parallel first-contact and repeat reports → 20 × 202 |
| F-51 | PASS | ev/10; ev/31 | `feed_idx`, `sweep_*`, unique partial `external_ref_idx`, `events_tenant_seq_idx`, `events_ttl_idx`, `monitor_tenant_service_idx`, `instance_*`, counters doc; TTL follows the retention |
| F-56 (BE) | PASS | A-01a; ev/23 | the form's `POST /v1/communications` contract |
| F-57 (BE) | PASS | A-07 group; G29-a; D-21; G24-a | every rejection is `{"error": text}`; 409 and 503 texts are plain sentences |
| F-58 (BE) | PASS | A-14a–m | `size=100`, filters as the UI sends them |
| F-60 (BE) | PASS | A-18a/c/d; A-27e/e2; D-4-c; G24-j | frames, `?clientId=`, response committed at once, stream survives a database outage |
| F-61 (BE) | PASS | D-1-b; A-20a; G28-b | automatic reconnect with `Last-Event-ID` gets 200 + replay |
| F-62 (BE) | PASS | A-06a–c | retire with note/actor, idempotent |
| F-64 (BE) | PASS | A-27d/e; ev/28 | header and `?clientId=`; 401 without the header from the image too |
| F-70 (BE) | PASS | B-38 (WARN, WEIRD); B-38b | unknown words → DEGRADED |
| F-72 (BE) | PASS | B-38 (UNKNOWN); B-47e | UNKNOWN carries no information; starting pods not tallied |
| F-74 (BE) | PASS | B-50/B-50b; D-7-a/c; ev/27b G24-n | 409 only on a persistent conflict; a database outage is a 503 the sidecar retries |
| F-75 | PASS | B-46a; B-75a–c; B-36a | instance fields round-trip, `id` 253 ok / 254 → 400, instance without id → 400 |
| F-76 (BE) | PASS | B-48a; C3-48b | `leaving:true` marks the record left immediately; all-left service scaled to zero |
| F-88 (BE) | PASS | C3-48a; B-47e; D-6-a; G25-a | silence → DOWN naming the pod; UNKNOWN during startup opens nothing |
| F-89 (BE) | PASS (note) | ev/30 (+ addendum), ev/27, ev/25 addendum, ev/22e | INFO access line per request, notice open/retire/`closed externally; counting again` lines, valve WARN/INFO once per transition, one WARN per skipped sweep during an outage, 0 ERROR on the shared backend; notes: GAP-1, GAP-2, GAP-6 |

Totals: 65 rows owned, 65 scored, **65 PASS, 0 FAIL, 0 NOT VERIFIED**. No regression found in any row that passed in
iteration 1; the three "(note)" rows of iteration 1 (F-30, F-34, F-41) are plain passes now, and F-03/F-07/F-18/F-43/F-89
carry new notes that are GAPs below, not feature failures.

## 4. Gaps

| Gap | Severity | Feature | Root cause | Reproduced by | Suggested fix | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-backend2-1 | minor (logs; client degrades fine) | F-18, F-20, F-30, F-89 | `RestControllerFeedAdapter.stream` (`RestControllerFeedAdapter.java:68-87`) commits the SSE response (`:connected`, line 42) before the snapshot/replay query; when that query fails during a Mongo outage, `GlobalExceptionHandler.handleDatabaseUnavailable` (`GlobalExceptionHandler.java:65-73`) returns a 503 `ResponseEntity` for a committed response, `ReadOnlyHttpHeaders.set` throws `UnsupportedOperationException`, and `HttpWebHandlerAdapter` + `HttpServerOperations` ("Error finishing response") each log an ERROR with a stack trace per subscription attempt; the client gets `:connected` and a silent close after the 5 s selection timeout (browsers reconnect, so every reconnect repeats it) | ev/27b G24-l/m + its addendum (two ERROR blocks per attempt, `*__checkpoint ⇢ Exception handler …handleDatabaseUnavailable`) | in the stream pipeline, `onErrorResume` for `DataAccessResourceFailureException`/`MongoTimeoutException`/`MongoSocketException`: log one WARN and complete the stream (optionally after a `retry:` field), and/or make the handler check `exchange.getResponse().isCommitted()` | `OperationsEndpointsIT`: open `/v1/feed/stream` while Mongo is stopped and assert with `LogCapture` that no ERROR is logged |
| GAP-backend2-2 | minor (design/logs) | F-43, F-89 | every node probes every due monitor: `probeDue` (`HealthMonitor.java:112-120`) reads `lastProbeAt`, which is written only after the probe returns (`HealthSweepUseCase.java:160-168` → `HealthObservationUseCase.probe`), so with N nodes a slow or timing-out endpoint is probed N× per interval and each loser logs `WARN skipping monitor … 409 CONFLICT` per sweep (35 lines in 94 s on two nodes sweeping every second against a 3 s endpoint) — exactly when a monitored service is struggling | ev/22e G27-c; `private-19100.txt`/`private-19101.txt` | claim the slot before probing (compare-and-set `lastProbeAt`/`probingSince` on the monitor) or shard monitors across nodes; log the lost race at DEBUG | `HealthSweepUseCaseTest`: two sweeps over one due monitor → one probe |
| GAP-backend2-3 | minor (contract) | F-03, F-13, F-15 | `GET /v1/communications/{id}` returns the aggregate's stored `status` (ACTIVE) after `expiresAt`, while `POST …/retire`/`PUT` answer 409 "already expired" and feed/permalink say EXPIRED, for up to one sweep interval (30 s default); `Communication.effectiveStatus` is used by `FeedItem.from` and the guards but not by the publisher representation (audit §6.1) | ev/29 N-1 | add `effectiveStatus` (or compute `status` on read) in the publisher/admin representation and say so in the README | `PublishingUseCaseTest`: get after `expiresAt` reports EXPIRED |
| GAP-backend2-4 | minor (build gate) | builds, tests | `coverageExclusions` (`build.gradle.kts:114-117`) drops all of `config/**`: `GlobalExceptionHandler` (97 lines, 83.5 % lines, 41 of 84 branches) and `ClientIdWebFilter` (48 lines, 91.7 %) are production logic now outside the gate (22 lines, 47 branches untested and invisible); the unfiltered line ratio 0.9460 still passes 0.92, so the exclusion is not needed | ev/05 | exclude only `**/config/*Config*`, `**/config/*Properties*`, `*Application*`; consider a BRANCH rule (measured 0.79–0.82) | the gate itself |
| GAP-backend2-5 | minor (CI/SBOM) | builds (G-2-3) | `cyclonedxBom` has no configuration filter, so the SBOM the CI job scans with fail-on-high lists build/test tooling (spotbugs 4.10.5, bcel 6.13, jacoco 0.8.13, junit 5.12.2, mockito 5.17, flapdoodle, lombok, assertj; `commons-lang3` 3.17 and 3.21): tool-only CVEs would fail the build and the SBOM misdescribes the runtime | ev/09 | `tasks.cyclonedxBom { includeConfigs = listOf("runtimeClasspath") }` | a check that `bom.json` has no `spotbugs`/`junit` purl |
| GAP-backend2-6 | minor (logs) | F-89, F-30 | during a Mongo outage Spring's `MongoReactiveHealthIndicator` logs `WARN Mongo health check failed` with a full stack trace per readiness request (a kubelet probes every 10 s) and the driver logs INFO stack traces at each connectivity transition; the application's own sweeps are clean | ev/27 addendum | `logging.level.org.springframework.boot.actuate.data.mongo: ERROR` (or a custom indicator) and `logging.level.org.mongodb.driver.cluster: WARN` | n/a (log hygiene) |
| GAP-backend2-7 | minor (input wording/validation) | F-07, F-28 | a `null` element in `affectedServices` is rejected with 400 (the fixers' change) but with the generic `Failed to read HTTP message`, unlike every other input error since G-1-21; an empty-string element is accepted (201 with `["a",""]`) | ev/22 addendum | map the `MismatchedInputException` for null elements like the other binding errors (name the field) and validate elements with `@NotBlank` | `RestControllerPublishingAdapterTest` |

Observations that are not gaps: the orchestrator's plain `test integrationTest` repeat form is a Gradle no-op after a
successful run (use `--rerun` or `--rerun-tasks` for flake runs); a PROBE observation also stamps `lastReportAt`
(`HealthMonitor.java:139`), harmless for push-only staleness; the JVM exits with code 143 after SIGTERM (default signal
exit after the shutdown hooks ran; streams and server close cleanly); the cookbook's `lastEventId=1234` on a fresh database
is beyond the log and falls back to a snapshot, as documented; the sidecar job's `govulncheck@latest` pulled a newer Go
toolchain (go1.26.10) through the module proxy — it worked but is an unpinned moving part (sidecar verifier's area);
`FindBugsSummary total_classes=0` in `main.xml` is a SpotBugs XML quirk while the HTML metrics show 89 classes analysed.

## 5. Not exercised here, and why

- GitHub Actions: no runner and no network to GitHub; `ci.yml`/`e2e.yml` were read and every backend, frontend and
  sidecar step's command was run locally except `npm ci` (would reinstall the `node_modules` serving the shared dev server),
  the sidecar image build (UBI base blocked; the sidecar verifier builds it with substitutes) and govulncheck's database
  fetch (`vuln.go.dev` Forbidden). The anchore SBOM scan has no local equivalent (no grype/trivy, databases blocked, ev/07).
- Vulnerability scan of the resolved dependencies: blocked as above; only the version list in ev/09 was possible.
- TTL expiry actually removing `communication_events`/`health_instances` after 24 h: parameters verified (ev/10) and the
  `collMod` on a retention change observed (ev/31); expiry itself not waited for.
- Startup staleness grace (300 s): unit test only; private instances ran with `stale-grace-after-start-ms=0`.
- Notice-claim race (F-42) as a real race over HTTP: not deterministically reproducible; relied on the three unit tests, the
  repository IT and 38 observed cross-node conflict skips.
- Kubelet behaviour (readiness timeout 1 s vs the 5 s 503), a real OpenShift Route and the UBI base: no cluster.
- Three check rows failed only because earlier scenarios in the same database had just gone silent and paused the valve as
  specified (C-48a twice, D-6-c); each was re-run on a fresh database and passed (ev/25c, ev/22b). Not hidden: documented
  in the addenda of ev/25, ev/25b and ev/22.
- Environment: the private instances :19100–:19150, :19190, the stub :19160, the containers `vb2-mongo` and `vb2-backend`
  and the image `vb2-backend:test` were all stopped/removed; the databases `vb2_*` remain in `mongo7` (small). The shared
  stack (:8080, :3000, `mongo7`, `app`, `sidecar`) and the other verifiers' instances (`e2e2-*`, `vf2-*`, `ux2-*`, their
  backends) were not touched. `build/libs` is unchanged (sha256 `491438c7…`); `build/reports` holds run 1's SpotBugs,
  JaCoCo and SBOM output; my init-script run wrote its reports to the scratchpad only.
