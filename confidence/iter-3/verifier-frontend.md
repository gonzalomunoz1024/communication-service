# Frontend Verifier, iteration 3

Area `frontend`, verified at `e3968c4067e44ac0362f33418940ba8fe473dfae` on branch `confidence-loop/2026-11-01` (frontend code identical to `4a0e84e`), 2026-11-02 from 06:47Z to 07:29Z. Evidence lives under `confidence/evidence/iter-3/frontend/`, and the paths below are relative to it.

What I used:
- **Identity.** Tenant prefix `vf3`; client id `vf3-verifier` for my own API calls (the UI sends its own `communication-frontend`).
- **Private backends**, all from `communication-service-iter3.jar`:
  - A on :19200 and B on :19201, both on database `vf3_reconnect`;
  - C on :19202, on my Mongo container `vf3-mongo` (:19290, database `vf3_mongodown`).
- **My Vite dev servers:** :3200 (to A), :3201 (to C) and :3206 (to a dead :19299).
- **Reverse proxies** (`scripts/rp.js`), serving my scratch builds on :3202 to :3205, :3207 and :3208.
- **An emulated pod:** `vf3-app` plus `vf3-sidecar`.

I never stopped or reconfigured the shared stack (:8080, :3000, `mongo7`, `app`, `sidecar`). How my checks used it:
- v1, v2, v3, v3b, v5, v6, v7's two-tab flow and v7c drove the shared dev server on :3000 against :8080. They created data only in `vf3-*` tenants;
- the variant builds on :3202 to :3204 also call :8080;
- one read-only `mongosh` query counted the shared event log.

The checks that need a backend I can break or configure ran on my private instances.

I tore everything private down at 07:24Z. Afterwards the shared stack answered 200 on both :8080 and :3000, and its three containers were still up (`results/infra-down.txt`).

## 1. Summary verdict

**The frontend is ready to ship: 96/100, and no hard gate tripped.**
- All 29 matrix rows I own pass in a real browser against real backends: 298 of 299 scripted checks passed.
- The one failed check comes from a wrong assumption in my v7 script, carried over from iteration 2: it took seq 1 to have expired, but the shared log still holds it. v7c and v7b replace that check, and both pass (section 2, row 24).
- Every iteration-3 frontend change (G-3-20 to G-3-26) works in the browser, with its own evidence.
- The iteration-2 fixes G-2-9 to G-2-13 still hold.

There is one new minor gap, GAP-frontend3-1. A feed page that opens its stream while the database is down keeps cycling for the whole outage:
- the badge reads Live for about 5 s, then Reconnecting for about 3 s;
- the list reloads once per cycle;
- the polite live region announces every change.

Both READMEs describe something else. The gap costs one point in each of four categories.

| Category | Weight | Score | Basis |
|---|---|---|---|
| Builds & static checks | 10 | **10** | Lint, typecheck and build each ran three times and exited 0. The three builds are byte-identical (JS sha256 `43fe6ad748abfb5a…`, CSS `6957980854814f42…`; 270.34 kB JS, 84.40 kB gzip). `npm audit` finds 0 vulnerabilities with and without `--omit=dev` (307 dependencies, 4 of them prod). The three `VITE_*` variant builds exit 0. Evidence: `static-checks.txt`. |
| Feature completeness | 30 | **30** | 29 of 29 owned rows PASS with browser or CLI evidence (section 3; `results/aggregate.txt`). |
| Automated test health | 20 | **19** | 169/169 tests in 19 files on three runs (16.4 s, 24.9 s, 15.5 s) plus the coverage run (26.7 s), with no flakes and no skip/only/todo (`static-checks.txt`, `test-names.txt`, `test-diff.txt`). Coverage is 96.77 % statements, 92.68 % branches, 94.14 % functions and 97.58 % lines; iteration 2 had 93.49 / 90.73 / 89.42 / 93.99. All 52 executable lines that iteration 3 added or changed are covered (`coverage.txt`). Every test change is justified (`test-diff.txt`). **−1:** no test covers a stream that opens and then ends within seconds. `frontend/src/test/stream.test.ts:122` asserts the reset-on-every-open policy behind GAP-frontend3-1, and `e2e/tests/07-f92-database-down.spec.ts:33-38` checks only the late page's message, not its stream requests, reloads or badge. |
| Integration & contracts | 20 | **19** | `X-Client-Id` on every fetch and `?clientId=` on the stream. 400/401/409/500/503 bodies and empty proxy 502s map as G-3-20 and G-3-21 specify. Frame names and ids are right. `Last-Event-ID` and `?lastEventId=` replay works after restarts, and unknown or expired ids fall back to a snapshot. The ticket url and the `VITE_*` build contracts hold. Evidence: `run-logs/v2.txt`, `v3.txt`, `v4*.txt`, `v6.txt`, `v7*.txt`. **−1:** each side documents a stream behaviour during a database outage that the other does not deliver. `README.md:110-113` says that after the service ends the stream (G-3-1) "the client reconnects with its backoff". `frontend/README.md:82-84` says the stream "stays open on keepalives meanwhile". Neither holds for a stream opened during the outage (GAP-frontend3-1). |
| Resilience & ops | 10 | **9** | **Backend killed:** error state with Try again; reopen gaps of 2, 4, 8, 10, 10, 10 s; Live again 8.9 s after the restart; replay; one list reload per recovery. **Mongo down:** the database wording appears within 5.0 to 5.4 s; the page that was open before the outage keeps its stream; it recovers by itself 1.6 to 2.9 s after Mongo returns. **Also:** cards leave on their own timer at expiry, stale responses are ignored, there were no page errors in any run, and my three backends logged 0 ERROR lines. Evidence: `run-logs/v4*.txt`, `v7*.txt`, `results/backend-logs-summary.txt`. **−1:** GAP-frontend3-1: a page opened during the outage flaps and reloads every ~8 s (`results/v7d-db-outage-timeline.txt`, `v7e-db-outage-prod-timeline.txt`). |
| Usability | 10 | **9** (provisional) | These are my observations only; the Usability Reviewer's UI figure replaces this one. axe found 0 violations in 16 runs: both tabs, both themes, the banners, the confirmation and the automated notice. All 586 sampled text contrasts in 12 views meet AA (lowest 4.66:1). Every row is at least 24 px tall at 375 px, and focus moves as G-2-10 and G-3-22 require. **−1:** during a database outage the badge's live region announces Live and Reconnecting every ~4 s (GAP-frontend3-1). The 409 banner also still sits flush with the bottom of an 800 px viewport (top 696, bottom 800, as in iteration 2). |
| **Weighted total** | 100 | **96** | |

