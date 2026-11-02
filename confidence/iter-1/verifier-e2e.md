# E2E Integration Verifier — iteration 1

Verifier: E2E Integration Verifier (grader only; no repository code was changed; the only files written are this
report and `confidence/evidence/iter-1/e2e/`). Date: 2026-11-02 01:30–02:02 UTC.
Baseline for the deltas: the audited iteration-0 E2E score **62** (`confidence/iter-0/audit.md` §5: builds 7,
features 26.4 = 29/33, tests 8, integration 14, resilience 5, usability 1.7).

Stack under test: a private copy of the whole system built from `confidence-loop/2026-11-01` at `0e14838`
(all 24 iteration-1 fixes): backend **A `:19501`** and **B `:19502`** from the iteration-1 jar
(`scratchpad/communication-service-iter1.jar`, Spring Boot 3.5.16), both on Mongo database `e2e1`
(`communication.sweep.interval-ms=2000`, `communication.health.sweep-interval-ms=1000`,
`communication.health.stale-grace-after-start-ms=0`); the fixed `frontend/` served by **Vite `:3501`** with
`/v1` proxied to A; an emulated pod **`e2e1-netns`** (network-namespace holder, host ports 19601→8080 and
19602→9465) joined by **`e2e1-app`** (`fakeapp:ci`, an Actuator-style app flipped with `POST /__set`) and
**`e2e1-sidecar`** (`health-sidecar:ci`, version `ci-iter1`, built from `sidecar/Dockerfile`; run as UID
1000660000, read-only rootfs, `--cap-drop ALL`, `no-new-privileges`; `CS_INTERVAL=3s`, `CS_HEARTBEAT=10s`,
`CS_RETRY_DELAY=1s`, `CS_STARTUP_GRACE=30s`, Downward-API identity `e2e1-app-6d4f8b7c9-ab12c` / `e2e1-ns` /
`worker-7` / cluster `sandbox` / version `2.1.0`). A second emulated pod (`e2e1-pod2`+`e2e1-app2`+`e2e1-sidecar2`),
a capture sidecar (`e2e1-sidecar3`) and a slow probe stub (`:19620`) were created and removed by the scripts.
The shared stack (`:8080`, `:3000`, `app`+`sidecar`) was not touched. Sandbox limits are in
`confidence/evidence/environment.md` (no kind/OpenShift: a "pod" is containers sharing one network namespace).

## 1. Verdict and score

