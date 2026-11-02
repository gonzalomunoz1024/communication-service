# Iteration 3 — Independent Audit

**Auditor:** Independent Auditor for iteration 3. I wrote no code, test, fix or verifier report. I changed nothing outside `confidence/evidence/iter-3/audit/` and this report, and committed nothing.
**When:** 2026-11-02, 07:53–09:55 UTC. **Code under test:** `e3968c4` on `confidence-loop/2026-11-01`, whose code is the tree of the last fix commit, `4a0e84e`. `HEAD` was `6fa95c5` when I started and `6c15715` from 07:57 UTC; both later commits change only files under `confidence/` (section 7).
**Method:** I drew a seeded random sample (`random.seed(3)`) of 20 % (rounded up) of the 460 claims taken from the five iteration-3 reports. A claim is a row of a Commands table, Feature verdicts table, Gaps table or closure list, or a sidecar O-n observation, usability finding or iteration-2 re-check, as in iteration 2. The sample is stratified per report: backend 26 of 130, frontend 16 of 78, sidecar 18 of 89, E2E 15 of 75 and usability 18 of 88, which makes **93 claims** (`ev-a/00`). I also ran the directed checks:
- **(a) Test weakening:** over the 37 iteration-3 fix commits `23c297d..4a0e84e` against `be19645`, and over the whole branch from `191a0c5`.
- **(b) Feature completeness:** recounted from `feature-matrix.json`.
- **(c) Closed gaps:** at least one claim re-verified for each closed gap, G-3-1 to G-3-32.
- **(d) Scores, gates and contradictions:** scores without evidence, the hard gates, and PASS/FAIL contradictions between the reports.
- **(e) The three gate claims the brief names:** GAP-backend3-6 (the dependency scan), F-34 (the G-2-7 scenario) and F-65 (UX-53). I re-ran each myself (section 4).

**Instances** (all mine: ports 19700–19799, databases and containers prefixed `au3`):
- **Shared stack (read only):** backend :8080, Vite :3000, `mongo7`, `app` and `sidecar`. I grepped its log and sent GETs.
- **Backend replays:** private copies of the same jar, `scratchpad/communication-service-iter3.jar` (sha256 `b63ffd4e…`, the same as `build/libs`):
  - :19711 stands in for :8080, with the default configuration and database `au3-shared`;
  - :19712 and :19713 form the pair (`au3-pair`, :19713 at DEBUG); :19715 runs with the sweeper off (`au3-eff`);
  - :19714 on `au3-mongo` (:19798) is the Mongo-outage node;
  - :19720 and :19725 (iteration-3 jar) against :19721 and :19726 (the iteration-2 jar, `scratchpad/communication-service-iter2.jar`, sha256 `491438c7…`) for the G-2-7 A/B runs; :19795 (`au3-dropped`), which also served the CVE probe; the probe stub on :19760;
  - the image `au3-backend:test` on :19780.
- **Frontend:** Vite dev servers on :19741–:19744, reverse proxies on :19745–:19749, the backend :19711 in place of :8080, backends :19753/:19754 (pair) and :19755 (own Mongo), the `au3f-*` pod.
- **Sidecar scenarios:** the verifier's scripts with `au3-s*` containers, image `health-sidecar:au3` built from `sidecar/` (labels `1.0.0-au3` / `e3968c4…`), backend :19700 (`au3-smain`).
- **E2E:** backends A :19701 and B :19702 on `au3-emongo` (:19727), `vite preview` of `frontend/dist` on :19730, the pod `au3-enetns` + `au3-eapp` + `au3-esidecar` (UID 1000660000, read-only, `cap-drop ALL`, `no-new-privileges`), the stub :19751. The in-repo suite (compose project `e2e`) ran once, for the G-3-12 mutation.
- **Usability:** the reviewer's scripts on :19700/:19711 (API walk, cookbook), Vite :19741/:19742, an outage pair :19775 → :19774 on its own Mongo (:19773), a reconnect pair :19778 → :19777, pods `au3-ux-*`.

`ev-a/NN` means `confidence/evidence/iter-3/audit/NN-…`. `ev/…` and other file names refer to the cited report's own evidence folder.

## 1. Verdict per score

| Score | Claimed | Audit verdict | Audited value | Why |
|---|---|---|---|---|
| Backend | 80 (capped; 91 before the cap) | **ACCEPT 80** | 91.0 before the cap → 80 | All 26 sampled claims reproduced:<br>• 297 tests (251 + 46), 0 failures, 0 skips;<br>• the check scripts id by id: 102 of 103 `check_a` ids and every other script identical; A-24 too, once my harness read the right database;<br>• the Mongo-outage rows, the image, the four sampled gaps.<br>**Gate claim 1:** my own Trivy run, on a database I downloaded fresh, finds the same 29 entries (3 CRITICAL, 10 HIGH) in libraries the jar ships, and nothing triages them. The gate applies; the cap stands.<br>**Gate claim 2:** F-34 stays PASS (note); G-2-7 with a 1 s sweep fails 0/30, as claimed (GAP-backend3-1).<br>Usability 9 (provisional) → 9.0 (API 90/100). |
| Frontend | 96 | **ACCEPT 96** | 95.7 | All 16 sampled claims reproduced:<br>• lint, typecheck and build ×3 exit 0; 169/169 tests ×3 plus coverage (96.77 % statements); `npm audit` 0;<br>• eight browser runs identical id by id (258 checks);<br>• G-3-21, G-3-23, G-3-25 and G-2-10 closed.<br>**Gate claim 3:** F-65 passes as the matrix defines it (46/46 rows, axe 0 violations, lowest contrast 4.66:1). The feed's load error has no `role=alert` (UX-53, confirmed), but F-65, F-57 and F-59 do not ask for one there (section 4.3). No gate.<br>Usability 9 (provisional) → 8.7 (UI 87/100). Trivy finds 0 in the lockfiles, dev dependencies included. |
| Sidecar | 91.5 | **ADJUST to 80** | 92.05 before the cap → 80 | All 18 sampled claims reproduced:<br>• configuration errors, send policy, vocabulary, staleness;<br>• the restricted-v2 emulation, the wire contract, the manifests.<br>**The cap:** the vulnerability check the verifier could not run (govulncheck: `vuln.go.dev` Forbidden) does run with Trivy, the tool and database that capped the backend:<br>• 4 HIGH entries in the Go 1.25.14 standard library compiled into the shipped binary;<br>• one of them (CVE-2026-111943, `crypto/x509`) is on the default https report path;<br>• no Go 1.25 release carries the fixes (1.26.9+ / 1.27.2+ only), and nothing triages them.<br>That is an open high finding, so the hard gate caps the score at 80 (**AUD-3-1**, section 4.4).<br>Before the cap: usability 9 → 9.5 (onboarding 95/100); features 28.5 → 28.55. |
| E2E system | 97 | **ADJUST to 80** | 96.7 before the cap → 80 | All 15 sampled claims checked:<br>• 14 reproduced by re-running: HTTP 119/119, UI 34/34, pods, failure flows; spec 04 passes through the proxy and fails when the proxy strips the id;<br>• 1 from the verifier's log only: a crashed run that cannot be repeated.<br>**The cap:** the system ships the backend and the sidecar. As in the iteration-0 and iteration-2 audits, the E2E score inherits their security-gate status. GAP-backend3-6 and AUD-3-1 are open, so the score is capped at 80. The verifier applied the gate only to `e2e/` (`npm audit` 0).<br>Before the cap: usability 9 → 8.7 (UI). |
| Usability Reviewer (UI 87 / API 90 / onboarding 95) | — | **ACCEPT** | — | All 18 sampled claims reproduced:<br>• UX-53: the feed's load error is announced by nothing;<br>• the UX-42 residual: the badge stays "Live" during a database outage;<br>• UX-44 and UX-45 closed; UX-48 closed, with live announcements through a real kill;<br>• the cookbook, the Swagger fix-up chain, the pod walks.<br>Its "FAIL (one clause)" on F-65 states a fact I confirm. Whether it trips a gate is a separate question, settled in section 4.3. |

**Overall iteration-3 confidence (the lowest of the four): 80 / 100** (iteration 2: 90). No VETO.
- **Why 80:** all three caps come from the security gate. Without it, the lowest score would be the backend's 91.
- **What changed since iteration 2:** a vulnerability database is now reachable. The entries were published between 2026-07-21 and 2026-10-21, before iteration 2, and both iterations ship the same Spring Boot 3.5.16 and the same Go 1.25 line. So the drop is a measurement change, not code that got worse.
- **The one regression observed:** GAP-backend3-1 (G-2-7 under a 1 s sweep).