**Hard gates: none tripped.**
- **(a) Every owned matrix item passes E2E.** All 29 rows PASS. The single failed check (v7, F-92) was my script's assumption, not a product failure. v7c tests an unknown id and v7b a truly expired id on my private log, and both pass. `results/shared-log-retention.txt` shows why seq 1 was still retained.
- **(b) No test was skipped, deleted or loosened without justification.** `frontend/src/test/` changed by +517/−10 since `be19645`. The 10 removed lines are:
  - four import or constructor lines: three import lines rewritten with more names, and the EventSource stub's constructor, which now records URLs;
  - two ambiguous `getByRole('status')` queries, replaced by queries for a specific region, because G-3-23 added a second status region;
  - four lines of the two verbatim-409 tests (their titles and assertions), replaced by stricter assertions on the form's wording and the details element. These are G-3-21's documented "touched existing tests" in `confidence/iter-3/fixes.md`.

  A grep for `.skip(`, `.only(`, `.todo(`, `xit(`, `xdescribe(`, `fit(` and `fdescribe(` finds nothing (`test-diff.txt`).
- **(c) Sidecar non-root and restricted-v2.** This gate belongs to the Sidecar Verifier. In my emulated pod the sidecar ran as UID 1000660000:0, with a read-only root, every capability dropped and no-new-privileges, and F-91 passed (`results/v8-pod-timeline.txt`).
- **(d) No open critical or high security finding:** `npm audit` reports 0 with and without `--omit=dev` (`static-checks.txt`).

**What would close the remaining deductions.** Fix GAP-frontend3-1 and add its tests:
1. The client counts a stream as recovered (Live, backoff reset, list reload) only after it has stayed open for some seconds or delivered a frame. A stream that ends right after opening counts as a failed attempt and gets the client's backoff. Alternatively, the service answers 503 before committing the response, or sends a `retry:` hint.
2. Add a repeated open-then-end case to `stream.test.ts` and `useOutageFeed.test.tsx`, and a late-page assertion to `07-f92-database-down.spec.ts`.
3. Make both READMEs describe the same outage behaviour.

That gives +1 test health, +1 integration and +1 resilience, plus +1 usability if the Reviewer agrees. Moving the 409 banner off the bottom edge (scroll it into the centre, or add a scroll margin) is the Reviewer's call.

**Iteration-3 changes, each verified in a real browser:**
- **G-3-20** (`run-logs/v7.txt`, `v7d.txt`, `v7e.txt`, `v2.txt`, `g3.txt`; `shots/mongo-down-feed.png`):
  - **Real database outage.** With Mongo stopped behind backend C, Refresh shows "Couldn't load the feed — The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment." 5.4 s after the click, not "unreachable".
  - **Publish and resolve.** Both get the same sentence in about 5.1 s, with no "rejected" prefix; the draft stays editable and the card stays.
  - **Dead upstream behind a proxy.** A proxy whose upstream is dead answers 502 with an empty body and no content type. The production bundle behind rp.js :3207 and the dev proxy both read "The service is unreachable right now. Check that communication-service is running, then try again." on both tabs.
  - **Route-fulfilled answers.** html, text and empty 502/503/504 bodies read as unreachable. A 504 with a JSON `{"error"}` body reads "The service failed (HTTP 504): <reason>", which is the rule as specified.
- **G-3-21** (`run-logs/g3.txt`, `v2.txt`; `shots/g3-409-details-open.png`, `publish-409-banner.png`):
  - **Reused incident number.** A real 409 reads: "The service rejected this. INC3014347 is already the reference of a notice in tenant vf3-dupref-… (the ServiceNow incident number doubles as the reference). References are permanent, even after a notice is retired, so a follow-up for the same incident needs another External reference, such as INC3014347-2." It shows no notice id.
  - **The service's own sentence** is one keyboard step away. Focus lands on the banner; Tab reaches the "What the service said" summary, and Enter opens it.
  - **The suggestions work.** INC3014347-2 publishes (201). A typed reference that is already taken is named as the External reference, and INC3014347-3 is suggested and accepted.
  - **Accessibility.** axe finds 0 violations with the details open, in both themes.
- **G-3-22** (`run-logs/g3.txt`, `v2.txt`, `v7.txt`), keyboard only:
  - **Opening.** Tab from Refresh reaches Resolve. Enter moves focus to "Resolution note (optional)" inside a `role=group` named by the question.
  - **Cancel** sends focus back to Resolve.
  - **Confirming.** Enter, a note, Tab, Tab, Enter gives 200: the card leaves, focus moves to the results wrapper, and the resolve is announced.
  - **Withdraw** behaves the same way, with "Reason (optional)".
  - **After a failed resolve**, focus returns to the confirm button. This holds for a route-fulfilled 409 (`already expired (probe)`) and for a real 503 with Mongo down.
  - **`document.activeElement`** is never `<body>`.
