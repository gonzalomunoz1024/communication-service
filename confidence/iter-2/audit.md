# Iteration 2 — Independent Audit

**Auditor:** Independent Auditor for iteration 2. I wrote no code, test, fix or verifier report. I changed nothing outside `confidence/evidence/iter-2/audit/` and this report, and committed nothing.
**When:** 2026-11-02, 04:50–06:05 UTC. **Code under test:** `be19645` on `confidence-loop/2026-11-01`. Its code is the tree of the last fix commit, `908598a`. `HEAD` was `33451c3` for the whole audit; `be19645`, `3806e7c` and `33451c3` change only files under `confidence/` (section 7).
**Method:** I drew a seeded random sample (`random.seed(2)`) of 20 % (rounded up) of the 363 claims taken from the five iteration-2 reports. A claim is a row of a Commands table, Feature verdicts table, Gaps table or closure list, or a sidecar O-n observation, usability finding or iteration-1 re-check. The sample is stratified per report: backend 21 of 103, frontend 13 of 61, sidecar 13 of 65, E2E 14 of 67 and usability 14 of 67, which makes **75 claims** (`ev-a/00`). I also ran the directed checks:
- **(a) Test weakening:** over the iteration-2 fix commits `b397f87..908598a` against `0e14838`, and over the whole branch from `191a0c5`.
- **(b) Feature completeness:** recounted from `feature-matrix.json`.
- **(c) Closed gaps:** at least one claim re-verified for each closed gap, G-2-1 to G-2-17.
- **(d) Scores, gates and contradictions:** scores without evidence, the hard gates, and PASS/FAIL contradictions between the service reports and E2E.

**Instances:**
- **Shared stack (read only):** I only read it: backend :8080, Vite :3000, `mongo7`, `app` and `sidecar`. I grepped its log and sent GETs.
- **Backend replays:** every replay ran on private copies of the same jar, `scratchpad/communication-service-iter2.jar` (sha256 `491438c7…`, the same as `build/libs` of `be19645`):
  - :19711 stands in for :8080, with the default configuration and database `au2_shared`;
  - :19712 and :19713 form the pair;
  - :19714 on `au2-mongo3` (:19729) is the Mongo-outage node;
  - other private instances served the scripts that need their own configuration: :19703, :19704 and :19719 (backend scripts), :19700 and :19706 (sidecar scenarios), :19708 and :19709 (frontend scripts); the stub Actuator for `check_b` ran on :19716;
  - E2E nodes A :19701 and B :19702 ran on `au2-mongo` (:19727, database `au2_main`).