As in earlier audits, I re-graded no category on my own judgment. Two kinds of change only:
- the reviewer's usability figure in place of each verifier's own figure;
- the 80 cap for an open high finding that I reproduced, on the sidecar and on the E2E system that ships it.

## 2. Sampled claims and results (93)

The labels in the Result column mean:
- **MATCH:** the claim reproduced as stated.
- **MATCH (exact):** it reproduced to the figure or to the byte.
- **MATCH (nuance):** it reproduced, with a detail worth recording.
- **MATCH (equivalent):** the verifier's own command could not be repeated as written (bound to its ports or containers, or a script version it did not keep), so I ran an equivalent check that proves the same claim.
- **EVIDENCE ONLY:** the run cannot be repeated; I checked the verifier's log for consistency and re-ran what still exists.
- **PARTIAL:** part of the claim did not reproduce.

**Tally:** 92 of 93 reproduced (61 MATCH, 18 MATCH (exact), 10 MATCH (nuance), 3 MATCH (equivalent)), 1 EVIDENCE ONLY, 0 PARTIAL, 0 MISMATCH.

### Backend verifier (26)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | G-3-2 closure: one probe per interval across two nodes (G32-a: 13 probes in 62 s); the losing node stays quiet; it caused GAP-1 | MATCH (nuance) | `ev-a/21`: G32-a–c 3/3:<br>• 7 probes in 31 s, gaps 5.03–5.1 s;<br>• 0 `skipping monitor` WARN and 0 ERROR on either node.<br>The kept script's window is 31 s, the window the verifier's `ev/24b` ran (6 probes). `ev/24`'s 62 s came from an earlier version of the script. GAP-1 is in `ev-a/22`. |
| 2 | G-3-25 closure: automated notices in plain sentences, signed with one name (G3-25-a…i, C-44a) | MATCH | `ev-a/21`:<br>• body "push-svc is DOWN as of … UTC.";<br>• published under the monitor's publisher; a default-publisher notice retired as `health-monitor` when its monitor is deleted;<br>• C-44a's stale-notice body.<br>`be-22` 51/51 and `be-25` 19/19, with the verifier's verdicts. |
| 3 | cmd-5: jar sha256 before and after; BOOT-INF/lib listing | MATCH (exact) | `ev-a/20`, `ev-a/07` §4:<br>• `b63ffd4e…` before and after my Gradle run, the same as the shared stack's jar;<br>• netty 4.1.135.Final, jackson 2.21.4 and spring-webflux 6.2.19 in BOOT-INF/lib. |
| 4 | cmd-10: `check_g_jackson_regex.py` → 0 | MATCH (exact) | `ev-a/07` §6: the same codes, sizes and texts at n = 2,000 and 60,000; 7–91 ms; exit 0 |
| 5 | cmd-14: `check_b_health` → 0 (80/80) | MATCH (exact) | `ev-a/21`: 80/80; all 62 compared ids have the verifier's verdict |
| 6 | cmd-31: image build, run, stop → 0; 0; 0 (143) | MATCH | `ev-a/24`:<br>• every layer cached;<br>• `User=65532:65532`, `8080/tcp`, `java -jar /app/app.jar`, 335,092,382 bytes, as in `ev/34`;<br>• readiness 200; 401 without `X-Client-Id`; publish 201;<br>• `docker stop` 4.49 s (4.42 s there), exit 143 after a graceful shutdown. |
| 7 | F-03 PASS: any status, with history; unknown → 404; EXPIRED after `expiresAt` without a write | MATCH | A-03a/b, G33-a/b and N-1 PASS |
| 8 | F-12 PASS: 8 parallel PUTs with the same version → 1 × 200, 7 × 409 | MATCH (exact) | A-12: `[200, 409 ×7]` |
| 9 | F-13 PASS: the state machine is enforced; the 409 texts name the state | MATCH | A-13a–c, C-13a/b and G33-g PASS. The texts: "already expired; retiring would rewrite history", "is EXPIRED and can no longer be updated". |
| 10 | F-17 PASS: RETIRED and EXPIRED stay retrievable; unknown ids and drafts → 404 | MATCH | A-17a/b, A-02c, C-17 and A-15a PASS |
| 11 | F-20 PASS: resume via header or query, after the larger id; 15 races with no miss | MATCH | PASS: A-20a/d/e, D-1-a–e, G3-11-a–d, and G28-b/c (15 rounds, 0 misses).<br>A-20b/c fail in `check_a` here too: the verifier's documented frame-order artefact. They pass in the 9/9 re-check.<br>O-1h passes in the phase-1 re-run, as in `ev/33b`. |
| 12 | F-23 PASS: filters and history; effective status | MATCH | A-23a–d and G33-d PASS |
| 13 | F-24 PASS: counts match the stored statuses in Mongo | MATCH | A-24 PASS once my harness read `au3-shared` (section 6, item 15) |
| 14 | F-34 PASS (note): GAP-1 regression (G27-a 0/30, G27b-S1/S3 0/10); the default configuration passes | MATCH (nuance) | `ev-a/22`:<br>• B-34a/b PASS.<br>• G27-a: 0 × 200 / 30 × 409 in 274.4 s, as there.<br>• G27b and G27c identical: the iteration-2 jar 10/10, the iteration-3 jar 0/10.<br>• G27d-D1 (default sweep): 10/10 here and 9/10 plus one 409 there; 4 of 10 calls needed retries in each run (9.2 s = three attempts). |
| 15 | F-37 PASS: a status-bearing document wins over the HTTP status; timeouts; plain HTTP fallback | MATCH | B-37a–f and G3-30-e PASS |
| 16 | F-50 PASS: 20 parallel reports → 20 × 202, twice | MATCH (exact) | B-50, B-50b and D-7-a/c: 20 × 202, 0 × 409 |
| 17 | F-57 (BE) PASS: every rejection is `{"error": text}` | MATCH | A-07, A-28, G3-7/8/9 and G29 (17/17) PASS |
| 18 | F-62 (BE) PASS: retire with note and actor; idempotent | MATCH | A-06a–c PASS |
| 19 | F-70 (BE) PASS: the service reads every sidecar word the same way | MATCH | G3-30-a–g and B-38 PASS |
| 20 | F-72 (BE) PASS: UNKNOWN during startup opens nothing | MATCH | B-38 (UNKNOWN), B-47e and G3-30-d-UNKNOWN PASS |
| 21 | F-74 (BE) PASS: 409 only on a persistent conflict; database outage → 503, retryable | MATCH | B-50/B-50b and D-7-a/c PASS; O-1e 503 after 5.09 s (5.04 s there) |
| 22 | GAP-backend3-2: monitor registration accepts misspelled policy fields | MATCH | `ev-a/23`: G3-8-l → 201 with the defaults; `RegisterMonitorCommand` has no `@JsonIgnoreProperties` |
| 23 | GAP-backend3-3: readiness answers in about 1.01 s, past a kubelet's default 1 s timeout | MATCH | `ev-a/23`: 1.01 s on every probe while Mongo was stopped; the code and README lines as cited |
| 24 | GAP-backend3-4: one dropped probe error logged at ERROR with a full trace | MATCH (exact) | `ev-a/23`:<br>• shared log line 47 is the only ERROR in 1,839 lines;<br>• 74 stack lines (74 there), 0 `com.atlas` frames;<br>• no `Hooks.onErrorDropped` in `src/main`. |
| 25 | GAP-backend3-6: 3 CRITICAL + 10 HIGH in netty, spring-webflux and jackson | MATCH (exact) | `ev-a/07`: with my own fresh database, 29 entries (3 CRITICAL, 10 HIGH, 16 MEDIUM), the same IDs (section 4.1) |
| 26 | GAP-backend3-7: the debian12 base ships fixable critical/high OS packages | MATCH | `ev-a/24`, `ev-a/07` §7:<br>• debian12: 108 entries, 2 CRITICAL + 12 HIGH, 10 fixable;<br>• debian13: 77 entries, 4 HIGH (libuuid1, no fix).<br>Not re-checked: that the local base digest equals the tag's remote digest. |