- **G-3-23** (`run-logs/g3.txt`, `v4.txt`, `v5.txt`):
  - **No tenant.** With Live updates on, the badge reads "Waiting for a tenant" in its own `span[role=status][aria-live=polite]` (ariaSnapshot `status: Waiting for a tenant`). It reads "Paused" when the switch is off.
  - **State changes.** The region goes Waiting → Connecting → Live. Through a backend crash it goes Live → Reconnecting → Reconnecting (1)…(n) → Live.
  - **Sizes.** The switch row is 155 × 26 px around the 30 × 18 switch, and every feed and publish row is at least 24 px tall at 375 px.
  - **A separate region.** The resolve announcement is its own `p[role=status]`.
- **G-3-24** (`run-logs/g3.txt`, `probe-reload.txt`):
  - **Typing.** An 18-character tenant typed at 60 ms per key gives exactly one `GET /v1/feed` and one stream, both for the full tenant, 349 ms after the last key.
  - **Enter and Tab** commit the tenant at once.
  - **Reload.** With a remembered tenant, a reload gives 1 GET and 1 stream in the production bundle. The dev server gives 2 GETs because of React StrictMode's development-only double mount.
- **G-3-25** (`run-logs/g3.txt`, `v8.txt`; `shots/g3-automatic-notice.png`, `pod-outage-card.png`, `feed-automatic-dark.png`). This covers notices raised both by my own health reports and by the real sidecar in the emulated pod:
  - **The card** shows one "Automatic" tag (title "Raised by an automated health check") and no `health:<monitor>:<n>` text, although the API still carries that externalRef.
  - **The body** is plain words, with timestamps to the second and the failing component named.
  - **The history** is signed by one actor throughout: `health-monitor` for my reports, `health-sidecar` for the sidecar's monitor.
  - **Accessibility.** axe finds 0 violations and the contrasts meet AA with that card and its confirmation open.
- **G-3-26** (`coverage.txt`):
  - `useTheme.ts` is at 100 % lines and 96 % branches (60.9 % lines in iteration 2).
  - Overall coverage is 97.58 % lines and 92.68 % branches.
  - Every executable line that iteration 3 touched is covered: 52 of 52.

**Iteration-2 fixes, re-verified:**
- **G-2-9** (`run-logs/v1.txt`, `v2.txt`):
  - The External reference hint still reads "Optional idempotency key, permanent per tenant; defaults to the incident number."
  - No 409 tells the user to retire anything.
  - By the deliberate G-3-21 change, the 409 now explains permanence in the form's words, with the service's sentence in the details element, instead of quoting it verbatim.
- **G-2-10** (`run-logs/v2.txt`, `v3.txt`, `g3.txt`, `v5.txt`). Focus lands:
  - on the Title input after Publish another, by keyboard or mouse;
  - on the `role=alert` banner after a 409, inside the 1280 × 800 viewport;
  - on the results wrapper `div[tabindex=-1]` showing "All clear" after the last card is resolved.
- **G-2-11** (`run-logs/v4.txt`, `v4c.txt`, `v4b.txt`, plus the timelines):
  - **Backoff.** Reopen gaps are 2, 4, 8, 10, 10, 10 s. Every client attempt carries `?lastEventId=25`, and the browser's own retry carries `Last-Event-ID` (seen through CDP). The backoff starts again at 1 s after an open.
  - **Badge.** It counts "Reconnecting (1)…(9)" and returns to Live 8.9 s after the restart.
  - **Recovery.** The missed `created` and `retired` frames are replayed. The list reloads exactly once per recovery and not at all in the 4 s idle window after it.
- **G-2-12** (`run-logs/v1.txt`, `v2.txt`, `v3.txt`, `v6.txt`):
  - **No tenant on a first visit.** `acme` is only the placeholder; the prompt and "Choose a tenant" show.
  - **Ticket hint:** "…linked when the service knows your ServiceNow instance."
  - **Draft row:** at least 24 px tall.
  - **Build default.** A `VITE_DEFAULT_TENANT` build opens on that tenant and wins over localStorage.
  - **Wording.** The "Scheduled" capsule is in sentence case, the empty-body 500 has its own wording, and the confirmations name the actor and the tenant.
- **G-2-13** (`static-checks.txt`, `coverage.txt`):
  - Coverage is above the iteration-2 figures.
  - `npm audit` reports 0 with and without `--omit=dev`.
  - `minimatch` is still overridden, at 11.0.3.

**Observations (none of them a gap):**
1. **409 banner position.** The banner sits flush with the bottom of an 800 px viewport (top 696, bottom 800, `inViewport` true), as in iteration 2.
2. **Badge text toggles the switch.** Clicking the badge's text toggles Live updates, because the labelled row is the switch's click target (G-3-23, by design).
3. **Development-only double GET.** After a reload the dev server shows one extra GET (React StrictMode); the production bundle loads once (`run-logs/probe-reload.txt`).
4. **504 with a JSON body.** A 504 carrying a JSON `{"error"}` body counts as the service's own failure. This is the heuristic G-3-20 specifies; a gateway that answers in JSON would therefore be reported as the service failing.
5. **Slow typing.** Typing with pauses longer than 400 ms commits after each pause, one GET per pause, as G-3-24 designs.
6. **For the Backend Verifier, outside my area.**
   - During a Mongo outage the event-log poller logs `event log poll failed: org.springframework.dao.DataAccessResourceFailureException: …`: 25 WARN lines across three outages on backend C. The other schedulers log the `… skipped: database unavailable: …` wording that `README.md:105-107` documents.
   - SpringDoc logs two startup WARN lines saying `/v3/api-docs` and `/swagger-ui.html` are enabled by default (`results/backend-logs-summary.txt`).

## 2. Commands run

