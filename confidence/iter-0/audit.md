# Iteration 0 — Independent Audit

**Auditor:** Independent Auditor (did not write any code, test, fix or verifier report; did not modify any file outside `confidence/evidence/iter-0/audit/` and this report).
**When:** 2026-11-02 00:20–01:00 UTC. **Code under test:** commit `191a0c5` (the iteration-0 tree) — see "What code was actually under test" below, because fix commits started landing on `confidence-loop/2026-11-01` while this audit ran.
**Method:** seeded random sample (seed 0) of 20 % of the 309 claims extracted from the five iteration-0 reports, stratified per report: backend 18, frontend 11, sidecar 10, E2E 10, usability 12 = **61 claims**. Every sampled claim was re-run or re-derived against the iteration-0 code on the auditor's own ports, tenants, databases and containers (`audit-*`, ports 18500/18501/18556/18800/3500/3510/3010/3027), never through the verifiers' result files alone. Scores were recomputed from the verifiers' category tables; the Usability Reviewer's scores replace the verifiers' provisional usability points, as instructed. The sample list is `confidence/evidence/iter-0/audit/sample.json`.

## 1. Verdict per score

| Score | Claimed | Audit verdict | Audited value | Why |
|---|---|---|---|---|
| Backend | 72 | **ADJUST → 68** | 67.7 | All 18 sampled claims reproduced (incl. the F-20 resume 500, the retire-after-expiry 200, the safety valve, the staleness states). Only change: usability 8 → 4.1 (Usability Reviewer's API score 41/100). Hard gate tripped (F-20/F-61 fail; and see the security-gate note) — cap 80 not binding. |
| Frontend | 66 | **ADJUST → 62** | 61.9 | All 11 sampled claims reproduced (t2 28/28, t5 identical 7 failures, t6 2/2, ESLint 2 errors + 3 warnings with the verifier's toolchain, GAP-frontend-1/2/7 live in the browser). Only change: usability 6 → 1.7 (UI score 17/100). Hard gate tripped — not binding. |
| Sidecar | 77 | **ACCEPT (77)** | 76.7 | All 10 sampled claims reproduced (probe ladder, send policy, rediscovery, manifests, dead-app → UNKNOWN, pod silence vs scale-to-zero). Usability 8 → 7.3 (operator score 73/100) does not change the rounded total. Hard gate tripped (F-83 native-sidecar patch, dead-app row) — not binding. |
| E2E system | 67 | **ADJUST → 62** | 62.1 | All 10 sampled claims reproduced (15 s first byte on an empty tenant, F-15 projection, pod flow app → sidecar → backend → UI, F-48 rollup, F-57 error surfacing). Usability 7 → 1.7: the end-to-end journeys run through the UI, so the UI reviewer's 17/100 is the system's usability (the average of the three reviewer scores, 43.7 → 4.4, would give 65; the lower figure is used because the system is only as usable as the surface its users touch). Hard gate tripped — not binding. |
| Usability Reviewer (UI 17 / API 41 / sidecar 73) | — | **ACCEPT** | — | 12 of 12 sampled claims reproduced, including the contrast ratios to two decimals and both halves of UX-6. |

**Overall iteration-0 confidence (lowest of the four): 62 / 100.** No VETO. No score was raised.

## 2. Sampled claims and results (61)

Evidence files are in `confidence/evidence/iter-0/audit/` (`ev-a/…` below). "MATCH" = the claim reproduced as stated; "MATCH (nuance)" = reproduced, with a detail worth recording; "MATCH (equivalent)" = the verifier's exact command was bound to its own ports/containers and could not be replayed verbatim, so the same flow was re-run with the auditor's own harness.

### Backend verifier (18)

| # | Claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-6: JUnit XML inventory 189 ok / 1 fail / 0 skipped; no `@Disabled/@Ignore/assume*/@EnabledIf` | MATCH — `test --rerun`: 164 tests, 0 failures, 0 skipped (XML 00:36); `integrationTest`: 26 tests, 1 failure (`CommunicationServiceE2EIT.reconnectingWithLastEventIdReplaysWhatWasMissed`), 0 skipped → 189/1/0; grep over `src/test`, `frontend/src`, `sidecar` for skip/assume annotations: none | `ev-a/gradle-test-rerun.txt`, `ev-a/gradle-integrationTest.txt` |
| 2 | cmd-13: first `check_c2_private.py` attempt, 1 FAIL caused by a db shared with another verifier | MATCH — the artefact shows exactly one FAIL (C-44a, `state=UNKNOWN`), consistent with the 30 % staleness valve being tripped by the other verifier's silent `sc-silent` monitors in the same db | `evidence/iter-0/backend/23a-…ABORTED….txt` (re-read) |
| 3–6 | F-01, F-11, F-16, F-17 PASS | MATCH | `ev-a/01-http-recheck-shared-backend.txt` |
| 7 | F-20 FAIL: `Last-Event-ID` and `?lastEventId=` answer 500 | MATCH — 500 with the bson "second 'seq' expression" error in both forms | `ev-a/01-…` lines 18–20 |
| 8 | F-22 PASS (event log) | MATCH | `ev-a/06-private-backend-recheck.txt` (:18500) |
| 9–12 | F-29, F-33, F-35, F-37 PASS | MATCH | `ev-a/01-…` |
| 13 | F-45 PASS (safety valve: 2 of 4 silent → paused, 1 of 4 → DOWN) | MATCH | `ev-a/06-…` (:18501, own db) |
| 14 | F-46 PASS | MATCH | `ev-a/01-…` |
| 15 | F-48 PASS (silent pod → DOWN notice naming it; returns → retired) | MATCH — first attempt showed 2 mismatches caused by the auditor's own timing (feed read before the second stale observation); re-run with a proper wait: both clauses hold | `ev-a/06-…` (lines 9–10, auditor error), `ev-a/06b-f48-notice-recheck.txt` |
| 16 | F-49 PASS | MATCH | `ev-a/01-…` |
| 17 | F-64 (BE side) PASS — `X-Client-Id` accepted/required | MATCH | `ev-a/01-…`, `ev-a/07-pod-flow-recheck.txt` |
| 18 | F-76 (BE side) PASS — leaving report marks the instance `left` | MATCH | `ev-a/07-…` |

### Frontend verifier (11)

| # | Claim | Result | Evidence |
|---|---|---|---|
| 19 | cmd-5: ad-hoc ESLint → 2 errors + 3 warnings | MATCH (nuance) — with the verifier's own toolchain (eslint 9.39.1, typescript-eslint 8.46.0, eslint-plugin-react-hooks **7.0.1**) on the `191a0c5` sources: 5 problems (2 errors, 3 warnings), identical locations. With eslint-plugin-react-hooks 5.2.0 the two `react-hooks/set-state-in-effect` errors do not exist (rule introduced in v6): 0 errors, 3 warnings. The −3 in "builds & static" stands: the repo has no lint config and the warnings are version-independent | `ev-a/14-eslint-rerun-verifier-toolchain.txt`, `ev-a/14b-eslint-rerun-react-hooks-5.2.0.txt` |
| 20 | cmd-7: `t2-publish-errors.js` 28 checks, 0 failed | MATCH — first replay 25/25 then a script error (the verifier's dead-backend dev server on :3010 was not running); second replay with a dead-backend dev server on :3010: **28 checks, 0 failed, exit 0** | `ev-a/02-frontend-scripts-rerun.txt`, `ev-a/02b-frontend-t2-rerun-with-dead-backend-ui.txt` |
| 21 | cmd-10: static build with `VITE_API_BASE` + `http.server 3027` + `t6-xorigin.js` 2 checks, 0 failed | MATCH — rebuilt from `191a0c5`, 2/2 (CORS block without a backend CORS policy; `X-Client-Id`/`Accept`/`?clientId=` through the proxy) | `ev-a/02a-vite-build-xorigin.txt`, `ev-a/02-…` |
| 22 | F-01 PASS (UI publish → 201 + Location, ACTIVE, CUSTOMERS) | MATCH | `ev-a/02-…` (t2 F-01 checks), `ev-a/13-ui-recheck-shared-frontend.txt` |
| 23 | F-06 FAIL (one clause): retire of an item past `expiresAt` but still stored ACTIVE → 200 | MATCH — 200 and RETIRED | `ev-a/01-…` line 17 |
| 24 | F-56 PASS (confirmation card, "Publish another" keeps tenant/publisher/type) | MATCH | `ev-a/02-…`, `ev-a/02b-…` |
| 25 | F-60 PASS (created frame → card appears live) | MATCH — card in 292 ms, no page errors | `ev-a/13-…` |
| 26 | F-65 FAIL (axe `color-contrast` in all six scans, placeholder-only "Service" filter) | MATCH — t5 replay: 18 checks, the same 7 failures as the verifier's result file | `ev-a/02-…` (t5), `$S/audit/fe-scripts/results/t5-a11y.json` |
| 27 | GAP-frontend-1 High: after a non-200 on the stream the EventSource is never re-created; only the "Live updates" toggle restores it | MATCH — route-fulfilled 500: 2 stream requests in 12 s then nothing, indicator stuck on "Reconnecting", toggle → "Live" | `ev-a/13-…` |
| 28 | GAP-frontend-2 Medium: future-dated OUTAGE appears live under Upcoming, gone on reload | MATCH | `ev-a/13-…` |
| 29 | GAP-frontend-7 Low: 103 items → 100 cards, no hint, `hasNext=true` | MATCH | `ev-a/13-…` |

### Sidecar verifier (10)

| # | Claim | Result | Evidence |
|---|---|---|---|
| 30 | cmd-7: `main-scenario.sh` lifecycle incl. STEP E (app killed → UNKNOWN, restart → UP) | MATCH — the script itself could not be replayed (it needs a pod the verifier built by hand; two attempts were invalid, kept as `03a/04a/04`), so STEP E was reproduced on the auditor's pod: `docker kill app` → sidecar logs `health target gone; will rediscover`, sends one DOWN (connection refused) then `UNKNOWN "no health target found yet"` on every heartbeat, monitor stays without a notice (feed empty); `docker start app` → `health target found` → UP within 3 s | `ev-a/16-dead-app-unknown-recheck.txt`; invalid runs `ev-a/03a-…`, `ev-a/04-…`, `ev-a/04a-…` |
| 31 | cmd-14: `silence2.sh` — silent pod → DOWN naming it; scaled-to-zero (both pods left) → no notice; six reporting services keep the valve closed | MATCH (nuance) — `goes-silent` DOWN at +101 s with `1 pod has not reported since 2026-11-02T00:51:26Z (silent-1)`; `scaled-to-zero` stays `UNKNOWN (no live pod reports)`, incidents 0. The script reuses db `sc_silent2`, so the verifier's notice from 23:50 is still the open notice in the feed (the new detection has its own timestamp) | `ev-a/10-sidecar-silence2-rerun.txt` |
| 32 | F-67 PASS (config errors name the variable, exit 2) | MATCH | `ev-a/08-sidecar-config-recheck.txt` |
| 33 | F-69 PASS (ladder: Actuator 9003 → `/healthz` 9002 → `/` 9001 → tcp 9004) | MATCH | `ev-a/03-sidecar-ladder-rerun.txt` |
| 34 | F-74 PASS (500 → retry 1 s/2 s/4 s; 400 → `report rejected` once; 409 → retried; 202 resumes) | MATCH | `ev-a/03-…` lines 46–52 |
| 35 | F-77 PASS (`health target gone; will rediscover` → new target ≈2.5 s, three times; restart on the same port rediscovered) | MATCH | `ev-a/03-…` lines 34–44, `ev-a/16-…` |
| 36 | F-82 PARTIAL (Kustomize classic form) | MATCH | `ev-a/05-manifests-recheck.txt` |
| 37 | F-86 PARTIAL (native-sidecar form; GAP-sidecar-2 drops existing initContainers) | MATCH — the native patch replaces `initContainers` | `ev-a/05-…` |
| 38 | F-87 PASS (wire contract / headers from the pod) | MATCH | `ev-a/05-…`, `ev-a/07-…` |
| 39 | GAP-sidecar-5 minor (F-85/F-86 image override / docs) | MATCH | `ev-a/05-…` |

### E2E verifier (10)

| # | Claim | Result | Evidence |
|---|---|---|---|
| 40 | cmd-1: two backend nodes + dev server + pod (`--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges`) all start, exit 0 | MATCH (equivalent) — the same stack started on the auditor's ports (18500/18501, vite 3500, pod `audit-hold/audit-sidecar/audit-app` with the same hardening flags); the sidecar reported from the first heartbeat | `ev-a/07-…`, `$S/audit/pod_flow.sh` |
| 41 | cmd-4: `/v1/feed/stream` first byte ≈15 s on an empty tenant (header and `?clientId=`) | MATCH — 15.003 s in both forms; a non-empty tenant answers in 4 ms (the `[MISMATCH]` label on that line is an auditor labelling bug: the claim was about the empty tenant) | `ev-a/01-…` lines 54–56 |
| 42 | cmd-6: `pod_flows.js p91` 19 checks | MATCH (equivalent) — the script is bound to the verifier's ports/containers (18081/18082/3001, `e2e-app/e2e-sidecar`); the F-91 flow app → sidecar → backend → UI (report accepted, instance record, rollup, notice in the UI, leaving) was re-run with the auditor's own script and pod, plus the dead-app and UI checks | `ev-a/07-…`, `ev-a/16-…`, `ev-a/13-…` |
| 43 | F-15 PASS (feed ACTIVE while stored SCHEDULED; gone 0.2 s after `expiresAt` while the stored status lags; permalink EXPIRED later) | MATCH (nuance) — feed ACTIVE at t+4.9 s while stored SCHEDULED; gone at t+12.1 s (expiry t+12 s) while stored still SCHEDULED (the shared backend's sweeper had not run yet — the verifier saw ACTIVE at that point); EXPIRED at t+28 s | `ev-a/15-f15-time-projection-recheck.txt` |
| 44 | F-48 PASS* | MATCH | `ev-a/06b-…` |
| 45 | F-57 PASS (409 banner with the service text; feed error state "Couldn't load the feed · 502 Bad Gateway · Try again") | MATCH | `ev-a/02b-…` (t2 F-57 ×2), `ev-a/11-usability-drop502-rerun.txt`, `ev-a/12-usability-ux-ui-rerun.txt` (`contrast:server-error-light`) |
| 46 | F-60 PASS | MATCH | `ev-a/13-…` |
| 47 | F-64 PASS (`x-client-id: communication-frontend` on every fetch, `clientId=` on the stream) | MATCH | `ev-a/13-…`, `ev-a/02-…` (t6) |
| 48 | F-72 PASS (sidecar report accepted from the pod) | MATCH | `ev-a/07-…` |
| 49 | F-91 PASS (sidecar flow end to end) | MATCH | `ev-a/07-…` |

### Usability reviewer (12)

| # | Claim | Result | Evidence |
|---|---|---|---|
| 50 | cmd-1: `ux-ui.js` first pass crashed at the slow-feed step, exit 1 | MATCH — not a scored claim; the reviewer's second pass is the evidence. The same script replayed by the auditor (tenant `audit-ux`, output redirected) completes with exit 0 and produces the same step outputs | `ev-a/12-…`, `ev-a/ux-rerun/` |
| 51 | cmd-5: sidecar operator walk (no/partial/wrong config, wrong endpoint, README command, SIGTERM) | MATCH | `ev-a/09-usability-cmd5-recheck.txt` |
| 52 | F-57 PASS (UX-4, UX-9) | MATCH | as #45 |
| 53 | F-62 PASS (UX-7, UX-8): inline confirm, card removed, stored RETIRED with actor; no confirmation/undo afterwards | MATCH | `ev-a/13-…` |
| 54 | F-63 PASS (UX-10, UX-12): ticket chip is plain text (no instance URL) | MATCH | `ev-a/13-…` |
| 55 | F-76 SIGTERM leaving PASS | MATCH | `ev-a/07-…` |
| 56 | UX-5 major: contrast below AA in both themes (3.62 / 3.33 / 3.1 / 4.02 / 2.86 light; 3.51 / 2.84 / 3.65 dark; "Save as draft" 30×18 px tap target) | MATCH — every ratio identical to two decimals | `ev-a/ux-rerun/ux-ui-log.json`, `ev-a/12-…` |
| 57 | UX-6 major: (a) "Live" shown throughout a SIGKILL outage behind the dev proxy, stream back only long after; (b) opened during a 502 the stream never recovers without a user action | MATCH (and worse) — (a) indicator read "Live" for the whole 14 s outage; after the backend was back the indicator still said "Live" but no new stream request was ever made in 140 s and a newly published item never appeared (the reviewer saw recovery after ~36 s). (b) 502 → two stream requests at 1 s, then none; "Reconnecting" for 41 s after the backend was up; item visible only after "Try again"; the stream only returns on the "Live updates" toggle (68 s) | `ev-a/17-ux6a-sigkill-live-indicator-recheck.txt`, `ev-a/11-…` |
| 58 | UX-11 minor: "Nothing outage is active or upcoming for acme." | MATCH | `ev-a/13-…` |
| 59 | UX-12 cosmetic: state capsule CSS-capitalised ("Starts In 60m") | MATCH — `text-transform: capitalize` on the tag | `ev-a/13-…` |
| 60 | UX-22 major: wrong enum and malformed JSON both answer `{"error":"Failed to read HTTP message"}` | MATCH | `ev-a/01-…` lines 58–59 |
| 61 | UX-25 minor: framework internals leak (404 "No static resource v1/nothing."; non-JSON body → `{"error":"unexpected error"}` 415) | MATCH (nuance) — the 404 text reproduced verbatim; for 415 the reviewer's exact request (`-d 'tenantId=x'` without a Content-Type → form-urlencoded) answers `{"error":"unexpected error"}`, while `text/plain`, `application/xml` and `application/octet-stream` bodies answer a descriptive `Content type '…' not supported for bodyType=…` (which leaks the Java class name instead) | `ev-a/01-…` lines 60–61 |

**Tally: 61 sampled, 61 reproduced (57 plain MATCH, 4 MATCH with a nuance, 2 of them via an equivalent harness). 0 claims contradicted. 0 vetoes.**

## 3. Test-weakening check

- The verifiers worked on the `191a0c5` tree with **no tracked change**: `git status` showed only the untracked `confidence/` folder; `git diff 191a0c5 -- src/test frontend/src sidecar` was empty when this audit started. No test was deleted, skipped, xfail'd, loosened or mocked away in iteration 0.
- Annotation grep over `src/test/**/*.java`, `frontend/src/**/*.ts(x)` and `sidecar/**/*.go` for `@Disabled`, `@Ignore`, `assume*`, `@EnabledIf/@DisabledIf`, `.skip(`, `t.Skip(`: **none** (the only `t.Skip` hits are none — the sidecar tests have no skips).
- Baseline caveat: the local `main` and `origin/main` refs point at a stale "wip" commit (`19159f5`), so `git diff main` lists 164 unrelated files. The valid baseline for this loop is `191a0c5`.
- **For the iteration-1 auditor:** since 00:45 UTC the orchestrator has been cherry-picking Fixer commits onto `confidence-loop/2026-11-01` (`0fd51b6`, `ccecee8`, `5a38919`, `b2b0a16`, `9d47a47`, `2e890f3`, `1f04bb7`, `556d814`, `cc32685`, `49d120f`, `080668a` at the time of writing). They add tests but also carry small deletions inside existing test files (worktree stats: frontend −1, BE-A −2, BE-B −4 lines; e.g. `CommunicationServiceE2EIT.java` is modified by G-1-4). Those deletions belong to iteration 1 and must be justified there; they do not affect iteration-0 scores.

## 4. Hard gates (per service)

| Gate | Backend | Frontend | Sidecar | E2E |
|---|---|---|---|---|
| Any Feature Matrix item fails E2E | **tripped** (F-20, F-41, F-61) | **tripped** (F-06 clause, F-16, F-20, F-61, F-65) | **tripped** (F-83/F-86 native patch, dead-app → UNKNOWN) | **tripped** (F-20, F-61, F-88, F-92) |
| Test skipped/deleted/loosened without justification | no | no | no | no |
| Sidecar not restricted-v2 / not non-root | n/a | n/a | passes (UID 1000660000:0, read-only, cap-drop ALL, no-new-privileges verified again in `ev-a/07-…`) | — |
| Open critical/high security finding | **tripped, conservatively**: the backend verifier left it "not confirmed either way"; the shipped Netty 4.1.116 carries NVD-HIGH CVEs (CVE-2025-24970, CVE-2025-55163, CVE-2025-58056) and no scanner could prove non-exposure, so under "evidence or it didn't happen" the auditor counts it as open | no (`npm audit` 0) | no (zero third-party Go modules) | inherits the backend finding |

All caps (80) are non-binding because every audited score is below 80.

## 5. Recomputed scores

| Category (weight) | Backend verifier → audit | Frontend verifier → audit | Sidecar verifier → audit | E2E verifier → audit |
|---|---|---|---|---|
| Builds & static checks (10) | 4 → 4 | 7 → 7 | 7 → 7 | 7 → 7 |
| Feature completeness (30) | 28.6 → 28.6 (61/64 confirmed) | 24.2 → 24.2 (21/26) | 26.4 → 26.4 (25.5/29) | 26.4 → 26.4 (29/33) |
| Automated test health (20) | 11 → 11 | 14 → 14 | 14 → 14 | 8 → 8 |
| Integration & contracts (20) | 15 → 15 | 11 → 11 | 16 → 16 | 14 → 14 |
| Resilience & ops (10) | 5 → 5 | 4 → 4 | 6 → 6 | 5 → 5 |
| Usability (10) | 8 → **4.1** (API 41/100) | 6 → **1.7** (UI 17/100) | 8 → **7.3** (operator 73/100) | 7 → **1.7** (UI 17/100, lowest surface) |
| **Total** | 71.6 → **67.7 ≈ 68** | 66.2 → **61.9 ≈ 62** | 77.4 → **76.7 ≈ 77** | 67.4 → **62.1 ≈ 62** |

Feature-completeness ratios were recounted from the verifiers' matrix sections and agree with the verifiers. No other category was changed: the sample gave no evidence that any verifier over- or under-scored a category, and the auditor does not re-grade on opinion.

## 6. Nuances, auditor errors and harness incidents (all recorded, none changes a verdict)

1. `01-http-recheck` line 56 is labelled `[MISMATCH]` by a bug in the auditor's label ("non-empty" matched "empty"): the claim concerns the empty tenant and matched (15.003 s); the 4 ms figure for a non-empty tenant is additional information.
2. `06-private-backend-recheck` lines 9–10 (F-48) were caused by the auditor reading the feed too early and reviving the pod; `06b` repeats the check correctly (MATCH).
3. `03a`/`04a` (ladder and main-scenario run concurrently) failed on Docker port-binding and a missing hold container; `04` ran without the hand-built pod. Replaced by `03` (ladder, valid) and `16` (focused STEP E reproduction).
4. The first `silence2.sh` attempt died because :18800 was still bound by the earlier aborted attempt; the re-run on a free port completed (`10`).
5. ESLint error count depends on the `eslint-plugin-react-hooks` major (7.0.1 → 2 errors; 5.2.0 → 0) — both runs kept.
6. The first `t2` replay stopped at 25/28 because the verifier's dead-backend dev server (:3010) was not running; the second replay with one is 28/28.
7. `ux-ui.js` and `drop-502.js` write into their own evidence folder; they were copied and their output redirected to `ev-a/ux-rerun/` so no reviewer evidence was overwritten (checked by timestamp).
8. `NODE_PATH` must be extended, not replaced (`/usr/local/lib/node_modules_global` holds Playwright), otherwise the verifier scripts cannot `require('playwright')`.
9. Verifiers shared the backend's `sc-pod`, `sc_silent2` and `be-verify` state across runs; the auditor used fresh `audit-*` tenants wherever the script allowed it and otherwise relied on timestamps to separate new from old observations.

## 7. What code was actually under test

- Shared backend on :8080 = `scratchpad/communication-service.jar` built 23:22 UTC from `191a0c5` (process started 23:22:18, never restarted during the audit); the private backends on :18500/:18501/:18800 ran the same jar.
- Sidecar image `health-sidecar:ci` built 23:17:44 UTC from `191a0c5`; `fakeapp:ci` 23:24.
- Frontend: the shared dev server on :3000 serves the working tree; `git diff --stat 191a0c5..HEAD -- frontend` was empty at every UI check (00:39–00:58). The private dev servers :3510/:3010 and the static build on :3027 were built from `git archive 191a0c5 frontend`.
- Gradle `test --rerun` (00:36) and `integrationTest` (00:25) compiled the tree before the first `src/` fix commit landed (00:45:12).

## 8. Evidence index (`confidence/evidence/iter-0/audit/`)

`sample.json` (seed 0, 309 claims, 61 sampled) · `01-http-recheck-shared-backend.txt` (48 checks) · `02-frontend-scripts-rerun.txt`, `02a-vite-build-xorigin.txt`, `02b-frontend-t2-rerun-with-dead-backend-ui.txt` · `03-sidecar-ladder-rerun.txt` (+ `03a` invalid) · `04`, `04a` (invalid main-scenario attempts, kept for traceability) · `05-manifests-recheck.txt` · `06-private-backend-recheck.txt`, `06b-f48-notice-recheck.txt` · `07-pod-flow-recheck.txt` · `08-sidecar-config-recheck.txt` · `09-usability-cmd5-recheck.txt` · `10-sidecar-silence2-rerun.txt` · `11-usability-drop502-rerun.txt` · `12-usability-ux-ui-rerun.txt` + `ux-rerun/` (screenshots, `ux-ui-log.json`) · `13-ui-recheck-shared-frontend.txt` (12 Playwright checks) · `14-eslint-rerun-verifier-toolchain.txt`, `14b-eslint-rerun-react-hooks-5.2.0.txt` · `15-f15-time-projection-recheck.txt` · `16-dead-app-unknown-recheck.txt` · `17-ux6a-sigkill-live-indicator-recheck.txt` · `gradle-test.txt` (UP-TO-DATE, superseded), `gradle-test-rerun.txt`, `gradle-integrationTest.txt`. Auditor scripts: `scratchpad/audit/` (`http_recheck.py`, `private_recheck.py`, `f48_notice.py`, `pod_flow.sh`, `ui_recheck.js`, `ux6a.js`, `fe-rerun.sh`, `fe-rerun-t2b.sh`, `stub.py`, `manifests/`, `fe-scripts/` copies).

## 9. Clean-up

Removed: containers `audit-hold`, `audit-sidecar`, `audit-app`, `sc-pod-main-app`; private backends :18500/:18501/:18800, stub :18556, dev servers :3050/:3500/:3510/:3010, static server :3027. Left untouched: the shared stack (backend :8080, dev server :3000, Mongo :27017, pod `app`/`sidecar`), the Fixer worktrees, and the Mongo databases created during verification (dropping data was not needed and is out of the auditor's remit).