### Frontend verifier (16)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | G-3-21 closed (g3, v2) | MATCH | `ev-a/30`:<br>• g3 32/32 and v2 46/46, identical id by id;<br>• the 409 banner says the ServiceNow incident number doubles as the reference;<br>• the service's text is folded under "What the service said". |
| 2 | G-3-23 closed (g3, v4, v5) | MATCH | g3, v4 9/9 and v5 46/46 identical |
| 3 | G-3-25 closed (g3, v8) | MATCH | g3, and v8 7/7, identical: the "Automatic" chip, a plain-sentence body, the pod outage card |
| 4 | G-2-10 still closed: focus lands on the banner and the heading | MATCH | v2, v3, g3 and v5 identical |
| 5 | cmd-8: three environment-specific builds → 0, 0, 0 | MATCH | static steps 11–13: exit 0, 0, 0 |
| 6 | cmd-9: `npm ls minimatch` and the `overrides` block → 0 | MATCH | `minimatch@11.0.3 overridden`; `{"minimatch": "^11.0.1"}` |
| 7 | cmd-14: v1 → 0 (62/62) | MATCH (exact) | v1 62/62, the same ids |
| 8 | cmd-18: g3 run 1 → 0 (30/32: two script assumptions) | MATCH (equivalent) | the kept, corrected g3 script: 32/32. The run-1 version was not kept. |
| 9 | cmd-23: v8 pod UI → 0 (7/7) | MATCH | 7/7 identical. The run used my copy after a port fix (section 6, item 16). |
| 10 | cmd-27: v7b expired `lastEventId` → 0 | MATCH | The same four outcomes:<br>• a gap the log no longer holds → snapshot;<br>• the boundary → `created` only;<br>• nothing missed → no frames;<br>• an id never issued → snapshot.<br>The sequence numbers are 1–3 here and 3–5 there. |
| 11 | F-02 PASS | MATCH | the five F-02 rows identical |
| 12 | F-15 PASS: the card leaves 129 ms after `expiresAt` | MATCH (nuance) | three rows identical; 135 ms here |
| 13 | F-53 PASS | MATCH | seven rows identical |
| 14 | F-59 PASS | MATCH | nine rows identical |
| 15 | F-66 PASS: lint, typecheck and build ×3; tests 169/169 ×3 | MATCH (exact) | static steps 01–06 and 14–19, all exit 0; 169/169 ×3 plus the coverage run |
| 16 | GAP-frontend3-1: `onopen` counts every 200 as a recovery; a normally ended stream is left to the browser's retry | MATCH | `api.ts:182-191` as cited (`ev-a/70`). Seen live in `ev-a/60`: a page opened during the outage cycles Live/Reconnecting about every 8 s. |

### Sidecar verifier (18)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | G-3-17 closed: `maybe`, `2` and `enabled` → exit 2 with one ERROR line; every documented spelling starts; `yes` turns verification off and `No` on | MATCH | `ev-a/40`:<br>• `04-config-errors`: 0 differing lines after normalising;<br>• `14-tls`: `yes` sent=1; `No` sent=0, with x509 "unknown authority". |
| 2 | O-1: README L155-156's 33 and 67 req/s per 1,000 pods are upper bounds | MATCH (nuance) | `42` §G identical (it computes from the cadence constants). My `17c` heartbeat gaps of 32.8–34.7 s give about 30 req/s for healthy pods; a failing cycle takes at least 15 s, so at most 67. |
| 3 | O-6: a SIGTERM during the first probe → UNKNOWN and one leaving report | MATCH | `15c`: `docker stop` 0.08 s; one report, UNKNOWN "instance shutting down", `leaving=true` |
| 4 | cmd-9: `CI=true go test -count=1 -shuffle=on ./...` ×3 → 0/0/0 | MATCH | 7/7 packages ok in each run |
| 5 | cmd-15: `12-send-policy` (14 documents, 60 s each) → 0 | MATCH (nuance) | The same levels, summaries, notices and debug lines. Sends per minute are identical except comp-notserving (19 vs 18) and comp-error (18 vs 17). |
| 6 | cmd-20: `15b-vocabulary-edges` → 0 | MATCH (exact) | identical apart from a notice id |
| 7 | cmd-26: `17c-staleness` → 0 | MATCH (nuance) | The same sequence:<br>• the 22 s outage opens nothing;<br>• the 100 s outage gives DOWN "has not reported since" about 91 s after the last accepted report, and a notice;<br>• then UP, and the notice is retired.<br>The first report was accepted 2.0 s and 19.1 s after the proxy returned (0.6 s and 16.0 s there), depending on where the backoff stood. |
| 8 | cmd-28: `30-restricted-v2` → 0 | MATCH | For all 5 UID/GID choices:<br>• the same Uid/Gid/Groups; CapEff 0, NoNewPrivs 1, Seccomp 2;<br>• the same mounts and fds, no shell, the same strace call set;<br>• VmRSS within 0.3 MB. |
| 9 | cmd-31: `40-security` → 0 / 0 / 1 (`vuln.go.dev` Forbidden) / 1 / 000 and 200 | MATCH (exact) | byte-identical apart from the scratch path. What a reachable database shows: `ev-a/08`, section 4.4. |
| 10 | cmd-35: the shared pod, read only | MATCH | `/status` UP, `/healthz` 200; `User=1000660000:0`, read-only, `CapDrop ALL`, `no-new-privileges`; the same 3 INFO lines |
| 11 | F-36 PASS | MATCH | `15` §2 identical: a blank or missing status, or a missing tenantId or service → 400 naming the field; unknown keys → 202 |
| 12 | F-38 PASS (34 spellings) | MATCH | `15` §3 identical: every word, overall and as a component |
| 13 | F-70 PASS | MATCH | `10` B and `12` identical: Actuator DOWN with db DOWN → DOWN with components; WARN → DEGRADED |
| 14 | F-71 PASS | MATCH | `13` CASE 3 identical: `CS_PORT` + `CS_PATH=/ping`, and the tcp, actuator and http targets |
| 15 | F-75 PASS | MATCH | `42` §D: the headers identical.<br>`13` CASE 6: 253 accepted; 254 → 400 permanent, one send in 5 s.<br>`15c`: the leaving body.<br>`11-ladder` was not re-run; `13` and `15c` show equivalent bodies. |
| 16 | F-80 PARTIAL: the UBI bases are unreachable | MATCH | `03-image-build`: the same facts (go1.25.14, static, `-trimpath`, `User=1001`, labels). `registry.access.redhat.com/v2/` → 000 at 09:05Z. |
| 17 | F-87 PASS | MATCH | `20` run 2 identical:<br>• liveness `httpGet /healthz` on `cs-status`, every 30 s only;<br>• no readiness or startup probe; no preStop or grace period. |
| 18 | GAP-sidecar3-2: README:218 says the report timeout outlasts the service's database timeout; a frozen database holds a report longer | MATCH (exact) | `ev-a/23`, direct reports while my Mongo was paused: 503 after 20.03 s, then 5.02 s and 5.01 s. README:218, `application.yml:59` (PT15S) and README.md:119-124 read as cited. |