- **Frontend:** Vite dev servers on :19731, :19736 and :19737; `vite preview` of `frontend/dist` on :19730; environment-specific builds on :19732–:19734.
- **Pod emulation:** `au2-netns` + `au2-app` + `au2-sidecar`. The sidecar ran image `health-sidecar:au2`, built from `sidecar/Dockerfile`; its labels read `1.0.0-au2` / `be19645`. Two stubs: :19751 (target of the backend's pull probe) and the capture stub :19760.
- **Sidecar scenarios:** `au2-s-*` containers and `au2-s-mongo` (:19728).

The in-repo Playwright suite was not run (section 6). `ev-a/NN` means `confidence/evidence/iter-2/audit/NN-…`. `ev/…` and other file names refer to the cited report's own evidence folder.

## 1. Verdict per score

| Score | Claimed | Audit verdict | Audited value | Why |
|---|---|---|---|---|
| Backend | 94 | **ACCEPT 94** | 93.9 | All 21 sampled claims reproduced:<br>• the `-Werror` compile with 0 warnings, and 208 + 42 tests;<br>• the check scripts, down to the same FAIL ids (B-34a's race did not occur here);<br>• the Mongo-outage signatures of GAP-backend2-1 and -6, with the same counts;<br>• the instance with its own configuration;<br>• G-2-9's 17/17.<br>Usability changes from 9 (provisional) to 8.9 (the reviewer's API score, 89/100); the total still rounds to 94. No gate tripped. |
| Frontend | 97 | **ADJUST to 96** | 96.4 | All 13 sampled claims reproduced:<br>• lint and typecheck;<br>• axe and contrast, 33/33;<br>• the snapshot fallback for an expired `lastEventId`;<br>• the keepalive at +15.0 s;<br>• the aggregate, 236/2, identical (diff 0 lines);<br>• the draft, resolve, validation, expiry and snapshot rows;<br>• G-2-12 and G-2-13.<br>The one change: usability goes from 9 (the verifier's own figure) to **8.4** (the reviewer's UI score, 84/100). No gate tripped. |
| Sidecar | 90.5 | **ADJUST to 91** | 90.9 (90.95 with the unrounded 28.55) | All 13 sampled claims reproduced:<br>• 42/42 tests in five modes;<br>• TLS, CA and proxy handling;<br>• the failure paths, including O-1's 20.1 s;<br>• the manifests, wire headers and vocabulary;<br>• the startup messages;<br>• GAP-sidecar-3 and -4.<br>The one change: usability goes from 9 to **9.4** (the reviewer's onboarding score, 94/100). No gate tripped. |
| E2E system | 90 | **ACCEPT 90** | 90.4 | 13 of 14 sampled claims reproduced; the 14th is a PARTIAL:<br>• **What did not reproduce (F-74):** the recovery timing, "next report accepted 5 s after readiness, no notice". Here node A was slow to restart under load, so the next report was accepted about 35 s after readiness. In one of the two runs a false OUTAGE stayed open for 13 s.<br>• **Why:** the specified backoff of 1 s → 60 s against the 90 s staleness window (AUD-2-1).<br>• **Effect on the row:** none; it stays PASS as the matrix defines it.<br>Usability changes from 8 (provisional) to 8.4 (the UI score, 84/100, the lowest surface), which gives 90.4. No gate tripped. |
| Usability Reviewer (UI 84 / API 89 / onboarding 94) | — | **ACCEPT** | — | All 14 sampled claims reproduced:<br>• the cap notice;<br>• the confirmations and focus;<br>• the 409 and 500 texts;<br>• Swagger UI;<br>• the sidecar's configuration errors and image facts;<br>• UX-48's accessibility tree, UX-51's missing log level and UX-24's bare 400.<br>The pod walks behind F-34 (P4) and UX-30–34 (`sidecar-pod.txt`) were checked against equivalent evidence, not re-run. |

**Overall iteration-2 confidence (the lowest of the four): 90 / 100** (iteration 1: 85). No VETO. As in iteration 1, I re-graded no category on my own judgment. Both changes put the reviewer's usability figure in place of a verifier's own or provisional figure.

## 2. Sampled claims and results (75)

The labels in the Result column mean:
- **MATCH:** the claim reproduced as stated.
- **MATCH (exact):** it reproduced to the figure or to the byte.
- **MATCH (nuance):** it reproduced, with a detail worth recording.
- **MATCH (equivalent):** the verifier's command was bound to its own ports or containers, so I ran the same check on my instances.
- **PARTIAL:** part of the claim did not reproduce.

**Tally:** 74 of 75 reproduced (41 MATCH, 16 MATCH (exact), 12 MATCH (nuance), 5 MATCH (equivalent)), 1 PARTIAL, 0 MISMATCH.

### Backend verifier (21)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-5: test-integrity review (`git diff 0e14838..HEAD -- src/test`, `@Test` counts, skip markers, removed assertions) → 0 | MATCH (nuance) | `ev-a/01`, sections C, F and G. No marker was added to the backend tests, `@Test` grew from 227 to 250, and no test file was deleted. **8** assertion lines were removed, and each was replaced by a stronger or justified one. The verifier's `ev/06` lists 7: it missed `MongoCommunicationRepositoryAdapterIT`'s `.hasMessageContaining("duplicate externalRef")`, which now asserts the full permanent-key message. |
| 2 | cmd-8: the sidecar CI steps run locally. `go vet` 0, `CI=true go test` 0, govulncheck 1 (`vuln.go.dev` Forbidden) | MATCH | `ev-a/10`: vet 0; `CI=true` with the tools 0; govulncheck "fetching vulnerabilities … Forbidden", exit 1 |
| 3 | cmd-11: `check_a` 108/113 → `check_a2` 3/3 → `check_a23` 2/2 | MATCH (exact) | `ev-a/21` totals; `ev-a/22`, `22b`, `22c`. 108/113 with the same five FAIL ids (A-18b, A-20b, A-20c, A-23b, A-24: the script artefacts the verifier's addendum explains), then 3/3 and 2/2 |
| 4 | cmd-12: `check_b_health` 79/80, plus an 8/8 re-check of B-34a | MATCH (nuance) | `ev-a/23`: 80/80. B-34a fails when a forced probe coincides with a scheduler probe; that race did not occur in this run. The other 79 ids are identical. |
| 5 | cmd-21: log review of the shared backend and of the private instances → 0 | MATCH | `ev-a/21`, "cmd-21 replay":<br>• **Shared log** (read-only grep at 05:33Z): 0 ERROR, the same 3 WARN lines, 0 stack frames.<br>• **Private instances with a counterpart here:** each within a few INFO lines of the verifier's (for example :19712 0/25/199 against :19100 0/24/194).<br>• **Outage instance:** :19714 has the same 4 ERROR blocks as the verifier's :19110 (GAP-backend2-1 and -6).<br>• **Credentials:** none in any log; the only `password` is the driver's `password=null`. |
| 6 | cmd-22: a private instance with `events.retention=PT2H`, `client-id.required=false` and `servicenow.instance-url` → 0 | MATCH (equivalent, :19719) | `ev-a/28`:<br>• The TTL index went from 86400 s to 7200 s, with its INFO line.<br>• No `X-Client-Id` → 200; the default stand-in answers 401.<br>• The ticket link is built from the instance URL.<br>• A bad incident number → 400 naming the ServiceNow format. |
| 7 | F-06 PASS: retire with a note, idempotent, actor defaults; 409 after `expiresAt` | MATCH | `ev-a/21`: A-06a–c, D-20-b, C-13a, G26-2-b and G26-3-b PASS |
| 8 | F-11 PASS: ordered entries, cap of 50, actor fallback, a refused retire writes nothing | MATCH | A-11a–c (60 updates → 50 entries), D-20-d PASS |
| 9 | F-18 PASS (note): `:connected` first, snapshot stamped with the log head, monotonic ids, keepalive; A-18b is the documented overlap | MATCH | A-18a, c, d and e PASS; D-4-s/p PASS (`:connected` is the first line, after 16 ms and 90 ms); G28-a and G28-d PASS. A-18b FAILs on the same documented snapshot/live overlap. |
| 10 | F-25 PASS: admin retire with actor + `retired` frame | MATCH | A-25 PASS |
| 11 | F-29 PASS: 16 paths / 20 operations, a global apiKey scheme with a description, 401 on 20/20, `externalRef` and `expectedVersion` described | MATCH | A-29a–c and G29-g–n PASS (`ev-a/27e`) |
| 12 | F-34 PASS: probe-now applies one observation, push-only → 409, 30/30 forced probes → 200 while the scheduler runs | MATCH | B-34a/b PASS; G26 10/10 (`ev-a/27b`); G27-a 30 × 200 and 0 × 409 (`ev-a/27c`) |
| 13 | F-44 PASS: a silent push-only monitor → DOWN, then OUTAGE; an UP report → `recovered: UP` | MATCH | C-44a/b, D-6-a/b and G25-a PASS (`ev-a/25`, `24`, `27`) |
| 14 | F-57 (BE) PASS: every rejection is `{"error": text}`; 409 and 503 bodies are plain sentences | MATCH | A-07 (11 texts), D-21-a–i, G29-a/b and G24-a PASS |
| 15 | F-61 (BE) PASS: reconnect with `Last-Event-ID` → 200 + replay | MATCH | D-1-b, A-20a and G28-b PASS |
| 16 | F-72 (BE) PASS: UNKNOWN carries no information; starting pods are not counted in the rollup | MATCH | B-38 UNKNOWN (streaks untouched) and B-47e (`… 1 starting`) PASS |
| 17 | F-88 (BE) PASS: silence → DOWN naming the pod; UNKNOWN during startup opens nothing | MATCH | C3-48a ("1 pod has not reported since … (pod-b)"), B-47e, D-6-a and G25-a PASS (`ev-a/25b`) |
| 18 | GAP-backend2-1: the SSE response is committed before the snapshot/replay query, so a Mongo failure lands on a committed response | MATCH | `ev-a/26b` G24-l/m: HTTP 200, `:connected`, no frame, the connection closed within 5 s. `ev-a/21`: two ERROR blocks per stream attempt in :19714's log (`UnsupportedOperationException` after `handleDatabaseUnavailable`). Code: `RestControllerFeedAdapter.java:68-90` (`ev-a/70`). |
| 19 | GAP-backend2-6: `WARN Mongo health check failed`, with a full stack trace, on every readiness request during an outage | MATCH (exact) | `ev-a/26`: G24-f FAILs with the verifier's counts (3/3/3 WARN, 7 other WARN, 0 ERROR, 86 stack-trace lines) |
| 20 | G-2-1 closed: 0 `warning:` lines with `-Werror`; the four former `ensureIndex` sites call `createIndex` | MATCH | `ev-a/20`:<br>• `compileJava` and `compileTestJava` ran under `-Xlint:… -Werror` with 0 javac warnings; BUILD SUCCESSFUL.<br>• 208 + 42 tests, 0 failed, 0 skipped.<br>• `createIndex` at the four sites, 0 `ensureIndex(` calls left. |
| 21 | G-2-9 closed: `ev/22g` 17/17 | MATCH | `ev-a/27e` G29 17/17; the same sentences appear in the UI (`ev-a/60`) and in the API walk (`ev-a/61` C1b, C2, C6) |

### Frontend verifier (13)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-2: `npm run lint` → 0 | MATCH | `ev-a/11` |
| 2 | cmd-3: `npm run typecheck` → 0 | MATCH | `ev-a/11` |
| 3 | cmd-18: `v5-a11y.js` (axe 4.10.2 + contrast sampling) → 0 | MATCH (exact) | `ev-a/12`: 33 checks, 0 failed:<br>• axe: 0 violations on every scanned state, both themes.<br>• Lowest sampled tertiary-text contrast: 4.66 (light), 5.93 (dark).<br>• Keyboard, roles, roving tabindex, 375 px width. |
| 4 | cmd-21: `v7b-expired-lastEventId.sh`, the retention expiry emulated by deleting events → 0 | MATCH (equivalent, :19708) | `ev-a/12`. The same holds for the header and the query parameter:<br>• An id below the oldest retained one minus 1, or an id never issued → one `snapshot` per notice, stamped with the head, and no `created`.<br>• The boundary id → only `created` #3.<br>• Nothing missed → no frame. |
| 5 | cmd-24: keepalive curl, exit 28 by design | MATCH | `ev-a/12`: `:connected` at once, `:keepalive` 15.0 s later, curl exit 28 |
| 6 | cmd-25: `aggregate.py` → 0 | MATCH (exact) | `ev-a/12`: re-run read-only over the verifier's raw results; the diff against its `aggregate.txt` is 0 lines (236 PASS / 2 FAIL) |
| 7 | F-02 PASS: Save as draft → 201 DRAFT; no "View in feed"; absent from the feed; permalink 404; feed says All clear; `POST /publish` → 200, again → 409 | MATCH | v2 F-02 5/0 (verifier 5/0) |
| 8 | F-06 PASS: Resolve → RETIRED with actor and note; an item retired elsewhere → 200 and the card is gone; an EXPIRED item → 409 | MATCH | v3 F-06 3/0 |
| 9 | F-07 PASS: bean validation and the OUTAGE-at-INFO rule (forced past the client) → 400 naming the field, shown after "The service rejected this." | MATCH | v2 F-07 2/0 |
| 10 | F-15 PASS: the server excludes the item at `expiresAt` and the permalink says EXPIRED; the UI drops the card on its own timer, 142 ms after `expiresAt` | MATCH (nuance) | v3 F-15 3/0. Here the card left 99 ms after `expiresAt`, and 491 ms after it with Live updates off (no request sent). |
| 11 | F-18 PASS: one subscription → one lower-cased `snapshot` per item, `:connected` first, `:keepalive` at +15.0 s. v3's one miss was the verifier's own double subscription. | MATCH (nuance) | v3b 3/3. v3 F-18 2/0 here; the verifier had 1 PASS and 1 FAIL because of its double subscription, which did not happen here. |
| 12 | G-2-12 closed (v1, v3, v6): no tenant pre-filled; the prompt; the build default; hints; capsule; confirmations | MATCH | v1 62/0, v3 54/0, v6 8/0 (the last after I fixed my own harness, section 6); the 11 G-2-12 lines in `ev-a/12` |
| 13 | G-2-13 closed: coverage 93.49 / 90.73 / 89.42 / 93.99, `src/ui` 92.03; `npm audit` 0 and 0 | MATCH (exact) | `ev-a/11`: 141/141 tests in 18 files; the same four figures; `src/ui` 92.03, `src/outages` 94.86, `useTheme.ts` 60.86; `npm audit` 0 and 0 |

### Sidecar verifier (13)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-2: `go test`, `-race`, `CI=true`, the `-v` tally and `-cover` → 0/0/0/0 (42 `Test*`, 42 PASS, 0 FAIL, 0 SKIP) | MATCH (exact) | `ev-a/10`, go1.25.0:<br>• gofmt, vet, build, test, race, CI and cover: all exit 0.<br>• 42 PASS / 0 FAIL / 0 SKIP.<br>• Coverage by package: cmd 79.2, agent 89.1, config 88.4, discover 92.3, probe 88.7, report 80.0. |
| 2 | cmd-9: a TLS-only app port is found; a 302 on `/health` is not followed | MATCH | `ev-a/40`, `41`. The TLS-only target `https://127.0.0.1:9006/actuator/health` is discovered and reports UP with its components. With the redirect stub the sidecar keeps `http://127.0.0.1:9007/health` as its target, and no log line mentions `/elsewhere`. |
| 3 | cmd-12: TLS cases. No CA → x509 error; CA file → OK; skip-verify → OK; empty CA file → exit 2; dead proxy → `proxyconnect`; `NO_PROXY` → OK; the TLS floor | MATCH | `ev-a/40`, cases 1 to 6 |
| 4 | cmd-15: failure paths. Stub delayed 7 s; stub stopped, then started; Mongo paused behind the backend | MATCH (equivalent: `au2-s-mongo` :19728 + backend :19706) | `ev-a/40`:<br>• Delayed stub: timeout → backoff → accepted.<br>• Stub stopped: connection refused at 1, 2, 4 and 8 s; the next retry is accepted after the restart.<br>• Paused Mongo: a direct POST gets 503 after 20.1 s; the monitor is UP after the unpause. |
| 5 | cmd-16: manifests (`kustomize build` ×5, `helm lint` ×2, …) | MATCH (exact) | `ev-a/40`: the normalised diff against the verifier's `ev/20` is the HEAD line only (`sidecar/deploy` is unchanged between the two heads) |
| 6 | cmd-21: backend-side lines, 528 INFO / 2 WARN / 0 ERROR, 0 stack frames | MATCH (nuance) | `ev-a/40`: 536 INFO / 2 WARN / 0 ERROR / 0 stack frames on :19700. The INFO count grows with the number of reports sent. |
| 7 | F-27 PASS: all 21 POSTs carry `X-Client-Id` = `CS_CLIENT_ID`, UA `health-sidecar/<version>`, JSON | MATCH | `ev-a/40`: 21/21, plus the leaving report |
| 8 | F-36 PASS: the first report → 202 and a push-only monitor at `UP (1 of 1 pod UP)`; missing or blank status → 400 | MATCH | `ev-a/40`, F-36 lines. A bad client id → 400 listing the allowed characters. |
| 9 | F-38 PASS: the vocabulary maps to UP, DOWN, UNKNOWN and DEGRADED (O-5 on PASS) | MATCH (exact) | `ev-a/40`: the same 13-value table, including nested components and PASS → DEGRADED |
| 10 | F-72 PASS: never-UP pod → "starting: waiting for the app to listen", then "no health target found after 20s …"; pinned port → "… never answered UP since start …" | MATCH | `ev-a/40`, STEP F: the four messages, and 0 feed items |
| 11 | GAP-sidecar-3: `agent.go:311-312` makes every non-UP report due, including UNKNOWN after the grace period | MATCH (nuance) | `ev-a/40`:<br>• The never-UP sidecar sent 105 reports (verifier: 101).<br>• PHASE 5: 5 UNKNOWN reports in about 16 s, at gaps of 3.1, 3.2, 3.5 and 3.0 s (verifier: 3.3, 3.0, 3.2, 3.4).<br>• Code: `ev-a/70`. |
| 12 | GAP-sidecar-4: `TestNotUpIsSentEveryProbeAndUpOnlyAtTheHeartbeat` depends on wall-clock time (300 ms at a 50 ms interval, at least 3 DOWN reports) | MATCH | `ev-a/70` (`agent_test.go:573/586/593`). It passed here in 0.66 s at a load average of 6 to 10 (`ev-a/10`): I confirmed the cause in the code but saw no flake. |
| 13 | O-1: with Mongo paused (a TCP black hole) the service takes 20.1 s to answer 503 | MATCH (exact) | `ev-a/40`, cmd-15 CASE 3: 503 after 20.1 s |

### E2E verifier (14)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-11: `node scripts/ui_focus.js` → 2/2 | MATCH | `ev-a/51`: 2/2. Focus goes to the confirmation heading, then to Title after "Publish another"; tenant and publisher are kept. |
| 2 | F-02 PASS: http ×3, ui ×2 | MATCH | `ev-a/50` 3/0, `ev-a/51` 2/0 |
| 3 | F-06 PASS: note and actor in the history, idempotent, actor defaults to the publisher | MATCH | `ev-a/50` 4/0 |
| 4 | F-09 PASS: ` inc0077001 ` is normalised; `ABC` and `ftp://` → 400; PUT attaches a ticket with an audit line | MATCH | `ev-a/50` 6/0, `ev-a/51` 1/0 |
| 5 | F-16 PASS: only the maintenance within P7D; hidden with `includeUpcoming=false`; the UI shows *Upcoming 1* | MATCH | `ev-a/50` 1/0, `ev-a/51` 2/0 |
| 6 | F-56 PASS: the tenant flows into the form; 201; a confirmation with a chip; *Publish another* keeps tenant and publisher and focuses Title | MATCH | `ev-a/51` 4/0, plus focus 2/0 |
| 7 | F-72 PASS: sidecar started before the app → UNKNOWN "starting: …", the service stays UP, no notice; the app is found 1.6 s after it starts | MATCH (nuance) | `ev-a/52`, ordering. The rollup reads `UP (1 of 2 pods UP (1 starting))`, no notice; the app was found 1.8 s after it started. |
| 8 | F-74 PASS. Slow backend: 1 s timeout. 400: permanent. 500: backoff 1 s, 2 s, then recovery. Backend dead: 1, 2, 4, 8, 16 s with `sendError`, "next report accepted 5 s after readiness, no notice". Mongo down: the same backoff (GAP-e2e2-6). | **PARTIAL** | **Reproduced:**<br>• Capture ×4 (`ev-a/52`): 1 s timeout → `context deadline exceeded` `in=1s`; 400 → ERROR `report rejected` and no request in the next 3 s; 500 → backoff 1 s, then 2 s; the stub answered the next retry 2.2 s after the last 500 (verifier: 2.3 s). The script's own FAIL, which looks for the INFO line that G-2-16 moved to DEBUG, reproduced too.<br>• Backend dead, both runs (`ev-a/53`): 1, 2, 4, 8 and 16 s, with `/status.sendError` set.<br>• Mongo down: the verifier's two outcomes (recovery PASS; attribution FAIL = GAP-e2e2-6).<br>**Not reproduced: "accepted 5 s after readiness, no notice".**<br>• Under load, A needed 16.1 s and 11.5 s to become ready (verifier: 6.8 s and 5.7 s). By then the sidecar's sixth attempt had failed, and the next came one 32 s step later: about 35 s after readiness in both runs, by the log timestamps.<br>• In run 1 the pod's silence passed the 90 s window. OUTAGE `ve2-app is down` opened at 05:29:57.327Z and was retired 13 s later (AUD-2-1, section 6). |
| 9 | F-76 PASS: `docker stop` → leaving report, exit 0 in 111 ms, `left=true`, no notice | MATCH (nuance) | `ev-a/52`, sigterm: 178 ms here |
| 10 | F-89 PASS: 31 JSON lines; a start line with version, service, tenant, instance and endpoint; one INFO per transition; WARN only for send failures | MATCH | `ev-a/52` logs 5/0, and `ev-a/54`: 31 lines, 0 non-JSON. The backend-log FAIL after the Mongo outage is GAP-backend2-6, as in the verifier's silence run. |
| 11 | F-92 PASS: backend down (error state with *Try again*, B keeps serving, sidecar backoff and recovery, the page heals); a silent pod → DOWN naming it; slow backend; http F-27/F-20/F-92 | MATCH (nuance) | **Both runs** (`ev-a/53`): the error state; B serving; A ready again; the page heals and shows the notice published meanwhile.<br>**Mongo outage:** 503 within about 5 s; readiness DOWN, liveness UP; recovery without a restart.<br>**Silent pod** (`ev-a/54`): OUTAGE 88.3 s after the kill, naming the pod.<br>**HTTP** (`ev-a/50`): 2/0.<br>In run 1 the recovery came after AUD-2-1's 13 s false notice, which is counted under F-74. |
| 12 | GAP-e2e2-1: a report with status UP and a DOWN component (DEGRADED) is re-sent only at the heartbeat, so the HEALTH notice waits `CS_HEARTBEAT` | MATCH (nuance) | `ev-a/52`, degraded:<br>• The report (status UP, `db` DOWN) left 2.9 s after the flip; the monitor was DEGRADED 8 ms later.<br>• The notice came only after the heartbeat send, 13.0 s after that first report (2 reports). `agent.go:311` sends such a report again only once 10 s have passed since the last send.<br>• The script labels this figure "after the flip", but its timer starts after the first report (`pod_flows.js:94-96`). So the verifier's "10.2 s after the flip" is also measured from its first report. |
| 13 | GAP-e2e2-4: the e2e README's `GO_IMAGE=local/go-toolset:1.24` cannot build a `go 1.25` module | MATCH (exact) | `ev-a/55`: `go: go.mod requires go >= 1.25 (running go 1.24.13; GOTOOLCHAIN=local)`, exit 1 |
| 14 | G-2-16 closed: the first DOWN report 4.2 s after the flip; OUTAGE 4.46 s after that report; card 4.68 s | MATCH (nuance) | `ev-a/52`, down: the first DOWN report came 2.3 s after the flip; the notice 4.38 s and the card 4.83 s after that report (2 reports). Dead app: `app is not listening (last target …)` from the first failed probe. Also `ev-a/41`, 12-send-policy. |

### Usability reviewer (14)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | Feed cap notice (SRE): "Showing the first 100 of 103 notices. Narrow the filters to see the rest.", badge 99+ | MATCH (exact) | `ev-a/60` `cap-notice`: identical, 100 cards |
| 2 | F-29 Swagger UI (developer): 20 operations, a lock on each, Authorize explains itself, 401 and 409 documented with examples, try-it-out 401 → 200 | MATCH | `ev-a/62`, Chromium:<br>• 20 operations, 20 locks.<br>• The dialog text; the 401 and 409 rows.<br>• 401 before Authorize; 200 after it, with `-H 'X-Client-Id: ux2-swagger'` in the curl. |
| 3 | F-34 monitors, probe and instances (developer, engineer): the not-found text, the push-only 409, the duplicate-monitor 409, the 202 report, instances (H1–H7, pod walk P4) | MATCH (equivalent for P4) | `ev-a/61`: H1–H7 identical after normalisation. I did not re-run P4, because it starts the reviewer's `ux2-*` pod. Instance records written by a real sidecar are in `ev-a/52` (F-75, F-48). |
| 4 | F-67 sidecar configuration (engineer): every missing variable at once, the scheme, `CS_PORT` with tcp, a bad duration, exit 2 | MATCH (exact) | `ev-a/63` S7: identical (exit 2 ×4) |
| 5 | F-80 image (engineer): user 1001, port 9465, version and revision labels. The UBI base, "~10 MB" and "no shell" were not exercised | MATCH | `ev-a/63` S9: `user=1001`, `9465/tcp`, `version=1.0.0-au2`, `revision=be19645`, size 16319254. The extra byte comes from the longer version label. |
| 6 | UX-48 (minor): the connection badge is plain text next to the switch, outside any live region | MATCH (exact) | `ev-a/60`: the accessibility tree around the badge (`switch "Live updates" [checked]`, `text: Live`) is identical to the reviewer's lines 28–33. `OutageFeed.tsx:113-125` read (`ev-a/70`). |
| 7 | UX-24 residual (cosmetic): OpenAPI, Swagger UI and the README explain `expectedVersion`, but the 400 is still the bare `expectedVersion: must not be null` | MATCH | `ev-a/61` C5-put-omitted → 400 `{"error":"expectedVersion: must not be null"}`. The explanations: G29-k (`ev-a/27e`) and `put409` (`ev-a/62`). |
| 8 | UX-51 (minor): the README's "Debugging" section says the sends between transitions are logged at DEBUG, but no setting raises the level (`main.go:36`: `slog.NewJSONHandler(stdout, nil)`) | MATCH | `ev-a/70`: `README.md:178-182`, `main.go:34-38`, and 0 hits for a log level in `config.go`. `ev-a/52`: "no DEBUG noise at the default level" (`{"INFO":17}`). |
| 9 | UX-8 recheck CLOSED: the Resolve and Withdraw confirmations name the actor and the tenant | MATCH (exact) | `ev-a/60`: `resolve-confirm`, `withdraw-confirm` and `phone-resolve-confirm` identical |
| 10 | UX-16 recheck CLOSED: no advice to retire; following the banner (`INC2000001-2`) publishes | MATCH (nuance) | `ev-a/60`: `duplicate-advice-works` is identical. `duplicate-409` is identical apart from a truncated notice-id fragment in the focused element's name. |
| 11 | UX-17 recheck CLOSED: focus on Title (in view, with the focus ring); tenant, publisher and type kept | MATCH (exact) | `ev-a/60` `publish-another-focus`: identical |
| 12 | UX-19 recheck CLOSED: "The service failed (HTTP 500). Try again; …", with the service's reason when it sends one | MATCH (exact) | `ev-a/60`: `variant-500-empty`, `variant-500-json` and `feed-500-json` identical |
| 13 | UX-26 recheck CLOSED: the 409 names the holder and the tenant, says the key is permanent and suggests a new value | MATCH | `ev-a/61` C1b (409 naming the holder); `ev-a/27e` G29-a/c/d; `ev-a/62` `post409` |
| 14 | UX-30–34 recheck, still RESOLVED: tenant explained; Image and Debugging sections; `CS_PUBLISHER`; namespace note; every documented path re-rendered | MATCH (equivalent) | `ev-a/63` S1–S6 identical: kustomize ×2, the `images:` override, the helm library and a chart that consumes it, kubeconform. `sidecar-pod.txt` was not re-run (it uses `ux2-*` containers). |

### Closed gaps: at least one claim re-verified per gap (directive c)

| Gap | Re-verified by | Gap | Re-verified by |
|---|---|---|---|
| G-2-1 | `ev-a/20`: the `-Werror` compile ran with 0 warnings; `createIndex` ×4, `ensureIndex` ×0 | G-2-10 | `ev-a/51`: focus 2/2. `ev-a/60`: `publish-another-focus`. `ev-a/12`: v5, the results wrapper can take focus. |
| G-2-2 | `ev-a/71`, static check only. SpotBugs (effort MAX, confidence MEDIUM, exclude filter) and JaCoCo (minimum 0.92) are wired into `check`. Not executed: the brief limits my Gradle runs to `test`/`integrationTest`. The verifier's `ev/01` (`check --rerun-tasks`) stands. | G-2-11 | `ev-a/53`: the client waits 1, 2, 4, 8, 10, 10 s; every client reopen carries `?lastEventId=`; the page heals within the cap and shows the replayed notice once. Also `ev-a/12` v7b. |
| G-2-3 | `ev-a/71`: the `ci.yml` jobs for backend, frontend and sidecar, with their steps; `e2e.yml`. The same steps run locally in `ev-a/10`, `11` and `20`. | G-2-12 | `ev-a/12`: the 11 G-2-12 lines from v1, v3 and v6. `ev-a/60`: the confirmations. |
| G-2-4 | `ev-a/26`, `26b`: 503 `database unavailable` within about 5 s; readiness 503 while liveness is 200; recovery without a restart. Also the Mongo part of `ev-a/53`, and `ev-a/40` O-1 (paused Mongo: 20.1 s). | G-2-13 | `ev-a/11`: the coverage figures; `npm audit` 0 and 0 |
| G-2-5 | `ev-a/27` G25 5/5: abandoned monitors are forgotten, left out of the share and do not pause the valve; the valve still pauses on a recent mass silence | G-2-14 | `ev-a/10`: go1.25.0; the image's version and revision labels. `ev-a/55`: `go 1.25` is enforced. |
| G-2-6 | `ev-a/27b` G26 10/10: after an operator's retire, the notice reopens on the threshold-th failing observation | G-2-15 | `ev-a/10`: with `CI=true` and no tools, 4 tests FAIL naming the tool; without CI, 3 SKIP + 1 PASS; the `/status` contract and `main` tests PASS. Also `ev-a/71`. |
| G-2-7 | `ev-a/27c` G27 3/3: 30 × 200 and 0 × 409 while the scheduler runs | G-2-16 | `ev-a/52`: the notice 4.38 s after the first DOWN report; a dead app is reported DOWN on the first failed probe. Also `ev-a/41`, 12-send-policy. |
| G-2-8 | `ev-a/27d` G28 4/4: the snapshot id is the log head; resuming from it works; nothing is skipped. Also `ev-a/12`: v3b 3/3 and v7b. | G-2-17 | `ev-a/71`, static check only: `npx playwright test --list` → 6 tests in 4 files; `tsc --noEmit` 0; `workers: 1`, `retries: 0`, trace kept on failure. The suite itself was not run, because the E2E-T fixer's `e2e-*` containers were up (section 6). The verifier's three runs (18 of 18) stand. |
| G-2-9 | `ev-a/27e` G29 17/17; `ev-a/60` (the banner); `ev-a/61` (C1b, C2, C6) | | |

### Feature completeness recount (directive b)

Recounted from `confidence/feature-matrix.json` (92 rows) and the verifiers' row tables:

- **Backend: 65/65 PASS → 30.0.** BE is listed on 68 rows. Its verifier scored 65 and left the whole-stack rows F-90, F-91 and F-92 to the E2E verifier, which marks all three PASS, so 68/68 gives the same 30.0.
- **Frontend: 29/29 PASS → 30.0.**
- **Sidecar: 28 PASS + 3 PARTIAL of 31 = 29.5/31 → 28.55.** The verifier wrote 28.5; the rounded total does not change. The three PARTIAL rows (F-80, F-82, F-86) involve only the sidecar and need a cluster or the UBI registry.
- **E2E: 33/33 → 30.0.** These are the rows with two or more services. Read literally, "every row with an `e2e_path`" covers all 92 rows: 89 PASS + 3 PARTIAL = 90.5/92 → 29.5, and the E2E total becomes 89.9 → 90, unchanged.

No row is FAIL in any report. No row is PASS in one report and FAIL or PARTIAL in another. The three sidecar PARTIAL rows are sidecar-only, so the E2E verifier does not grade them. The usability reviewer's feature rows are all PASS.

## 3. Test-weakening check (directive a)

`ev-a/01-test-weakening-check.txt` holds the diff facts, the commits that touched each pre-existing test file, and a verdict per removed line.

- **Diff size:** `git diff --stat 0e14838..908598a` over test paths: 39 files, **2527 insertions, 55 deletions**. The whole branch, `191a0c5..908598a`: 52 files, 4783 insertions, 31 deletions. With `--diff-filter=DR`, **no test file was deleted or renamed** in either range. `be19645`, `3806e7c` and `33451c3` touch only `confidence/`.
- **Markers added in iteration 2:** none (`@Disabled`, `@Ignore`, `assume*`, `.skip(`, `.only(`, `xit(`, `test.todo`, `t.Skip(`). The only `t.Skip` on the branch is iteration 1's `kustomize not on PATH` in `deploy_test.go`. Iteration 2 (`e54fe6a`, G-2-15) made it a failure under `CI=true`; here it FAILs and names the tool when the tools are absent and `CI=true` is set (`ev-a/10`). The added timeouts are the explicit timeouts of the new Playwright specs and sleeps inside new Go tests; no existing timeout was raised.
- **Removed assertion lines, backend: 8.** The verifier's `ev/06` lists 7; it missed `.hasMessageContaining("duplicate externalRef")` in the repository IT.
  - 3 were replaced by stronger assertions: the 409 now also asserts the permanent-key text and the holder; the repository message; and the snapshot stamped with the log head, which is read before the query.
  - 5 were expectations that encoded the G-2-6 defect: `unhealthyStreak().isZero()` ×4 became `isEqualTo(1)`, and `openCommunicationId().isNull()` became an assertion that the notice reopens at the threshold-th observation. `dce5f89`'s message justifies them.
- **Removed assertion lines, frontend: 4.**
  - `reconnectDelay` 16/30/30 s became 10 s ×3. That is G-2-11's documented cap; new attempt-by-attempt tests came with it, and the reopen URL is now asserted with `&lastEventId=`.
  - The old 409 wording that told the user to retire the notice was replaced by the permanent-key wording, plus an assertion that the advice to retire is gone (G-2-9).
- **Removed assertion lines, sidecar and e2e suite:** none. The e2e suite is new.
- **Pre-existing test files touched: 23.** Every commit that touched one is a `Fix G-2-…` commit whose message explains the change. `fixes.md` names 20 of them. The three it does not name are:
  - `MongoHealthInstanceRepositoryAdapterIT` and `MongoHealthMonitorRepositoryAdapterIT`: one setup line each, `ensureIndex` → `createIndex` (`37e6ad4`);
  - `deploy_test.go`: skip → fail under CI, described in the G-2-15 row and in `e54fe6a`'s message.
- **Suite sizes grew:**
  - `@Test` 227 → 250 (the JUnit XML of my run: 208 unit + 42 integration, 0 failed, 0 skipped; `ev-a/20`);
  - vitest `it`/`test` calls 73 → 136 (141 cases run in 18 files; `ev-a/11`);
  - Go top-level `Test*` 33 → 42 (42/42 PASS; `ev-a/10`);
  - the new Playwright suite: 6 tests in 4 files, listed only (`ev-a/71`).

**Finding: no test was deleted, skipped, xfail'd or loosened without justification. The gate is not tripped for any service.**

## 4. Hard gates (per service)

| Gate | Backend | Frontend | Sidecar | E2E |
|---|---|---|---|---|
| Any Feature Matrix item fails E2E | no (65/65; F-90–92 PASS in E2E) | no (29/29) | no (31 rows: 28 PASS, 3 PARTIAL, 0 FAIL) | no (33/33) |
| Test skipped, deleted or loosened without justification | no | no | no | no |
| Sidecar not restricted-v2 / not non-root | n/a | n/a | passes. The image runs as `User=1001` (`ev-a/10`, `ev-a/63` S9). In the pod emulation it runs with `--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges` (`ev-a/52`, `ev-a/56`). This is an emulation, not an SCC admission. | — |
| Open critical/high security finding | none known. Iteration 2 added or changed no dependency; it added only the SpotBugs Gradle plugin, with a resolution strategy limited to its own configurations (`ev-a/71`). The SBOM scan needs the network (verifier's `ev/07`). | no: `npm audit` 0 with and without `--omit=dev` (`ev-a/11`); the `minimatch` override clears the dev-only finding | none known: standard library only (`go.mod` has no `require`), Go 1.25. govulncheck is blocked (`vuln.go.dev` Forbidden, `ev-a/10`). | inherits the three |

No cap applies: every audited total is above 80 on its own merits, and no gate is tripped.

## 5. Recomputed scores

| Category (weight) | Backend verifier → audit | Frontend verifier → audit | Sidecar verifier → audit | E2E verifier → audit |
|---|---|---|---|---|
| Builds & static checks (10) | 9 → 9 | 10 → 10 | 9 → 9 | 8 → 8 |
| Feature completeness (30) | 30 → 30 (65/65; 68/68 with F-90–92) | 30 → 30 (29/29) | 28.5 → 28.5 (29.5/31 = 28.55) | 30 → 30 (33/33; 29.5 if all 92 rows count) |
| Automated test health (20) | 19 → 19 | 19 → 19 | 18 → 18 | 17 → 17 |
| Integration & contracts (20) | 19 → 19 | 19 → 19 | 17 → 17 | 18 → 18 |
| Resilience & ops (10) | 8 → 8 | 10 → 10 | 9 → 9 | 9 → 9 |
| Usability (10) | 9 (provisional) → **8.9** (API 89/100) | 9 → **8.4** (UI 84/100) | 9 → **9.4** (onboarding 94/100) | 8 (provisional) → **8.4** (UI 84/100, the lowest surface) |
| **Total** | 94 → **93.9 ≈ 94** | 97 → **96.4 ≈ 96** | 90.5 → **90.9 ≈ 91** (90.95 with 28.55) | 90 → **90.4 ≈ 90** |

**Usability fold.** It is the same as in iteration 1: backend ← the reviewer's API score; frontend ← the UI score; sidecar ← the onboarding score; E2E ← the UI score, the lowest surface a user journey crosses.

**Only usability changed.** 74 of 75 sampled claims reproduced. The 75th, E2E F-74, differs in a timing that its matrix row does not specify. So there is no evidence that a verifier over- or under-scored a category, and I do not re-grade on opinion.

**Scores without evidence: none.** The backend, sidecar and E2E reports cite their evidence inline in every category row. The frontend's test-health, integration, resilience and usability rows state facts that its Commands and Feature tables cite (`static-checks.txt`, `run-logs/v2…v8`, `results/aggregate.txt`); the facts I sampled reproduced.

## 6. Nuances, auditor errors and harness incidents (all recorded; none changes a verdict)

### Observation that needs a gap decision in iteration 3

It is not in `confidence/iter-3/gaps.md`, which was written before this audit finished.

**AUD-2-1 (minor): the sidecar's backoff cap against the instance staleness window.**
- **The two settings:**
  - **Sidecar:** it backs off failed sends at 1, 2, 4, 8, 16, 32 and then 60 s, plus up to 20 % jitter, and keeps only the latest report (`agent.go:25-26`, `340-347`).
  - **Backend:** it declares a pod silent after `instance-stale-after-seconds: 90` (`application.yml:102`).
- **Observed, run 1 of the kill flow (`ev-a/53`):** under load, A took 16.1 s to become ready. By then the sidecar's sixth attempt had failed, so its next report was accepted about 35 s after readiness, about 94 s after its last accepted report. At 90.3 s of silence, A's sweep (start grace 0, as the verifier's `start-backend.sh` sets for both nodes) opened OUTAGE `ve2-app is down` at 05:29:57.327Z. It retired the notice 13 s later, after the second UP report.
- **Observed, run 2:** A was ready in 11.5 s, the report was accepted about 35 s after readiness, and no notice opened. The verifier saw no notice because its restarts took 6.8 s and 5.7 s.
- **Why the scores stand:** both behaviours are as specified (F-74's 1 s → 60 s backoff, F-48's silence rule). The topology is particular to the emulation: a sidecar pinned to the node that died, while the other node stays up past its start grace. Behind a Service or a Route, the retries reach the surviving node.
- **Inferred from the constants, not observed:** a pod's last report can be up to one heartbeat old (30 s) when an outage starts, and its next attempt can come up to one backoff step (at most 72 s) after the outage ends. So a pod can cross 90 s after an outage of about a minute behind nodes that stay up, for example a Mongo outage. The staleness valve catches a fleet that goes silent all at once, but not the pods that are still waiting out a long step after most of the fleet has recovered.
- **Options:**
  - cap the backoff below the window minus the heartbeat;
  - or document the relation in both READMEs.

### Nuances

1. **Backend cmd-5:** 8 removed assertion lines against the verifier's 7 (section 3).
2. **Backend cmd-12:** 80/80 here against 79/80. B-34a's race did not occur; the verifier's 8/8 re-check stands.
3. **Frontend:**
   - F-15: the expired card left 99 ms after `expiresAt` here, 142 ms there.
   - F-18: v3 gave 2/2 here; there it gave 1 PASS plus a FAIL from the verifier's own double subscription.
4. **Sidecar counts** grow with run time:
   - cmd-21: 536 INFO here against 528;
   - GAP-sidecar-3: 105 reports against 101.
5. **E2E:**
   - F-72: the app was found 1.8 s after it started (1.6 s there).
   - F-76: the stop took 178 ms (111 ms there).
   - G-2-16: the first DOWN report came 2.3 s after the flip (4.2 s); the notice 4.38 s after it (4.46 s); the card 4.83 s after it (4.68 s).
6. **Mislabelled script timers.** Two timers in the verifier's scripts do not start where their labels say; both figures I first wrote down came from those labels.
   - **GAP-e2e2-1:** "notice … after the flip" is measured from the first report (`pod_flows.js:94-96`): 13.0 s here, 10.2 s there. Both fit `agent.go:311`'s heartbeat rule: at least 10 s after the last send, at the next 3 s probe tick.
   - **F-74:** "accepted … after readiness" starts after the page-heal checks (`failure_flows.js:100-114`). It printed 33.2 s and 28.2 s here, while the log timestamps give about 35 s; the verifier's "5 s" is 7.1 s and 3.2 s by its timestamps. Annotations are in `ev-a/52` and `ev-a/53`. The verifier's conclusions hold with the corrected figures.
7. **FAIL composition of the E2E failure flows.**
   - Run 1 has the verifier's run-1 count, 21 PASS / 5 FAIL.
   - Its kill FAILs are F-61's `header=undefined`, AUD-2-1's F-74, and the harness crash (item 14). F-61's `header=undefined` is also the verifier's run-2 FAIL; the CDP capture in its `32b`/`32c` shows the header.
   - The two Mongo FAILs are the verifier's: GAP-backend2-6 (log hygiene) and GAP-e2e2-6 (attribution).
   - Run 2 gave 12/2 (`ev-a/53`).
8. **`fixes.md`** names 20 of the 23 pre-existing test files the fixes touched (section 3).
9. **Usability replays:**
   - `duplicate-409` differs from the reviewer's record only in a truncated notice-id fragment.
   - S8's laptop run differs because the reviewer's backend :19600 does not exist here.
   - 24 of the 156 lines of the API walk changed, all for environmental reasons:
     - the database was fresh, so C1 verbatim gave 201 instead of 409;
     - event sequence numbers differ;
     - the admin tenant list differs;
     - section D has a quoting error in its embedded Python in both runs.

### Auditor errors

Each was caught before it could affect a result, or the step was re-run.

10. **Container names.** I copied the sidecar scripts and renamed the verifier's `vs2-` prefix to `au2-`. That would have reused my E2E pod's container names (`au2-app`, `au2-sidecar`) and recreated a Mongo database. I caught it before any run and renamed them to `au2-s-*` (Mongo `au2-s-mongo` on :19728, backend :19706).
11. **Ports.** None of these ran against the wrong target:
    - my copy of `check_a` still opened one raw connection to :8080; I re-pointed it to :19711 before the run;
    - the sidecar scripts' :19760 collided with my E2E capture stub; I moved them to :19769;
    - `15b-rollup-and-ids.sh` computes its ports (`1938$((n+4))`, `1936$((n+1))`), which my substitution missed; I moved them to 1978x/1976x before the run.
12. **Frontend v6 (`ev-a/12`, `12b`).**
    - Run 1 still fetched the production `index.html` from the verifier's :3205 and hit ECONNREFUSED after 4/4 PASS.
    - Run 2's same-origin assertion still compared against `http://127.0.0.1:3000`. That gave one FAIL, although its own detail shows the right header, `Accept`, `?clientId=` and origin.
    - Run 3, with both constants re-pointed: 8/0.
13. **My own evidence.**
    - `ev-a/01` section E first listed `stream.test.ts` under `00433c3`. I regenerated it per file from `git log`; the right commit is `7bb0b6c`.
    - My first draft of the `fixes.md` note said 19 of 23; it is 20.
    - The echo label `db au2_mongodown` in the v7b output was copied with the verifier's script; its queries ran on `au2_cfg`. Annotated in `ev-a/12`.
    - The private stack-up script tried to create `au2-mongo`, which my backend jobs had already started. `docker run` refused the name and the stack used the running container (`ev-a/56`).
14. **Harness crash.** Both of my failure-flow runs crashed at the script's *Try again* click: during the long sidecar wait, the second page had already healed itself. So the second-outage checks of the verifier's run 2 (backoff reset, second restart) did not run here.

### Harness incidents

15. **Pause.** The coordinator paused me for about a minute at about 05:04 UTC. The two tool calls in flight, an `e2e-*` container check and the start of the Vite dev servers, were rejected; I re-issued both after the resume. A foreground `sleep 45` was blocked, so I used background runs with notifications instead.
16. **Load.** The fixers' worktrees in `/home/claude/wt-*` built and tested in parallel, keeping the load average at 6–10 on 4 cores. I stopped my own idle JVMs mid-audit to reduce it. The timings above carry that load (A's 16.1 s and 11.5 s to readiness, F-76's 178 ms).
17. **Blocked, as in iteration 1:**
    - `vuln.go.dev` (govulncheck);
    - the UBI and quay registries: the sidecar image uses substitute builder and base images;
    - the backend SBOM scan;
    - no kind or OpenShift: the pod is a Docker shared-network-namespace emulation.

### Not run

18. **The in-repo Playwright suite (`e2e/`).** The E2E-T fixer was using its only compose project (the `e2e-*` containers were up the whole time), so I ran only `npx playwright test --list` and `tsc --noEmit` (`ev-a/71`).
19. **SpotBugs and JaCoCo (`./gradlew check`).** Outside the Gradle command the brief allows.
20. **The reviewer's pod and outage walks** (`sidecar-pod`, `ux2-dbdown`, `ux2-reconnect`). The sampled claims that cite them were checked against equivalent evidence.
21. **Frontend v4, v7 and v8.** Not in the sample.

## 7. What code was actually under test

- **Branch:** `confidence-loop/2026-11-01`. `HEAD` was `33451c3` for the whole audit; its code is identical to `be19645` and to the last fix commit, `908598a`. Three later commits touch only `confidence/` (0 other files):
  - `be19645`: the fixers' records;
  - `3806e7c`: the verifier and usability reports;
  - `33451c3`: the iteration-3 gap analysis.

  The working tree had no tracked change. The untracked `confidence/evidence/iter-3/` belongs to the iteration-3 fixers, who work in `/home/claude/wt-*` worktrees; I did not read those.
- **Last code commits by area:** `src` `908598a`; `build.gradle.kts` `b0a71ef`; `frontend` `6ba70b0`; `sidecar` `7006692`; `e2e` `3bf0946`.
- **Backend:** `scratchpad/communication-service-iter2.jar`, the jar the verifiers and the shared :8080 use (sha256 `491438c7…`, the same as `build/libs` of `be19645`). `ev-a/20` compiled and tested the checkout from 04:55 to 04:57 UTC.
- **Frontend:**
  - my Vite dev servers served the working tree;
  - `vite preview` served `frontend/dist`, built at 03:39:43 UTC, after the last frontend commit.
- **Sidecar:**
  - image `health-sidecar:au2`, which I built from `sidecar/` at `be19645` (labels `1.0.0-au2` / `be19645`), with substitute builder and base images because UBI is blocked;
  - `go test`, `vet` and `build` on the checkout, with go1.25.0.
- **Pod:** `fakeapp:e2e`, the e2e stack's test double, built at 02:48:58 UTC.

## 8. Evidence index (`confidence/evidence/iter-2/audit/`)

| File | Contents |
|---|---|
| `00-claims-and-sample.txt` | The 363 claims and the seed-2 sample |
| `01-test-weakening-check.txt` | The weakening check, sections A–G |
| `10-sidecar-static-and-tests.txt` | Sidecar static checks and tests |
| `11-frontend-static-and-tests.txt` | Frontend static checks and tests |
| `12-frontend-browser-replays.txt` · `12b-frontend-run-logs.txt` | Frontend browser replays |
| `20-gradle-test-integrationTest-rerun.txt` | Backend build and tests |
| `21-backend-replay-summary.txt` | Totals against the verifier, the sampled ids, the log review and the gap signatures |
| `22-backend-check-a-replay.txt` · `22b-backend-check-a2-replay.txt` · `22c-backend-check-a23-replay.txt` · `23-backend-check-b-replay.txt` · `24-backend-check-d-gaps-replay.txt` · `25-backend-check-c-pair-replay.txt` · `25b-backend-check-c3-pods-replay.txt` · `26-backend-g24-mongo-down-replay.txt` · `26b-backend-g24b-stream-during-outage-replay.txt` · `27-backend-g25-forget-after-replay.txt` · `27b-backend-g26-reopen-replay.txt` · `27c-backend-g27-probe-race-replay.txt` · `27d-backend-g28-snapshot-head-replay.txt` · `27e-backend-g29-externalref-openapi-replay.txt` · `28-backend-config-cmd22-replay.txt` | Raw backend replays |
| `40-sidecar-scenarios-summary.txt` · `41-sidecar-scenario-outputs.txt` | Sidecar scenarios |
| `50-e2e-http-checks-replay.txt` · `51-e2e-ui-flows-and-focus-replay.txt` · `52-e2e-pod-flows-replay.txt` · `53-e2e-failure-flows-replay.txt` · `54-e2e-pod-silence-logs-replay.txt` · `55-e2e-readme-go124-probe.txt` · `56-e2e-private-stack-up.txt` | E2E replays |
| `60-usability-ui-walk-replay.txt` · `61-usability-api-walk-replay.txt` · `62-usability-swagger-replay.txt` · `63-usability-sidecar-manifests-replay.txt` | Usability replays |
| `70-code-reads.txt` | The code lines quoted above |
| `71-closed-gap-static-checks.txt` | G-2-2, G-2-3, G-2-15 and G-2-17, and the dependency diff for the security gate |
| `90-cleanup.txt` | Clean-up |

The scripts I copied from the verifiers and re-pointed, with their raw outputs, stay in the session scratchpad (`audit2/`); they are not in the repository.

## 9. Clean-up

**Stopped at the end of the audit** (`ev-a/90`; listening sockets on 19700–19799 afterwards: 0):
- the private backends A :19701 and B :19702 (the others had been stopped mid-audit);
- `vite preview` on :19730 and the Vite dev servers on :19731, :19736 and :19737;
- the static proxies on :19732–:19734;
- the containers `au2-sidecar`, `au2-app`, `au2-stub`, `au2-netns`, `au2-mongo` and `au2-mongo3`, with `docker rm -f`. The `au2-s-*` scenario containers were already gone;
- the image `health-sidecar:au2`;
- my databases in `mongo7`: `au2_cfg`, `au2_cookbook`, `au2_e`, `au2_gaps`, `au2_pair`, `au2_pods`, `au2_shared` and `au2_sidecar`.

**Left in place, checked after the clean-up:**
- the shared stack: `mongo7`, `app` and `sidecar` up; backend :8080 readiness 200; Vite :3000 200;
- the E2E-T fixer's `e2e-*` compose project and every fixer process.

**Repository:** nothing was committed, checked out, stashed or pushed. `git status` shows only the untracked `confidence/evidence/iter-2/audit/`, this report, and the fixers' `confidence/evidence/iter-3/`.
