# E2E Integration Verifier — iteration 3

Verifier: E2E Integration Verifier. I only graded. I changed no repository code, test or assertion. The only repository
files I wrote are this report and `confidence/evidence/iter-3/e2e/`; scratch files are under the scratchpad folder `e2e3/`.
Date: 2026-11-02, 06:45–07:25 UTC. Code under test: `confidence-loop/2026-11-01` at `e3968c4`, which has no code change
after `4a0e84e`. The jar in `build/libs/` is byte-identical to the iteration-3 jar (sha256 `b63ffd4e…`), and
`frontend/dist` was built at 06:42 from the merged tree, after the last `frontend/src` commit (06:05)
(`06-artifact-provenance.txt`). The baseline for the deltas is my iteration-2 score of 90 (`iter-2/verifier-e2e.md`).

I used two stacks and shared neither with the other verifiers. I only read the shared stack (`:8080`, `:3000`, `mongo7`,
`app` and `sidecar`). It is still up with its original creation times (`99-teardown-and-shared-stack.txt`).

- **The repository's suite.** Docker compose project `e2e` on its fixed ports 28030/28080/28090/28091, run exactly as
  `e2e/README.md` says: `npm ci`, `npm run lint`, `npm run typecheck`,
  `GO_IMAGE=go-toolset:e2e BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot ./stack.sh up`, `npx playwright test`,
  `./stack.sh down`. I ran it three times, each on a fresh stack. I did not run Gradle because the jar was already in
  `build/libs/`.
