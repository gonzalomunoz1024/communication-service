# Backend Verifier report — iteration 3 (2026-11-02)

Code under test: branch `confidence-loop/2026-11-01` at `e3968c4` (code identical to `4a0e84e`), Spring Boot 3.5.16 WebFlux +
reactive MongoDB. Full re-verification, not a delta: every gate re-run, the suites run three times, every owned matrix row
exercised over HTTP against a real backend (the shared :8080, 12 private instances on :19100–19195 and the image on :19180), each iteration-3
backend change and each iteration-2 closure checked with its own evidence. Evidence: `confidence/evidence/iter-3/backend/`
(cited as `ev/NN`); scripts and raw logs: `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/backend3/`
(cited as `<scratch>`). Tenants `vb3-*`, databases `vb3_*`, containers `vb3-*`; the shared stack was never stopped or reconfigured.

## 1. Verdict and scores

**Backend confidence: 80 / 100 (capped; weighted total before the cap 91). Iteration 2: 94, no gate. Hard gate tripped: an
open critical/high security finding (GAP-backend3-6).**

What changed the picture is not the code: a vulnerability database became reachable. Trivy 0.58.1 and today's trivy-db
(updated 2026-11-02T01:14Z) come through `mirror.gcr.io`, which iteration 2 did not try (it found OSV, deps.dev, OSS Index,
the grype DB and GitHub advisories blocked, as they still are). Scanning the exact SBOM the CI job scans gives 3 CRITICAL and
10 HIGH findings in netty 4.1.135.Final, jackson 2.21.4 and spring-webflux 6.2.19, the same versions iteration 2 shipped
(`ev/07`). My reachability analysis finds none of the 13 reached by this service as configured, and fixes exist for 11 of them.
But the repository records no triage, and the CI job's own rule would fail on them (`ci.yml:40`: "a critical or high finding in
a runtime dependency fails the job"). By the rubric that is an open finding, so the score is capped at 80. Without that gap the
weighted total is 91. Every backend item of G-3-1…G-3-32 is confirmed; one of them, G-3-2, re-opened G-2-7 as a
regression (GAP-1).

| Category | Weight | Score | Why (evidence) |
|---|---|---|---|
| Builds & static checks | 10 | 6 | Clean: `check --rerun-tasks` exit 0 in 2 m 41 s, 12 tasks, 0 javac warnings under `-Werror` (`ev/01`). SpotBugs (effort max, confidence medium) analysed 92 classes, 0 findings; its one new exclusion (MongoReadinessIndicator constructor injection) is justified (`ev/08`). JaCoCo LINE 0.9651 and the new BRANCH rule 0.8474 ≥ 0.84 (`ev/05`). `verifySbomScope`: 87 runtime components, no tool (`ev/09`). **Deduction (−4):** the dependency criterion fails, with 3 CRITICAL and 10 HIGH in runtime dependencies (`ev/07`, GAP-6). What would close it: netty 4.1.137.Final and jackson 2.21.7 overrides, plus a recorded, justified ignore for the two spring-webflux items (or Framework 7.0.9+), then a green `trivy sbom` (or grype) at cutoff high. |
| Feature completeness | 30 | 30 | 65 of 65 owned rows PASS (section 3). 436 scripted checks in `ev/20`–`ev/38`, 425 PASS; the 11 FAILs are 6 script artefacts re-verified clean (`ev/20b`, `ev/33b`) and 5 checks of the GAP-1 regression. Also covered: the README cookbook run verbatim twice (`ev/35`), the configuration-driven paths (`ev/36`), SIGTERM (`ev/37`), the image (`ev/34`) and the indexes (`ev/10`). F-34 passes with a regression note (GAP-1), as iteration 1 treated the original G-2-7. |
| Automated test health | 20 | 19 | 297 tests (251 unit + 46 IT, up from 250) over three executed runs: 0 failures, errors or skips; all 297 cases pass 3/3 (`ev/02`). Every guarding test named in `iter-3/fixes.md` is present and green. Test integrity: 47 `@Test` added, 0 removed or skipped; each of the 34 removed lines is replaced by an equal or stronger assertion of a documented change (`ev/06`). **Deduction (−1):** no test caught the G-2-7 regression. The existing probe-now tests mock the conflict and never model the scheduler's new claim save (GAP-1). The branch gate also has a 6-branch margin. |
| Integration & contracts | 20 | 18 | Publishing, feed, SSE, admin, client id, errors and OpenAPI: 110/113 on :8080 (`ev/20`); the 3 FAILs are a frame-order artefact of my script, re-verified 9/9 (`ev/20b`). Health: 80/80 (`ev/21`). Iteration-3 contracts: 51/51 (`ev/22`). Two-node fan-out, sweeps and staleness: 19/19 (`ev/25`). Gap re-checks: 42/42 (`ev/29`). **Deductions (−2):** a forced probe loses to the scheduler again since G-3-2 (`ev/26`–`26d`, GAP-1). Monitor registration still silently ignores misspelled policy fields, against the G-3-8 rule (GAP-2). With `client-id.required=false`, no request is logged (GAP-5). |
| Resilience & ops | 10 | 9 | Stopped mongod: 503 after 5.02 s. Frozen mongod: first read 20.03 s, first write 15.02 s, then 5.01 s, as README:118-125 now says. Readiness answers 503 while liveness stays 200, the service recovers without a restart, and a stream opened before the outage survives it. A stream opened during the outage gets 200 then EOF, with one WARN. Each outage logs two readiness lines, with 0 ERROR, 0 stack lines and 0 driver INFO (`ev/33`, `ev/33b`). SIGTERM closes 2 open streams in 6 ms, exit 143 (`ev/37`). The image runs as UID 65532 (`ev/34`). **Deductions (−1):** readiness answers in 1.01–1.06 s, not within the kubelet's 1 s it promises to beat (GAP-3). One Reactor `onErrorDropped` ERROR with a 74-line stack trace on the shared backend, from a probe of a dead target (GAP-4). |
| Usability | 10 | 9 (provisional) | API level only; I defer to the Usability Reviewer. The input errors now name the field and its value and list the known fields: `unknown field 'sevrity'; known fields: …`, `endsAt … must be after startsAt, which defaulted to now (…)`, `affectedServices[1]: must not be null`. The automated notice reads as plain sentences. The 409/503 texts are sentences, and the cookbook runs verbatim (`ev/22`, `ev/35`). **Nits:** misspelled monitor policy fields are ignored (GAP-2). Fractional numbers are truncated silently (`intervalSeconds: 5.5` → 5, `expectedVersion: 1.5` → 1). A >1000-digit numeric string gets the generic `Failed to read HTTP message` (`ev/07` probe). README:110/159 write `: connected` while the wire sends `:connected` (harmless). |
| **Weighted total** | | **91 → 80** | cap 80 applies (open critical/high security finding) |