**How the browser checks run:**
- **Tooling.** Scripts are in `scripts/`, using Playwright 1.63 with headless Chromium. CDP reads the SSE frames and the wire headers. @axe-core/playwright 4.10.2 (axe-core 4.10.3) is installed in my scratch folder, not in `frontend/`.
- **Logging.** Each script runs through `scripts/run.sh <name> node <script>`. That writes `run-logs/<name>.txt`, which starts with a line naming the commit and ends with `EXIT <code> (<seconds>)`.
- **Exit codes.** The exit code is the script's own, and it is non-zero only for a script error. Failed checks are counted at the end of each log.
- **Check output.** Each check prints `PASS|FAIL [feature] name :: evidence`, with the evidence cut at 400 characters. The full evidence is in `results/<script>.jsonl.txt`, one check per line.

`scripts/infra.sh` starts and stops my private stack. `scripts/make-evidence.sh` rebuilds this evidence folder. Every evidence text file is under 200 lines; only some of the scripts themselves are longer.

| # | command | exit code | evidence file |
|---|---|---|---|
| 1 | `git rev-parse HEAD`; `git log -1`; `git branch --show-current`; `git diff --stat be19645..e3968c4 -- frontend/`; `git status --short` | 0 | `commit.txt` |
| 2 | `scripts/run-static.sh` steps 01, 14 and 15: `npm run lint` (in `frontend/`), three times | 0, 0, 0 | `static-checks.txt` |
| 3 | steps 02, 16 and 17: `npm run typecheck`, three times | 0, 0, 0 | `static-checks.txt` |
| 4 | steps 03, 18 and 19: `npm run build -- --outDir <scratch>/frontend3/dist{,-run2,-run3} --emptyOutDir` (`tsc -b` + `vite build`; leaves `frontend/dist/` to the E2E Verifier), three times; then `sha256sum` of the assets | 0, 0, 0 | `static-checks.txt` |
| 5 | steps 04, 05 and 06: `npm test`, three times (run 1 with `--reporter=verbose`) | 0, 0, 0 | `static-checks.txt`, `test-names.txt` |
| 6 | step 07: `npm run test:coverage -- --coverage.reportsDirectory=<scratch>/frontend3/coverage` | 0 | `coverage.txt` |
| 7 | steps 08, 09 and 10: `npm audit`; `npm audit --omit=dev`; `npm audit --json` | 0, 0, 0 | `static-checks.txt` |
| 8 | steps 11, 12 and 13: `vite build` to scratch with `VITE_DEFAULT_TENANT=vf3-default`, with `VITE_API_BASE=http://127.0.0.1:8080`, and with `VITE_CLIENT_ID='bad id!'` | 0, 0, 0 | `static-checks.txt` |
| 9 | `npm ls minimatch`; the `overrides` block of `frontend/package.json` | 0 | `static-checks.txt` |
| 10 | `git diff be19645..e3968c4 -- frontend/src/test/` (removed lines and their replacements); grep of `frontend/src/test` for `.skip(` `.only(` `.todo(` `xit(` `xdescribe(` `fit(` `fdescribe(`; `git log 3806e7c..e3968c4 -- frontend/` | 0; grep 1 (no match) | `test-diff.txt` |
| 11 | `git diff -U0 be19645..e3968c4 -- frontend/src ':!frontend/src/test'`, intersected with the line coverage of the HTML report | 0 | `coverage.txt` |
| 12 | `infra.sh up \| tee …; infra.sh wait \| tee …`: backends A, B and C from the iteration-3 jar, `vf3-mongo`, Vite :3200/:3201/:3206, rp.js :3202 to :3205 and :3207 | 0, the task's status, which is `infra.sh wait`'s. The first `tee` kept the task open because the started servers inherited its pipe, so I killed that `tee`. Every service stayed up, and `wait` found all eleven ready. | `results/infra-up.txt`, `results/infra-wait.txt` |
| 13 | `curl -sN --max-time 17 -i '<A>/v1/feed/stream?tenantId=vf3-keepalive-…&clientId=vf3-verifier'` | 28 (my `--max-time`, by design) | `results/sse-keepalive.txt` |
| 14 | `run.sh v1 node v1-shell-theme-form.js` | 0 (62/62) | `run-logs/v1.txt`, `results/v1-shell-theme-form.jsonl.txt` |
| 15 | `run.sh v2 node v2-publish-errors.js` | 0 (46/46) | `run-logs/v2.txt`, `results/v2-publish-errors.jsonl.txt`, `shots/publish-409-banner.png` |
| 16 | `run.sh v3 node v3-feed.js` | 0 (54/54) | `run-logs/v3.txt`, `results/v3-feed.jsonl.txt` |
| 17 | `run.sh v3b node v3b-snapshot-per-open.js` | 0 (3/3) | `run-logs/v3b.txt`, `results/v3b-snapshot-per-open.jsonl.txt` |
| 18 | `run.sh g3-superseded-run1 node g3-iteration3.js` (run 1) | 0 (30/32: two failures, both my script's assumptions; see the note below) | `run-logs/g3-superseded-run1.txt`, `results/g3-superseded-run1.jsonl.txt` |
| 19 | `run.sh g3 node g3-iteration3.js` (run 2, corrected checks) | 0 (32/32) | `run-logs/g3.txt`, `results/g3-iteration3.jsonl.txt`, `shots/g3-409-details-open.png`, `shots/g3-automatic-notice.png` |
| 20 | `run.sh v4 node v4-reconnect.js` (kills backend A and restarts it with `infra.sh kill-backend` / `start-backend`) | 0 (9/9) | `run-logs/v4.txt`, `results/v4-reconnect-timeline.txt`, `results/v4-sse-frames.jsonl.txt` |
| 21 | `run.sh v4c node v4c-reconnect-phase2.js` (A down; publish and retire through B; A back) | 0 (7/7) | `run-logs/v4c.txt`, `results/v4c-reconnect-phase2-timeline.txt`, `results/v4c-sse-frames.jsonl.txt` |
| 22 | `run.sh v4b node v4b-replay-static.js` (production bundle behind rp.js :3205) | 0 (7/7) | `run-logs/v4b.txt`, `results/v4b-replay-timeline.txt` |
| 23 | `infra.sh pod`, then `run.sh v8 node v8-pod-ui.js` (emulated pod, a second pod, `docker stop -t 10 vf3-sidecar`) | 0 (7/7) | `run-logs/v8.txt`, `results/v8-pod-timeline.txt`, `results/v8-sidecar1-log.txt`, `shots/pod-outage-card.png` |
| 24 | `run.sh v7 node v7-e2e-flows.js` (two tabs on the shared :3000 and :8080; `docker stop` / `docker start vf3-mongo` behind backend C) | 0 (12/13; the failure is my script's assumption, see the note below) | `run-logs/v7.txt`, `results/v7-mongo-down-timeline.txt`, `shots/e2e-consumer-live.png`, `shots/e2e-consumer-after-resolve.png`, `shots/mongo-down-feed.png` |
| 25 | `docker exec mongo7 mongosh --quiet communication --eval '<oldest, newest, count and TTL of communication_events>'` (read-only) | 0 | `results/shared-log-retention.txt` |
| 26 | `run.sh v6 node v6-builds.js` (rp.js :3202 to :3204 serve the variant builds against :8080) | 0 (8/8) | `run-logs/v6.txt`, `results/v6-builds.jsonl.txt` |
| 27 | `scripts/v7b-expired-lastEventId.sh` (backend C, private database: deletes the events up to seq 4, then resumes) | 0 | `results/v7b-expired-lastEventId.txt` |
| 28 | `run.sh v7c node v7c-unknown-lastEventId.js` | 0 (1/1) | `run-logs/v7c.txt`, `results/v7c-unknown-lastEventId.jsonl.txt` |
| 29 | `run.sh v7d node v7d-db-outage-stream.js` (dev server :3201; Mongo stopped for 30 s) | 0 (2/2) | `run-logs/v7d.txt`, `results/v7d-db-outage-timeline.txt`, `results/v7d-db-outage-stream.jsonl.txt` |
| 30 | `run.sh v5 node v5-a11y.js` (axe, contrast, keyboard and 375 px, in both themes) | 0 (46/46) | `run-logs/v5.txt`, `results/v5-a11y.jsonl.txt`, `results/v5-axe-violations.jsonl.txt`, `results/v5-contrast-samples.jsonl.txt`, `shots/feed-*.png`, `shots/publish-*.png` |
| 31 | `run.sh probe-reload node probe-reload.js` (dev :3200 against production :3205) | 0 | `run-logs/probe-reload.txt` |
| 32 | `node rp.js 3208 19202 <scratch>/dist`, then `run.sh v7e node v7e-db-outage-prod.js` (v7d on the production bundle) | 0 (2/2) | `run-logs/v7e.txt`, `results/v7e-db-outage-prod-timeline.txt`, `results/v7e-db-outage-prod.jsonl.txt` |
| 33 | `python3 -I scripts/aggregate.py results/` | 0 | `results/aggregate.txt` |
| 34 | ERROR and WARN counts of my three backend logs, with backend C's WARN lines grouped by logger | 0 | `results/backend-logs-summary.txt` |
| 35 | `infra.sh status`; `infra.sh down`; then `curl` of :8080 readiness and :3000, and `docker ps` for `mongo7`, `app` and `sidecar` | 0 (0 private listeners or containers left; shared stack 200/200, all three up) | `results/infra-status.txt`, `results/infra-down.txt` |
| 36 | `scripts/make-evidence.sh` (rebuilds this folder and checks line counts) | 0 | this folder |

**Two script mistakes, kept in the evidence and replaced by corrected runs:**
- **Row 18, the first g3 run.** Two checks failed on my own assumptions; the product behaved correctly in both:
  - **G-3-20:** the check expected the "Try again" text inside the element it read, but that button sits outside it. The unreachable wording was already correct.
  - **G-3-24:** the check counted 2 GETs after a reload on the dev server. That is React StrictMode's development-only double mount.

  Run 2 asserts the message and the button separately. It measures the reload on the production bundle (1 GET, 1 stream) and records the dev count. Row 31 confirms both counts.
- **Row 24, the last v7 check.** It assumed `lastEventId=1` had expired from the shared log. It has not: the oldest retained event is seq 1 from 2026-11-01T23:27Z, the TTL is 86400 s, and the log holds 2,088 events (row 25). So the service was right to replay the tenant's `created` frame instead of sending a snapshot.

  In the same check, the never-issued id did get a snapshot first. The `created` that followed it is the documented at-least-once duplicate after a publish, also seen in v3b (G-2-8). Two checks stand in for this one: v7c (row 28) shows a never-issued id, sent as a query parameter or as a header, gets only a snapshot, and v7b (row 27) shows a truly expired id on my private log gets a snapshot.

## 3. Feature verdicts

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | `run-logs/v2.txt` (F-01, F-56) | A publish from the UI gets 201 with a Location header, status ACTIVE and audience CUSTOMERS. A maintenance dated tomorrow gets 201 SCHEDULED, and the confirmation says so. |
| F-02 | PASS | `run-logs/v2.txt`, 5 F-02 checks | Save as draft sends `draft:true` and gets 201 DRAFT. The UI shows "Draft saved" and no View in feed button. The draft is absent from the feed, its permalink returns 404, and the UI shows All clear. `POST /publish` moves it to ACTIVE (200), and publishing again returns 409. The open feed then shows it live on the `created` frame. |
| F-06 | PASS | `run-logs/v3.txt`, 3 F-06 checks | Resolving from the card leaves the item RETIRED, with the actor and note in its history. Resolving an item already retired elsewhere returns 200 and removes the card. An item past `expiresAt` (EXPIRED) returns 409. |
| F-07 | PASS | `run-logs/v2.txt`, 2 F-07 checks; `run-logs/v1.txt` (F-55) | A server-side invariant (an OUTAGE at INFO, forced past the client) returns 400, shown after "The service rejected this." Bean validation (a blank title, 25 services) returns 400 naming the fields. The client-side mirror is covered under F-55. |
| F-09 | PASS | `run-logs/v2.txt`, `v3.txt`, 3 F-09 checks | A lower-case ticket is sent upper-cased and stored as `servicenow` / `INC0012345`, and externalRef defaults to the number. A url given by the publisher makes the chip a link (`target=_blank rel=noreferrer`). With `communication.servicenow.instance-url` set on backend A, the service fills `ticket.url` and the feed chip links to that instance. |
| F-14 | PASS | `run-logs/v3.txt`, 2 F-14 checks | Seven items seeded. `size=500` is capped to 100; `page=-1`, `size=0` and a blank tenantId each return 400; paging with size 2 sets hasNext correctly, then ends on the last page. |
| F-15 | PASS | `run-logs/v3.txt`, 3 F-15 checks | At `expiresAt` the service's feed drops the item and its permalink says EXPIRED. The UI removes the card on its own timer 129 ms after `expiresAt`, also with Live updates off, well before the 30 s sweeper runs. |
| F-16 | PASS | `run-logs/v3.txt`, 4 F-16 checks | Hidden: a future OUTAGE and a maintenance outside the 7-day window. Listed under Upcoming: a maintenance tomorrow. Live frames are filtered like the GET: a maintenance 3 days out is listed, one 10 days out is not. A reload agrees with the live view. |
| F-18 | PASS | `run-logs/v3.txt`, `v3b.txt`; `results/sse-keepalive.txt`, `results/v4-sse-frames.jsonl.txt` | Each visible item gets one lower-case `snapshot` frame with a numeric id. The live frames are `created`, `updated` and `retired`, with ascending ids above the snapshot id, and a publish arrives exactly once as `created`. On the wire, `:connected` arrives at +0.0 s and `:keepalive` at +15.0 s. |
| F-20 | PASS | `run-logs/v4.txt`, `v4b.txt`, `v4c.txt`, `v7c.txt`; `results/v7b-expired-lastEventId.txt` | Every client reopen carries `?lastEventId=<last>`, and the browser's own retry carries `Last-Event-ID` (seen through CDP). Missed `created` and `retired` frames are replayed without snapshot frames. A non-numeric header is ignored; a non-numeric `?lastEventId=` returns 400, and the client only ever sends numbers. An unknown id (v7c) and an expired id (v7b) each get a snapshot. |
| F-27 | PASS | `run-logs/v2.txt`, `v6.txt`, 5 F-27 checks | The UI sends `X-Client-Id: communication-frontend` on every fetch and `?clientId=` on the stream, and gets 200. A missing header returns 401, and `bad id!` returns 400; the UI shows the service's text for each. |
| F-52 | PASS | `run-logs/v1.txt`, 16 checks; `v6.txt`, 2 checks | Title and h1 are present. A first visit has no tenant (`acme` is only the placeholder): the prompt and "Choose a tenant" show, and no request is made. The tenant field is monospace and persists in `comm-tenant`. `#/publish` opens directly and survives a reload. The tab badge equals the Active now count. A `VITE_DEFAULT_TENANT` build opens on its tenant. The matrix's "default 'acme'" is out of date: G-2-12 changed it on purpose. |
| F-53 | PASS | `run-logs/v1.txt`, 7 checks; `v6.txt`, 1 check | The inline pre-paint script and the color-scheme meta are present, also in the production `index.html`. System mode follows the OS live. The toggle persists `atlas-theme`. After a reload the page is dark before React mounts. An explicit dark setting ignores OS changes. |
| F-54 | PASS | `run-logs/v1.txt`, 24 checks | The type control offers no Health, and its hints follow the type. Severity defaults to Major. The title counter tracks the 200-character limit. Services are split, trimmed, deduped and shown as chips. The incident field and its hint follow G-2-12, and the External reference hint says "permanent per tenant" (G-2-9). Also checked: audience, the timing panel, and the draft switch row (at least 24 px). The POST body is in UTC, converted from Europe/Madrid input, and Clear resets the fields. |
| F-55 | PASS | `run-logs/v1.txt`, 15 checks | Required fields, an error summary, and focus on the first invalid field. `aria-invalid` is set. The title is capped at 200 characters, the body at 16 KB counted in UTF-8, services at 20. The severity floors apply. A maintenance without an end time opens the timing panel with focus on Ends. Also checked: time order and the ticket format. Nothing is sent while the form is invalid. |
| F-56 | PASS | `run-logs/v2.txt`, 14 checks | The button shows a busy state. The confirmation takes focus on its heading. The publisher is remembered. View in feed works. Publish another puts focus on Title, by keyboard or mouse. Every type publishes with and without a ticket. A scheduled maintenance gets its own confirmation. |
| F-57 | PASS | `run-logs/v2.txt`, `v6.txt`, `g3.txt`, `v7.txt`, 19 checks | 400, 401 and 409 show the service's text with the "rejected" prefix, and the 409 uses the form's terms (G-3-21). An empty or JSON 500 gets its own wording. Bodies that are not the service's own (html, text or empty 502/503/504) read as unreachable, and the service's own 503 gets the database wording (G-3-20). A refused connection reads as unreachable. The banner takes focus and stays inside the viewport. Resolve errors appear under the confirm row. |
| F-58 | PASS | `run-logs/v3.txt`, 8 checks | The default query is Type=Outage, with `page=0&size=100`. Also checked: All types, the service filter (exact match) and the severity filter, and Refresh. A stale response is ignored. With 103 active items the UI shows 100 and says so. |
| F-59 | PASS | `run-logs/v3.txt`, `v2.txt`, 9 checks | "Choose a tenant"; three skeleton cards in an `aria-busy` container; the four empty-state sentences; an error with Try again that recovers. With the backend down the badge never reads Live. |
| F-60 | PASS | `run-logs/v3.txt`, 7 checks; `g3.txt` | The EventSource URL carries tenantId and clientId. `created`, `updated` and `retired` apply without a new GET. A scheduled item moves to Active now 112 ms after `startsAt`. Turning Live updates off shows Paused; turning it on goes Connecting → Live and brings in the missed item. Malformed frames are covered by the unit test `stream.test.ts` ("delivers parsed frames and skips malformed ones") only, because the real service cannot be made to send one. |
| F-61 | PASS | `run-logs/v4.txt`, `v4b.txt`, `v4c.txt`; `results/v4-reconnect-timeline.txt` | Backend A killed: the browser retries with `Last-Event-ID`, then the client reopens with gaps of 2, 4, 8, 10, 10, 10 s. The badge counts "Reconnecting (1)…(9)" and returns to Live 8.9 s after the restart. The backoff restarts at 1 s after an open. A publish and a retire made through B while A was down appear after the reconnect. There is exactly one reload per recovery and no page errors. This row is about a restart; GAP-frontend3-1 concerns a database outage. |
| F-62 | PASS | `run-logs/v3.txt`, 9 checks; `g3.txt` (G-3-22) | The confirmation names the actor and the tenant. Cancel works. Confirming sends `POST /retire {actor, note}` (200): the card leaves, the result is announced, and focus moves to the results wrapper, also after the last card. A notice that has not started offers Withdraw. A fresh browser with no publisher yet works too (Q11). The flow works by keyboard only (G-3-22). |
| F-63 | PASS | `run-logs/v3.txt`, 5 checks; `g3.txt`, `v8.txt` (G-3-25) | The Active and Scheduled capsules are in sentence case, and "Starts in" appears once. The card offers Withdraw or Resolve as appropriate. The rail colour follows severity, and the tags (severity, type, audience, ticket chip, externalRef) and the pre-wrapped body are right. Automated notices show "Automatic" instead of a `health:` reference. |
| F-64 | PASS | `run-logs/v6.txt`, `v4b.txt`, 4 checks | `X-Client-Id` and `Accept` go on every fetch and `?clientId=` on the stream. The dev proxy forwards the stream same-origin as `text/event-stream`. The production bundle works behind a reverse proxy. A cross-origin `VITE_API_BASE` build is blocked by the browser because the backend sends no CORS headers (documented limitation, Q2). A `VITE_CLIENT_ID` override is sent. |
| F-65 | PASS | `run-logs/v5.txt`, 46 checks; `v3.txt` | axe finds 0 violations in 16 runs, and contrast meets AA (586 samples, lowest 4.66:1). There is one h1. Inputs have labels and describedby, and roles are right. Tab order, roving tabindex, arrow keys and the switch keys all work, and the focus ring is visible. There are two polite live regions (G-3-23). At 375 px there is no horizontal overflow and every row is at least 24 px tall. |
| F-66 | PASS | `static-checks.txt`, `test-names.txt`, `coverage.txt` | Lint, typecheck and build exit 0 three times each, and the tests pass 169/169 three times. The matrix row is out of date where it says there is no lint, coverage or DOM tests: an ESLint flat config, v8 coverage and 19 test files with component tests now exist. |
| F-90 | PASS | `run-logs/v7.txt`, 3 checks; `shots/e2e-consumer-live.png`, `shots/e2e-consumer-after-resolve.png` | Tab A publishes with a ticket and two services; tab B shows the card 442 ms later, from the `created` frame and with no GET. A consumer GET filtered by service lists it. Resolving with a note removes it from A at once and from B 810 ms later, on `retired`. The consumer feed is then empty, and the permalink is RETIRED with the actor and the note. |
| F-91 | PASS | `run-logs/v8.txt`, 6 checks; `results/v8-pod-timeline.txt`; `shots/pod-outage-card.png` | Emulated pod. With the app UP, a monitor is auto-registered UP with the pod as its instance (sidecar version `ci-iter3`). With the app DOWN, the OUTAGE "vf3-fake-app is down" (Major) appears in the UI feed 5.9 s later without a refresh, and the instance shows DOWN. With the app UP again the notice is RETIRED and the card leaves 8.5 s later; one actor, `health-sidecar`, signs its whole history. A second pod keeps the service UP ("UP (1 of 2 pods UP (DOWN: …q1w2e))") and no card appears. After SIGTERM the sidecar exits 0 in 128 ms and pod 1 is marked `left=true`. |
| F-92 | PASS (with GAP-frontend3-1) | `run-logs/v2.txt`, `v4*.txt`, `v6.txt`, `v7.txt`, `v7c.txt`, `v7d.txt`, `v7e.txt`; `results/v7-mongo-down-timeline.txt`, `v7b-expired-lastEventId.txt`, `v7d-…`, `v7e-…`, `backend-logs-summary.txt`; `shots/mongo-down-feed.png` | **Backend down:** error state with Try again, then reconnect and replay (F-61). **Bad input and bad client ids:** 400 and 401 are shown (F-57, F-27). **Mongo down behind backend C:** `{"error":"database unavailable"}` (503) arrives in 5.0 s. The feed shows its error with the database wording 5.4 s after Refresh; a UI publish and a resolve get the same wording in about 5.1 s. The page that was open before the outage keeps its stream (Live at +5 s and +21 s). The backend recovers without a restart (200 again 1.6 s after `docker start`), and the page lists the item again 2.9 s later without a click. **Unknown and expired ids** get a snapshot (v7c, v7b). The v7 FAIL is my script's assumption (section 2). The sidecar-only parts of this row (sidecar backoff, a silent app, a slow backend, sidecar 400s) are in the Sidecar and E2E Verifiers' evidence. |

## 4. Gaps

| ID | Severity | Feature ID(s) | Root cause (file:line) | How reproduced | Suggested fix (one line) | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-frontend3-1 | minor | F-92, F-60, F-61 | `frontend/src/outages/api.ts:182-186`: `onopen` counts every 200 as a recovery (it resets `attempt` and reports open). `api.ts:187-191` leaves a stream that the service ends normally to the browser's own retry, about 3 s with no backoff. `frontend/src/outages/useOutageFeed.ts:96-103` sets Live and reloads the list after every open that follows a drop. Backend half: `src/main/java/com/atlas/communication/feed/adapters/inbound/RestControllerFeedAdapter.java:93-99` (G-3-1) commits `200` and `: connected` before the snapshot query, then ends the stream about 5 s later with no `retry:` hint. Its comment says it will "let the client reconnect with its backoff". The docs disagree with the behaviour: `README.md:110-113` ("the client reconnects with its backoff") and `frontend/README.md:82-84` ("stays open on keepalives meanwhile"). | With `docker stop vf3-mongo` behind backend C, I opened (reloaded) the feed and watched it for 30 s, with request and response listeners and a MutationObserver on the badge's live region. I did this on the dev server (v7d) and on the production bundle behind rp.js :3208 (v7e); both behave the same. Stream requests go out at 0, 8, 16 and 24 s. Each is answered 200, and the service ends each one about 5 s later with one `feed stream closed: database unavailable` WARN. After each reopen a `GET /v1/feed` gets 503. The badge text changes 8 times in 30 s (Live for about 5 s, then Reconnecting for about 3 s), and each change is in the polite live region. Recovery is fine: the card is back 1.8 to 2.3 s after `docker start`. Try again, a tenant change and a reload during the outage open a stream the same way; I inferred this from the code and did not run it separately. | Count a stream as recovered (Live, backoff reset, list reload) only after it has stayed open N s or delivered a frame; treat a stream that ends within N s as a failed attempt with the client's backoff, or have the service answer 503 before committing or send `retry:`; then make both READMEs agree. | `frontend/src/test/stream.test.ts`: a stream that repeatedly opens and ends within seconds should get growing delays and no reset. `frontend/src/test/useOutageFeed.test.tsx`: at most one list reload per outage. `e2e/tests/07-f92-database-down.spec.ts:33-38`: count the late page's stream requests, list GETs and badge texts over about 20 s. |

**Why minor:**
- No data is lost, and the wording on the page is right.
- The page recovers by itself once the database is back.
- A page that was already open before the outage is not affected.

**Where it happens.** In a cluster that removes the unready pod from its Service (readiness reports DOWN within 1 s, and the kubelet's probe period sets how soon the pod leaves), new requests during the outage get the router's 503 instead. The client's backoff then applies, so the cycle is limited to the probe window, and to deployments without readiness-based routing (Vite proxy, plain reverse proxy, compose). I could not verify this: there is no cluster here.

**What it costs.** Two WARN lines on the service, one stream request and one list request per affected page every ~8 s.

## 5. Not exercised in this sandbox

- **OpenShift: no cluster.** Untested:
  - how the Route/HAProxy treats SSE (idle timeout, buffering, HTTP/2);
  - how a readiness-gated Service behaves during a database outage. There, the router's 503 has no `{"error"}` body, so the UI would show the unreachable wording, not the database wording;
  - restricted-v2 SCC admission.

  The pod was a Docker emulation (`--network container:`, UID 1000660000:0, read-only root, `--cap-drop ALL`, no-new-privileges). The SCC gate belongs to the Sidecar Verifier.
- **UBI base images:** the registry is unreachable, so the pod used the local `fakeapp:ci` and `health-sidecar:ci` images.
- **A real ServiceNow instance:** none is reachable. The ticket links were checked only as URLs built from `communication.servicenow.instance-url=https://vf3.service-now.com`, and never fetched.
- **Retention by time (P1D TTL):** I did not wait 24 h. On my private database I emulated it by deleting events (v7b). The shared log still holds seq 1.
- **Browsers other than Chromium:** Firefox and WebKit are not installed, and `npx playwright install` is forbidden. The ~3 s EventSource retry seen in GAP-frontend3-1 is Chromium's default; other browsers may use a different delay.
- **Screen readers** (NVDA, JAWS, VoiceOver): not available. Instead I used axe, role and ariaSnapshot checks, and a MutationObserver on the live regions. That shows what would be announced, not how a screen reader speaks it.
- **Locales and time:** the browser ran in the sandbox's UTC, except Europe/Madrid (UTC+1) for the form's time-conversion check, with Chromium's default locale (en-US). DST transitions, other time zones and locales, and clock skew between browser and service were not exercised.
- **GitHub Actions:** no workflow run from the sandbox. The frontend's CI steps were run locally instead (section 2, rows 2 to 7).
- **Vulnerability scanning beyond `npm audit`:** no image or SCA scanner is available. The frontend's dependencies were checked against npm's advisory database only.
- **Load:** I measured only a single page during a database outage. How the WARN lines and requests of GAP-frontend3-1 add up across many pages is extrapolated, not measured.