- **A private copy of the whole system**, for everything the suite does not do and for anything that breaks a stack:
  - Mongo 7 in `e2e3-mongo` (`127.0.0.1:19527`, database `ve3_main`).
  - Backends **A `:19501`** and **B `:19502`**, both from the iteration-3 jar. Settings: `communication.sweep.interval-ms=2000`,
    `communication.health.sweep-interval-ms=1000`, `communication.health.stale-grace-after-start-ms=0`, everything else default.
  - The **production bundle** on `vite preview :19530`, proxying `/v1` to A with the same proxy and SSE drop handler the
    suite uses.
  - An emulated pod `e2e3-netns` (host 19540 → app, 19541 → the sidecar's `/status`) with two containers:
    - `e2e3-app`: `fakeapp:e2e`.
    - `e2e3-sidecar`: **`health-sidecar:e2e3`**, built from `sidecar/Dockerfile` with `GO_IMAGE=local/go-toolset:1.25` and
      `BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot`. It ran as UID 1000660000 with a read-only root filesystem,
      `--cap-drop ALL` and `no-new-privileges`, with `CS_INTERVAL=3s`, `CS_HEARTBEAT=10s`, `CS_RETRY_DELAY=1s` and
      `CS_STARTUP_GRACE=30s`. Downward-API identity: `ve3-app-6d4f8b7c9-ab12c` / `ve3-ns` / `worker-7`.
  - `e2e3-stub` (`:19551`), a pull-probe target.
  - Created and removed by the scripts: a second pod, a capture sidecar talking to a recording stub backend (`:19560`),
    and the G-3-12 proxy (`:19590`).
  - Tenants `ve3*`. Everything was torn down at 07:23Z.

## 1. Verdict and score

**E2E system score: 97 / 100.** 88 of that comes from the five categories I measure here. The other 9 is the usability
category, which is provisional and the Usability Reviewer's to set. **Hard gates tripped: no.**

All 33 matrix rows I own pass end to end.

The in-repo suite grew from 6 tests to 9. It passed **27 of 27 test runs** (9 tests on each of three fresh stacks; 117.1 / 103.8 /
108.8 s wall), with `retries: 0`, no flake and stable timings. What changed in it:

- Its restart test now provably fails against a backend that does not replay (mutation run, G-3-12).
- The new tests (SIGTERM, pull monitor, database down) prove what their titles say (G-3-27).
- The new lint gate catches focused and skipped tests and fixed waits (G-3-28).
- The README's Go recipe builds the sidecar, and the suite's images carry the commit (G-3-13).

I confirmed, with my own evidence, every iteration-3 fix with a cross-service effect that my brief names (§1.1).

I found two new minor gaps (§4):
- `e2e/README.md` still explains the sidecar's cadence as it worked before G-2-16: a DOWN status re-sent only at the
  heartbeat, "an OUTAGE about 45 s after it fails" with the defaults.
- The sidecar logs the end of a send outage only at DEBUG. At the default level, a backend restart leaves a run of
  `report failed; will retry` WARNs and no line saying that reports get through again.

| Category | Weight | Score (iter-2) | Why |
|---|---|---|---|
| Builds & static checks | 10 | **10** (8) | `e2e/`: `npm ci`, the new `npm run lint` (`eslint . --max-warnings 0`), `npm run typecheck` and `npm audit` (0 vulnerabilities) all pass (cmd 1–4). The lint gate works: a probe spec with `test.only`, `test.skip`, `waitForTimeout` and a conditional `expect` fails it (cmd 5). The fake app passes `go vet` and `go test` (cmd 6). The README's substitute builder (golang 1.25 with the CA bundle at the UBI path) builds the sidecar from scratch (`--no-cache`), and the images are labelled with the commit (cmd 12; suite log: "sidecar version e3968c4, revision e3968c40…"). No reference to the old 1.24 image is left. Both iteration-2 deductions are closed (G-3-13, G-3-28). Noted, not deducted: npm warns that `eslint@9.39.5` is no longer supported (a dev-only tool, no advisory). |
| Feature completeness | 30 | **30** (30) | 33 of 33 owned rows pass (§3). |
| Automated test health | 20 | **19** (17) | 27/27 across three fresh stacks (`workers: 1`, `retries: 0`), no flake, per-test timings inside the README's table (§1.2). Spec 04 now tells a replay from a reload: it passes against the real backend and fails, at its `['created']` frame assertion, against a proxy that strips the resume id (cmd 23). Specs 05/06/07 cover the SIGTERM leaving report, the pull monitor's DEGRADED → OUTAGE → recovery, and the database outage with the UI's reason and recovery without a restart. No e2e test was deleted, skipped or loosened since iteration 2 (`git diff 908598a e3968c4 -- e2e/tests`: spec 04's card timeout went from 90 s to 30 s, and `if (restartError) throw` became `expect(await restart).toBeNull()`). My own scripts ran about 320 checks, the timing-sensitive ones twice. **−1 (environmental, as in iteration 2):** the e2e workflow has never run. Not verified: there is no GitHub Actions run in this sandbox. Its steps match the README, and the lint and typecheck step is present (`.github/workflows/e2e.yml:51-57`). |
| Integration & contracts | 20 | **19** (18) | UI → backend: `X-Client-Id: communication-frontend` on 22 of 22 fetches, `?clientId=` on 15 of 15 streams, same origin. The resume contract holds, including G-3-11 (query versus header: the stream resumes after the larger id, and nothing is replayed twice). Two nodes share one event log: a publish on B gives the same `created` seq on A and B. I captured the sidecar's wire request from the real binary. The shared vocabulary works through the real sidecar (G-3-30). The 503 semantics hold end to end: the sidecar sees the service's 503 (G-3-15), and the UI shows its reason (G-3-20). Publishing bodies with unknown fields get a 400, and every in-repo client still works: UI publish 201, sidecar reports 202, the suite green (G-3-8). G-3-16 closes iteration 2's −1. **−1 (environmental, as in iteration 2):** the sidecar ↔ app contract ran in Docker with restricted-v2-like settings, not under an OpenShift SCC. Not verified: there is no cluster. |
| Resilience & ops | 10 | **10** (9) | **Backend SIGKILL:** *Reconnecting* after 13 ms. The browser's own retry carried `Last-Event-ID: 88`, then the page reopened at 1, 2, 4, 8 and 10 s with `?lastEventId=88`, was Live 2.8 s after readiness, and received the notice published on B meanwhile once, as `created#89`. B kept serving throughout. **Sidecar backoff:** 1, 2, 4, 8, 16 (and 30) s; the next report was accepted 3.6 s after readiness (21.5 s after an accidental 60 s outage). B opened no false OUTAGE (longest silence it saw: 47.0 s and 82.3 s, against a 90 s window). **Mongo stopped:** a 503 in 5.0 s on both nodes; readiness DOWN in 1.01 s while liveness stays UP; two readiness log lines per outage; 0 ERROR and 0 stack-trace lines in 30 s. A stream opened during the outage answers 200, ends after 5 s with one WARN, and the page retries. Streams that were already open survive. The sidecar's reports fail with the service's 503. Recovery takes about 2 s with no restart and no click. **Pods:** the SIGTERM leaving report goes out in 115 ms; a vanished pod is declared DOWN 89.3 s after the kill; a dead app is reported DOWN from the first failed probe. Iteration 2's −1 (stack traces, 5 s readiness, sidecar timeout) is closed. Noted, not deducted: GAP-e2e3-2, the missing INFO line when sends resume. The WARNs stop and `/status.sendError` clears, so the state can be read, only not from one log line. |
| Usability | 10 | **9 provisional** (8) | I defer to the Usability Reviewer. Seen in the browser: G-3-20 database wording with the service's reason; G-3-21 the duplicate reference explained in the form's terms with `INC0012345-2`; G-3-22 focus moves into the inline confirmation; G-3-23 "Waiting for a tenant" in a polite status region; G-3-24 one load per typed tenant; G-3-25 an "Automatic" chip and a plain-words body timed to the second. For the reviewer: (a) the Publish tab has two textboxes named exactly "Tenant" (`frontend/src/App.tsx:101` `aria-label="Tenant"` and `PublishOutageForm.tsx:223`), so assistive technology hears two identical fields, and Playwright's strict mode tripped on it (`21-ui-focus.txt`); (b) one maintenance card shows "Starts in 24h" next to "Expected end in 1d"; (c) GAP-e2e3-1 and GAP-e2e3-2. |
| **Total** | | **97** (90) | No hard gate; the 80 cap does not apply. If the reviewer's UI score is X/100, the total is 88 + X/10. |