**E2E system score: 86 / 100 (78 + the usability category, which is provisional at 8 and is the Usability
Reviewer's to set). Hard gate tripped: no — all 33 Feature Matrix rows with two or more services pass end to end
(iteration 0: 29/33, gate tripped by F-20, F-61, F-88, F-92).** Every iteration-0 E2E gap was re-driven on the
new stack and is closed: the resume path answers 200 and replays exactly what was missed (GAP-e2e-1); a browser
whose backend dies shows *Reconnecting (n)* within 0.5 s, reopens the stream itself with `?lastEventId=` and
shows the notice published meanwhile without a refresh (GAP-e2e-2); an app process that dies while its sidecar
runs is reported DOWN and becomes an OUTAGE in the UI in 16–18 s (GAP-e2e-3); the staleness valve no longer trips
on a scaled-to-zero service (GAP-e2e-4); the stream commits with `:connected` in 3–6 ms instead of 15 s
(GAP-e2e-5); 60 of 60 simultaneous pod reports were accepted, three bursts (GAP-e2e-6); 400/404/405/415 bodies
name the problem (GAP-e2e-7); SIGTERM with open streams ends them in ~40 ms and the JVM exits in 5.5 s
(GAP-e2e-8). What remains is minor: after a long backend outage the page can take up to the 30 s backoff cap to
notice the service is back (*Try again* reopens at once), the snapshot frame id can lag the event log by one
fan-out poll so a resume from it re-delivers one already-known frame (harmless, clients upsert), and the sidecar
log does not show the moment "connection refused" becomes "app is not listening".

| Category | Weight | Score (iter-0 audited) | Why |
|---|---|---|---|
| Builds & static checks | 10 | 7 (7) | Jar, dev server and both images were built from the same commit and started cleanly (cmd 1). This verifier ran no lint, type-check or dependency/security scan (the service verifiers do); those points are not awarded here. |
| Feature completeness | 30 | **30** (26.4) | 33 of 33 owned rows pass (section 3): the four iteration-0 failures (F-20, F-61, F-88, F-92) now pass on the same scripts plus new checks. |
| Automated test health | 20 | 14 (8) | All cross-service suites in the repo are green after the merge (`evidence/iter-1/merged-suite-counts.txt`: 39 ITs, 0 failing; iteration 0: 1 failing) and every iteration-0 E2E gap now has a guarding test (`iter-1/fixes.md`: G-1-1 IT, G-1-2 Go, G-1-3 vitest ×12, G-1-4/5/7 ITs). My own scripts were run twice where it mattered (UI flows, dead app, backend down, ordering) with identical product results. Not full marks: there is still no automated test in the build that drives browser↔backend or sidecar↔backend together (only these verifier scripts do), and flakiness 3× of the Gradle suites is the Backend Verifier's measurement, not mine. |
| Integration & contracts | 20 | 18 (14) | UI→backend (header, `?clientId=`, shapes, 400/409/unreachable texts), resume contract (200, exact replay from the last id, snapshot fallback), first byte, sidecar→backend wire contract (captured from the real sidecar and replayed verbatim → 202), node↔node fan-out (same seq on A and B), per-pod rollup, 20-pod bursts, Actuator probes outside the client-id rule: all match. −1: the sidecar↔main-container contract is verified in an emulated pod, not under an SCC; −1: the at-least-once overlap on resume-from-snapshot-id is documented in code but not in the README (GAP-e2e-10). |
| Resilience & ops | 10 | 9 (5) | SIGTERM with open streams: streams end in ~40 ms, JVM gone in 5.5–5.7 s (3 runs); browser heals after a restart (1.5–4 s when the backoff is short, 23 s when it had reached the 30 s cap); dead app → DOWN → OUTAGE → recovery; silent pod → OUTAGE naming it after 89 s; valve silent; sidecar backoff and recovery; readiness/liveness probes; slow probe target; operator-retired notice re-opens. −1: Mongo down, the sidecar's `CS_REPORT_TIMEOUT` path and its permanent-4xx path were not driven here (section 5), and the up-to-30 s heal latency (GAP-e2e-9). |
| Usability | 10 | 8 provisional (1.7) | Deferring to the Usability Reviewer, whose UI score replaces this figure at audit. Observed: every journey completed unaided; the badge now explains itself (*Reconnecting (3)*), an unreachable service is said to be unreachable, the 409 names the incident and tenant, the first invalid field receives focus with an error summary, a resolution is announced to assistive tech, not-started items say *Withdraw*. |
| **Total** | | **86** (62) | No hard gate tripped; the 80 cap does not apply. If the reviewer's UI score is X/100 the total is 78 + X/10. |

## 2. Commands run

Scripts (iteration-0 scripts adapted to the new ports/names/behaviours, plus two new ones) are copied under
`confidence/evidence/iter-1/e2e/scripts/`; outputs (trimmed `.txt`) and screenshots next to them. Seven FAIL lines
appeared across first runs; each was traced to the verifier script, not the product, the script was corrected
and the affected part re-run; both runs are kept as evidence and the reason is given in the table.

| # | Command (from the scratchpad `e2e1/` folder) | Exit | Evidence |
|---|---|---|---|
| 1 | `java -jar communication-service-iter1.jar --server.port=19501 …` (and 19502); `COMM_BACKEND=http://127.0.0.1:19501 npm run dev -- --port 3501 --host 127.0.0.1`; `docker run … e2e1-netns`, `… --network container:e2e1-netns fakeapp:ci` (e2e1-app), `… --network container:e2e1-netns --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges … health-sidecar:ci` (e2e1-sidecar) | 0 | `environment.md` (§ E2E verifier private stack), `e2e1-sidecar-log.txt` |
| 2 | `python3 -I http_checks.py` (107 HTTP/SSE contract checks against A and B) | 1 | `http-contracts-run1.txt` — 106 pass; the FAIL (F-20 header resume) was the script resuming from the *first* id it saw for the item (the snapshot id) instead of the last id received, as an EventSource does; see cmd 3/4 |
| 3 | `python3 -I http_checks.py f20` (resume checks with the last received id, plus an explicit snapshot-id-overlap line) | 0 | `http-contracts-run2-f20.txt` — 6/6: replay `[retired first, created second]`, no snapshot |
| 4 | `python3 -I f20_probe.py` (three times: snapshot id vs the created event's seq, replay from 0, resume from the snapshot id) | 0 | `f20-snapshot-id-probe.txt` — snapshot id 57/60/64, created seq 58/62/66 arriving 150–360 ms later; GAP-e2e-10 |
| 5 | `node ui_flows.js` (Playwright, 39 checks: publish with ticket, second-context live watcher, resolve + announcement, filters, Withdraw, Live switch, 409 banner, focus management, draft) | 1 | `ui-flows-run1.txt` — 38 pass; the FAIL was Playwright strict mode: G-1-12 renders "Title is required" twice (summary + field), `isVisible()` on the ambiguous locator threw; the condition (message shown, nothing sent) held |
| 6 | `node ui_flows.js` (run 2, counting locator) | 0 | `ui-flows-run2.txt`, `screenshots/f90-*.png`, `f57-server-error.png`, `f58-filters.png` — 39/39 |
| 7 | `python3 -I iter1_checks.py` (37 checks for the iteration-1 behaviours: first byte on four routes, `:connected`, Actuator probes and what is not exposed, operator-retired notice re-opens, 409 after `expiresAt` before the sweep, 404/405/415/enum/malformed bodies, access log) | 1 | `iter1-checks-run1.txt` — 36 pass; the FAIL was the script filtering the access log by the request's query string, which the log line does not carry |
| 8 | `python3 -I iter1_checks.py access_log` (run 3, counts the exact line; run 2 saw +2 lines because the dead-app phase was polling the feed with the same client id at that moment) | 0 | `iter1-checks-run3-accesslog.txt` |
| 9 | `node pod_flows.js p91` (19 checks: app → sidecar → backend → UI, DOWN/DEGRADED/UP, SIGTERM, restart) | 0 | `pod-flow-f91.txt`, `screenshots/f91-outage-in-ui.png`, `f91-degraded-in-ui.png` |
| 10 | `node pod_flows.js deadapp` (new: `docker stop e2e1-app` while `e2e1-sidecar` keeps running in `e2e1-netns`, browser open) | 2 | `pod-flow-dead-app-run1.txt` — 7/9; the two FAILs expected the text "app is not listening" in the *first* DOWN report (it says "connection refused" on the tick the port vanished; the next tick says "not listening") and in the notice body (the body is the rollup "0 of 1 pod UP (DOWN: pod)"; the pod's message is in the instance record) |
| 11 | `node pod_flows.js deadapp` (run 2, checks the first DOWN, then the "not listening" report in `/status` and the instance record) | 0 | `pod-flow-dead-app-run2.txt`, `screenshots/f88-dead-app-outage-in-ui.png` — 9/9 |
| 12 | `node pod_flows.js p92` (16 checks: SIGTERM A with the UI and the sidecar connected, exit time, badge transitions, error state, publish through B, restart A, heal, resume probe, duplicates, sidecar recovery) | 1 | `pod-flow-f92-backend-down-run1.txt`, `screenshots/f92-backend-down.png`, `f61-after-restart.png` — 15 pass; the FAIL line's own detail shows the badge at *Reconnecting* 0.5 s after the kill and *Reconnecting (1)…(5)* (the `getByText` regex locator did not resolve; the transition poller used `locator('text=…')`) |
| 13 | `node pod_flows.js p92` (run 2, same locator as the poller) | 0 | `pod-flow-f92-backend-down-run2.txt` — 16/16 |
| 14 | `node reconnect_probe.js` (in-page `EventSource` instrumentation, CDP capture of every stream request/response and SSE frame, `curl -N` via the proxy and direct, across SIGTERM/restart of A) | 0 | `browser-reconnect-probe.txt` |
| 15 | `node pod_flows.js silent` (`docker pause e2e1-sidecar`, nothing else deleted) | 0 | `pod-flow-silent.txt` |
| 16 | `node pod_flows.js ordering` (pod 2: sidecar before app, app stopped/started, sidecar SIGKILL, port move) | 2 | `pod-flow-ordering-run1.txt` — 7/9; same two expectation errors as cmd 10 (notice body / log message) |
| 17 | `node pod_flows.js ordering` (run 2, checks `/status`, instance record and log separately) | 0 | `pod-flow-ordering-run2.txt`, `sidecar2-log.txt` — 9/9 |
| 18 | `node pod_flows.js slow` (slow probe target, wire capture through a stub backend, id limits, WARN pass-through) | 0 | `pod-flow-slow.txt` — 8/8 |
| 19 | `grep` of both backend A logs (startup, shutdown, valve, notices, access log, WARN/ERROR) and `docker logs e2e1-sidecar` | 0 | `backendA-log-excerpts.txt`, `e2e1-sidecar-log.txt` |
| 20 | teardown: `kill` A and B, Vite; `docker rm -f e2e1-sidecar e2e1-app e2e1-netns` | 0 | — |

Script changes versus iteration 0 that a reader should know about (all in `scripts/`): ports/names/tenants;
F-18 now looks for `:keepalive` specifically because `:connected` arrives first; F-50 accepts ≥ 19 × 202 as the
orchestrator's acceptance criterion but reports the exact count (it was 20/20 three times); the health section
deletes the monitors it created at the end (nothing reports to them afterwards, so left in place they would all go
silent together and feed the database-wide valve during the later pod phases — `DELETE /v1/health/monitors/{id}`
is the documented operator action, iteration 0 deleted them from inside the silent phase); console errors that
are Chromium's own line for a deliberate 409 and `net::ERR_ABORTED` for a stream the page closed are excluded
from the "no console errors" checks and listed in the detail.

## 3. Feature verdicts (the 33 rows with two or more services)

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | http run1 F-01 ×5 | 201 + Location, ACTIVE/SCHEDULED by startsAt, audience default, `created` frame with `id` = seq |
| F-02 | PASS | http run1 F-02 ×8; ui run2 F-02 | draft invisible everywhere, no event; publish → 200 ACTIVE + `created`; again → 409 naming the state; UI "Draft saved" without View in feed |
| F-06 | PASS | http run1 F-06 ×5; iter1 F-06 ×2; ui run2 F-62 | note + actor in history; idempotent; actor defaults to publisher; EXPIRED → 409; **409 0.15 s after expiresAt while the stored status was still ACTIVE** (G-1-20); an operator can retire an auto notice |
| F-07 | PASS | http run1 F-07 13/13 (iteration 0: 11/13); iter1 F-07 ×6; ui run2 F-55 ×4 | every bean/domain rule → 400 naming the field; unknown enum → `type: 'BOGUS' is not one of [INCIDENT, CHANGE, OUTAGE, MAINTENANCE, HEALTH]`; bad timestamp names `startsAt`; 404/405/415/malformed JSON readable (G-1-21); UI mirrors the rules inline, focuses the first invalid field (G-1-12) |
| F-09 | PASS | http run1 F-09 ×6, F-08 ×2; ui run2 F-09 ×2 | normalised number, externalRef default, 409 on reuse, PUT attach with audit, chip in the card |
| F-14 | PASS | http run1 F-14 ×13 | filters, ordering, paging, cap 100, 400s |
| F-15 | PASS | http run1 F-15 ×3 | feed ACTIVE while stored SCHEDULED; gone 0.2 s after expiresAt; permalink EXPIRED |
| F-16 | PASS | http run1 F-16 ×3, F-17; ui run2 F-16 ×2 | P7D window, includeUpcoming=false; UI "Upcoming / Starts in"; **Withdraw** instead of Resolve on a not-started notice (G-1-16) |
| F-18 | PASS | http run1 F-18 ×9; iter1 F-18 ×6 | **`:connected` at 2 ms, status+headers in 3.0 / 2.7 / 5.7 / 5.0 ms** (A header, A `?clientId=`, B, Vite proxy; iteration 0: 15.005 s), snapshot per item, activated/updated/retired/expired, ids increasing, `:keepalive` at 15.004 s |
| F-20 | PASS | http run2 F-20 ×5; p92 run1/run2 F-20; probe | `Last-Event-ID` and `?lastEventId=` → **200** and the exact replay `[retired first, created second]`, no snapshot; never-issued id and non-numeric → snapshot; manual resume probe after a restart 200 `text/event-stream` (iteration 0: 500). Observation GAP-e2e-10: resuming from the *snapshot* id replays the item's own `created` once more |
| F-27 | PASS | http run1 F-27 8/8 (iteration 0: 7/8) | 401/400 bodies, OPTIONS exempt, docs exempt, `?clientId=` stream 200 at once, UI header on every call (F-64), sidecar `X-Client-Id` = `CS_CLIENT_ID` (F-75); Actuator outside the rule (iter1 ×7) |
| F-36 | PASS | http run1 F-36 ×4 | 202 + monitor, push-only, publisher from the report, 400s |
| F-38 | PASS | http run1 F-38 ×7 | vocabulary, nested `db.primary`, UP+DOWN component → DEGRADED |
| F-46 | PASS | http run1 F-46 ×4, F-49 | ordered by id, upsert, rollup "2 of 2 pods UP", 404 |
| F-48 | PASS | http run1 F-48 ×4 (one silent + one scaled-to-zero among 6 push-only monitors → "silent is down" naming p1, p2; scaled → no notice; **0 valve warnings**, iteration 0 tripped); p91 F-76/F-48 (leaving → left=true at once); silent phase (paused sidecar → OUTAGE naming the pod after 89 s; unpause → retired in 10 s) | G-1-6 verified end to end |
| F-50 | PASS | http run1 F-50 ×2 | **20/20, 20/20, 20/20 × 202** for a fresh service, the same service again and another fresh service (iteration 0: 6–7/20); one monitor, 20 pods, "20 of 20 pods UP" (G-1-7) |
| F-56 | PASS | ui run2 F-56 ×4 | 201 with `communication-frontend`, confirmation card, publisher remembered, View in feed switches to the feed showing the item |
| F-57 | PASS | ui run2 F-57; p92 F-92 (error state) | 409 banner: "The service rejected this. A notice with the reference INC0012345 already exists for tenant e2e1-ui-… (the ServiceNow incident number doubles as the reference). Retire that notice first, or set another external reference."; backend down: "Couldn't load the feed — The service is unreachable right now. Check that communication-service is running, then try again." + Try again (G-1-14; iteration 0 quoted "502 Bad Gateway") |
| F-58 | PASS | ui run2 F-58 ×3 | sections/counts, `severity=`/`service=` in the query, All types |
| F-60 | PASS | ui run2 F-60 ×6; p92 F-60 (Live 5–6 ms after the page settled; iteration 0: 15 s "Connecting") | created/updated/retired live; Paused/Live states; automated notices arrive live (p91, deadapp) |
| F-61 | PASS | p92 run1/run2 F-61 ×4 each; reconnect probe | kill A → badge **Reconnecting 0.5 s later, then Reconnecting (1)…(5)** with 1/2/4/8/16/30 s between attempts; the first reopen carries `?lastEventId=98` (run 2: 114); A back → **Live 1.5 s (run 1) / 4.0 s (run 2) later and the notice published through B meanwhile appears without a refresh, exactly once**; probe: raw `EventSource` goes CLOSED on the proxy's 502 (why the client reopens itself), curl streams via proxy and direct ended ~40 ms after SIGTERM, the page's stream got 200 23 s after the restart because the backoff had reached the 30 s cap (GAP-e2e-9) |
| F-62 | PASS | ui run2 F-62 ×3 | inline confirm, note + actor in history, card removed in both contexts, announced in `role=status`: "Resolved “UI outage …”. It has left every consumer's feed." (G-1-15) |
| F-64 | PASS | ui run2 F-64 ×2 | every feed GET with `X-Client-Id: communication-frontend`, stream with `clientId=`; no failed requests besides streams the page closed |
| F-70 | PASS | slow F-70 | app `WARN` → sidecar reports `WARN` → backend DEGRADED |
| F-72 | PASS | ordering run2 F-72, F-88 | sidecar first: UNKNOWN "starting: waiting for the app to listen", monitor "UNKNOWN (1 pod starting, none reporting yet)", no notice; app found 2.1 s after it starts |
| F-74 | PASS | p92 F-74, F-78, F-92 | "report failed; will retry … connection refused" with backoff; `/status.sendError` set; next report accepted 19–27 s after A was back, `sendError` cleared, no duplicate notice |
| F-75 | PASS | slow F-75 ×4 | headers (`User-Agent: health-sidecar/ci-iter1`, `X-Client-Id` = `CS_CLIENT_ID`) and body captured from the real sidecar, replayed verbatim → 202; id 253 ok / 254 → 400 |
| F-76 | PASS | p91 F-76 | `docker stop` → "leaving report sent", exit 0 in 128 ms, instance `left=true` at once |
| F-88 | PASS | deadapp run2 9/9 (main pod); ordering run2 9/9 (pod 2) | **app process dead, sidecar alive: DOWN report 2.6–4.1 s after the stop, "app is not listening (last target http://127.0.0.1:8080/actuator/health)" from the next tick, `/status.target` empty + `lastTarget` set, OUTAGE "e2e1-app is down" naming the pod after 15.8–17.7 s (9–10 s on pod 2 with a 5 s heartbeat), card live in the UI; app back → rediscovered, UP, retired "recovered" in 15 s** (G-1-2; iteration 0 reported UNKNOWN and never opened a notice); sidecar SIGKILL + restart → no new notice; port move → rediscovery (F-77) |
| F-89 | PASS | p91 F-89, deadapp run2 F-89, ordering F-89; iter1 F-89 ×3; `backendA-log-excerpts.txt` | JSON slog lines (start, target found, target gone, reported, report failed, leaving); backend: INFO access log `client=e2e1-verifier GET /v1/feed -> 200 (11 ms)` per identified request (G-1-22), rejected calls logged with the reason, notice open/retire/"closed externally; counting again" at INFO, 0 valve warnings, no WARN/ERROR besides springdoc's startup notice. Observation GAP-e2e-11 |
| F-90 | PASS | ui run2 F-90 ×4, F-52 ×2, F-63, screenshots | second context saw the card 480 ms after the click; consumer filter; resolve → gone both sides; permalink RETIRED with the note |
| F-91 | PASS | p91 19/19, deadapp run2, screenshots f91-*, f88-* | DOWN → OUTAGE 17.2 s (change report + 10 s heartbeat), DEGRADED swap 16.2 s, recovery 15.1 s, SIGTERM/left, restart; dead-app variant as above; no console errors |
| F-92 | PASS | p92 run2 16/16, probe, silent, slow, iter1 ×37, http F-27/F-20 | backend down (error state explained as unreachable, Try again reopens the stream, sidecar backoff/recovery, B unaffected, **JVM exit 5.5–5.7 s with open streams**, browser heals), silent pod, slow probe target ("no response within 500ms" → DOWN → OUTAGE), bad input (UI 409/400 texts), missing/invalid id, expired/unknown Last-Event-ID → snapshot, probes 200 without a client id and nothing else exposed, operator-retired notice re-opens on continued failure (G-1-5). Not exercised: Mongo down, `CS_REPORT_TIMEOUT`, sidecar permanent 4xx (section 5) |

Rows passing: 33. Rows failing: 0. Also exercised with evidence (owned by the service verifiers): F-12 (stale
`expectedVersion` → 409, update after expiresAt → 409), F-17, F-21 (publish via B → `created` on A in 0.33 s,
same seq on both nodes, B serves while A is down), F-49, F-77, F-78 (`/status` now shows `lastTarget`).

## 4. Gaps

None blocking or major. Iteration-0 gaps GAP-e2e-1…8 are closed by the evidence above (1: cmd 3/12; 2: cmd 12–14;
3: cmd 11/17; 4: cmd 2 F-48; 5: cmd 7 F-18; 6: cmd 2 F-50; 7: cmd 2 F-07, cmd 7; 8: cmd 12–14, `backendA-log-excerpts.txt`).

| ID | Severity | Feature(s) | Root cause | Reproduced by | Suggested fix | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-e2e-9 | minor | F-61, F-92 | `frontend/src/outages/api.ts:50-57` caps the reopen backoff at 30 s and nothing resets it when the service is back (no server `retry:` hint, no `online`/visibility trigger); after an outage longer than ~1 min the page notices the restart only at its next attempt | reconnect probe: A back at 01:53:53.9, next attempt 01:54:16.9 → Live 23 s later (p92, with the backoff still at 8 s: 1.5–4 s) | cap the delay at ~10 s, or retry at once on `window` `online`/`visibilitychange`, or send `retry:` from the server | a vitest on `reconnectDelay` bounds; a Playwright restart test with a long outage |
| GAP-e2e-10 | minor | F-20, F-61 | `FeedUseCase.snapshotThenLive` (`FeedUseCase.java:93-102`) stamps snapshot frames with the node's fan-out cursor, which trails the event log by up to one poll; a client that resumes from a snapshot id is replayed the item's own `created` frame | `f20-snapshot-id-probe.txt`: snapshot `id:57` for an item whose `created` is seq 58 (arrives live 150–360 ms later); `Last-Event-ID: 57` → `created first, retired first, created second` | stamp the snapshot with the log's max seq at snapshot time (or document the at-least-once overlap in the README's resume section; `FeedUseCase.java:88-91` already documents it in code) | `MongoCommunicationEventsAdapterIT`: snapshot id ≥ seq of every item in the snapshot |
| GAP-e2e-11 | minor (ops) | F-89, F-88 | `sidecar/internal/agent/agent.go:304` logs "reported" only when the status/signature changes; the message change from "GET …: connection refused" to "app is not listening (last target …)" is sent (heartbeat) but not logged, so `oc logs` shows one DOWN line and then silence until recovery | `pod-flow-dead-app-run2.txt`: `/status` says "not listening" at +8.7 s, the log has only "reported DOWN connection refused" at +2 s and "health target found" at +16 s | log the first "not listening" report at INFO (message change after a target loss) | `agent_test.go`: a log assertion in `TestAppThatStopsListeningStaysDownUntilItIsBack` |

Benign observations (not gaps): Chromium prints "Failed to load resource: … 409/502" for deliberate non-2xx
responses; `net::ERR_ABORTED` on a stream the page closes on a filter change; the sidecar's first DOWN after
the app vanishes says "connection refused" (the port was still known on that tick) before "app is not listening".

## 5. Not exercised in this sandbox

- **No real pod / cluster**: kind cannot start here and there is no OpenShift, so the sidecar↔main-container
  contract was verified in Docker (shared network namespace, arbitrary UID, read-only rootfs, dropped
  capabilities), not under an SCC; the native-sidecar (init container) form was rendered and validated by the
  Sidecar Verifier, not run.
- **Mongo down**: the only Mongo is the shared `mongo7` container, which I was not allowed to stop; the backend's
  behaviour without its database (5xx bodies, keepalive continuing, readiness going DOWN) was not observed.
- **Slow backend from the sidecar's side** (`CS_REPORT_TIMEOUT`) and the sidecar's permanent-4xx path were not
  driven end to end (unit tests exist in `sidecar/internal/agent`).
- **Cross-origin static frontend build** and a production reverse proxy (the F-61 proxy behaviour was measured on
  the Vite dev proxy, whose drop handler is part of G-1-3).
- **Flakiness 3×** of the Gradle suites and the dependency/security scans belong to the service verifiers; this
  report cites the orchestrator's single merged run (`evidence/iter-1/merged-suite-counts.txt`).
