# E2E Integration Verifier — iteration 4

Verifier: E2E Integration Verifier, iteration 4 (the last). I only graded. I changed no repository code, test or assertion;
the only repository files I wrote are this report and `confidence/evidence/iter-4/e2e/`. Scratch files are under the
scratchpad folder `e2e4/`. Running the suite as its README says also refreshed its git-ignored outputs (`e2e/node_modules`,
`e2e/playwright-report/`, `e2e/test-results/`). Date: 2026-11-02, 10:16–11:10 UTC. Evidence file names below are relative to
`confidence/evidence/iter-4/e2e/`.

**Code under test.** Branch `confidence-loop/2026-11-01` at `d10369b`. `git diff 1cd3f13 HEAD -- . ':!confidence'` is empty,
so this is the code of `1cd3f13` that the brief names (`aa37365` is one of the confidence-only commits after it). The jar in
`build/libs/` (sha256 `64e07ece…`, built 10:05:00Z) is byte-identical to `scratchpad/communication-service-iter4.jar`.
`frontend/dist` was built at 10:05:04Z, after the last `frontend/src` commit (08:59:55Z), and carries the G-4-17 and G-4-21
code (`06-artifact-provenance.txt`). The baseline for the deltas is my iteration-3 score of 97 (`iter-3/verifier-e2e.md`).

I used two stacks and shared neither. I only read the shared stack (`mongo7`, `app`, `sidecar`, `:8080`, `:3000`); it is
still up with its original creation times (`98-teardown.txt`).

- **The repository's suite.** Compose project `e2e` on its fixed ports 28030/28080/28090/28091, run exactly as
  `e2e/README.md` says: `npm ci`, `npm run lint`, `npm run typecheck`,
  `GO_IMAGE=local/go-toolset:1.27 BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot ./stack.sh up`,
  `npx playwright test`, `./stack.sh down`. Three times, each on a fresh stack. No Gradle.