**Hard gates**

| Gate | Tripped? | Reason |
|---|---|---|
| Any matrix item fails E2E | No | 65/65 PASS. F-34 is counted PASS (note): its own check passes (`lastProbeAt` set; push-only → 409, B-34a/b), and in the default configuration 9 of 10 forced probes of the worst-case monitor answer 200 (`ev/26d`). The iteration-2 G-2-7 scenario (sweep every 1 s) now fails 30/30 (GAP-1). If the auditor counts that scenario as part of F-34's E2E, this gate trips as well; the cap stays 80. |
| A test skipped, deleted or loosened without justification | No | `ev/06` |
| Sidecar non-root / restricted-v2 | n/a | Not this verifier's area. The backend image runs as 65532:65532 (`ev/34`). |
| Open critical/high security finding | **Yes** | GAP-6, `ev/07`: 3 CRITICAL + 10 HIGH in runtime dependencies, no triage record, and the CI scan's own rule fails on them. The backend image's OS packages add 2 CRITICAL + 12 HIGH from the distroless debian12 base (information, GAP-7). |

**Iteration-3 backend changes, each with its own evidence**

| Gap | Verdict | Evidence |
|---|---|---|
| G-3-1 stream during a DB outage | confirmed | O-1f/O-1h (`ev/33b`): 200, `:connected`, EOF after 5.01 s, one `feed stream closed: database unavailable` WARN, 0 ERROR, no stack; the IT `aStreamOpenedWhileTheDatabaseIsUnreachableEndsWithOneWarningAndNoError` 3/3 (`ev/02`) |
| G-3-2 probe-slot claim | confirmed; it caused GAP-1 | G32-a (`ev/24`): 13 probes in 62 s across 2 nodes sweeping every second (uncoordinated would be ~24), gaps 5.02–5.07 s. G32-b: 0 `skipping monitor` WARN and 0 ERROR on either node; the lost claim shows only at DEBUG (`ev/24b`). Across all my iteration-3 logs, the WARN appears only in the iteration-2 A/B jar (`ev/38`). |
| G-3-3 effective status on publisher/admin reads | confirmed | `ev/23` 11/11 with the sweeper off: GET by id, the publisher list and admin search say EXPIRED after `expiresAt` while the stored document stays ACTIVE, version 0, history 1 (the tenant summary counts stored statuses by design, A-24). N-1 on :8080 (`ev/32`). |
| G-3-4 coverage scope + branch rule | confirmed | `ev/05`: the gate leaves out only 5 wiring classes (33 lines, 0 branches). The handler, the filter, the readiness indicator and the unknown-fields module are inside the gate. BRANCH 0.8474 ≥ 0.84. |
| G-3-5 SBOM scope | confirmed | `ev/09`: 87 components, none a tool. 76 of the 79 `BOOT-INF/lib` jars match by exact name-version, 2 netty native jars match without their classifier, and only `spring-boot-jarmode-tools` is absent. |
| G-3-6 outage log hygiene + readiness | confirmed, with GAP-3 | `ev/33/33b`: two readiness lines per outage (WARN DOWN, INFO UP), 0 driver INFO, 0 stack lines. Readiness 503 in 1.01–1.06 s. |
| G-3-7 / G-3-8 / G-3-9 / G-3-32 input errors | confirmed, with GAP-2 | G3-7-a…g, G3-8-a…k, G3-9-a…f, G3-32-a/b (`ev/22`). Unknown fields → 400 naming them on publish, update, retire and ticket; a health report stays lenient (the sidecar's real wire request → 202). Exception: monitor registration, G3-8-l. |
| G-3-11 resume precedence | confirmed | G3-11-a…d (`ev/22`): resumes after the larger of `?lastEventId=` and `Last-Event-ID` in both orders; either alone works |
| G-3-25 automated notices (backend) | confirmed | G3-25-a…i (`ev/22`), C-44a (`ev/25`): body in plain sentences with the time to the second, "Failing components:" lines and the origin sentence. Created, updated and retired under the monitor's own publisher (`health-sidecar` for sidecar services, `health-monitor` by default). |
| G-3-30 status vocabulary | confirmed | G3-30-a…g (`ev/22`): every word, in 3 spellings each, as overall status (45 reports) and as component status; pull documents use the same words |
| G-3-31 README outage timings | confirmed | `ev/33`: stopped 5.02/5.01 s; SIGSTOPped first read 20.03 s, first write 15.02 s, later 5.01 s; recovery after SIGCONT immediate |

**Iteration-2 closures (regression check)**

| Gap | Verdict | Evidence |
|---|---|---|
| G-2-1 `-Werror` | holds | `ev/01`: 0 compiler warnings |
| G-2-2 SpotBugs + JaCoCo gates | holds | `ev/01`, `ev/05`, `ev/08` |
| G-2-3 CI | holds as far as checkable | `ev/39`. The backend job is unchanged and its `check` step passes locally. Its scan step would fail today (GAP-6). Actions cannot run here. |
| G-2-4 Mongo unreachable | holds | `ev/33/33b` |
| G-2-5 stale-forget-after | holds | `ev/30` 5/5 |
| G-2-6 reopen on the threshold-th probe | holds | `ev/28` 10/10 |
| **G-2-7 forced probe vs scheduler** | **regressed (GAP-1)** | `ev/26`: 0 × 200 / 30 × 409 where iteration 2 had 30 × 200. `ev/26b`: interval 5 s fails 10/10 on the pair and on a single node; 15 s and 30 s pass. `ev/26c`: A/B, iteration-2 jar 10 × 200 vs iteration-3 jar 10 × 409. `ev/26d`, default configuration: iteration-3 jar 9 × 200 + 1 × 409 with 4 of 10 calls retried, iteration-2 jar 10 × 200 with none retried. |
| G-2-8 snapshot id = log head | holds | `ev/27` 4/4: 15 races, 0 misses |
| G-2-9 externalRef wording | holds | `ev/31` 17/17 |

## 2. Commands run

`<s>` = `<scratch>/scripts`. Runner scripts exit 0 even when a check fails; the check count is given.

| # | command | exit code | evidence file |
|---|---|---|---|
| 1 | `pgrep -f GradleWrapperMain` (no other build) then `./gradlew --max-workers=2 --no-daemon check --rerun-tasks` | 1 (none running); 0 | `ev/01`, `ev/05`, `ev/08`, `ev/09` |
| 2 | `./gradlew --max-workers=2 --no-daemon test --rerun integrationTest --rerun` (run 2) | 0 | `ev/02` |
| 3 | same (run 3) | 0 | `ev/02` |
| 4 | `./gradlew --max-workers=2 --no-daemon -I <s>/jacoco-unfiltered.init.gradle -I <s>/spotbugs-low.init.gradle jacocoTestReport spotbugsMain` (verifier-only init scripts, output to the scratchpad) | 0 | `ev/05`, `ev/08` |
| 5 | `sha256sum build/libs/*.jar` before/after; `unzip -Z1 build/libs/*.jar \| grep BOOT-INF/lib` | 0 | `ev/01`, `ev/09` |
| 6 | `git diff --stat` / `-U0 908598a 4a0e84e -- src/test`; `git grep -c @Test` at both commits | 0 | `ev/06` |
| 7 | curl to api.osv.dev, api.deps.dev, ossindex, grype DB, NVD; `api.github.com/advisories`; `docker pull ghcr.io/aquasecurity/trivy` | 56 (blocked) ×7; 0 (403); 1 (blob 403) | `ev/07` |
| 8 | `docker pull mirror.gcr.io/aquasec/trivy:0.58.1`; `docker run … trivy sbom --scanners vuln … /scan/bom.json` | 0; 0 | `ev/07` |
| 9 | `docker run … trivy image --skip-db-update --scanners vuln --pkg-types os vb3-backend:test`; same with `--image-src remote gcr.io/distroless/java21-debian13:nonroot`; `docker buildx imagetools inspect` (3 tags) | 0; 0; 0 | `ev/07` |
| 10 | `python3 -I <s>/check_g_jackson_regex.py` (:19195) | 0 | `ev/07` |
| 11 | `docker exec mongo7 mongosh --quiet communication --eval <getIndexes ×5, counters>` (read-only) | 0 | `ev/10` |
| 12 | `python3 -I <s>/runner.py check_a_publishing_feed_admin.py` (:8080) | 0 (110/113) | `ev/20` |
| 13 | `runner.py check_a18_recheck.py` (:8080, 3 rounds) | 0 (9/9) | `ev/20b` |
| 14 | `runner.py check_b_health.py` (:8080, stub :19160) | 0 (80/80) | `ev/21` |
| 15 | `runner.py check_g3_contracts.py` (:8080) | 0 (51/51) | `ev/22` |
| 16 | `runner.py check_g33_effective.py` (:19105, sweeper off) | 0 (11/11) | `ev/23` |
| 17 | `runner.py check_g32_probe_claim.py` (:19100/:19101), then again with DEBUG on :19101 | 0 (3/3); 0 (3/3) | `ev/24`, `ev/24b` |
| 18 | `runner.py check_c_private.py` (:19100/:19101, one database) | 0 (19/19) | `ev/25` |
| 19 | `runner.py check_g27_probe_race.py` (:19100/:19101) | 0 (2/3) | `ev/26` |
| 20 | `runner.py check_g27b_regression.py` (pair + :19120) | 0 (2/4) | `ev/26b` |
| 21 | `runner.py check_g27c_ab.py` (:19120 iteration-3 jar vs :19121 iteration-2 jar) | 0 (1/2) | `ev/26c` |
| 22 | `runner.py check_g27d_default.py` (:19125 iteration-3 vs :19126 iteration-2, default configuration) | 0 (3/4) | `ev/26d` |
| 23 | `runner.py check_g28_snapshot_head.py` (pair) | 0 (4/4) | `ev/27` |
| 24 | `runner.py check_g26_reopen.py` (:19100) | 0 (10/10) | `ev/28` |
| 25 | `runner.py check_d_gaps.py` (:8080 + :19120) | 0 (42/42) | `ev/29` |
| 26 | `runner.py check_g25_valve.py` (:19120) | 0 (5/5) | `ev/30` |
| 27 | `runner.py check_g29_externalref_openapi.py` (:8080) | 0 (17/17) | `ev/31` |
| 28 | `runner.py check_nuances.py` (:8080) | 0 (11/11) | `ev/32` |
| 29 | `runner.py check_g3_outage.py` (:19110 on container `vb3-mongo`: `docker stop/start`, then `docker kill -s STOP` / `-s CONT` to freeze its mongod) | 0 (19/22) | `ev/33` |
| 30 | `runner.py check_g3_outage_rerun.py` (phase 1 with corrected expectations) | 0 (14/14) | `ev/33b` |
| 31 | `docker build -t vb3-backend:test .`; run on :19180; `docker stop`; `docker build -q` | 0; 0; 0 (143 in container); 0 | `ev/34` |
| 32 | `bash <s>/cookbook-iter3.sh` twice (extracted by `cookbook_extract.py` from README; :19150) | 0; 0 | `ev/35` |
| 33 | `runner.py check_e_config.py` (:19190, retention PT2H, client-id off, ServiceNow URL, upcoming PT1H, grace 20 s) | 0 (9/9) | `ev/36` |
| 34 | `python3 -I <s>/sigterm_test.py` (:19141) | 0 | `ev/37` |
| 35 | `runner.py check_f_dropped.py` (:19195) | 0 (1/1) | `ev/38` |
| 36 | grep of `logs/backend-iter3.log` and 13 private logs | 0 | `ev/38` |
| 37 | `sed -n 19,46p .github/workflows/ci.yml`; `git diff 908598a 4a0e84e -- .github/` | 0 | `ev/39` |
| 38 | cleanup: 98 × `DELETE /v1/health/monitors/{id}` (vb3 tenants on :8080), SIGTERM to my backends and stub, `docker rm -f vb3-mongo` | 0 (98 × 204) | `ev/40` |

## 3. Feature verdicts

Check ids refer to the tables in the evidence files. "(BE)" marks rows owned with another verifier; this verdict covers the
backend's side of the contract.

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | A-01a–d (`ev/20`); `ev/35` | 201 + Location, ACTIVE/SCHEDULED, `created` frame. Publishing a window already over answers 201 with EXPIRED (G33-j, observation). |
| F-02 | PASS | A-02a–e | Draft is invisible in feed, stream and permalink, emits no event, publishes later; publishing twice → 409 |
| F-03 | PASS | A-03a/b; G33-a/b (`ev/23`); N-1 (`ev/32`) | Any status, with history; unknown → 404 `{error}`; EXPIRED after `expiresAt` without a write (G-3-3) |
| F-04 | PASS | A-04a–c; G33-c/e | Filters work; reads report the effective status, while the `status` filter matches the stored one (README:138-139) |
| F-05 | PASS | A-05a–d; G3-8 (update), G3-9-d/e/f (`ev/22`); D-20-c (`ev/29`); `ev/35` | `expectedVersion` 400 explains what to send; a mismatch → 409; values named in the date errors |
| F-06 | PASS | A-06a–c; G33-i; D-20-b, D-5-b; G26 (`ev/28`); `ev/35` | Idempotent on RETIRED; 409 on EXPIRED; actor and note recorded |
| F-07 | PASS | A-07 (11 cases); G3-7-a–g, G3-8-a–j, G3-9-a–f, G3-32-a/b; D-21-a–i | Every input error is a sentence naming the field and value; unknown fields are listed with the known ones |
| F-08 | PASS | A-08; G29-a–g (`ev/31`); `ev/35` run 2 | 409 names the holder, says the key is permanent, suggests `-2` |
| F-09 | PASS | A-09a–h; E-09-a/b (`ev/36`) | Trimmed and upper-cased, pattern checked; ServiceNow link built from `instance-url` (trailing slash trimmed); own URL kept; other systems left alone |
| F-10 | PASS | A-10, A-10b; `ev/35` | MAINTENANCE expiry defaults to `endsAt`; start defaults to now |
| F-11 | PASS | A-11a–c; D-20-d; G3-25-i | History appended and capped at 50 after 60 updates; without an actor the publisher is recorded (`no actor given, publisher p`), which the matrix text (`unknown`) predates |
| F-12 | PASS | A-12 | 8 parallel PUTs with the same version → 1 × 200, 7 × 409 |
| F-13 | PASS | A-13a–c; C-13a/b (`ev/25`); G33-g | State machine enforced; 409 texts name the state |
| F-14 | PASS | A-14a–m; D-21-h | `tenantId` required; filters for service, type, severity, audience, `activeAt`, upcoming, paging |
| F-15 | PASS | A-15a/b; D-20-a; G33-f | The effective status is consistent on every read path now |
| F-16 | PASS | A-16a/b; E-16-a (`ev/36`) | Upcoming window honoured at the default 7 d and at a configured PT1H |
| F-17 | PASS | A-17a/b; A-02c; C-17; A-15a | RETIRED and EXPIRED stay retrievable; unknown ids and drafts → 404 |
| F-18 | PASS | A-18a/c/d/e; A-18b-r1–r3 (`ev/20b`); D-4-s/p; G28-a/d (`ev/27`); O-1f/O-1l (`ev/33b`); `ev/35` | `:connected` first; snapshot id = log head; survives an outage; at-least-once overlap documented |
| F-19 | PASS | A-19 | Server-side per-subscriber filters |
| F-20 | PASS | A-20a/d/e; A-20b/c-r1–r3; G3-11-a–d; G28-b/c; O-1h; D-1-a–e | Resume via header or query, after the larger id; 15 races with no miss |
| F-21 | PASS | C-21a–e (`ev/25`) | Published on one node, received on the other |
| F-22 | PASS | C-22a/b | SCHEDULED → ACTIVE → EXPIRED by the sweeper, with frames |
| F-23 | PASS | A-23a–d; G33-d | Filters and history; effective status |
| F-24 | PASS | A-24 | Counts match the stored statuses in Mongo |
| F-25 | PASS | A-25 | Same rules and events as the publisher retire |
| F-26 | PASS | A-26 | Purge 204; then GET 404 and purge 404 |
| F-27 | PASS (note) | A-27a–k, A-27e2; D-4-c; E-27-a (`ev/36`); `ev/34` | 401/400 rules, `?clientId=` for streams, access line per request. Note GAP-5: with the check switched off, nothing is logged. |
| F-28 | PASS | A-28a–i; D-21-a–h; O-1a/b, O-1e (`ev/33b`) | 400/404/409/503 bodies are `{error: sentence}`; no driver detail leaks |
| F-29 | PASS | A-29a–c; G29-h–o (`ev/31`) | Every `/v1` path, `X-Client-Id` scheme, 401 documented |
| F-30 | PASS (note) | A-30; D-8-* (`ev/29`); N-3 (`ev/32`); O-1c/d/j, O-2c/g, O-3 (`ev/33/33b`) | Only health is exposed; liveness/readiness groups; readiness DOWN in ~1 s; no start without Mongo (exit 1). Note GAP-3: 1.01–1.06 s. |
| F-31 | PASS (note) | B-31a–f (`ev/21`); E-45-0 (`ev/36`); `ev/35` | 201 + Location, defaults from configuration; 409 on a duplicate. Note GAP-2: misspelled policy fields ignored. |
| F-32 | PASS (note) | B-32 (11 cases) | Every bound enforced with a sentence. Note GAP-2. |
| F-33 | PASS | B-33a–d | All monitors or one tenant's, with live state |
| F-34 | PASS (note) | B-34a/b; G26 (`ev/28`); G27b-S2/S4 (`ev/26b`); G27d-D2/D3 (`ev/26d`) | Applies one observation; push-only → 409. **Regression GAP-1:** G27-a 0/30 (`ev/26`), G27b-S1/S3 0/10, A/B (`ev/26c`), default configuration D1 9/10 (`ev/26d`). |
| F-35 | PASS | B-35a/b; G3-25-i; `ev/40` (98 × 204) | The notice is retired as `monitor deleted` under the monitor's publisher |
| F-36 | PASS | B-36a–d; D-24-a/b; G3-8 (lenient report) | Unknown keys accepted on reports, as documented |
| F-37 | PASS | B-37a–f; G3-30-e | A status-bearing document wins over the HTTP status; timeouts; plain HTTP fallback |
| F-38 | PASS | B-38 (9 cases), B-38a–c; G3-30-a/b/d | Shared vocabulary; unknown words → DEGRADED; UNKNOWN carries no information |
| F-39 | PASS | B-39a–d; G26; D-5-a | Debounce in both directions |
| F-40 | PASS | B-40a–c; G3-25-a–h; D-5-d | OUTAGE/HEALTH at the policy severities; plain-words body |
| F-41 | PASS | B-41a–f; G26; D-5-c | Updated in place on a signature change; reopens on the threshold-th probe after an operator retire |
| F-42 | PASS | unit `openClaimsTheMonitorBeforePublishingAnOutage`, `lostClaimRacePublishesNothing`, `publishFailureReleasesTheClaim`; IT `staleVersionIsConflict` (3/3, `ev/02`) | Not reproducible as a race over HTTP (section 5) |
| F-43 | PASS | G32-a–c (`ev/24/24b`); C-43, C-43b; G27-c (`ev/26`) | One probe per due monitor across nodes; one failing monitor never stops the sweep; quiet loser |
| F-44 | PASS | C-44a/b; D-6-a/b; G25-a (`ev/30`); E-45-b | Silence → DOWN with the "No health report received since …" sentence; recovers on a report |
| F-45 | PASS | C-45a/b; D-6-d; G25-c/d; E-45-a/b (`ev/36`) | The valve pauses on mass silence and forgets abandoned monitors. Startup grace 20 s: DOWN 19.9 s after `Started`, never before. |
| F-46 | PASS | B-46a–c; D-7-b | Per-instance upsert; fields round-trip |
| F-47 | PASS | B-47a–h, B-47c2; G3-25-e | Rollup rules; the notice names the pods |
| F-48 | PASS | B-48a/b; C-48a–c; D-6-c | `leaving:true` marks the instance left at once; scaled to zero opens nothing |
| F-49 | PASS | B-49a | Auto-registered monitors get the instance staleness window |
| F-50 | PASS | B-50, B-50b; D-7-a/c | 20 parallel reports → 20 × 202, twice |
| F-51 | PASS | `ev/10`; E-51-a/b (`ev/36`) | All named indexes, unique partial `external_ref_idx`, TTL 86400; a configured PT2H changes the TTL to 7200 in place, with its log line |
| F-56 (BE) | PASS | A-01a; `ev/35` | The form's `POST /v1/communications` contract |
| F-57 (BE) | PASS | A-07, A-28; G3-7/8/9; G29-a | Every rejection is `{"error": text}` |
| F-58 (BE) | PASS | A-14a–m | `size=100`; filters as the UI sends them |
| F-60 (BE) | PASS | A-18a/c/d, A-27e/e2; O-1f/O-1l | Frames, `?clientId=`, committed at once, survives an outage |
| F-61 (BE) | PASS | A-20a; A-20b/c-r1–r3; G28-b; G3-11 | Automatic reconnect with `Last-Event-ID` replays |
| F-62 (BE) | PASS | A-06a–c | Retire with note and actor; idempotent |
| F-64 (BE) | PASS | A-27d/e; `ev/34` | Header and `?clientId=`; 401 without it, also from the image |
| F-70 (BE) | PASS | G3-30-a–g; B-38 | The service reads every sidecar word the same way |
| F-72 (BE) | PASS | B-38 (UNKNOWN), B-47e; G3-30-d-UNKNOWN | UNKNOWN during startup opens nothing |
| F-74 (BE) | PASS | B-50/B-50b; D-7-a/c; O-1e | 409 only on a persistent conflict; database outage → 503, retryable |
| F-75 | PASS | B-75a–c, B-46a, B-36a; G3-8-k | The sidecar's real wire request → 202; instance id 253 ok / 254 → 400 |
| F-76 (BE) | PASS | B-48a; C-48b | `leaving:true` honoured |
| F-88 (BE) | PASS | C-48a; B-47e; D-6-a; G25-a | Silence → DOWN naming the pod; UNKNOWN during startup opens nothing |
| F-89 (BE) | PASS (note) | `ev/38`; O-1g/i/k, O-2f; G32-b, `ev/24b`; E-51-b | One access line per request, notice and valve lines, two readiness lines per outage, 0 ERROR on every private instance. Notes: GAP-4 (one dropped-error ERROR on :8080), GAP-5. |

## 4. Gaps

| ID | Severity | Feature ID(s) | Root cause (file:line) | How reproduced | Suggested fix (one line) | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-backend3-1 | minor (**regression of closed G-2-7**, deterministic with a 1 s sweep) | F-34, F-43 | Since G-3-2 the scheduler saves each probe twice: the claim before (`HealthSweepUseCase.java:170`, `:194-195` `monitors.save(monitor.withProbeClaimed(now)).flatMap(… probe …)`) and the result after. A forced probe holds the version it read for the whole probe, and each retry probes again (`HealthMonitorUseCase.java:123-129`, `PROBE_ATTEMPTS = 3` at `:48`). So when the probe takes more than about half the interval, no gap between the scheduler's saves is long enough. | 3 s endpoint, interval 5 s. Sweep 1 s: 0/30 on two nodes (`ev/26`); 0/10 on the pair and on one node, while 15 s and 30 s pass (`ev/26b`). A/B on the same scenario: iteration-2 jar 10/10, iteration-3 jar 0/10 (`ev/26c`). Default 5 s sweep: 9/10 with one 409, and 4 of 10 calls needed retries of 6–9 s, where the iteration-2 jar got 10/10 at 3 s (`ev/26d`). | On a version conflict, re-read the monitor and apply the observation already obtained instead of probing again; or take the probe slot in `probeNow` the way the sweep does. | An IT (e.g. `HealthMonitoringE2EIT`) that runs the real scheduler against a slow stub (probe ≈ 0.6 × interval) and asserts that `POST …/probe` answers 200. The existing `HealthMonitorUseCaseTest` probe-now tests (lines 187–243) mock the conflict. |
| GAP-backend3-2 | minor | F-31, F-32 | `RegisterMonitorCommand.java:14` lacks `@JsonIgnoreProperties(ignoreUnknown = false)`, which `RejectUnknownFieldsModule` needs. G-3-8 gave it to the publish, update, retire and ticket bodies. | `{"intervalSecond": 5, "downSeverty": "CRITICAL"}` → 201 with the defaults 30 s and MAJOR (G3-8-l, `ev/22`) | Annotate the command like the publishing ones (health reports stay lenient). | `RestControllerHealthAdapterTest`: a misspelled policy field → 400 naming it |
| GAP-backend3-3 | minor | F-30, F-89 | `MongoTimeoutProperties.java:21` `@DefaultValue("PT1S")` plus the check's own overhead (`MongoReadinessIndicator.java:38-39`). `application.yml:60-64` and README:104 promise an answer within a kubelet's default 1 s, "so the probe gets the 503 instead of a timeout". | Readiness during an outage answers 503 in 1.01, 1.01, 1.01, 1.01, 1.06 s (O-1c) and 1.01, 1.01 s (O-2c) (`ev/33/33b`) | Default `readiness-timeout` PT0.8S, or document `timeoutSeconds ≥ 2` for the probe. | `MongoOutageReadinessTest` asserting the 503 arrives in < 1 s |
| GAP-backend3-4 | minor (logs; suspected root cause) | F-37, F-89 | `WebClientHealthProbeAdapter.java:46-55`: `.timeout(timeout)` ends the exchange, and when the connect failure arrives just after, Reactor's default `onErrorDropped` hook logs it at ERROR with the full trace. No `Hooks.onErrorDropped` is installed. | Once on the shared backend (`backend-iter3.log:47`, 06:45:54): an earlier verifier's monitor `be-h-efa728/slow-svc` (timeoutMs 200, dead 127.0.0.1:18555) while the host was busy. 74 stack lines, no `com.atlas` frame. Not reproduced on demand in 71 s with a hanging connect (`ev/38`). | Install a `Hooks.onErrorDropped` that logs dropped probe errors at DEBUG/WARN without the trace, or give the WebClient a connect timeout no longer than the probe timeout. | A `WebClientHealthProbeAdapterTest` that times out a probe while its connection fails, asserting no ERROR via `LogCapture` |
| GAP-backend3-5 | minor | F-27, F-89 | `ClientIdWebFilter.java:63` returns `chain.filter(exchange)` before the access logging when `communication.client-id.required=false`, so no request is logged, not even one that carries `X-Client-Id`. README:188-189: "Every request is logged with its id". | :19190 with the check off: 0 `ClientIdWebFilter` lines for 31 `/v1` requests (`ev/36`) | When the check is off, still log the access line (`client=<id or ->`). | `ClientIdWebFilterEdgeCasesTest` with `required=false` asserting the access line |
| GAP-backend3-6 | **blocker (hard gate; fails the repository's own CI scan rule)** | build/security (all rows ship these libraries) | `build.gradle.kts:8` Spring Boot 3.5.16 manages netty 4.1.135.Final, jackson 2.21.4 and spring-webflux 6.2.19, with no override. Trivy finds CRITICAL CVE-2026-75595 (netty-handler, fixed 4.1.137.Final) and CVE-2026-47890 / CVE-2026-47892 (spring-webflux, Trivy lists only 7.0.9). It also finds HIGH: 2 × jackson-core, 3 × jackson-databind (fixed 2.21.7) and 5 × netty codec (fixed 4.1.136.Final). | `trivy sbom` on `build/reports/cyclonedx/bom.json`, the file `ci.yml:44` scans, with the DB from 2026-11-02T01:14Z (`ev/07`). Versions confirmed in `BOOT-INF/lib`. Reachability: TLS/SNI, SPDY, bzip2, HTTP/2, view fragments, functional endpoints, polymorphic typing and XML datatypes are unused. A 60 000-digit stringified-number probe answers in ms. So none is reached as configured, but none is triaged either. | Override `netty.version=4.1.137.Final` and `jackson-bom.version=2.21.7` (or take a Boot patch that does), and record a justified ignore for the two spring-webflux items (or move to Framework 7.0.9+). | The CI job's `anchore/scan-action` (cutoff high), which cannot run here. A local scan step (`trivy sbom` or grype) documented next to `check` would make it reproducible on a laptop. |
| GAP-backend3-7 | minor (information; the CI policy scans the SBOM only) | F-30 (image), ops | `Dockerfile:11` `ARG BASE_IMAGE=gcr.io/distroless/java21-debian12:nonroot`. The debian12 line ships packages Debian has already fixed (libexpat1 2.5.0-1+deb12u2, libbrotli1 1.0.9-2+b6). | `trivy image --pkg-types os vb3-backend:test`: 2 CRITICAL + 12 HIGH, 10 of them fixable. The base digest equals the tag's current remote digest. `gcr.io/distroless/java21-debian13:nonroot`: 0 CRITICAL, 4 HIGH (libuuid1, no fix) (`ev/07`). | Default `BASE_IMAGE` to `java21-debian13:nonroot`, pinned by digest. | An image scan step in CI (`trivy image` / grype on the built image) |

Observations, not gaps:
- Publishing a window that is already over (both `startsAt` and `expiresAt` in the past) answers 201 with status EXPIRED. The document is stored as ACTIVE and emits `created` until the sweeper runs (G33-j).
- The retire answer's history `at` has nanoseconds where a GET shows milliseconds.
- During an outage, the two sweeps share Spring's single scheduler thread, so each logs about every 10 s rather than every 5 s (O-1i).
- During an outage, every failed event-log poll logs `event log poll failed` as a WARN. Each poll waits out the 5 s server selection, so that is about one line per 5 s (19 lines over the 81 s of outages, `ev/38`).
- `fixes.md` says 247 unit tests; I count 251 per run (`ev/02`).
- SpringDoc logs two "enabled by default" WARNs at every start; Swagger UI is documented as intended.

## 5. Not exercised here, and why

- **A GitHub Actions run of the backend job:** there is no runner in this sandbox, and the session token is repository-bound (`api.github.com/advisories` → 403). The local `check` is the same command. That the scan step would fail is an inference from GAP-6, not an observation.
- **grype, the CI's scanner:** its databases (`grype.anchore.io`, `toolbox-data.anchore.io`) are blocked, so Trivy with the GHSA-based trivy-db stands in. OSV, deps.dev, OSS Index and NVD are blocked too (`ev/07`).
- **OpenShift / a real kubelet:** there is no cluster, and kind cannot start pods here (`environment.md`). Readiness timing was measured with an HTTP client, not with a kubelet's `timeoutSeconds`. The restricted-v2 SCC is not exercised for the backend image (it runs as UID 65532).
- **The 24 h TTL expiry of `communication_events` and `health_instances`:** only the index definitions and an in-place TTL change (to 7200) were verified.
- **F-42's claim race over HTTP:** it cannot be induced from outside, so it rests on the unit and IT tests.
- **The default 300 s startup grace:** the same code path was verified with 20 s (E-45-a/b).
- **GAP-4 on demand:** the timing window was not hit in 71 s. The only occurrence is the shared-log line.
- **ServiceNow:** nothing calls it by design. Only the generated link was checked.
- **Several nodes behind a real load balancer:** two nodes on one database were reached on their own ports.
- **Cleanup state (`ev/40`):** all my monitors on :8080 are deleted (98 × 204), and my backends, stub and `vb3-mongo` are stopped or removed. Kept on purpose: the databases `vb3_cookbook`, `vb3_dropped`, `vb3_eff`, `vb3_gaps`, `vb3_image`, `vb3_iter2ab`, `vb3_pair`, `vb3_sigterm`, `vb3_g27d` and `vb3_g27d2` on mongo7; the vb3 tenants' notices in the shared database; and the images `vb3-backend:test` and `mirror.gcr.io/aquasec/trivy:0.58.1`, with its DB cache in `<scratch>/trivy-cache`, which the other verifiers can reuse.