What would close the remaining deductions:
- **Tests −1:** run `.github/workflows/e2e.yml` once on GitHub Actions and keep the run.
- **Integration −1:** apply the sidecar Deployment on an OpenShift cluster under `restricted-v2` (`oc apply --dry-run=server`
  plus a real pod).

Neither is a code change, and both are blocked here (§5). Usability belongs to the reviewer; fixing the duplicate "Tenant"
name, GAP-e2e3-1 and GAP-e2e3-2 would answer my own observations.

Hard gates:
- No owned row fails (33/33).
- No test was skipped, deleted or loosened (above). I changed no file outside the report and the evidence (`git status`, cmd 25).
- The sidecar ran non-root (UID 1000660000, GID 0) with a read-only root filesystem, `cap_drop ALL` and `no-new-privileges`
  in both stacks (cmd 10, 14).
- No critical or high finding in what I scanned (`npm audit` of `e2e/`: 0; the service scans belong to their verifiers).

### 1.1 Iteration-3 fixes confirmed end to end (own evidence)

| Gap | What I measured | Evidence |
|---|---|---|
| G-3-1 | A page opened during the Mongo outage got a stream answered `200`. The service ended it after 5.0 s with one WARN, `feed stream closed: database unavailable: …` (no ERROR, no trace). The badge said *Reconnecting* at +5.2 s and the browser retried at +8.1 s. After Mongo came back, the page showed the list by itself, 34 ms after the API answered 200. (Run 2's FAIL on this check was my script checking before the retry was due; see §4.) | `34-failure-flows-mongo-run3.txt`, `35-mongo-outage-backend-log.txt` |
| G-3-6 | Readiness answered `503 {"status":"DOWN"}` in 1007–1017 ms (five probes) while liveness answered 200 in 6–7 ms. The log has one WARN `readiness DOWN: MongoDB did not answer a ping: no answer within 1000 ms` and one INFO `readiness UP: MongoDB answers again` per outage. 29 lines in 30 s: 0 ERROR, 0 trace, one WARN per skipped run or answered call, as the root README says | `31b-…`, `34-…`, `35-…` |
| G-3-11 | Query 33 with header 34, and the reverse: the stream resumes after the larger id; nothing is replayed twice | `10-http-contracts-run1.txt` (sse) |
| G-3-12 | I ran spec 04, unchanged, on a fresh compose stack behind a proxy. In pass-through mode it passes ("replayed as created#2 on the stream resumed after 1"). When the proxy strips `?lastEventId=` and `Last-Event-ID`, i.e. a backend that does not replay, it fails at `04-f92-backend-restart.spec.ts:151` with frames `['snapshot']` instead of `['created']` | `41-g312-mutation.txt`, `scripts/mut/` |
| G-3-13 | The README's Dockerfile text gives go1.25.14 and builds the sidecar `--no-cache`. Labels: version/revision = `e3968c4`. No `local/go-toolset:1.24` is left in `e2e/` | `40-g313-readme-go-recipe-and-labels.txt`, `03-compose-container-facts.txt` |
| G-3-15 | During the Mongo outage the real sidecar's failures read `HTTP 503 {"error":"database unavailable"}` (retried in 1 s, 2 s, 4 s), not `context deadline exceeded`. `/status.sendError` cleared 0.5–1.0 s after recovery | `31b-…`, `34-…` |
| G-3-16 | The app answered UP with `db` DOWN. The first report came 3.2 s / 2.8 s after the flip, and the monitor was DEGRADED 7 ms later. The HEALTH notice "ve3-app is degraded" (MINOR) opened **3.3 s / 3.2 s after the first report**, one 3 s probe later rather than at the 10 s heartbeat. The card followed 0.5–0.6 s later. Run 1's message prints "24 ms after the first report"; that figure is wrong, because my script measured from after the first-report wait. Run 2 uses the corrected measure | `30-pod-flows-run1.txt`, `33-pod-flows-run2.txt` |
| G-3-18 | A pod that never became UP sent 4 UNKNOWN reports in 40 s after the grace, at the 8 s heartbeat, instead of about 18 at the 2 s probe. The service ignored them: no notice, summary "1 pod starting, none reporting yet" | `30-…` (unknownpod) |
| G-3-20 | A page opened during the Mongo outage says "Couldn't load the feed — The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment." and offers *Try again*. With A dead it says "The service is unreachable right now…" | `31b-…`, `34-…`, `screenshots/f92-mongo-down-late-page.png` |
| G-3-21 … G-3-24 | Through the UI; see §3 F-57, F-58, F-60, F-62 | `22-ui-flows-run2.txt`, `21-ui-focus.txt` |
| G-3-25 | OUTAGE card "ve3-app is down" with an "Automatic" chip and the body "ve3-app is DOWN as of 2026-11-02 07:18:48 UTC. Reported by its pods: 0 of 1 pod UP (DOWN: ve3-app-6d4f8b7c9-ab12c). Failing components: db: DOWN …": no `**`, no sub-second time. It was created and retired by `health-sidecar`, with history ending "recovered". Over HTTP, a monitor's notice is published, updated and retired under its own publisher (`ops`) | `30-…`, `33-…`, `10-…` (health) |
| G-3-27 | Specs 05, 06 and 07 are in the suite and pass 3/3 (§1.2) | `01-suite-run-{1,2,3}.txt` |
| G-3-28 | `npm run lint` is in `package.json` and in the workflow. The probe fails on a focused test, and on warnings for skip, fixed wait and conditional expect under `--max-warnings 0` | `00-static-checks.txt` |
| G-3-29 | **Kill, run 2:** retry steps 1, 2, 4, 8, 16 s; the report was accepted at 07:12:19.502Z, 3.6 s after A was ready. B saw the pod silent for 47.0 s and opened no notice. **Accidental 60 s outage** (run 1 crashed and left A down): steps up to the 30 s cap, accepted 21.5 s after readiness, silence 82.3 s < 90 s, and B opened no notice. (Run 2's message says "accepted 2 ms after readiness"; that is wrong, because it counted from when the script's wait began. The log figure is in `36-…`.) | `36-g329-restart-timeline.txt`, `32-g329-accidental-60s-outage.txt` |
| G-3-30 | The real sidecar forwards `db: pass`: monitor UP, no DEGRADED, no notice. `db: fail`: a HEALTH notice naming "db: DOWN" 3.5 s after the flip, card +0.3 s, retired on UP. Over HTTP: `pass/PASS/green/SERVING` → UP, `fail/FAILED/error/RED/NOT_SERVING` → DOWN, UP with a `fail` component → DEGRADED | `30-…`, `33-…` (words), `10-…` |

### 1.2 The in-repo suite, judged

- **Shape:** 9 tests in 7 files, matrix ids in every title, `workers: 1`, `retries: 0`, traces on failure.
- **Runs:** 27/27 over three fresh stacks. `stack.sh up` took 54.5 / 27.9 / 16.8 s (first build, then cached layers),
  `down` 5–6 s, and no `e2e-*` container was left after any `down`. Playwright wall time 1.9 / 1.7 / 1.8 min; the README
  says 1.7–1.8 and a budget of 3.
- **Per test, three runs, against the README table (`e2e/README.md:83-88`):**
  - 02: 5.3 / 5.5 / 4.1 s.
  - 03: 12.4 / 13.7 / 13.0 s (README 11–14). Card 4.4 / 5.5 / 5.5 s after `app-set DOWN DOWN`; gone 6.4 / 6.4 / 5.9 s
    after UP.
  - 04: 28.5 / 21.3 / 25.3 s (README 22–27). The backend restart itself took 24.6 / 17.7 / 21.3 s; the badge said
    *Reconnecting* 0.4 s in; "replayed as created#8 on the stream resumed after 7; 1 list reload".
  - 05: 1.9 / 1.5 / 2.1 s; the sidecar stopped 0.7 / 0.5 / 0.8 s after SIGTERM.
  - 06: 35.6 / 31.5 / 35.5 s. The HEALTH notice, the OUTAGE and the retirement each came 9.8–10.2 s after their flip.
  - 07: 28.1 / 25.8 / 25.5 s. 503 in 5.0–5.1 s; late page's error state 10.4–11.2 s into the outage; ready again 20.3–20.5 s
    after the stop; the late page's list 1.3–2.0 s and a new notice on the open page 2.2–2.3 s after readiness.
  - The only numbers outside the README's ranges are spec 04 in runs 1 and 2. They follow from how long the backend
    took to restart.
- **Does each test prove its title?** Yes for all nine:
  - 01: client-id refusal, 409 body, probe without id.
  - 02: live in a second page with a window marker and a `GET /v1/feed` count, never `page.reload()`.
  - 03: the sidecar's OUTAGE card, publisher and recovery.
  - 04: replay versus reload, now proven by the mutation above.
  - 05: exit 0, "leaving report sent", the pod `left` with "instance shutting down", no notice, back UP after a restart.
  - 06: streak counts, `openStatus`, the reclassification retiring the HEALTH notice, the OUTAGE's `externalRef`,
    retirement, the monitor deleted.
  - 07: the 503 body in under 8 s, the late page's error with the reason and *Try again*, the open page with 0 reopens and
    0 GETs during the outage, both pages recovering, `expectNotReloaded`.
- **Not in the suite, covered only by my scripts here and by unit tests in their services.** Not deducted; most of these
  do not fit the 3-minute budget:
  - two backend nodes (the compose stack has one);
  - the sidecar's degraded-by-component push (G-3-16);
  - a pod silent for 90 s;
  - the backoff versus staleness relation (G-3-29);
  - a slow backend (`CS_REPORT_TIMEOUT`).
- **Lint observation, not a gap:** an unawaited `page.goto('/')` passes the lint. There is no type-aware
  `no-floating-promises`, and the Playwright plugin's `missing-playwright-await` covers only `expect` and assertions.

## 2. Commands run

Evidence files are in `confidence/evidence/iter-3/e2e/`. Scripts are in `…/e2e/scripts/`; they run from the scratchpad
folder `e2e3/`, and each exits with its number of failed checks. Times are UTC, 2026-11-02.

| # | command | exit code | evidence file |
|---|---|---|---|
| 1 | `cd e2e && npm ci` | 0 | `00-static-checks.txt` |
| 2 | `npm run lint` (`eslint . --max-warnings 0`) | 0 | `00-static-checks.txt` |
| 3 | `npm run typecheck` (`tsc --noEmit`) | 0 | `00-static-checks.txt` |
| 4 | `npm audit` | 0 (0 vulnerabilities) | `00-static-checks.txt` |
| 5 | `npx eslint --max-warnings 0 --stdin --stdin-filename tests/zz-lint-probe.spec.ts < lint-probe` (G-3-28 probe, no file written) | 1, as intended (1 error, 7 warnings) | `00-static-checks.txt`, `scripts/lint-probe.spec.ts.txt` |
| 6 | `cd e2e/fakeapp && go vet ./... && go test -count=1 ./...` | 0 | `00-static-checks.txt` |
| 7 | suite run 1: `./stack.sh down; GO_IMAGE=go-toolset:e2e BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot ./stack.sh up; npx playwright test; ./stack.sh down` | 0 / 0 / 0 (9 passed, 117.1 s) / 0 | `01-suite-run-1.txt`, `02-stack-up-down.txt` |
| 8 | suite run 2 (same commands, fresh stack) | 0 / 0 / 0 (9 passed, 103.8 s) / 0 | `01-suite-run-2.txt`, `02-stack-up-down.txt` |
| 9 | suite run 3 (same commands, fresh stack) | 0 / 0 / 0 (9 passed, 108.8 s) / 0 | `01-suite-run-3.txt`, `02-stack-up-down.txt` |
| 10 | after run 1's `up`: `docker inspect` (user, read-only, cap_drop, security_opt, network mode) of the four containers, `docker top e2e-sidecar`, image labels, the sidecar's first log line | 0 (my `docker top e2e-backend -o uid,gid,args` failed with "Couldn't find PID field", so the backend's user comes from `inspect`: 65532) | `03-compose-container-facts.txt` |
| 11 | `./stack.sh logs` after the runs (excerpt) | 0 | `04-stack-logs-excerpt.txt` |
| 12 | `docker build -t e2e3-go-toolset:readme -` < `e2e/README.md` lines 50-54; `docker build --no-cache --build-arg GO_IMAGE=e2e3-go-toolset:readme --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot --build-arg VERSION=e2e3-readme --build-arg REVISION=$(git rev-parse HEAD) sidecar`; `docker inspect` labels; the binary run without configuration | 0, 0, 0, 2 (expected: "CS_ENDPOINT is required") | `40-g313-readme-go-recipe-and-labels.txt` |
| 13 | `sha256sum build/libs/*.jar scratchpad/communication-service-iter3.jar`; `ls -l frontend/dist`; `git diff --stat 4a0e84e e3968c4 -- src frontend sidecar e2e` | 0 | `06-artifact-provenance.txt` |
| 14 | `scripts/stack-up.sh` (private stack, 06:58Z) | 0 | `05-private-stack-up.txt` |
| 15 | `python3 scripts/http_checks.py core sse health fanout` | 0 (119/119) | `10-http-contracts-run1.txt` |
| 16 | `node scripts/ui_flows.js` (run 1) | 3 (31/34; three errors in my script, §4) | `20-ui-flows-run1.txt` |
| 17 | `node scripts/ui_focus.js` | 0 (2/2) | `21-ui-focus.txt` |
| 18 | `node scripts/ui_flows.js` (run 2, script fixed) | 0 (34/34) | `22-ui-flows-run2.txt` |
| 19 | `node scripts/pod_flows.js` (down degraded words unknownpod sigterm deadapp ordering capture pull silence logs) | 1 (61/62; the FAIL is the script expecting an INFO line, GAP-e2e3-2) | `30-pod-flows-run1.txt`, `30b-capture-stub-requests.txt` |
| 20 | `node scripts/failure_flows.js kill mongo` (run 1) | 2 (my script crashed with `ReferenceError: since`; A stayed down 60 s, which gave accidental G-3-29 data) | `31a-failure-flows-run1-crashed.txt`, `32-g329-accidental-60s-outage.txt` |
| 21 | `node scripts/failure_flows.js kill mongo` (run 2) | 1 (26/27; the FAIL is my script checking 1.4 s after the stream ended, before the retry was due) | `31b-failure-flows-run2.txt`, `36-g329-restart-timeline.txt`, `37-f61-cdp-wire-capture.txt` |
| 22 | `node scripts/failure_flows.js mongo` (run 3, the check waits for the badge and the retry) | 0 (15/15) | `34-failure-flows-mongo-run3.txt`, `35-mongo-outage-backend-log.txt` |
| 23 | `bash scripts/mut/run-mutation.sh` (G-3-12: fresh compose stack, spec 04 behind the proxy in `pass`, then `strip`, then `./stack.sh down`) | 0 (Playwright: `pass` 0, `strip` 1 as intended) | `41-g312-mutation.txt` |
| 24 | `node scripts/pod_flows.js down degraded words` (run 2) | 0 (22/22) | `33-pod-flows-run2.txt` |
| 25 | `bash scripts/stack-down.sh`; checks for leftover containers, networks and ports; shared-stack probes; `git status` | 0 | `99-teardown-and-shared-stack.txt` |

## 3. Feature verdicts

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | `10` core ×3, `22` F-56, suite 02 | 201 + `Location` + ACTIVE (audience default); future `startsAt` → SCHEDULED; UI publish → 201 with ticket and services |
| F-02 | PASS | `10` core ×3, `22` ×2 | DRAFT is invisible in the feed, permalink 404; `/publish` → ACTIVE; a non-draft gets 409. UI "Save draft" → "Draft saved" without *View in feed* |
| F-06 | PASS | `10` core ×4, `22` F-62 | retire → 200 RETIRED with note and actor; idempotent; actor defaults to the publisher; an expired item → 409 on its effective status before any sweep |
| F-07 | PASS | `10` core ×21, `22` ×1 | Every rule gives a 400 naming its field, including G-3-7 (`affectedServices[1]: must not be null` / `blank`), G-3-8 (unknown `sevrity`/`titel`/`reason` named, with the known fields listed) and G-3-9/G-3-32 (values and the defaulted start in the `expiresAt`/`endsAt` messages, what to send for `expectedVersion`). The UI blocks a malformed incident number before sending |
| F-09 | PASS | `10` ×6, `22` | ticket normalised, `system` default, `externalRef` defaults to the number; bad number or URL → 400; ticket attached later with audit; the same ref in another tenant → 201; the live card carries the ticket chip |
| F-14 | PASS | `10` core ×10 | order (severity, then start); service/type/severity/audience filters; paging; size capped at 100; `page=-1`, blank tenant and bad enum → 400 |
| F-15 | PASS | `10` ×3 | gone 0.4 s after `expiresAt`, permalink EXPIRED; G-3-3: publisher and admin reads say EXPIRED before the sweep; a started SCHEDULED item reads ACTIVE |
| F-16 | PASS | `10`, `22` ×2 | only maintenance inside P7D is listed, hidden with `includeUpcoming=false`; UI "Upcoming" section, a not-started notice offers *Withdraw* |
| F-18 | PASS | `10` sse ×5 + fanout ×2 | `:connected` first (4 ms), created/updated/retired frames with id = seq, keepalive at 15.0 s, one snapshot frame per item stamped with the log head; a publish on B gives `created#41` on A and B, a retire on A gives `retired#42` on both |
| F-20 | PASS | `10` sse ×10, `37`, `41` | the header and the query each replay exactly the missed events with no snapshot; G-3-11 the larger id wins; a never-issued or non-numeric id gets a snapshot; G-2-8 snapshot id ≥ newest seq (×4). In the browser, the notice published on B while A was dead came back as `created#89` on the stream resumed with `?lastEventId=88` |
| F-27 | PASS | `10` ×8, `22` F-64, `30` capture | 401 without `X-Client-Id` (before validation), 400 for a malformed id, a stream with `?clientId=` gets 200, OPTIONS/Swagger/api-docs exempt; the UI sends the header on 22/22 fetches and the id on 15/15 streams; the sidecar sends `X-Client-Id` from `CS_CLIENT_ID` (capture stub) |
| F-36 | PASS | `10` health ×5, `30` | the first push auto-registers a push-only monitor (202); a report without status or tenant → 400; G-3-8 unknown keys accepted on reports |
| F-38 | PASS | `10` ×21, `33` | the whole vocabulary, including G-3-30's words; nested and legacy components flattened; UP with db DOWN → DEGRADED through the real sidecar |
| F-46 | PASS | `10` ×4, `30` | per-instance upsert, `lastSeenAt` advancing, "2 of 2 pods UP", 404 for an unknown monitor; the real sidecar's Downward-API identity lands on the record |
| F-48 | PASS | `10` ×4, `30` ×7, `31b` | `leaving` marks the pod left at once; scaled to zero → no notice; silent pods → DOWN notice after the window naming them; a vanished pod → OUTAGE 89.3 s after the kill; G-3-29: B opened no false OUTAGE while A was dead |
| F-50 | PASS | `10` ×4 | 3 × 20 parallel instance reports all 202; "20 of 20 pods UP" |
| F-56 | PASS | `22` ×4, `21` ×2 | the header tenant flows into the form; 201 with `X-Client-Id`; confirmation "Outage published" with ticket chip, *Publish another*, *View in feed*; focus on the confirmation heading, then on Title; tenant and publisher kept |
| F-57 | PASS | `22`, `10`, `31b`, `34` | G-3-21: the 409 banner explains the permanent reference in the form's terms and suggests `INC0012345-2`, with the service's sentence under "What the service said"; focus goes to the banner, the form stays editable. Backend dead → "unreachable" + *Try again*, which lists the feed once A is back; G-3-20 database wording with the reason |
| F-58 | PASS | `22` ×5 | default type Outage with CRITICAL first; service and severity filters reflected in the query; Refresh re-fetches; G-3-24: 15 keystrokes → one GET and one stream, for the whole name |
| F-60 | PASS | `22` ×5, `31b` | publish/update/retire over HTTP appear live in 219–458 ms; Paused/Live, with missed items arriving through the snapshot; G-3-23 "Waiting for a tenant" inside `role=status aria-live=polite` |
| F-61 | PASS | `31b` ×4, `37`, suite 04 | SIGKILL → *Reconnecting* in 13 ms. The browser's retry carried `Last-Event-ID: 88`, then the page reopened 1, 2, 4, 8, 10, 10 s apart with `?lastEventId=88`; Live 2.8 s after readiness; the replayed notice shown once; one list reload; no `page.reload` |
| F-62 | PASS | `22` ×5 | G-3-22 focus moves into the inline confirm; the confirm names actor and tenant; POST `{actor, note}` → 200; the card leaves at once and the resolution is announced; the watcher's card leaves through the `retired` frame (526 ms, no re-fetch); *Withdraw* explains itself and retires the scheduled notice |
| F-64 | PASS | `22` ×2 | header on every fetch, `?clientId=` on every stream, same origin, no failed request besides the deliberate 409 |
| F-70 | PASS | `30` ×4, `33` ×3 | `WARN` → instance DEGRADED; G-3-30 `pass`/`fail` as above; recovery retires the HEALTH notice |
| F-72 | PASS | `30` ×3 | sidecar before the app: UNKNOWN "starting: waiting for the app to listen", no notice; G-3-18 UNKNOWN at the heartbeat after the grace, with a config hint; the service ignores UNKNOWN |
| F-74 | PASS | `30` ×2 (+1 script FAIL), `31b` ×3, `34` ×2, `30b` | 400 → ERROR "report rejected", no retry before the heartbeat; 500 → backoff 1 s, 2 s, and the retry got 202 2.4 s after the stub recovered (stub log #7); backend dead → 1, 2, 4, 8, 16 (30 cap) s; G-3-15 503 during the Mongo outage. The script FAIL wanted an INFO line for that success; the sidecar logs it at DEBUG (GAP-e2e3-2) |
| F-75 | PASS | `30` ×5 | wire body captured from the real binary: tenantId, service, status, components, `observedAt` (UTC ms), publisher `health-sidecar`, `instance{id, namespace, node, cluster, version, sidecar}`, no `leaving`; replayed verbatim → 202 |
| F-76 | PASS | `30`, suite 05 | SIGTERM → "leaving report sent", exit 0 in 115 ms; the instance is `left` with "instance shutting down"; no notice |
| F-88 | PASS | `30` ×6 | dead app → DOWN from the first failed probe ("app is not listening (last target …)"), OUTAGE naming the pod, rediscovered after the app returns; app started after the sidecar → found, "2 of 2 pods UP"; sidecar SIGKILL + restart → back UP in 43 ms, no notice |
| F-89 | PASS | `30` ×8, `31b`, `34`, `35` | sidecar JSON lines (starting, target found, reported on change, report failed, rejected, leaving report sent, stopped, target gone); backend INFO for opened/retired notices; no secret and no credentialed Mongo URI in either log; 30 s of database outage: 0 ERROR, 0 trace. Recovery after send failures is logged only at DEBUG (GAP-e2e3-2, minor) |
| F-90 | PASS | `22` ×5, suite 02 ×3 runs | UI publish → the second context shows the card 232 ms later (423 ms from the click) with feed GETs 1 → 1; consumer filter; resolve → the watcher loses it via the `retired` frame; API history holds note and actor; no console errors |
| F-91 | PASS | `30` ×20, `33` ×8, suite 03 + 06 ×3 runs | **Pod DOWN:** first DOWN report 1.9 / 2.0 s after the flip; OUTAGE 4.4 / 4.5 s and card 4.6 / 5.1 s after that report; recovery 10.4 / 10.5 s (the second UP at the 10 s heartbeat). **Degraded** (G-3-16): HEALTH 3.3 / 3.2 s after the first report. **Pull monitor:** HEALTH 9.9 s, OUTAGE 9.6 s (replacing the HEALTH notice), retired 10.4 s after each flip. One of two pods DOWN keeps the service UP. No page errors |
| F-92 | PASS | `31b` ×12, `34` ×9, `10` ×2, `30`, `41`, suite 04 + 07 | **Backend down:** UI error state + *Try again*; B keeps serving; sidecar backoff and recovery. **Mongo down:** 503 with the service's body on both nodes; readiness ~1 s; open streams kept; late page with the reason; recovery without restart. **Also:** silent pod; slow backend (1 s `CS_REPORT_TIMEOUT` → deadline error + backoff); bad input surfaced; client id 401/400; a never-issued or non-numeric `Last-Event-ID` → snapshot (an id past the log's retention was not tried); nothing but health exposed under `/actuator` |

## 4. Gaps

| Gap | Severity | Feature(s) | Root cause (file:line) | How reproduced | Suggested fix | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-e2e3-1 | minor (docs) | F-91, F-74 | `e2e/README.md:127-131`, the "Sidecar cadence" bullet: "the sidecar re-sends an unchanged status only at the heartbeat, so with the defaults a DOWN app becomes an OUTAGE about 45 s after it fails … the next heartbeat at the first 2 s tick 4 s on … within about 9 s (8.5 s measured)". This is the send policy before G-2-16/G-3-16. `sidecar/README.md:146-150` and `:217` say a DOWN or degraded report is sent after every probe, and this README's own table (`e2e/README.md:84`) gives 5–6.5 s. The text dates from `3bf0946` (G-2-17) | The three suite runs put the card 4.4 / 5.5 / 5.5 s after `app-set DOWN DOWN` (`01-suite-run-*.txt`). My pod saw OUTAGE 4.4–4.5 s after the first DOWN report, with 2 reports sent (`30`, `33`). With the defaults (15 s probe, 2 s second look), the second observation comes one probe later, about 17–32 s, not 45 s | Rewrite the bullet: DOWN/degraded is re-sent every probe, so the threshold is reached one probe after the first report (defaults ≈ 17–32 s; here a card in about 5 s); only the recovery's second UP waits for the heartbeat (6.3 s still holds) | None today. A README check like `deploy/helm_test.go`'s, or the README stating only what spec 03 asserts and measures |
| GAP-e2e3-2 | minor (ops) | F-89, F-74 | `sidecar/internal/agent/agent.go:355-360`: when a send succeeds, `reported` is logged at INFO only if the signature changed (`if changed { Info } else { Debug }`). A send that gets through after failures, with the status unchanged, is logged at DEBUG. At the default level, a backend outage leaves a run of `WARN report failed; will retry … in=16s` and no line saying that delivery resumed. The README's debugging section sends operators to `oc logs` first (`sidecar/README.md:241`) | Kill run 2: five WARNs from 07:11:45 to 07:12:05; A's log shows the pod's report accepted at 07:12:19.502Z (202), and the sidecar logged nothing (`36-g329-restart-timeline.txt`). Capture stub 500 → ok: request #7 accepted 2.4 s after recovery, no INFO line (`30b-…`, the FAIL in `30-…`) | When a send succeeds while `a.sendErr != ""` (or `a.backoff > 0`), log one INFO line, e.g. `report delivered again` with the number of failed attempts and how long, whatever `changed` is | An agent test with the fake clock: 500, 500, then 202 with the status unchanged → exactly one INFO line after the WARNs. `TestSendFailuresBackOffAndKeepLatest` (`agent_test.go:270`) checks the backoff and the kept report, not the log |

Not gaps. These were errors in my own scripts, each fixed and re-run with the evidence kept:
- **ui_flows run 1 (3 FAILs).** Two checks wrongly composed (focus after *Publish another* across a tab switch; G-3-23/G-3-24
  in a context that already held a stored tenant, where the typing landed inside it). Run 2 passed 34/34, and `ui_focus.js`
  does the focus part.
- **pod_flows run 1, degraded.** The message prints "24 ms after the first report"; the correct figure is 3.3 s.
- **failure_flows run 1.** Crashed on a helper I had dropped while editing.
- **failure_flows run 2.** The G-3-1 late-page check ran 1.4 s after the service ended the stream, before Chromium's
  ~3 s retry was due; run 3 waited for it (`scripts/failure_flows.run2.js.txt` is the old version).
- **failure_flows run 2, G-3-29.** "Accepted 2 ms after readiness" counted from the start of the script's wait. The real
  figure is 3.6 s, from the logs.

## 5. Not exercisable here

- **No cluster** (kind cannot start pods in this VM; no OpenShift; `evidence/environment.md`). That rules out:
  - SCC admission (`restricted-v2`), `oc apply --dry-run=server` and real Downward-API injection;
  - kubelet probes acting on readiness (I only read the endpoint);
  - rolling restarts;
  - a Service load-balancing the sidecar across backend replicas. My sidecar pointed at A only, so G-3-29's "second node"
    is B sharing the database, which the README's arithmetic covers.
- **UBI images** (`registry.access.redhat.com` is blocked). The sidecar ran on `distroless/static-debian12:nonroot`, built
  with a golang 1.25 stand-in (the README's recipe). The UBI go-toolset and ubi-micro bases themselves were not exercised.
- **GitHub Actions.** `.github/workflows/e2e.yml` has never run (no Actions here); it is graded not verified.
- **Vulnerability databases** for Go and the JVM (govulncheck, Trivy) belong to the service verifiers. I ran `npm audit`
  for `e2e/` only.
- **The default sidecar cadence under a real outage** (`CS_INTERVAL=15s`, `CS_HEARTBEAT=30s`). My pods used 3 s and 10 s
  to fit the time box. The README's "an outage shorter than 24 s cannot make a healthy pod look silent" is arithmetic I
  checked against the measured steps and cap, not a measurement at the defaults.
- **A database that hangs instead of refusing** (`docker pause` or SIGSTOP; the README's ~20 s path). I only stopped the
  container, which is the 5 s path.
- **A cross-origin deployment of the static frontend** (`VITE_API_BASE_URL` with CORS). Every browser run used the
  same-origin preview proxy, as the suite does.