- **A private copy of the whole system** (`scripts/stack-up.sh`), for everything the suite does not do and for anything that
  breaks a stack:
  - Mongo 7 in `e2e4-mongo` (`127.0.0.1:19527`, database `ve4_main`; both backends' logs show `hosts=[localhost:19527]`).
  - Backends **A `:19501`** and **B `:19502`** from the iteration-4 jar, with `communication.sweep.interval-ms=2000`,
    `communication.health.sweep-interval-ms=1000`, `communication.health.stale-grace-after-start-ms=0`, all else default.
  - The production bundle (`frontend/dist`) on `vite preview :19530`, proxying `/v1` to A, as the suite does.
  - An emulated pod `e2e4-netns` (host 19540 → app, 19541 → sidecar `/status`) holding `e2e4-app` (`fakeapp:e2e`) and
    `e2e4-sidecar`: **`health-sidecar:e2e4`**, built from `sidecar/Dockerfile` with `GO_IMAGE=local/go-toolset:1.27` and
    `BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot`, run as UID 1000660000 / GID 0 with a read-only root,
    `--cap-drop ALL` and `no-new-privileges` (`/proc` status: CapEff 0, NoNewPrivs 1, Seccomp 2). Cadence `CS_INTERVAL=3s`,
    `CS_HEARTBEAT=10s`, `CS_RETRY_DELAY=1s`, `CS_STARTUP_GRACE=30s`; Downward-API identity
    `ve4-app-6d4f8b7c9-ab12c` / `ve4-ns` / `worker-7`.
  - `e2e4-stub` (`:19551`), a pull-probe target. Created and removed by the scripts: a second pod, a never-up pod, capture
    sidecars against a recording stub backend (`:19560`) and a 3 s health target (`:19552`) for G-4-4.
  - Tenants `ve4*`. Everything was torn down at 10:57Z, including `e2e4-mongo`'s anonymous volumes and the
    `health-sidecar:e2e4` image (`98-teardown.txt`).

The machine was heavily loaded by the other verifiers: 1-minute load up to 32 on 4 CPUs during the suite runs (10–32
from run 2 on, when the sampler started; `90-load-average.txt`). That explains the slow backend restarts in spec 04 (JVM
start 51.3 / 33.8 / 13.9 s); nothing failed because of it.

## 1. Verdict and score

**E2E system score: 97 / 100.** 88 of that comes from the five categories I measure here; the other 9 is the usability
category, provisional and the Usability Reviewer's to set. **Hard gates tripped: no.** Same total as iteration 3.

- **All 33 matrix rows I own pass end to end** (§3), through real browsers and real containers. My own scenarios ran
  **318 checks: 317 pass; the one FAIL is my own regex**, which missed the `UNKNOWN (…)` wrapper on the G-4-15 summary. I
  re-ran that scenario with the regex anchored on the whole summary (stricter, not looser), and it passed (§2 #39–40).
- **The in-repo suite passed 27 of 27 test runs** (9 tests × three fresh stacks), with `retries: 0` and no flake. No test was
  skipped, deleted or loosened (`07-suite-diff-since-iter3.txt`).
- **Spec 07 now catches what it was extended for (G-4-30).** Unchanged, it fails on the iteration-3 jar and frontend
  (`07-f92-database-down.spec.ts:107` and `:109`: Live at +0.4, +8.5 and +16.5 s) and passes on the iteration-4 code.
- **The security gate is clean for everything the E2E system ships.** I ran CI's own image-scan command (G-4-31) on the
  suite's images:
  - sidecar image: 0 findings;
  - backend image OS packages: 0 fixable (4 HIGH in `libuuid1` have no fix, the same standard iteration 3's audit applied);
  - the jar's libraries, through its SBOM: 0 of any severity; a control SBOM with the iteration-3 versions finds 3 CRITICAL;
  - the sidecar binary: Go 1.27.3, govulncheck "No vulnerabilities found";
  - `npm audit` of `e2e/` and `frontend/`: 0.
- **Two new minor gaps** (§4), neither of which costs a point:
  - `e2e/README.md`'s timing table and totals predate G-4-17's 6 s *Live* rule.
  - The sidecar's message quotes a padded status word raw.

| Category | Weight | Score (iter-3) | Why |
|---|---|---|---|
| Builds & static checks | 10 | **10** (10) | `e2e/`: `npm ci`, `npm run lint`, `npm run typecheck` and `npm audit` (0 vulnerabilities) pass (#1–4). The lint gate bites: a probe spec fails it with 1 error and 7 warnings (#5). `e2e/fakeapp`: `go vet` and `go test` pass (#6). `stack.sh up` built the three images three times (#7, #10, #13). Security: the scans above (#19–26). An older Go builder fails the sidecar build as G-4-2 intends (#27). Not a deduction: npm's "eslint@9.39.5 is no longer supported" warning, unchanged since iteration 3. |
| Feature completeness | 30 | **30** (30) | 33 of 33 owned rows pass (§3). |
| Automated test health | 20 | **19** (19) | 27/27 on three fresh stacks, `workers: 1`, `retries: 0`, no flake. Every title still holds (§1.2). Two assertions got stronger: spec 01's exact 409 body (`01-api-contract.spec.ts:22`) and spec 07's never-Live timeline (`:107`, `:109`). Spec 07's new checks are proven by a mutation run (G-4-30). −1: `.github/workflows/e2e.yml` has never run on GitHub Actions (not verified here, as in iterations 2 and 3). |
| Integration & contracts | 20 | **19** (19) | UI → backend: `X-Client-Id: communication-frontend` on 23/23 fetches, `?clientId=` on 15/15 streams, same origin. Resume contract: `?lastEventId=93` → `created#94`, replayed once. Database outage: a stream gets a JSON 503 before any byte on A and B, in both request forms (G-4-10), and the UI treats it as a failed attempt (G-4-17). 409 `suggestedExternalRef`: the service returns it and the UI offers and accepts it (G-4-11/G-4-21). Sidecar → backend: wire headers and body recorded and replayed (202). Two nodes: one event log, fan-out with the same seq; 22/22 forced probes while both nodes sweep (G-4-4). −1: restricted-v2 only emulated with docker flags; no OpenShift admission (not verified here, as before). |
| Resilience & ops | 10 | **10** (10) | **Backend SIGKILL:** *Reconnecting* after 5 ms; after the browser's own retry (with `Last-Event-ID`), the page reopened 1, 2, 4, 8, 10 and 10 s apart with `?lastEventId=`; it was Live 1.65 s after readiness and got the notice published on B meanwhile exactly once. B kept serving and opened no false OUTAGE. The sidecar backed off 1, 2, 4, 8, 16 s and was accepted 6.1 s after readiness, then logged one INFO "report delivered again". **Mongo outage:** a JSON 503 in 5.0 s everywhere, streams included. Readiness answered 503 in 806–817 ms (11 probes) while liveness stayed 200. A page opened during the outage never said *Live* and kept the database message, in a `role=alert`. The open page kept its stream. Recovery needed no reload. Log: 0 ERROR and 0 traces; one WARN and one INFO for the event-log poller (G-4-9). **Pods:** a pod that vanishes gets an OUTAGE 90.2 s later; SIGTERM sends `leaving` in 121 ms. |
| Usability | 10 | **9 provisional** (9) | I defer to the Usability Reviewer. Seen in the browser: G-4-18 alert, G-4-19 focus on the list after *View in feed*, G-4-20 Escape cancels the inline confirmation, G-4-21 the service's suggestion offered and accepted, G-3-20 database wording. My observations are in §1.3. |
| **Total** | | **97** (97) | No hard gate; the 80 cap does not apply. If the reviewer's UI score is X/100, the total is 88 + X/10. |

What would close the remaining deductions (the first two are not code changes, and both are blocked here, §5):
- **Tests −1:** run `.github/workflows/e2e.yml` once on GitHub Actions and keep the run.
- **Integration −1:** apply the sidecar Deployment on an OpenShift cluster under `restricted-v2` (`oc apply --dry-run=server`
  plus a real pod).
- **Usability:** the reviewer's. Fixing the duplicate "Tenant" name and the other items in §1.3 would answer my own
  observations. GAP-e2e4-1 and GAP-e2e4-2 cost nothing, but they should be fixed so that the docs and the ops message stay
  true.

Hard gates:
- **No owned row fails** (33/33).
- **No test was skipped, deleted or loosened.** The same 9 titles, two of them extended. No `skip`, `only` or `fixme`;
  `retries: 0` (`07-suite-diff-since-iter3.txt`). I changed no file outside the report and the evidence (`git status`,
  `98-teardown.txt`).
- **The sidecar runs non-root and restricted-v2 compatible** in both stacks: UID 1000660000, GID 0, CapEff 0, NoNewPrivs 1,
  Seccomp 2, read-only root, `cap_drop ALL`; image `USER 1001` (`01-suite-run-1.txt`, `05-private-stack.txt`).
- **No open critical or high finding** in what the E2E system ships (#19–26). The unfixed `libuuid1` HIGHs are reported, not
  gated, exactly as `iter-3/audit.md` row 26 treated them. Two parts were not verified here (§5): the Java-DB half of CI's
  backend image scan, and the UBI-based sidecar image CI builds by default.

### 1.1 Iteration-4 fixes confirmed end to end (own evidence)

| Gap | What I measured | Evidence |
|---|---|---|
| G-4-29 | `e2e/README.md:130-144` now describes the current policy: DOWN or degraded re-sent after every probe, an unchanged UP one only at the heartbeat; "19 to 34 s (40 s at most)" with the defaults, which matches the arithmetic of 15 s probes plus a 2 s second look. In the suite the card came 4.5 / 6.6 / 4.1 s after `app-set DOWN DOWN` and left 6.1 / 5.2 / 6.4 s after UP. One stale bound remains: the README's "5 to 6.5 s" (`:88`, `:140`); two runs were below it and one 0.1 s over it under load (GAP-e2e4-1). The default cadence itself was not run (§5). | `01..03-suite-run-*.txt` |
| G-4-30 | Spec 07, byte-identical, run alone on fresh stacks. On the iteration-3 jar + iteration-3 frontend it **fails** at `:107`: the late page said Live at +0.4, +8.5 and +16.5 s during the outage. It also fails at `:109`: the database message was lost. On the iteration-4 code it **passes** (39.6 s). It passed 3/3 in the suite. | `50-g-4-30-spec07-mutation.txt` |
| G-4-31 | `ci.yml:21` pins Trivy 0.58.1 by the digest of the local `mirror.gcr.io/aquasec/trivy:0.58.1`. `:67` and `:140` scan the backend and sidecar images with `--scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1`, and `README.md:78-90` and `:101-107` say so. Run locally on the suite's images: sidecar 0 (exit 0); backend with `--pkg-types os` 0 (exit 0); the jar half through the SBOM, 0. | `40-security-and-image-scans.txt` |
| G-4-2 | The sidecar binary in `health-sidecar:e2e` is `go1.27.3` (`go version -m`). govulncheck v1.9.0 `-mode=binary`: no vulnerabilities; Trivy's gobinary: stdlib v1.27.3, 0. Building with `GO_IMAGE=golang:1.25` fails: "go.mod requires go >= 1.27.3 (running go 1.25.14; GOTOOLCHAIN=local)", exit 1. | `40-…`, `44-g-4-2-older-go-builder.txt` |
| G-4-4 | A 3 s health target, interval 5 s, both nodes sweeping every second. 12 forced probes alternating A and B, then 5 rounds of A and B at the same instant: **22/22 answered 200**, each 3.05–3.19 s (one target round trip). The monitor stayed UP with no notice (iteration 3: 0/30 on one node). | `11-forced-probes-two-nodes.txt` |
| G-4-6 | Readiness answered `503 {"status":"DOWN"}` in 808/807/809/807/817/808 ms and 808/807/807/807/806 ms in two outages; liveness 200 in 5–10 ms. That is inside a kubelet's 1 s default, which is what G-4-6 asked for. It is the configured 0.8 s plus 6–17 ms, so "within 0.8 s" in `fixes.md:40,109` is loose by that much; `README.md:120,130-131` states it correctly. | `31-failure-flows.txt`, `12-http-mongo-down.txt` |
| G-4-9 | Per outage, one WARN "event log poll skipped: database unavailable: …" and one INFO "event log poll resumed: database reachable again after N skipped poll(s)"; 0 "poll failed" lines. Seen in my outage (N = 9) and in all three suite runs (N = 4/6/4). | `31-…`, `33-mongo-outage-logs.txt`, `04-suite-stack-log-excerpts.txt` |
| G-4-10 | With Mongo stopped, a stream request gets status 503, `application/json`, body `{"error":"database unavailable"}`, after 5.01 s, with no `:connected`. Same on A and B, in both request forms (EventSource `?clientId=`, and header id + `Last-Event-ID`). The late page's stream requests were 503, 503, 503, then 200 after recovery. | `12-…`, `31-…` |
| G-4-11 / G-4-21 | Over HTTP, the 409 body is exactly `{error, suggestedExternalRef}`. It suggests `<ref>-2`; `<ref>-3` when `-2` is taken; `-3` for a reused `-2`. The suggested value is accepted (201). In the UI, with `INC0012345-2` taken, the banner offered the service's `INC0012345-3`, not the local `-2`; accepting it through the form gave 201 with that value and the ticket kept. Suite spec 01 asserts the exact body 3/3. | `10-http-contracts.txt`, `20-ui-flows.txt` |
| G-4-13 / G-4-5 | Three unknown fields give one 400 naming all three, sorted, with the known fields. A misspelled registration field (`staleAfterSecond`) gives a 400 and nothing is registered; health reports stay lenient (202). | `10-…` |
| G-4-15 | Through the real sidecar, a never-up pod gives the summary "UNKNOWN (1 pod starting, none reporting yet (ve4-never-up-0: no health target found after 4s: no listening port answered; set CS_PORT and CS_PATH))". Over HTTP, one and two starting pods quote the first pod's words. | `30-pod-flows.txt`, `10-…` |
| G-4-16 | Pushed over HTTP: `' up\t'`→UP, `'\tDOWN\n'`→DOWN, `'pass\u0001'`→UP, `'\u00a0'`→DEGRADED, `'pass\u2003'`→DEGRADED, `'   '`→400 "status: must not be blank", `'\u0001'`→202 UNKNOWN. Components: `' fail '`→db DOWN, `'\u0001'`→UP, `'\u00a0'`→DEGRADED. **From the app through the real sidecar to the notice and the card:** `' DOWN\t'`, `'   '` (503) and `'\u0001'` (503) → OUTAGE; `'pass\u2003'`, `'\u00a0'` and component `' fail '` → HEALTH; `'up '` (503) and component `'\u0001'` → no notice. Each notice was retired 13–17 s after UP. | `10-…`, `30-…` |
| G-4-17 | An empty tenant shows Live 7.07 s after the page opened (6 s settle). A page opened during the Mongo outage (MutationObserver from its first document): Connecting → Reconnecting (1), (2), (3), each with the database alert, **never Live**; after recovery *Service degraded*, then Live at +22.2 s in the same document. The suite's spec 07 recorded the same 3/3. | `20-…`, `31-…`, `01..03-…` |
| G-4-18 | The load error is a `role=alert` element carrying "Couldn't load the feed — The service cannot reach its database right now (HTTP 503): database unavailable…" and *Try again*. | `31-…` |
| G-4-19 / G-4-20 | After *View in feed*, focus is on the `div[tabindex=-1]` that holds the cards. Escape in the inline confirmation cancels it with no POST and returns focus to *Resolve*. | `20-…` |
| G-4-25 | The sidecar logs one INFO "report delivered again" after each send outage: backend restart (`failedAttempts` 5, `failingFor` 36.644s), Mongo outage (5, 47.68s), a stub's 5xx (3, 9.089s). In the suite: after each database outage (3 attempts, 21.4–21.8 s) and after run 1's restart (6, 1m2.895s). In runs 2 and 3 the sidecar was still in its 30 s-capped backoff when spec 05 stopped it, and its next delivery was the `leaving` report, logged as "leaving report sent". | `30-…`, `31-…`, `04-…` |

### 1.2 The in-repo suite, judged

- **Shape.** 9 tests in 7 files, matrix ids in every title, `workers: 1`, `retries: 0`, traces and screenshots on failure,
  per-test timeout 120 s, no global timeout (`e2e/playwright.config.ts:13-16`).
- **Runs: 27/27, no flake.**
  - `stack.sh up` 60.3 / 37.6 / 32.6 s.
  - Playwright 3.2 / 3.0 / 2.3 min (191.7 / 182.4 / 140.4 s wall).
  - `down` 6.0 / 6.9 / 5.1 s; no `e2e-*` container, network or volume left after any `down`.
- **Per test (runs 1/2/3), against the README table (`e2e/README.md:82-92`):**
  - 01: under 0.6 s each.
  - 02: 18.3 / 20.4 / 16.6 s (README "under 6 s"). Each `openFeed` (`tests/helpers.ts:52`) waits for *Live*, as in iteration 3,
    but on an empty tenant *Live* now takes the 6 s settle of G-4-17 (`frontend/src/outages/api.ts:76`), and spec 02 opens two
    pages.
  - 03: 18.8 / 20.2 / 18.2 s (README 11–14). Card 4.5 / 6.6 / 4.1 s after DOWN; gone 6.1 / 5.2 / 6.4 s after UP.
  - 04: 78 / 54.3 / 31.3 s (README 22–27). The backend was ready 65.1 / 43.9 / 22.0 s into the restart, because the JVM
    started in 51.3 / 33.8 / 13.9 s under load. *Reconnecting* came 0.5 / 1.0 / 0.5 s in; "replayed as created#8 on the
    stream resumed after 7; 1 list reload".
  - 05: 3.2 / 2.7 / 2.6 s (README 2 s). The sidecar stopped 1.2 / 1.1 / 1.2 s after SIGTERM (README 0.6–0.8 s).
  - 06: 33.2 / 34.6 / 34.4 s (README 34–36). The HEALTH notice, the OUTAGE and the retirement each came 9.8–10.3 s after
    their flip.
  - 07: 34.2 / 42.7 / 31.3 s (README about 45). 503 in 5.0 s; the late page's error state 10.8–11.3 s into the outage; the
    backend ready again 21.9–31.5 s after the stop; the open page showed a new notice 0.7–1.1 s after readiness.
  - Over the three runs the table is stale for 02, 03, 04, 05 and the totals ("1.7 to 1.8 minutes", "under two minutes",
    "the budget is 3"): GAP-e2e4-1. Load explains only part of it; on an idle machine spec 02 cannot drop under 12 s.
- **Do the titles hold?**
  - Every title is still proven by its assertions.
  - Spec 01's F-09 now pins the exact 409 body (`:22`).
  - Spec 07's title gained "never says Live", which `:107` and `:109` enforce with soft assertions (they still fail the test).
    The mutation run shows they fail on the iteration-3 code.
  - Spec 04's replay check was proven in iteration 3 (G-3-12) and is unchanged.
- **Lint gate:** `eslint . --max-warnings 0` passes on the suite. The probe fails it (#5).

### 1.3 Observations for the Usability Reviewer (not gaps)

- On the Publish tab two textboxes still have the accessible name exactly "Tenant" (the `ui_focus.js` note in
  `20-ui-flows.txt`): a screen-reader user hears two identical fields (carried over from iteration 3).
- On a tenant with nothing to show, the badge says *Connecting* for about 6 s before *Live* (7.07 s measured). This is the
  deliberate G-4-17 rule (`api.ts:76`). It is honest, but a user watching an empty feed waits on it.
- A maintenance card reads "Starts in 24h" next to "Expected end in 1d" (start 24 h away, end 25 h away): two units side by
  side (`20-ui-flows.txt`, F-16).
- A resolve or withdraw from a page that never used the Publish form sends no actor. The service then records the notice's
  own publisher as the actor (F-06 default), and the confirmation ("Withdraw? …") does not say so (`22-withdraw-propagation.txt`;
  `OutageCard.tsx:136-137`).

## 2. Commands run

The exit code of my scenario scripts is the number of FAILs (`http_checks.py:592`, `forced_probes.js:58`,
`ui_flows.js:252`, `ui_focus.js:21`, `withdraw_propagation.js`, `pod_flows.js`, `failure_flows.js`). Each log ends with its
summary line.

| # | command | exit code | evidence file |
|---|---|---|---|
| 1 | `cd e2e && npm ci` | 0 (0 vulnerabilities; npm warns eslint@9.39.5 is deprecated) | `00-static-checks.txt` |
| 2 | `npm run lint` (`eslint . --max-warnings 0`) | 0 | `00-static-checks.txt` |
| 3 | `npm run typecheck` | 0 | `00-static-checks.txt` |
| 4 | `npm audit` (e2e) | 0 (0 vulnerabilities) | `00-static-checks.txt` |
| 5 | lint probe: `npx eslint --max-warnings 0 --stdin --stdin-filename tests/zz-lint-probe.spec.ts < scripts/lint-probe.spec.ts.txt` | 1 (expected: 1 error `no-focused-test`, 7 warnings) | `00-static-checks.txt` |
| 6 | `cd e2e/fakeapp && go vet ./... && go test -count=1 ./...` | 0 | `00-static-checks.txt` |
| 7 | run 1: `GO_IMAGE=local/go-toolset:1.27 BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot ./stack.sh up` | 0 (60.3 s) | `01-suite-run-1.txt` |
| 8 | run 1: `npx playwright test` | 0 (9 passed, 3.2 min) | `01-suite-run-1.txt` |
| 9 | run 1: `./stack.sh down` | 0 | `01-suite-run-1.txt` |
| 10 | run 2: `… ./stack.sh up` | 0 (37.6 s) | `02-suite-run-2.txt` |
| 11 | run 2: `npx playwright test` | 0 (9 passed, 3.0 min) | `02-suite-run-2.txt` |
| 12 | run 2: `./stack.sh down` | 0 | `02-suite-run-2.txt` |
| 13 | run 3: `… ./stack.sh up` | 0 (32.6 s) | `03-suite-run-3.txt` |
| 14 | run 3: `npx playwright test` | 0 (9 passed, 2.3 min) | `03-suite-run-3.txt` |
| 15 | run 3: `./stack.sh down` | 0 | `03-suite-run-3.txt` |
| 16 | `./stack.sh logs` after each run (before `down`); `docker inspect` and `/proc/<pid>/status` of the suite's containers | 0 | `04-suite-stack-log-excerpts.txt`, `01..03-suite-run-*.txt` |
| 17 | `git diff 1cd3f13 HEAD -- . ':!confidence'`; `sha256sum` of the jars; dist markers | 0 (empty diff; same sha256) | `06-artifact-provenance.txt` |
| 18 | `git diff 6c15715 1cd3f13 -- e2e/` and the titles before/after | 0 | `07-suite-diff-since-iter3.txt` |
| 19 | `flock … trivy image --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 health-sidecar:e2e` (CI's G-4-31 command) | 0 (Total 0) | `40-security-and-image-scans.txt` |
| 20 | `trivy image --scanners vuln health-sidecar:e2e` (all severities; also `--format json`) | 0 (4 UNKNOWN Debian advisories; gobinary stdlib v1.27.3: 0) | `40-security-and-image-scans.txt` |
| 21 | `trivy image --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 --pkg-types os communication-service:e2e` | 0 (Total 0) | `40-security-and-image-scans.txt` |
| 22 | `trivy image --scanners vuln --pkg-types os --format json communication-service:e2e` | 0 (77 entries, none fixable; 4 HIGH `libuuid1` "affected") | `40-security-and-image-scans.txt` |
| 23 | `trivy sbom` on `META-INF/sbom/bom.json` of the jar inside the image (CycloneDX 1.6, 113 components); then `--severity CRITICAL,HIGH --exit-code 1` | 0 / 0 (0 vulnerabilities) | `40-security-and-image-scans.txt` |
| 24 | control: `trivy sbom` on a CycloneDX file with netty-handler 4.1.135.Final, spring-webflux 6.2.19, jackson-databind 2.21.4 | 0 (13: 3 CRITICAL, 3 HIGH; the scanner and DB do find old versions) | `40-security-and-image-scans.txt` |
| 25 | `go version -m health-sidecar`; `govulncheck@v1.9.0 -db https://storage.googleapis.com/go-vulndb -mode=binary health-sidecar` | 0 / 0 (go1.27.3; "No vulnerabilities found.") | `40-security-and-image-scans.txt` |
| 26 | `cd frontend && npm audit` | 0 (0 vulnerabilities) | `40-security-and-image-scans.txt` |
| 27 | `docker build --no-cache --build-arg GO_IMAGE=golang:1.25 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot -f sidecar/Dockerfile sidecar` (no tag) | 1 (expected: "go.mod requires go >= 1.27.3 (running go 1.25.14; GOTOOLCHAIN=local)") | `44-g-4-2-older-go-builder.txt` |
| 28 | G-4-30: `git archive 6c15715 frontend` + `npm run build` in a scratch copy | 0 | `50-g-4-30-spec07-mutation.txt` |
| 29 | G-4-30: `scripts/mut-run.sh iter3` (spec 07 alone, iteration-3 jar + frontend, tests byte-identical) | 1 (expected: fails at `:107` and `:109`) | `50-g-4-30-spec07-mutation.txt` |
| 30 | G-4-30: `scripts/mut-run.sh iter4` (control) | 0 (1 passed, 39.6 s) | `50-g-4-30-spec07-mutation.txt` |
| 31 | `docker build -t health-sidecar:e2e4 --build-arg GO_IMAGE=local/go-toolset:1.27 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot …` | 0 | `05-private-stack.txt` |
| 32 | `scripts/stack-up.sh` (private stack) and the sidecar's `docker inspect` + `/proc/<pid>/status` | 0 | `05-private-stack.txt` |
| 33 | `python3 scripts/http_checks.py core sse health fanout` | 0 (137 pass, 0 fail) | `10-http-contracts.txt` |
| 34 | `docker stop e2e4-mongo; http_checks.py mongo_down; docker start e2e4-mongo; http_checks.py mongo_back` | 0 / 0 / 0 / 0 (9/9, 3/3) | `12-http-mongo-down.txt` |
| 35 | `node scripts/forced_probes.js` | 0 (7 pass) | `11-forced-probes-two-nodes.txt` |
| 36 | `node scripts/ui_flows.js` | 0 (39 pass) | `20-ui-flows.txt` |
| 37 | `node scripts/ui_focus.js` | 0 (2 pass) | `20-ui-flows.txt` |
| 38 | `node scripts/withdraw_propagation.js` (two Chromium processes) | 0 (7 pass) | `22-withdraw-propagation.txt` |
| 39 | `node scripts/pod_flows.js down degraded words unknownpod sigterm deadapp ordering capture pull silence logs` | 1 (77 pass, 1 fail: my G-4-15 regex, see the next row) | `30-pod-flows.txt` (script: `scripts/pod_flows.run1.js`) |
| 40 | `node scripts/pod_flows.js unknownpod` (regex anchored on the whole `lastSummary`, `UNKNOWN (…)` included) | 0 (4 pass) | `30-pod-flows.txt` |
| 41 | `node scripts/failure_flows.js kill mongo` | 0 (32 pass) | `31-failure-flows.txt`, `32-wire-captures.txt`, `33-mongo-outage-logs.txt` |
| 42 | `docker rm -f -v e2e4-mongo; scripts/stack-down.sh; docker rmi health-sidecar:e2e4`; port, container, volume and process checks; shared stack read | 0 | `98-teardown.txt` |
| 43 | `git status --short`; `git diff --stat` | 0 / 0 (untracked only: mine are `confidence/evidence/iter-4/e2e/` and this report, the rest are the backend, frontend and sidecar verifiers'; `git diff --stat` empty: no tracked file changed; branch and HEAD unchanged) | `98-teardown.txt` |

Also: `90-load-average.txt` (load sampled every 10 s), `99-incidents.txt` (§5), `screenshots/` (17 PNGs), `scripts/`
(every script I ran).

## 3. Feature verdicts

Evidence names: `10` = `10-http-contracts.txt`, `11` = `11-forced-probes-two-nodes.txt`, `12` = `12-http-mongo-down.txt`,
`20` = `20-ui-flows.txt`, `22` = `22-withdraw-propagation.txt`, `30` = `30-pod-flows.txt`, `31` = `31-failure-flows.txt`,
`32` = `32-wire-captures.txt`, suite = `01..03-suite-run-*.txt`. "×n" = number of PASS lines.

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | `10` ×3, `22` seed, suite spec 02 ×3 | 201 + Location + ACTIVE, audience defaults to CUSTOMERS; a future start is SCHEDULED; published from the UI in spec 02 and `20`. |
| F-02 | PASS | `10` ×3, `20` ×2 | DRAFT is invisible (feed, permalink 404); `/publish` → ACTIVE; publishing a non-draft → 409; UI "Save draft" then publish. |
| F-06 | PASS | `10` ×4, `22` | Retire → 200 with note and actor; idempotent; the actor defaults to the publisher; expired → 409. A withdraw from the UI shows `SCHEDULED -> RETIRED: postponed by ve4`. |
| F-07 | PASS | `10` ×22, `20` ×1 | Every rule gives a 400 naming its field. G-4-13: one 400 names `affectedService`, `sevrity`, `titel` and lists the known fields. The UI blocks a malformed incident number before sending. |
| F-09 | PASS | `10` ×6 (+ ×6 under F-57), `20`, suite `01-api-contract.spec.ts:22` ×3 | Ticket normalised with defaults; bad number or url → 400; a PUT attaches one with audit; the feed and the card chip show it; a reused ref gives a 409 `{error, suggestedExternalRef}`. |
| F-14 | PASS | `10` ×10 | Ordering, service/type/severity/audience filters, paging, size cap; 400 for page −1, a blank tenant, a bad enum. |
| F-15 | PASS | `10` ×3 | An item is gone 0.4 s after `expiresAt` and reads EXPIRED on the permalink, the publisher GET and the admin search; a SCHEDULED maintenance reads ACTIVE once started. |
| F-16 | PASS | `10`, `20` ×2, `22` | Only maintenance within P7D is listed (Upcoming, "Scheduled"); hidden with `includeUpcoming=false`; offers *Withdraw*, not *Resolve*. |
| F-18 | PASS | `10` ×6 | `:connected` first, then named frames with `id == seq`, a keepalive at 15.01 s, one snapshot per visible item. Fan-out: `created#45` and `retired#46` with the same seq on A and B. |
| F-20 | PASS | `10` ×10, `31`, `32`, suite spec 04 ×3 | Header and query resume; the larger of the two wins (G-3-11); an unknown id gets a snapshot. On the wire after SIGKILL, `?lastEventId=93` was answered with `created#94` exactly once. |
| F-27 | PASS | `10` ×8, suite spec 01 ×3, `20` (F-64), `30` capture | 401/400 `{error}` before validation; `?clientId=` for EventSource; Swagger and OPTIONS exempt; the sidecar sends `X-Client-Id` = `CS_CLIENT_ID`. |
| F-36 | PASS | `10` ×6 | The first push auto-registers a push-only monitor; 400 without status or tenant; unknown keys in a report → 202 (lenient); a misspelled registration field → 400 (G-4-5). |
| F-38 | PASS | `10` ×31, `30` | Vocabulary including G-3-30 and every G-4-16 case (§1.1); nested and legacy components flattened, detail capped. |
| F-46 | PASS | `10` ×6 | Two instance records ordered by id; repeat reports upsert; "2 of 2 pods UP"; 404 for an unknown monitor; G-4-15 with one and two starting pods. |
| F-48 | PASS | `10` ×4, `30` ×7, `31` ×1 | `leaving` marks the pod left at once; a scaled-to-zero service is not DOWN; a pod killed without `leaving` gets an OUTAGE naming it 90.2 s later; B opened no false OUTAGE during A's restart (longest gap 47.3 s < 90 s). |
| F-50 | PASS | `10` ×4 | Three bursts of 20 parallel instance reports, all 202; "20 of 20 pods UP". |
| F-56 | PASS | `20` ×7 | The header's tenant flows into the form; 201 with `X-Client-Id`; confirmation card; *View in feed* puts focus on the list (G-4-19); *Publish another* puts focus on Title and keeps tenant and publisher. |
| F-57 | PASS | `10` ×6, `20` ×4, `31` ×4 | G-3-21 banner. G-4-11/G-4-21: the service's `INC0012345-3` is offered, accepted and gives 201. A dead → "unreachable right now" + *Try again*. Mongo down → "cannot reach its database right now (HTTP 503): database unavailable" in a `role=alert` (G-4-18). |
| F-58 | PASS | `20` ×5 | Default type; filters go into the query; Refresh re-fetches; 15 keystrokes give one GET and one stream. |
| F-60 | PASS | `20` ×6, `22` ×2, `31` ×2 | Publish, update and retire live in 527 / 315 / 419 ms; Paused/Live switch. A withdraw disappears in the second browser 166 ms after the 200. G-4-17: Live after 7.07 s on an empty tenant, and never during a DB outage. |
| F-61 | PASS | `31` ×4, `32`, suite spec 04 ×3 | *Reconnecting* 5 ms after SIGKILL; the browser's retry carried `Last-Event-ID: 93`, then the page's reopens came 1, 2, 4, 8, 10, 10 s apart with `?lastEventId=93`; healed 1.65 s after readiness with the missed notice shown once. |
| F-62 | PASS | `20` ×6, `22` | Focus moves into the confirmation; Escape cancels with no POST (G-4-20); resolve sends `{actor, note}` → 200; the watcher loses the card in 527 ms; withdraw works and propagates. |
| F-64 | PASS | `20` ×2 | `X-Client-Id: communication-frontend` on 23/23 fetches, `?clientId=` on 15/15 streams, same origin; no failed request except the deliberate 409. |
| F-70 | PASS | `30` ×18 | Normalisation end to end through the real sidecar, G-3-30 and the 10 G-4-16 word cases: each notice and card appears, then is retired. The instance message carries the raw word: GAP-e2e4-2. |
| F-72 | PASS | `30` ×3 + re-check ×3 | UNKNOWN until UP. A never-up pod reports at the 8 s heartbeat (4 reports in 40 s), not every probe, and the service opens nothing. G-4-15 summary quoted. Run 1's FAIL is my regex (§2 #39–40). |
| F-74 | PASS | `30` ×3, `31` ×3 | A permanent 4xx is not retried. A 5xx backs off 1 s, 2 s. After a restart: 1, 2, 4, 8, 16 s (30 s cap). In a DB outage the failures carry the service's 503 and are retried; reports are accepted again after it. |
| F-75 | PASS | `30` ×5, `32` | Recorded headers and body; the captured request replayed verbatim to the real backend → 202; an instance id of 253 chars is accepted, 254 → 400 naming the field. |
| F-76 | PASS | `30`, suite spec 05 ×3 | SIGTERM: `leaving` report, exit 0, 121 ms (suite 1.1–1.2 s); pod marked left; no notice. |
| F-88 | PASS | `30` ×6 | Sidecar before app: UNKNOWN "starting: waiting for the app to listen". App dies: DOWN "app is not listening (last target …)" and OUTAGE; rediscovered after 3 s. Sidecar SIGKILL and restart; second pod. |
| F-89 | PASS | `30` ×9, `31` ×4, `04` | Sidecar logs JSON slog at INFO with no DEBUG noise. Backend logs open and retire at INFO; 0 ERROR and 0 traces across a 30 s outage; no secrets. G-4-25 and G-4-9 as in §1.1. |
| F-90 | PASS | `20` ×5, `22`, suite spec 02 ×3 | UI publish → the second browser shows the card within 237 ms of the click (already there 8 ms into the wait that followed the 201), with no reload or re-fetch → consumer GET lists it → resolve → the watcher loses it in 527 ms; the API reads RETIRED with note and actor; no console errors. |
| F-91 | PASS | `30` ×21, `11` ×7, suite specs 03 + 06 ×3 | Pod DOWN: first report 4.2 s after the flip, notice 4.3 s later, card 0.3 s later (8.7 s from the flip); retired 13.0 s after UP. Component degraded: HEALTH 3.4 s after the first report. Pull monitor through UP, DEGRADED and DOWN. G-4-4: 22/22. |
| F-92 | PASS | `10` ×2, `12` ×12, `30` ×2, `31` ×13, suite specs 04 + 07 ×3 | Backend SIGKILL; Mongo outage (JSON 503 including streams, readiness 806–817 ms, a late page never Live, recovery without reload); pod silence; sidecar backoff and recovery. |

## 4. Gaps

| GAP | severity | feature(s) | root cause (file:line) | how reproduced | suggested fix (one line) | test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-e2e4-1 | minor (docs) | F-90, F-91, F-92 (the suite's docs; G-4-29 residue) | `e2e/README.md:30` ("under two minutes"), `:82` ("1.7 to 1.8 minutes each; the budget is 3") and the table at `:85-92` predate G-4-17. `frontend/src/outages/api.ts:76` (`STREAM_SETTLE_MS = 6_000`) delays *Live* on an empty tenant, and every `openFeed` (`e2e/tests/helpers.ts:52`) waits for *Live*. `:88`/`:140` "the card 5 to 6.5 s" is above the README's own arithmetic (about 3–6.3 s). The fixers measured 2.0–2.1 min (`fixes.md:21-23`) but left the README. | Three fresh-stack runs (#7–15). Suite 3.2 / 3.0 / 2.3 min. Spec 02 18.3 / 20.4 / 16.6 s against "under 6 s"; 03 18.8 / 20.2 / 18.2 against 11–14; 04 78 / 54 / 31 against 22–27; 05 3.2 / 2.7 / 2.6 against 2; sidecar stop 1.1–1.2 s against 0.6–0.8. Card 4.1–6.6 s after DOWN against "5 to 6.5". | Re-measure on an idle machine and rewrite the table and totals, counting the 6 s settle per page opened on an empty tenant (or let `openFeed` wait for the list rather than *Live* where a test does not need *Live*). | None (docs). A step in `e2e.yml` comparing the HTML report's durations with the README table would catch it. |
| GAP-e2e4-2 | minor (cosmetic; no effect on status, notices or the UI) | F-70, F-75 | `sidecar/internal/probe/probe.go:195` builds the message from the raw word (`"health document reports " + strings.ToUpper(doc.status)`), while the status goes through `Normalize` (`:189`, `:276`). Padding and control characters reach the instance record, `/status` and the sidecar's "reported" log line verbatim. | Pod flow `words` (`30-pod-flows.txt`). The app answers `" DOWN\t"`, `"   "`, `"\u0001"`, `"\u00a0"` → instance message `"health document reports  DOWN\t"`, `"health document reports    "` (reads as empty), `"health document reports \u0001"`, `"health document reports \u00a0"`. | Quote the word (`fmt.Sprintf("health document reports %q", doc.status)`) or use the trimmed one. | A `probe_test.go` case on the message for a padded or blank word, beside the G-4-16 trim table. |

## 5. What I could not exercise here, and why

- **OpenShift `restricted-v2` admission:** there is no cluster here. I emulated it (UID 1000660000, GID 0, read-only root,
  `cap_drop ALL`, `no-new-privileges`, default seccomp) in both stacks, but nothing ran `oc apply --dry-run=server` or
  scheduled a real pod. This is the Integration −1.
- **GitHub Actions:** `.github/workflows/e2e.yml` and `ci.yml`'s new scan steps (G-4-28, G-4-31) never ran on Actions; I
  have no network route or token for it. This is the Tests −1.
- **The UBI images** (`registry.access.redhat.com/ubi9/go-toolset:1.27`, `ubi9/ubi-micro:9.5`): the registry is unreachable.
  CI's sidecar job builds and scans the UBI-based image by default. I built and scanned the distroless variant the e2e README
  prescribes. The UBI base's packages are not verified; `fixes.md:122-123` warns the first Actions run may fail on them.
- **CI's full backend image scan:** Trivy's Java DB (about 1 GB) does not fit this disk. The jar's libraries were scanned
  through the jar's own CycloneDX SBOM (113 components), with a control proving the scanner finds old versions. The OS
  packages were scanned with CI's flags. A `trivy image` run that reads the jar itself is not verified here.
- **The sidecar's default cadence** (15 s / 2 s / 30 s): the suite uses 2 s / 0.5 s / 4 s and my pod 3 s / 1 s / 10 s. The
  README's "19 to 34 s" with the defaults is checked arithmetically only.
- **A database that hangs** instead of refusing connections (`README.md`, "about 20 s for a database that hangs"): `docker
  stop` closes the port, so only the refused path (5 s server selection) was exercised.
- **A cross-origin deployment of the frontend:** the bundle was always served same-origin through the Vite preview proxy, as
  in the suite. CORS between separate origins was not exercised.
- **Browsers other than Chromium:** only Chromium is installed for Playwright here.
- **Incident, recorded in `99-incidents.txt`, no effect on any tracked file.** In the G-4-30 mutation copy, the iteration-3
  frontend's `npm run build` wrote TypeScript's incremental cache through the symlinked `node_modules`, into the repository's
  untracked `frontend/node_modules/.tmp/tsconfig.{app,node}.tsbuildinfo` (10:32:06Z). I deleted both at 10:32:45Z so that the
  next `tsc -b` in `frontend/` does a full type-check instead of trusting iteration-3 build info. At worst the next
  type-check is slower; no source, `dist` or tracked file changed (`git status`, #43). The directory was still empty at 10:52Z.