### E2E verifier (15)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | G-3-12: spec 04, unchanged, behind a proxy: it passes in pass-through mode and fails in strip mode | MATCH | `ev-a/50`, `41-g312-mutation` (the repository suite, compose project `e2e`):<br>• pass mode: 1 passed ("replayed as created#2 on the stream resumed after 1");<br>• strip mode: 1 failed (expected `created`, received `snapshot`; the proxy stripped the last id three times). |
| 2 | G-3-13: the README's Dockerfile text gives go1.25.14 and builds `--no-cache`; labels; no `local/go-toolset:1.24` | MATCH | `40-g313`:<br>• README L50-54 verbatim → go1.25.14;<br>• the `--no-cache` build ran `go build` (14.1 s); the labels come from the build arguments; user 1001;<br>• the binary exits 2 naming `CS_ENDPOINT` and `CS_TENANT`;<br>• no `go-toolset:1.24` in `e2e/`. |
| 3 | G-3-18: a never-UP pod sends 4 UNKNOWN reports in 40 s at the 8 s heartbeat; the service ignores them | MATCH (exact) | `30-pod-flows`: 4 reports in the window; "UNKNOWN (1 pod starting, none reporting yet)"; no notice |
| 4 | G-3-29 kill, run 2: retry steps 1, 2, 4, 8, 16 s; accepted 3.6 s after A was ready; B saw 47.0 s of silence and opened no notice | MATCH (nuance) | First run: A came back during the 8 s step, so only 4 steps, and the script's "≥ 5 steps" line FAILed.<br>I re-ran it once, as the brief says for timing checks under load (`31b`):<br>• steps 1, 2, 4, 8 and 16 s;<br>• accepted 5.3 s after readiness;<br>• B's longest silence 50.2 s; no notice. |
| 5 | cmd-6: the fake app's `go vet` and `go test` → 0 | MATCH | exit 0 |
| 6 | cmd-13: jar sha256 equal; `frontend/dist` from 06:42:24; no code diff `4a0e84e..e3968c4` | MATCH | `b63ffd4e…` for both; dist 06:42:24; both diffs empty (also `e3968c4..HEAD`) |
| 7 | cmd-15: `http_checks.py core sse health fanout` → 0 (119/119) | MATCH (exact) | 119 pass, 0 fail; the same 119 names in the same order |
| 8 | cmd-16: `ui_flows.js` run 1 → 3 (31/34: three errors in the verifier's script) | MATCH (equivalent) | The kept, corrected script: 34/34, with names identical to the verifier's run 2. The three run-1 FAIL lines pass. The run-1 version was not kept. |
| 9 | cmd-20: `failure_flows.js` run 1 crashed (`ReferenceError: since`); A stayed down 60 s, which gave accidental G-3-29 data | EVIDENCE ONLY | The crashing version was not kept, so the run cannot be repeated.<br>• Its log, `ev/31a`, shows the ReferenceError.<br>• `ev/32`'s arithmetic is consistent: steps up to 30 s; accepted 21.5 s after readiness; silence 82.3 s, under the 90 s window.<br>I did not re-run a 60 s outage. |
| 10 | cmd-21: run 2 → 1 (26/27: the FAIL was the script checking 1.4 s after the stream ended) | MATCH (equivalent) | the kept script's late-page check, which waits for the badge and the retry, passes |
| 11 | cmd-22: `failure_flows.js mongo` run 3 → 0 (15/15) | MATCH (exact) | the same 15 names, all PASS; 503 in 5.019 s, readiness 503 in 1.014 s, B 503 in 5.032 s |
| 12 | F-02 PASS | MATCH | `10`: a DRAFT is absent from the feed, its permalink 404s, `/publish` → ACTIVE, a non-draft → 409.<br>`20`: "Save draft" → "Draft saved", with no View in feed. |
| 13 | F-07 PASS | MATCH | 24 F-07 rows; every rule names its field (G-3-7 positions, G-3-8 unknown fields on publish/PUT/retire, G-3-9, G-3-32) |
| 14 | F-38 PASS | MATCH | 21 F-38 rows, including G-3-30's words. Through the real sidecar: `pass` → UP; `fail` → a DOWN component; UP with db DOWN → DEGRADED. |
| 15 | GAP-e2e3-2: a send that succeeds after failures, with the status unchanged, is logged at DEBUG only | MATCH | `agent.go:355-360` as cited. Seen in `31b`: five WARN "report failed; will retry", then A logs the 202 and the sidecar logs nothing. |

### Usability reviewer (18)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-3: focus-obscured and focus-reverse → 0; 0 | MATCH (nuance) | `ev-a/60`: both exit 0; no settled stop is hidden or partly hidden (desktop and phone, Tab and Shift+Tab).<br>• The reviewer's raw log has two `hidden=true` entries in an unsettled phone-reverse list, which its report sets aside.<br>• The metric flags the header's own theme button in both runs. |
| 2 | cmd-6: view-in-feed focus, twice → 0; 0 | MATCH (exact) | Twice: focus lands on `body` after "View in feed"; Connecting/Live are announced; the next Tab reaches the filters. The finding reproduces. |
| 3 | cmd-9: a page opened during the outage, 45 one-second samples | MATCH (exact) | 45 samples; the error shown in 10; badges Connecting 1 / Live 29 / Reconnecting 15; 7 feed GETs, all 503; 6 streams |
| 4 | cmd-12: the cookbook pasted literally, twice, on a fresh store → 0 | MATCH | Run 1: every block 0 except the two bounded `curl -N` blocks (124).<br>Run 2: the duplicate-externalRef 409, and the 409 for a PUT on a RETIRED notice. |
| 5 | cmd-16: Swagger's publish example, fixed one error at a time, reaches a 201 | MATCH | ticket.url → endsAt → expiresAt → "INCIDENT requires severity MINOR or higher" → 201 (DRAFT) |
| 6 | cmd-20: `sidecar-pod3` and `auto-notice3` | MATCH | The same phases. One card, with the "Automatic" chip and its title and a plain-sentence body; no `health:` ref; no horizontal scroll at 1280 or 390 px. |
| 7 | F-65 "FAIL (one clause)": the feed's load error is not `role=alert` (UX-53) | MATCH | `au3-feed-error-live.txt`, the fact as stated:<br>• the error text is in no alert or live region; 0 alerts on the page;<br>• nothing is announced on load or after Try again.<br>Whether this fails F-65 is settled in section 4.3. |
| 8 | F-09 PASS: the form explains that the incident number doubles as the reference | MATCH | the `PublishOutageForm.tsx:250` hint; the real 409 banner in my g3 run; API walk E6b and E10 → 400 |
| 9 | F-27 PASS: the 401 names the header and `?clientId=`; Authorize says what to paste | MATCH | E0: the 401 names both; a bad id → 400. My `/v3/api-docs` carries the reviewer's Authorize text. |
| 10 | F-31 PASS, with friction UX-56 | MATCH | H1 201 with Location; H6 409; H7 204; H8 201 with a typo; misspelled policy fields → 201 with the defaults |
| 11 | F-78 PASS: the README's three causes reproduce; `CS_LOG_LEVEL=debug` shows every send | MATCH (nuance) | `sidecar-pod3`: debug shows every send. `sidecar-cause3`: UNKNOWN with the configuration hint at 5, 20 and 40 s. The grace timings differ by seconds. |
| 12 | F-80 NOT VERIFIED (UBI) | MATCH | The registry answers 000. The repository Dockerfile with a distroless base runs as 1001, and as 1000660000 under the restricted emulation. |
| 13 | F-82/F-83 Kustomize PASS | MATCH | S1–S3b identical apart from timestamps |
| 14 | UX-53 (minor): "Couldn't load the feed" appears silently | MATCH | the probe of row 7 |
| 15 | UX-42 PARTLY CLOSED: the words are right; the badge stays "Live" | MATCH | A real outage (my Mongo stopped for 51 s):<br>• API 503 in 5.0 s; the UI shows the database sentence, with the badge "Live" beside it;<br>• a page opened meanwhile cycles Live/Reconnecting;<br>• recovery: 2/2 cards. |
| 16 | UX-44 CLOSED on publish, update, retire and ticket; the same class remains on monitors (UX-56) | MATCH | E6–E6f: all 400, naming the field and the known ones; monitor typos → 201 |
| 17 | UX-45 CLOSED | MATCH (exact) | E7 "affectedServices[1]: must not be null", E7b "… must not be blank", E7c "affectedServices: expected a JSON array" |
| 18 | UX-48 CLOSED: the badge is a status; Reconnecting, (1)…(7) and Live announced through a real kill and restart | MATCH (nuance) | The badge has `role=status`, `aria-live=polite`, "Live". Through a real kill: Reconnecting, (1)…(6), Live. The restart took 7.6 s here and 11.1 s there, so one attempt fewer. |

### Closed gaps: at least one claim re-verified per gap (directive c)

| Gap | Re-verified by | Gap | Re-verified by |
|---|---|---|---|
| G-3-1 | `ev-a/23`: a stream opened during the outage gets `:connected`, ends after 5.01 s, and logs one WARN and 0 ERROR (O-1f/g/h in the phase-1 re-run) | G-3-17 | `ev-a/40` row 1 |
| G-3-2 | `ev-a/21`: G32-a–c 3/3. Its side effect, GAP-backend3-1, is in `ev-a/22`. | G-3-18 | `ev-a/50` row 3; `ev-a/40` `12-send-policy`: never-up sends at the heartbeat only |
| G-3-3 | `ev-a/21`: G33 11/11; N-1 | G-3-19 | `ev-a/40`: `CI=true go test -shuffle=on` ×3; `ev-a/01` §G: the test's new body is stricter |
| G-3-4 | `ev-a/71`: the JaCoCo exclusions are now only `*Config*`, `*Properties*` and `*Application*` | G-3-20 | `ev-a/30`: g3 G-3-20 rows 2/2; `ev-a/60` row 15 (a real outage) |
| G-3-5 | `ev-a/71`: `bom.json` lists 87 runtime components and no build or test tool; `includeConfigs = runtimeClasspath` | G-3-21 | `ev-a/30` row 1 |
| G-3-6 | `ev-a/23`: O-1i (phase-1 re-run) and O-2f: ERROR 0, stack lines 0, one readiness DOWN line per outage | G-3-22 | `ev-a/30`: g3 G-3-22 rows 8/8; focus moves onto the note field, inside a `role=group` named by the question |
| G-3-7 | `ev-a/21` (G3-7 rows); `ev-a/60` row 17 | G-3-23 | `ev-a/30` row 2; `ev-a/60` row 18 |
| G-3-8 | `ev-a/21` (G3-8 rows); `ev-a/60` row 16 | G-3-24 | `ev-a/30`: g3 G-3-24 rows 7/7; 19 keys → one `GET /v1/feed` and one stream |
| G-3-9 | `ev-a/21`: G3-9-a–f, both instants named, and the defaulted start | G-3-25 | `ev-a/21` (backend row 2); `ev-a/30` (frontend row 3) |
| G-3-10 | `ev-a/40`: `20-manifests` (the Helm include lines) identical; `ev-a/71`: `README.md:21` says Spring Boot 3.5 | G-3-26 | `ev-a/71`: `useTheme.ts` 100 % lines and 96 % branches in my coverage run (60.9 % lines in iteration 2) |
| G-3-11 | `ev-a/21`: G3-11-a–d | G-3-27 | `ev-a/71`, static only: `playwright test --list` shows 9 tests in 7 files, with the new specs 05, 06 and 07. Of the suite I ran only spec 04; the verifier's three runs (27/27) stand. |
| G-3-12 | `ev-a/50` row 1 | G-3-28 | `ev-a/71`: `npm run lint` 0 and `typecheck` 0 in `e2e/`; `e2e.yml:55-56` runs both |
| G-3-13 | `ev-a/50` row 2 | G-3-29 | `ev-a/50` row 4 |
| G-3-14 | `ev-a/40`: every documented level starts, and a bad one exits 2; `ev-a/60` row 11 | G-3-30 | `ev-a/21` (G3-30-a–g, G3-30-e); `ev-a/40` row 12; `ev-a/50` row 14 |
| G-3-15 | `ev-a/50` (`31`): during the outage the sidecar's reports fail with the service's 503, because the 10 s report timeout outlasts the 5 s database timeout | G-3-31 | `ev-a/23`: O-2a/b: 20.05 s for a read and 15.04 s for a write, then 5.01 s; `ev-a/71`: README.md:118-125 says so |
| G-3-16 | `ev-a/40` `12-send-policy`: UP with a DOWN component → DEGRADED, sent on every probe (18 a minute) | G-3-32 | `ev-a/21`: G3-32-a/b; the `endsAt` message names both values |

### Feature completeness recount (directive b)

Recounted from `confidence/feature-matrix.json` (92 rows) and the verifiers' row tables (`ev-a/00`):

- **Backend: 65/65 PASS → 30.0.** BE is listed on 68 rows. The verifier scored 65 and left the whole-stack rows F-90, F-91 and F-92 to the E2E verifier, which marks all three PASS. 68/68 gives the same 30.0.
- **Frontend: 29/29 PASS → 30.0.**
- **Sidecar: 28 PASS + 3 PARTIAL of 31 = 29.5/31 → 28.55.** The verifier wrote 28.5. The three PARTIAL rows (F-80, F-82, F-86) involve only the sidecar and need a cluster or the UBI registry.
- **E2E: 33/33 → 30.0.** These are the rows with two or more services. Read literally, "every row with an `e2e_path`" covers all 92 rows: 89 PASS + 3 PARTIAL = 90.5/92 → 29.5. The E2E total before the cap would then be 96.2, and the cap gives 80 either way.

**Contradictions (directive d).**
- **F-65** is the only row that is PASS in one report and FAIL in another: the frontend's PASS against the reviewer's "FAIL (one clause)". Section 4.3 settles it.
- **F-80:** the reviewer's NOT VERIFIED (UBI) agrees with the sidecar's PARTIAL.
- **F-34:** the reviewer's NOT VERIFIED says only that the success path was not run from that seat.
- No row is PASS in E2E and FAIL in a service report, or the reverse.

## 3. Test-weakening check (directive a)

`ev-a/01-test-weakening-check.txt` holds:
- the diff facts;
- every touched pre-existing test file, with its commits;
- a verdict per removed line, against `fixes.md` ("Existing tests touched") and the commit messages.

- **Ranges:**
  - `23c297d..4a0e84e` holds 37 commits, all "Fix G-3-…". `23c297d` itself and every commit after `4a0e84e` touch only `confidence/`.
  - The local `main` is an old ancestor (`19159f5`, "wip"), so the whole-branch diff uses `191a0c5`, the original main, as the brief says.
- **Diff size:**
  - test paths, `be19645..4a0e84e`: 38 files, **+3062 −91**;
  - the whole branch, `191a0c5..4a0e84e`: 69 files, +7838 −62.
  - With `--diff-filter=DR`, **no test file was deleted or renamed** in either range.
- **Markers:**
  - **None added:** no `@Disabled`, `@Ignore`, `assume*`, `.skip(`, `.only(`, `xit(`, `todo` or `fixme`.
  - **The two `t.Skip` lines** on the branch (kustomize, from iteration 1; helm, new in `1415134`) go through `requireTool`, which calls `t.Fatalf` when `CI` is set.
  - **Timeouts:** none raised. The Playwright config changed by one comment line. Spec 04's card wait went from 90 s to 30 s, which is tighter.
- **Removed lines, backend: 34** (the verifier's `ev/06` also counts 34):
  - **G-3-2 (`507e918`):** the matchers became stricter, and a new two-instance test was added.
  - **G-3-25 (`56d6cc8`):** the old notice format was replaced by exact lines of the new one; the actor change is the defect itself.
  - **G-3-32 (`72a14cd`):** a substring check became the exact message.
  - **The rest:** constructor arguments, a `LogCapture` factory and Javadoc lines, with no assertion.
- **Removed lines, frontend: 10** (the verifier's `test-diff.txt` also counts 10):
  - **G-3-21:** two verbatim-409 tests were replaced by tests of the form's explanation, with the service's text kept inside the details element.
  - **The rest:** a role query moved into a helper, with the same expected text; an EventSource stub; an import.
- **Removed lines, sidecar: 35** (the verifier's `41-test-diff.txt` also counts 35):
  - **G-3-19 (`375ccea`):** a 300 ms wall-clock test with a 3..20 window now runs on the harness clock, with exact per-tick counts.
  - **The rest:** harness fields and a package comment.
- **Removed lines, e2e: 12.**
  - **Spec 04:** a thrown restart error became `expect(await restart).toBeNull()`, and the wait was tightened.
  - **The rest:** imports and the title, plus one comment line in the config.
- **Justification.** Every removed assertion is replaced by an equal or stronger one, or encodes a deliberate, documented behaviour change (G-3-2, -12, -19, -21, -25, -32). Each is named in `fixes.md` and in the commit that made it.
  - **Not named in `fixes.md`:** six touched pre-existing files, whose removed lines are only comments, imports or harness refactors: `OperationsEndpointsIT`, `RestControllerFeedAdapterTest`, `OutageCard.test.tsx`, the `92e63d0` harness fields of `agent_test.go`, `deploy_test.go` and `playwright.config.ts`.
- **Suite sizes:**
  - Java `@Test` 250 → 297, executed here: 251 unit + 46 integration, 0 failed, 0 skipped (`ev-a/20`);
  - vitest 136 → 164 calls (169 cases run; `ev-a/30`);
  - Go top-level `Test*` 42 → 53;
  - Playwright 6 → 9 tests.

**Finding: no test was deleted, skipped, xfail'd or loosened without justification. The gate is not tripped for any service.**
- **Side note (coverage, not weakening):** no existing test was changed to admit the G-2-7 regression.
- **Why the tests miss it:** `HealthMonitorUseCaseTest`, which holds the probe-now tests, is untouched since `be19645`. Its tests mock the conflict and never model the sweep's new claim save.

## 4. Hard gates (per service)

| Gate | Backend | Frontend | Sidecar | E2E |
|---|---|---|---|---|
| Any Feature Matrix item fails E2E | no: 65/65; F-90–92 PASS in E2E. F-34 PASS (note) is upheld (4.2). | no: 29/29. F-65 passes as the matrix defines it (4.3). | no: 31 rows, 28 PASS, 3 PARTIAL (cluster or UBI), 0 FAIL | no: 33/33 |
| Test skipped, deleted or loosened without justification | no | no | no | no |
| Sidecar not restricted-v2 / not non-root | n/a | n/a | passes: the image runs as `User=1001`. Under the emulation (`--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges`), five UID/GID choices give CapEff 0, NoNewPrivs 1 and Seccomp 2 (`ev-a/40`, rows 8 and 10). This is an emulation, not an SCC admission. | — |
| Open critical/high security finding | **tripped:** GAP-backend3-6, reproduced (4.1) | no: Trivy `fs` with dev dependencies finds 0; `npm audit` 0 (`ev-a/08` §5, `ev-a/30`) | **tripped:** AUD-3-1, 4 HIGH in the Go standard library of the shipped binary (4.4) | **tripped, inherited** from the backend and the sidecar (4.5) |

Three caps bind: backend 80 (as its verifier applied it), sidecar 80 and E2E 80. The frontend has no cap.

### 4.1 Gate claim 1: GAP-backend3-6 (`ev-a/07`)

**Re-run.** Trivy 0.58.1 from `mirror.gcr.io`, `sbom --scanners vuln` on `build/reports/cyclonedx/bom.json` (87 runtime components).
- **Database:** the verifier's cache could not be used: Trivy needs a writable cache even with `--skip-db-update`, and the cache is read-only to me. So I downloaded a fresh one (UpdatedAt 2026-11-02T07:17:05Z), which is the more independent check.
- **Result:** 29 entries: 3 CRITICAL, 10 HIGH and 16 MEDIUM. They are the verifier's entries ID for ID, with nothing extra on either side:
  - CRITICAL: netty-handler CVE-2026-75595; spring-webflux CVE-2026-47890 and -47892;
  - HIGH: 5 in jackson, 5 in netty.

**Ruling: the gate applies as worded ("an open critical/high security finding").**
- **The versions ship:** the shipped jar carries exactly the affected versions in `BOOT-INF/lib`, and the SBOM is runtime-only (G-3-5).
- **Nothing triages them:** there is no VEX file, ignore list or accepted-risk record.
- **The repository's own CI fails on them:** `ci.yml:40-46` (`anchore/scan-action`, `fail-build: true`, `severity-cutoff: high`) and README.md:80 say they fail the job.
- **The environmental exception does not apply:** "no vulnerability DB" is not true here, because the database was reachable for the verifier and for me.
- **The reachability probe** (`check_g_jackson_regex.py`, reproduced) lowers the risk of one jackson entry. It closes nothing, and the netty and webflux entries are untested.
- **Not a regression:** the 13 entries were published between 2026-07-21 and 2026-09-23. Spring Boot 3.5.16 has been in the build since `be19645`; iteration 2 had no reachable database.
- **The base image (GAP-backend3-7):** its OS packages (2 CRITICAL + 12 HIGH, 10 with a Debian fix) would meet the same wording. That changes nothing, because the backend is capped already. The verifier graded it as information, because CI scans only the SBOM. The planner may want to weigh it for iteration 4.

### 4.2 Gate claim 2: F-34 and the G-2-7 scenario (`ev-a/22`)

- **The row's own check passes** (how_to_verify: probe a URL monitor → `lastProbeAt` set; probe a push-only monitor → 409): B-34a/b PASS here and there.
- **With the shipped 5 s sweep, forced probes answer 200:** 10/10 here and 9/10 in the verifier's run, where the tenth was the documented persistent-conflict 409. But 4 of 10 calls needed retries in both runs (9.2 s is three attempts). The iteration-2 jar in the same configuration needed at most one retry, on its first call (D4: 6.1 s once here, then about 3 s; about 3 s throughout there).
- **The failing scenario** is iteration 2's G-2-7 re-check with a non-default 1 s sweep:
  - 0 × 200 / 30 × 409 here and there, 274.4 s each;
  - G27b S1/S3 0/10 on the iteration-3 jar;
  - the iteration-2 jar passes the same single-node scenario 10/10 (S3a).
- **Why:** the regression comes from G-3-2's claim save. The sweep saves twice per probe (`HealthSweepUseCase.java:170`, `:194-196`), while a forced probe holds its version for the whole 3 s probe and retries the whole probe 3 times (`HealthMonitorUseCase.java:48`, `:123-129`).

**Ruling: PASS (note) is upheld, and the gate does not trip on F-34.**
- **Iteration 1 graded the same race the same way:** PASS with a race note (iteration-1 audit, row 13).
- **The regression is real:** it is GAP-backend3-1 (minor). The verifier counts it in its test-health deduction (−1) and in its integration deduction (−2, shared with GAP-2 and GAP-5), and I keep both.
- **No numeric effect:** gate 1 caps the backend anyway.

### 4.3 Gate claim 3: F-65 against UX-53 (`ev-a/30`, `ev-a/60`, `ev-a/70`)

**The fact is not in dispute.** The feed's load error ("Couldn't load the feed", the service's sentence, Try again) renders in `EmptyState`.
- **The markup:** plain `div`/`p` elements, with no role and no `aria-live` (`EmptyState.tsx:19-29`, `OutageFeed.tsx:143-153`).
- **What a screen reader hears:** nothing, on load or after Try again (my probe; UX-53).

**The question:** does F-65's clause "errors use role=alert" make the row fail E2E? It does not, for these reasons:
- **The matrix specifies the feed error elsewhere, without a role.**
  - F-57 (FE, BE) puts the publish banner in "a role=alert banner". In the same sentence it specifies the feed load error as "'Couldn't load the feed' with the text and Try again", with no role.
  - F-59 says the same ("error → 'Couldn't load the feed' + Try again").
  - Where the matrix wants `role=alert`, it says so for that surface.
- **F-65 names what it covers.** Its `where` is `Field.tsx:26-47, 56-70, 169-199`, Tabs, Segmented, Button and StatusDot. `Field.tsx:48` gives the field's error note `role=alert` when there is an error. The publish banners (`PublishOutageForm.tsx:282`, `:300`) and the resolve error (`OutageCard.tsx:149`) carry it too. `EmptyState` and `OutageFeed` are not in the row.
- **F-65's E2E check passes in full.** Its how_to_verify is: tab through the publish form; run axe on both tabs in light and dark; check tag contrast. Its `e2e_path` is "UI (keyboard + axe)". Result: 46/46 rows, 0 axe violations, lowest sampled contrast 4.66:1 (light) and 5.93:1 (dark), in my run and in the verifier's.
- **The product has not changed.** The markup is the same at `191a0c5` and `be19645` (`EmptyState` changed only its colour tokens, in `2ff9f45`). Iterations 1 and 2 passed F-65 on it, and the iteration-2 audit accepted that. A cap now would change the reading, not the product.
- **Single clauses still count.** The iteration-0 audit counted one failing clause of F-06 as a failing row, and this ruling keeps that strictness: a clause that fails would fail the row. What it decides is what this clause covers. Iteration 0's F-65 failure was its how_to_verify: axe contrast and a placeholder-only label.

**Ruling: F-65 PASS; the frontend gate is not tripped.**
- **UX-53 stands:** it is a valid minor UI finding, already priced into the reviewer's UI 87.
- **For iteration 4, either:**
  - give the feed error `role=alert`, or put it in the existing polite region;
  - or, if the team wants it required, say so in F-57/F-59, so the matrix and the clause agree.

### 4.4 New: AUD-3-1, open HIGH findings in the sidecar's Go standard library (`ev-a/08`)

The sidecar verifier could not check the standard library: govulncheck needs `vuln.go.dev`, which is Forbidden here (`ev-a/40` row 9). The same Trivy database that settled gate 1 can check it.

**The scan.** `trivy rootfs` on the binary that `sidecar/Dockerfile` builds from `e3968c4`, compiled with go1.25.14 (the verifier's `ev/03` gives the same version) → 14 stdlib entries: 4 HIGH, 9 MEDIUM, 1 LOW.

| ID | Package | Fixed in | Reached? (code read; govulncheck's call graph cannot run here) |
|---|---|---|---|
| CVE-2026-111943 | `crypto/x509` (untrusted intermediates) | 1.26.10, 1.27.3 | **Yes.** The report client verifies TLS by default (`internal/report/client.go:65-89`), so every https `CS_ENDPOINT` handshake runs x509 verification. |
| CVE-2026-78667 | `net/http` Range headers | 1.26.9, 1.27.2 | No: there is no `ServeContent`, `ServeFile` or `FileServer` in the sidecar. |
| CVE-2026-78669 | HTTP/2 SETTINGS | 1.26.9, 1.27.2 | Not as far as the code shows. The client Transport sets `TLSClientConfig` without `ForceAttemptHTTP2`, so HTTP/2 is off, and the status server speaks plain HTTP/1.1 (`main.go:55-57`). |
| CVE-2026-97031 | `crypto/tls` ECH (server side) | 1.26.9, 1.27.2 | No: the sidecar runs no TLS server. |

**Ruling: the gate applies to the sidecar, by the same test as gate 1.**
- **The finding is open and reproduced:** it is in a shipped runtime component, and the database is reachable.
- **It cannot be patched within the pinned line:** the repository pins Go 1.25 (`go.mod:3`; `Dockerfile:8` `ubi9/go-toolset:1.25`; CI's `setup-go` reads `go.mod`), and no 1.25 release carries the fixes.
- **Nothing triages it:** there is no `.trivyignore`, VEX or govulncheck exclusion.
- **The repository's own CI would fail:** its `govulncheck@latest` step (`ci.yml:101-102`) would report at least the x509 entry once `vuln.go.dev` answers.
- **What I could not verify:** the shipped builder, `registry.access.redhat.com/ubi9/go-toolset:1.25`, is unreachable here. Red Hat may backport fixes into its 1.25 build, but a version-based scanner would still report these IDs, and CI's `setup-go` path builds with upstream 1.25.x.
- **Not a regression:** the entries were published on 2026-10-08 and 2026-10-21. Iteration 2's go1.25.0 had the same exposure, unmeasured.

| Proposed gap | Severity | Feature | Root cause | How reproduced | Suggested fix | Test that should have caught it |
|---|---|---|---|---|---|---|
| AUD-3-1 | blocker (hard gate) | build and security (F-80 image; every sidecar row ships the binary) | `sidecar/go.mod:3` `go 1.25` and `sidecar/Dockerfile:8` `go-toolset:1.25`: a Go line that no longer receives security fixes | `trivy rootfs` of the image binary (`ev-a/08` §1): 4 HIGH stdlib entries | Move to Go ≥ 1.26.10 or 1.27.3, in `go.mod` (and a `toolchain` line), the builder image and CI. Keep the Dockerfile/`go.mod` equality test. Record a binary scan (Trivy or govulncheck) in CI evidence. | CI's govulncheck step (exists, blocked here); a Trivy `rootfs` scan of the built binary |

**Effect:** the sidecar is capped at 80 (92.05 before the cap). As an upper bound, by the backend verifier's own measure the sidecar's Builds category would also lose points for a failing dependency criterion: its −1 assumed that no scan could run. I leave the category as scored, because the cap binds either way and I do not re-grade on opinion.

### 4.5 E2E: the security gate is inherited

- **The convention:** the E2E system score covers the shipped services working together. The iteration-0 audit applied the security gate to E2E as "inherits the backend finding", and the iteration-2 audit as "inherits the three". Both times the cap did not bind; it binds now.
- **What the verifier did:** it applied the gate to `e2e/` only ("the service scans belong to their verifiers"; `npm audit` 0).
- **Why the cap applies:** the services' verifiers (backend) and this audit (sidecar) find open high and critical entries in components the system ships, so E2E is capped at 80 (96.7 before the cap).
- **The overall figure does not change:** it is the minimum, which the backend sets at 80.

## 5. Recomputed scores

| Category (weight) | Backend verifier → audit | Frontend verifier → audit | Sidecar verifier → audit | E2E verifier → audit |
|---|---|---|---|---|
| Builds & static checks (10) | 6 → 6 | 10 → 10 | 9 → 9 | 10 → 10 |
| Feature completeness (30) | 30 → 30 (65/65; 68/68 with F-90–92) | 30 → 30 (29/29) | 28.5 → 28.55 (29.5/31) | 30 → 30 (33/33; 29.5 if all 92 rows count) |
| Automated test health (20) | 19 → 19 | 19 → 19 | 19 → 19 | 19 → 19 |
| Integration & contracts (20) | 18 → 18 | 19 → 19 | 17 → 17 | 19 → 19 |
| Resilience & ops (10) | 9 → 9 | 9 → 9 | 9 → 9 | 10 → 10 |
| Usability (10) | 9 (provisional) → **9.0** (API 90/100) | 9 (provisional) → **8.7** (UI 87/100) | 9 → **9.5** (onboarding 95/100) | 9 (provisional) → **8.7** (UI 87/100, the lowest surface) |
| Total before caps | 91 → 91.0 | 96 → 95.7 | 91.5 → 92.05 | 97 → 96.7 |
| Hard-gate cap | 80 (GAP-backend3-6) → 80 | none → none | none → **80** (AUD-3-1) | none → **80** (inherited) |
| **Score** | 80 → **80** | 96 → **96** | 91.5 → **80** | 97 → **80** |

**Usability fold.** It is the same as in iterations 1 and 2, and the reviewer's own report states it:
- backend ← the reviewer's API score;
- frontend ← the UI score;
- sidecar ← the onboarding score;
- E2E ← the UI score, the lowest surface a user journey crosses.

**Categories.** No category other than usability changed. 92 of 93 sampled claims reproduced; the 93rd is a crashed run whose log is consistent. So there is no evidence that a verifier over- or under-scored a category, and I do not re-grade on opinion. The sidecar's builds category is the one place where new evidence bears on a category; see 4.4.

**Scores without evidence: none.**
- **Backend, sidecar and E2E:** their reports cite evidence inline in every category row.
- **Frontend:** its category rows state facts that its Commands and Feature tables cite (`static-checks.txt`, `run-logs/v1…v8`, `results/aggregate.txt`). The facts I sampled reproduced.

## 6. Nuances, auditor errors and harness incidents (all recorded; none changes a verdict)

### Findings that need a gap decision in iteration 4

`confidence/iter-4/gaps.md` was committed (`6c15715`) while this audit ran. I did not read it, so I cannot say whether it already lists these.

1. **AUD-3-1:** the sidecar's Go line (section 4.4). It caps the sidecar and the E2E system.
2. **UX-53 and the matrix wording** (section 4.3): announce the feed error, or state the requirement in F-57/F-59.
3. **GAP-backend3-1:** the forced probe loses to the sweep's claim save. It is a regression of the closed G-2-7, and no existing test models it (section 3).

### Nuances

4. **Backend G32-a:** 7 probes in a 31 s window here. The verifier's `ev/24` (13 in 62 s) came from an earlier version of its script; the kept version, with `WINDOW = 31`, is the one `ev/24b` ran (6 in 31 s).
5. **Backend G-2-7 family:**
   - G27-b burst: 29/1 here, 28/2 there; both kinds of 409 are documented persistent conflicts of a parallel burst.
   - G27d-D1 (default sweep): 10/10 here, 9/10 there; 4 calls retried in each run. The race in the default configuration is timing-dependent.
6. **Backend outage timings:**
   - O-1e: 5.09 s here, 5.04 s there;
   - O-1j: readiness 200 1.9 s after `docker start` here, 2.1 s there;
   - O-2a: 20.05 s here, 20.03 s there;
   - O-2f: sweeps 2/3 here, 3/2 there.
7. **Frontend:**
   - F-15: 135 ms here, 129 ms there;
   - v7b: sequence numbers 1–3 here, 3–5 there; the verifier's database held two older events.
8. **Sidecar:**
   - sends per minute: ±1 on two documents;
   - `17c`: first acceptance 2.0 s and 19.1 s after the proxy returned here, 0.6 s and 16.0 s there (where the backoff stood);
   - `42` §D: here the 500 window was seen, and the 30 s backoff then covered the 400/401/202 windows; there the 16 s backoff skipped the 500 window and met 400/401. Both follow README L170-172;
   - `30-restricted-v2`: VmRSS within 0.3 MB; SIGURG 2 vs 3 in strace;
   - `14-tls`: the per-service tally line works in my copy; the verifier's printed a jq error.
9. **E2E:**
   - G-3-29 kill: accepted 5.3 s after readiness here, 3.6 s there; B's silence 50.2 s here, 47.0 s there;
   - the UI-flow line "16 keys" differs because my tenant name is longer.
10. **Usability:**
    - in the API walk (68 steps both), the only status difference is C1-verbatim: 201 on my fresh store, 409 on the reviewer's;
    - UX-48: (1)…(6) here, (1)…(7) there;
    - F-78: the grace timings.
11. **`fixes.md`** does not name six touched pre-existing test files. Their removed lines are comments, imports or harness refactors only (section 3).
12. **Two hashes, one jar.** The E2E stack-up scripts print the jar's md5 (`32b20665…`); the backend and E2E provenance rows use its sha256 (`b63ffd4e…`). Both are the same file: `scratchpad/communication-service-iter3.jar` = `build/libs/communication-service-0.0.1-SNAPSHOT.jar`.

### Auditor errors

Each was caught before it could affect a result, or the step was re-run.

13. **Over-broad kill patterns.** The shared stack was checked unaffected both times: readiness 200, :3000 200, `app`/`sidecar`/`mongo7` up.
    - **'port 197..':** the teardown pattern meant for my Java backends also killed three processes whose arguments carried a 197xx port, most likely the docker-proxy processes of my own containers.
    - **The :19774 kill:** it also matched two of my own shell processes whose arguments contained the port.
14. **`cookbook_extract.py`.** My global port substitution corrupted the replace source in my copy of the backend verifier's README extractor, so the script it generated would have sent the README's commands to `localhost:8080`, the shared stack. I caught it before any run, never ran it, and used the reviewer's literal-cookbook script on my private backend instead (usability row 4).
15. **A-24.** My copy of the check queried database `communication` instead of `au3-shared` and FAILed. Fixed, it PASSes (`ev-a/21`).
16. **v8 (frontend).** My copy started the second pod's app with `-p 127.0.0.1:19293:19711`: my 8080 → 19711 substitution hit the container port, and 19293 was the verifier's host port, outside my range. I found it by diffing my copy against the verifier's before the run and changed it to `-p 127.0.0.1:19759:8080`. The 7/7 run used the fixed copy.
17. **`20-manifests` run 1.** Its Helm half failed because my work folder `work/helm` did not exist yet, a harness ordering slip. Run 2 is byte-identical to the verifier's file; run 1 is kept as `20-manifests-run1-harness.txt` in the scratchpad.
18. **The G-3-12 mutation script** referenced `$S/mut/…`. I ran it through a wrapper that points to the copied `scripts/mut/` folder.
19. **My own evidence.**
    - `ev-a/01` first wrote "38 commits" for `23c297d..4a0e84e`; that range holds 37 (38 counts `23c297d` itself). Corrected.
    - `ev-a/22`'s line citation was corrected to `:194-196`.

### Harness incidents

20. **`HEAD` moved** from `6fa95c5` to `6c15715` at 07:57 UTC, early in the audit. That commit adds only `confidence/iter-4/gaps.md` (+54 lines), which I did not read. An untracked `confidence/evidence/iter-4/` (the iteration-4 fixers') was present for most of the audit and gone by its end; I did not read it either.
21. **Load.**
    - The iteration-4 fixers built and tested in `/home/claude/wt4-*` throughout, and an iteration-4 container (`beu-mongo`) appeared; I left it alone.
    - The G-3-29 kill flow failed once on timing and passed on the single re-run the brief allows.
    - One long usability script outlived the 2-minute foreground limit, moved to the background, and completed.
22. **Tools.**
    - Trivy refused the verifier's read-only cache, so I used my own fresh database.
    - The debian13 remote image scan needed the agent proxy's CA.
    - `ss` is not installed, so the port checks read `/proc/net/tcp*`.
23. **Blocked, as in iteration 2:**
    - `vuln.go.dev` (govulncheck);
    - the UBI registries (`registry.access.redhat.com` → 000);
    - no kind or OpenShift: the pod is a Docker shared-network-namespace emulation.

### Not run

24. **The in-repo Playwright suite**, except spec 04 in pass and strip mode (the G-3-12 mutation). I also ran `--list`, lint and typecheck (`ev-a/71`). The verifier's three runs (27/27) stand.
25. **SpotBugs, JaCoCo verification and `cyclonedxBom`** (`./gradlew check`): outside the Gradle tasks the brief allows. The verifier's `ev/01` stands. I checked the configuration statically (`ev-a/71`).
26. **Sidecar `13b` and `11-ladder`:** not sampled. `42`'s "live keys" line greps `13b`'s output, so it errors in my run.
27. **GAP-backend3-7's base-digest sub-claim.**
28. **The crashed E2E run 1 (cmd-20):** it cannot be repeated (row 9 of the E2E table).
29. **Not in the sample:** frontend v3b, v4b, v4c, v6, v7, v7c and v7e, and the reviewer's walks.

## 7. What code was actually under test

- **Branch:** `confidence-loop/2026-11-01`. `HEAD` was `6fa95c5`, then `6c15715`. Its code is identical to `e3968c4` and to the last fix commit, `4a0e84e`: `git diff --name-only 4a0e84e HEAD` lists 0 files outside `confidence/`.
  - The working tree had no tracked change.
  - The iteration-4 fixers work in `/home/claude/wt4-*` worktrees; I did not read those, nor their untracked `confidence/evidence/iter-4/` while it existed.
- **Last code commits by area:** `src` `4a0e84e`; `build.gradle.kts` `f141b2d`; `frontend` `54fead9`; `sidecar` `06b822a`; `e2e` `ac7026a`.
- **Backend:** `scratchpad/communication-service-iter3.jar`, the jar the verifiers and the shared :8080 use. Its sha256 is `b63ffd4e…` (md5 `32b20665…`, the figure the E2E stack-up prints), the same as `build/libs`. `ev-a/20` tested the checkout from 07:58 to 07:59 UTC; the compile tasks were up to date and the jar was unchanged.
- **Frontend:**
  - lint, typecheck and three builds of the working tree, built into my scratchpad, not into `frontend/dist`;
  - Vite dev servers on the working tree;
  - the E2E stack's `vite preview` served `frontend/dist`, built at 06:42:24 UTC, after the last frontend commit.
- **Sidecar:**
  - image `health-sidecar:au3`, which I built from `sidecar/` at `e3968c4` with go1.25.14 and the substitute builder and base images, because UBI is blocked;
  - `go test` and `vet` on the checkout with go1.25.0, the toolchain that `go 1.25` selects on this host.
- **Pod:** `fakeapp:ci` (built 2026-11-01 23:24:58 UTC) and `fakeapp:e2e` (2026-11-02 02:48:58 UTC), the test doubles.

## 8. Evidence index (`confidence/evidence/iter-3/audit/`)

| File | Contents |
|---|---|
| `00-claims-and-sample.txt` | The 460 claims and the seed-3 sample |
| `01-test-weakening-check.txt` | The weakening check, sections A–H |
| `07-dependency-scan-rerun.txt` | Gate claim 1: the Trivy re-run, the jar's libraries, the triage search, the reachability probe, the backend image's OS packages, publication dates, the ruling |
| `08-security-scans-sidecar-frontend.txt` | AUD-3-1: the sidecar binary's scan, where Go is pinned, reachability, what is not verifiable; the frontend and e2e lockfiles; the ruling |
| `20-gradle-test-integrationTest-rerun.txt` | Backend tests (297) |
| `21-backend-replays.txt` | The verifier's check scripts, id by id, and the sampled check details |
| `22-backend-f34-g27.txt` | Gate claim 2: F-34, G27-a, G27b/c (A/B with the iteration-2 jar), G27d (default configuration), root cause, ruling |
| `23-backend-outage-and-gaps.txt` | Outage rows, GAP-backend3-2/-3/-4, the GAP-sidecar3-2 reports during a frozen Mongo |
| `24-backend-image.txt` | cmd-31 and GAP-backend3-7 |
| `30-frontend-replays.txt` | Static checks, browser runs compared id by id, the 16 claims, F-65's rows |
| `40-sidecar-replays.txt` | The 18 claims, script exit codes, key lines |
| `50-e2e-replays.txt` | The private stack, the 15 claims, the G-3-12 mutation and G-3-29 lines |
| `60-usability-replays.txt` | The 18 claims; the UX-53 live-region probe; the reconnect and outage runs |
| `70-code-reads.txt` | The code lines quoted above |
| `71-closed-gap-static-checks.txt` | G-3-4, -5, -10, -14, -26, -27, -28 and -31 |
| `90-cleanup.txt` | Clean-up |

The scripts I copied from the verifiers and re-pointed stay in the session scratchpad (`audit3/`), with their raw outputs and the Trivy JSON (`audit3/trivy-results/`). They are not in the repository.

## 9. Clean-up

**Stopped and removed** (`ev-a/90`; afterwards there were 0 listening sockets on 19700–19799, 0 `au3` containers, images, networks or volumes, and 0 `au3` databases):
- every private backend, Vite server, proxy and stub. Each was stopped where its section ran; the E2E stack ended with its own stack-down, and the in-repo suite with `./stack.sh down`;
- every `au3-*` container, including `au3-mongo`, `au3-emongo`, `au3-uxmongo`, the pods and the stubs;
- the images `au3-backend:test`, `health-sidecar:au3`, `au3-go-toolset:readme` and `au3-sidecar:readme-probe`;
- my 12 databases in `mongo7`: `au3-dropped`, `au3-eff`, `au3-freconnect`, `au3-g27d`, `au3-g27d2`, `au3-gaps`, `au3-image`, `au3-iter2ab`, `au3-pair`, `au3-shared`, `au3-smain` and `au3-uxcook`;
- the 1.6 GB Trivy database cache in my scratchpad.

**Left in place, checked after the clean-up:**
- the shared stack: `mongo7`, `app` and `sidecar` up; backend :8080 readiness and liveness 200; Vite :3000 200; the pod's `/status` answers;
- everything that is not mine: `health-sidecar:ci`/`:e2e`, `fakeapp:*`, `communication-service:e2e`, `go-toolset:e2e`, `local/go-toolset:*`, the iteration-4 `beu-mongo` container, and every database without the `au3` prefix.

**Generated output:** my `npx playwright test --list` (09:35 UTC) rewrote the git-ignored `e2e/playwright-report/index.html`, which is generated output, not a test or a report. Nothing tracked changed.

**Repository:** nothing was committed, checked out, stashed or pushed. At the end, `git status` shows only the untracked `confidence/evidence/iter-3/audit/` and this report. The iteration-4 fixers' untracked `confidence/evidence/iter-4/`, listed in `ev-a/90` at 09:31 UTC, had been removed by someone else by 09:51.
