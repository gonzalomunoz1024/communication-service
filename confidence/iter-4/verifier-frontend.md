# Frontend Verifier, iteration 4

Area `frontend`, verified at `d10369b21d65e9500bbfae7de53013ce5f7b78cc` on branch `confidence-loop/2026-11-01`, 2026-11-02 from about 10:19Z to 11:10Z.
- `d10369b` only rewords the commit counts in `confidence/evidence/environment.md` and `confidence/iter-4/fixes.md`. `git diff 1cd3f13 HEAD -- . ':!confidence'` is empty, so the code under test is `1cd3f13`.
- The iteration-4 frontend change set is `6c15715..d10369b -- frontend/`: five commits (`27a9fec` G-4-17, `d4988b0` G-4-18, `2587273` G-4-19, `4e199a0` G-4-20, `70d21c4` G-4-21) and 16 files, +567/−94. Eight of those files are tests, +329/−7 (`commit.txt`, `test-diff.txt`).
- Evidence lives under `confidence/evidence/iter-4/frontend/`. Every evidence path below is relative to that folder; paths that start with `frontend/`, `src/` or `README.md` are repository paths.

What I used:
- **Identity.** Tenant prefix `vf4`; client id `vf4-verifier` for my own API calls (the UI sends its own `communication-frontend`).
- **Private backends**, all from `communication-service-iter4.jar` (sha256 `64e07ece…`):
  - A on :19200 and B on :19201, both on database `vf4_reconnect` of the shared Mongo. Both run with a ServiceNow instance URL `https://vf4.service-now.com` and 2 s / 1 s sweeps;
  - C on :19202, on my own Mongo container `vf4-mongo` (:19290, database `vf4_mongodown`). This is the database I stopped and started.
- **My Vite dev servers:** :3200 (to A), :3201 (to C) and :3206 (to a dead :19299).
- **Reverse proxies** (`scripts/rp.js`) in front of my scratch production builds:
  - :3202 to :3204 serve the three variant builds and call :8080;
  - :3205 goes to A;
  - :3207 has a dead upstream and answers an empty 502;
  - :3208 goes to C.

  `rp.js` can also cut streams (`/__drop`) for the G-4-17 test.
- **An emulated pod:** `vf4-app` (`fakeapp:ci`) plus `vf4-sidecar` (`health-sidecar:ci`, reporting to A).
  - The sidecar ran as UID 1000660000:0, with a read-only root, every capability dropped, no-new-privileges, and the app's network namespace.
  - Its image was built from `ec4cfcb`, an ancestor of HEAD. `sidecar/` has 0 diff lines from `ec4cfcb` to HEAD.

I never stopped, restarted or reconfigured the shared stack (:8080, :3000, `mongo7`, `app`, `sidecar`). How my checks used it:
- v1, v2, v3b, v6, the two-tab flow of v7, v7c, and parts of v3 and v5 drove the shared dev server on :3000 against :8080. They created data only in `vf4-*` tenants;
- the variant builds behind :3202 to :3204 also call :8080;
- two read-only `mongosh` queries read the shared Mongo: the event-log retention (`results/shared-log-retention.txt`) and the list of `vf*` databases (`results/shared-mongo-vf-databases.txt`).

Every check that needs a backend I can break or configure ran on my private instances.

**Teardown (10:53Z to 10:57Z):**
- I stopped my backends, Vite servers and proxies, and removed `vf4-app`, `vf4-sidecar` and `vf4-mongo` (`results/infra-status.txt`, `results/infra-down.txt`).
- I removed the two anonymous volumes `vf4-mongo` left behind (302 MB), by name and without a prune. I identified them by content: the `/data/db` volume holds `vf4_mongodown`, and both were created at 10:20:10Z, together with the container.
- I removed my scratch builds.
- Afterwards the shared stack answered 200 on both :8080 readiness and :3000, and `mongo7`, `app` and `sidecar` were still up (`results/shared-stack-after.txt`).
- I kept `vf4_reconnect` (0.8 MB) on the shared Mongo, as iterations 2 and 3 kept `vf2_reconnect` and `vf3_reconnect`.

## 1. Summary verdict

**The frontend is ready to ship: 97/100, and no hard gate tripped.**
- **All 29 owned rows pass** in a real browser against real backends, with no mocks. 356 of 359 scripted checks passed in the final runs (`results/aggregate.txt`). Of the three failed checks:
  - two are assumptions in my scripts that the code made obsolete. Each is classified with evidence in `results/fails-classified.txt` and in gate (a) below;
  - one is GAP-frontend4-1.
- **The five iteration-4 frontend changes, G-4-17 to G-4-21, work as specified**, each with its own evidence. One edge of G-4-21 fails (GAP-frontend4-1).
- **GAP-frontend3-1 is fixed.** A page opened during a database outage no longer cycles between Live and Reconnecting and no longer reloads per cycle. It counts **Reconnecting (n)**, never reads Live, and recovers by itself once the database is back.
- **No earlier fix regressed:** the iteration-3 closures G-3-20 to G-3-26 and the iteration-2 closures G-2-9 to G-2-13 still hold.
- **There are two new minor gaps:**
  - **GAP-frontend4-1:** with a reference that contains parentheses and all 50 follow-up values taken, the 409 banner suggests a value the service has just reported as taken;
  - **GAP-frontend4-2:** the vitest suite times out under CPU contention. 4 of 14 scored runs failed, all under heavy load and none at load 7 or below. I reproduced it on a single core.

| Category | Weight | Score | Basis |
|---|---|---|---|
| Builds & static checks | 10 | **10** | `npm run lint`, `npm run typecheck` and `npm run build` each ran three times and exited 0. The three builds are byte-identical (JS sha256 `47bfbd8f1a39c715…`, CSS `6957980854814f42…`; 271.54 kB JS, 84.82 kB gzip). The three `VITE_*` variant builds exit 0. `npm audit` finds 0 vulnerabilities with and without `--omit=dev` (307 dependencies, 4 of them prod). Trivy 0.58.1 `fs` on the lockfile used the cached database without downloading and found 306 packages, 0 vulnerabilities. `minimatch` 11.0.3 is still overridden (G-2-13). Evidence: `static-checks.txt`. |
| Feature completeness | 30 | **30** | 29 of 29 owned rows PASS with browser or CLI evidence (section 3). |
| Automated test health | 20 | **18** | 183 tests in 19 files. No skip/only/todo (grep exit 1). The 7 removed test lines are all justified (`test-diff.txt`). All 119 executable lines that iteration 4 added or changed are covered. Coverage is 96.73 % statements, 92.78 % branches, 94.26 % functions and 97.74 % lines (iteration 3: 96.77 / 92.68 / 94.14 / 97.58; `coverage.txt`). Every G-4 change has its own tests (`test-names.txt`). Iteration 3's −1 is closed: `stream.test.ts` now covers a stream that is ended within seconds of opening (line 135 of `test-names.txt`). **−2 (GAP-frontend4-2):** the 3× run did not pass. Run 1 passed; runs 2 and 3 failed 4 and 3 tests; the coverage run failed 1 and wrote no report. Over all 14 scored runs, 4 failed, all under heavy CPU contention, and all 7 runs at load 7 or below passed. With 8 workers on one CPU the same timeouts come back, and with `--testTimeout=20000` they go away (`test-runs.txt`). |
| Integration & contracts | 20 | **19** | `X-Client-Id` on every fetch and `?clientId=` on the stream. 400/401/409/500/503 bodies and empty proxy 502s map as specified. G-4-10's 503 before any stream byte is handled as a failed attempt. The service's `suggestedExternalRef` is used (R-3, INC…-3). `?lastEventId=` goes on every attempt, and the browser's retry sends `Last-Event-ID`. Unknown and expired ids fall back to a snapshot (v7b, v7c). The ticket url and the `VITE_*` build contracts hold. Iteration 3's −1 is closed: both READMEs now describe the same outage behaviour (`README.md:125-157`, `frontend/README.md:36-58` and `:92-98`). **−1 (GAP-frontend4-1):** the client reads "none free" from the service's prose, and that parse fails when the reference contains parentheses. |
| Resilience & ops | 10 | **10** | **Backend killed (v4):** attempts 1, 2, 4, 8, 10, 10, 10 s apart, each with `?lastEventId=245`. Live 13.9 s after the backend answered: the next attempt came 7.7 s later (inside the 10 s cap) and Live followed 6.1 s after its 200 (the settle time). The reconnect was a resume and replayed nothing; the list reloaded once. **Stream cut before it worked (g4-17-settle):** reopen gaps 1002/2006/4003/8014 ms, no reload, never Live; Live 6.0 s after the fifth attempt, then exactly one reload. **Database down (g4-db-outage, v7, v7d, v7e):** a page opened before the outage keeps its stream. Pages opened during it get 503 on every attempt, never read Live, and recover by themselves about 2.4 s after `docker start` with one reload. **Also:** pod flows (v8); 0 ERROR lines from my backends (`results/backend-logs-summary.txt`); no page errors in any run. |
| Usability | 10 | **10** (provisional) | These are my observations only; the Usability Reviewer's UI figure replaces this one. axe found 0 violations in every run, both themes included. All sampled text contrasts meet AA (lowest 4.66:1 light, 4.93:1 dark). Focus is right for G-4-18, G-4-19 and G-4-20, the badge no longer flaps, and the live region announces each real state once. GAP-frontend4-1's wrong suggestion is charged once, under Integration. The observations for the Reviewer are listed after the gaps table in section 4. |
| **Weighted total** | 100 | **97** | |

**Hard gates: none tripped.**
- **(a) Every owned matrix item passes E2E.** All 29 rows PASS. The three failed checks:
  1. **v4: "Live again within the 10 s cap (plus one attempt)".** It measured 13.9 s against a bound of 11 s. That bound dates from iteration 2, when the badge turned Live on the stream's open event. G-4-17 deliberately changed that: Live now needs a frame or 6 s (`frontend/README.md:39-46`), and a resume with nothing missed carries no frame. The timeline splits the 13.9 s into the next attempt 7.7 s after the backend was up (inside the cap) and Live 6.1 s after that attempt's 200. That is the expected cap + settle, at most about 16 s. The next check in the same run passed: the attempt was a resume and replayed nothing (`results/v4-reconnect-timeline.txt`, `results/fails-classified.txt`).
  2. **v7: "expired id 1 → snapshot".** Seq 1 has not expired in the shared log (oldest seq 1 at 2026-11-01T23:27:04Z, TTL 86400 s; `results/shared-log-retention.txt`), so the service correctly replays from it. v7c (an id never issued) and v7b (truly expired ids on my private log) pass.
  3. **g4-focus-409: the parentheses edge.** This is GAP-frontend4-1. F-56 and F-57 pass in every other flow.

  **F-66 is judged PASS.** Its commands run and pass. The 4 failing runs show timeouts, one missed real-time window and one test failing because a timed-out test's typing leaked into it, all under 4 to 7× CPU oversubscription; they come back only when the workers are starved and go away with a longer timeout. The rubric scores flakes under test health, where I deducted 2. If F-66 were read as failing on runs 05 and 06 instead, gate (a) would cap the total at 80.
- **(b) No test was skipped, deleted or loosened without justification.** `frontend/src/test/` changed by +329/−7 since `6c15715`. The 7 removed lines (`test-diff.txt`):
  - two import lines, now importing more names;
  - two comments and two test titles reworded;
  - one expectation, `getByText('Live')`. The 503 test now asserts the badge reads **Service degraded** and that no Live is shown. That is stricter, and it is G-4-17's documented deliberate change (`confidence/iter-4/fixes.md`, "Existing tests touched").

  Two `stream.test.ts` tests now advance `STREAM_SETTLE_MS` after `open()`, with their expectations unchanged. The grep for `.skip(`, `.only(`, `.todo(`, `xit(`, `xdescribe(`, `fit(`, `fdescribe(`, `skipIf` and `runIf` finds nothing.
- **(c) Sidecar non-root and restricted-v2.** This gate belongs to the Sidecar Verifier. In my emulated pod the sidecar ran as UID 1000660000:0 with a read-only root, every capability dropped and no-new-privileges, F-91 passed, and SIGTERM exited 0 in 119 ms (`run-logs/v8.txt`).
- **(d) No open critical or high security finding.** `npm audit` reports 0 with and without `--omit=dev`, and Trivy reports 0 on the lockfile (`static-checks.txt`).

**What would close the remaining deductions.**
- **Test health, +2 (GAP-frontend4-2):**
  1. Replace the real-time 250/450 ms window in `frontend/src/test/useOutageFeed.test.tsx:188-200` with fake timers.
  2. Give the user-event tests headroom: set `test.testTimeout` (for example 15000) in `frontend/vite.config.ts:34-39`, or use `userEvent.setup({ delay: null })` in `App.test.tsx`, `OutageCard.test.tsx` and `PublishOutageForm.test.tsx`.
  3. Show it holds: `taskset -c 0 npx vitest run --maxWorkers=8` should pass three times in a row (it fails today; `test-runs.txt`).
- **Integration, +1 (GAP-frontend4-1):**
  1. Anchor the parse to the end of the message, for example `/\((.+) are taken as well\)\.?$/`. Better, have the 409 say "none free" in a field the client reads, rather than in prose.
  2. Add an `errors.test.ts` case whose reference contains parentheses.

**Iteration-4 changes, each verified in a real browser:**
- **G-4-17: Live only after a frame or 6 s.** Evidence: `run-logs/g4-17-settle.txt`, `g4-db-outage.txt`, `v7.txt`, `v7d.txt`, `v7e.txt`, `v4.txt`. Every badge change was recorded by a MutationObserver installed before the app ran, and frames were recorded through CDP.
  - **Healthy service:**
    - a filter with no notice gets no frame. The badge reads Connecting, then Live 6004 ms (dev) and 6001 ms (production bundle) after the stream's 200, never earlier;
    - a filter with a notice gets its snapshot 0 and 34 ms after the 200 and reads Live at 17 and 39 ms.
  - **Streams cut before they work:** `rp.js` cut the stream 2 s after each 200, four times.
    - Each cut counted as a failed attempt: reopen gaps 1002/2006/4003/8014 ms, badge **Reconnecting (1)** to **(4)**, never Live, and no list reload;
    - the fifth attempt, left alone, read Live 6023 ms after it was requested, and the list reloaded exactly once.
  - **Database down, page opened before the outage (P1):**
    - it keeps its stream, with no new stream request;
    - it reads Live until a Refresh fails (503 after 5507 ms), then **Service degraded** beside the database wording;
    - after the database returns, untouched, it stays **Service degraded**, because its stream never dropped (`frontend/README.md:94-97`). Try again brings Live back.
  - **Database down, pages opened during the outage (P2 dev, P3 production in dark):**
    - they never read Live and count **Reconnecting (1)** to **(5)**, at 5 s (the service's wait) plus 1, 2, 4 and 8 s;
    - every stream answer is `503 application/json {"error":"database unavailable"}` with no event-stream byte, and the list is requested once (G-4-10: 503 in 5032 ms);
    - about 2.4 s after `docker start` the card is back and the badge reads Live (2398 and 2393 ms), after one reload and with no alert left.

    v7d and v7e show the same over 30 s: Connecting, then Reconnecting (1) to (4), all four stream answers 503, and Live 4.8 s after `docker start`. In iteration 3 the same page cycled Live for about 5 s and Reconnecting for about 3 s, with a reload each cycle (`confidence/iter-3/verifier-frontend.md:30-33`).
- **G-4-18: the feed's load error is an alert.** Evidence: `run-logs/g4-focus-409.txt` (dead backend) and `g4-db-outage.txt` (database down).
  - "Couldn't load the feed" renders inside `role="alert"`, with its heading, the reason and Try again (accessibility tree in `results/g4-db-outage.jsonl.txt`).
  - Each failed Try again inserted exactly one new alert, and the old node was detached: 502 three times from the keyboard, and 503 twice during the outage.
  - Focus landed on the new Try again every time, never on `<body>`. The old alert stays on screen while the retry loads.
  - When a retry succeeds, the alert leaves and focus moves to the results container.
  - axe found 0 violations in light and dark.
- **G-4-19: focus after "View in feed".** Evidence: `run-logs/g4-focus-409.txt`.
  - Enter or a click on View in feed after a 201 switches to `#/feed` and focuses the results container (`div[tabindex=-1]`) that holds the new card. The next Tab reaches that card's Resolve.
  - Switching to the Feed tab by mouse or by arrow keys leaves focus on the tab.
  - Back and Forward leave focus on `<body>`; this is an observation.
- **G-4-20: Escape cancels the confirmation.** Evidence: `run-logs/g4-focus-409.txt` and `g4-db-outage.txt`.
  - Escape from the note, from Cancel and from the confirm button closes both the Resolve and the Withdraw confirmation, and focus returns to the Resolve or Withdraw button. A confirmation opened with the mouse also closes.
  - No Escape sent a retire.
  - While the retire call ran during the outage (Cancel disabled, confirm busy, focus placed in the note), Escape changed nothing.
  - After the 503 (5074 ms) the database wording appeared, the card stayed and focus went back to confirm. Escape then cancelled, focus went back to Resolve, and no second retire was sent.
- **G-4-21: the service's suggestion.** Evidence: `run-logs/g4-focus-409.txt`.
  - With R and R-2 taken, the real 409 carries `suggestedExternalRef` R-3, and the banner offers R-3. The local count would have said R-2. Publishing R-3 returns 201.
  - The ticket path offers the service's INC…-3.
  - With all 50 follow-up values taken (51 seeded through the API), the 409 has no suggestion. The banner suggests nothing and quotes "(R-2 to R-51 are taken as well)". The banner has focus, and the service's sentence is in the details. axe found 0 violations.
  - The parentheses edge fails: GAP-frontend4-1.

**Iteration-3 closures still hold:**
- **G-3-20, the database wording:** 10 checks (v2, v7, g3); g4-db-outage shows the same wording. Its badge part changed on purpose under G-4-17.
- **G-3-21, the 409 explained:** 9 checks (v2, g3).
- **G-3-22, focus in the confirmation:** 10 checks (v2, v7, g3).
- **G-3-23, the badge as a live region:** 9 checks (g3, v4, v5). The sequence was Live → Reconnecting → (1) … (9) → Live.
- **G-3-24, one subscription per tenant:** 7 checks (g3).
- **G-3-25, the automated notice:** 5 checks (g3, v8). It shows "Automatic", a plain body and one actor.
- **G-3-26:** `useTheme.ts` has 100 % line coverage and 7 tests; the 503-with-body tests are in `errors.test.ts`, `OutageFeed.test.tsx` and `PublishOutageForm.test.tsx` (`coverage.txt`, `test-names.txt`).

**Iteration-2 closures still hold:**
- **G-2-9:** 3 checks (v1, v2). The wording is now superseded by G-3-21.
- **G-2-10:** 5 checks (v2, v3, v5).
- **G-2-11:** 6 checks pass in v4 and v4c. The one failed check is the bound described in gate (a).
- **G-2-12:** 12 checks (v1, v2, v3, v6).
- **G-2-13:** `Segmented`, `Tabs` and `format.ts` are at 100 % lines, the `minimatch` override is in place, and the audit finds 0.

## 2. Commands run

The scripts are in `scripts/`. "x/y" counts the checks that passed. My browser scripts exit 0 even when a check fails, so read their pass/fail counts, not just the exit code.

| # | command | exit code | evidence file |
|---|---|---|---|
| 1 | `git rev-parse HEAD`; `git log -1`; `git branch --show-current`; `git diff 1cd3f13 HEAD -- . ':!confidence' \| wc -l`; `git log`/`git diff --stat 6c15715..HEAD -- frontend/`; `git status --short` | 0 (the diff has 0 lines) | `commit.txt` |
| 2 | `npm run lint`, three times (steps 01, 14, 15) | 0, 0, 0 | `static-checks.txt` |
| 3 | `npm run typecheck`, three times (02, 16, 17) | 0, 0, 0 | `static-checks.txt` |
| 4 | `npm run build -- --outDir <scratch>/dist{,-run2,-run3} --emptyOutDir` (03, 18, 19), then `sha256sum dist*/assets/*` | 0, 0, 0; byte-identical | `static-checks.txt` |
| 5 | `VITE_DEFAULT_TENANT=vf4-default`, `VITE_API_BASE=http://127.0.0.1:8080` and `VITE_CLIENT_ID='bad id!'` with `npx vite build --outDir <scratch>/…` (11, 12, 13) | 0, 0, 0 | `static-checks.txt`, `run-logs/v6.txt` |
| 6 | `npm test -- --reporter=verbose` (04) | 0 (183/183, 22.9 s) | `test-runs.txt`, `test-names.txt` |
| 7 | `npm test` (05) | 1 (4 failed, 63.5 s) | `test-runs.txt` |
| 8 | `npm test` (06) | 1 (3 failed, 63.9 s) | `test-runs.txt` |
| 9 | `npm run test:coverage -- --coverage.reportsDirectory=<scratch>/coverage …` (07) | 1 (1 timeout; no report written) | `test-runs.txt` |
| 10 | `npm audit`; `npm audit --omit=dev`; `npm audit --json` (08, 09, 10) | 0, 0, 0 (0 vulnerabilities) | `static-checks.txt` |
| 11 | `scripts/test-repeat.sh A 3` (`npm test` three times, load about 25) | 0, 0, 1 | `test-runs.txt` |
| 12 | `scripts/test-repeat.sh D-testTimeout20000-diagnostic 2 --testTimeout=20000` (diagnostic, not scored, load 16 to 17) | 0, 0 | `test-runs.txt` |
| 13 | `scripts/test-repeat.sh B 3` (load 1.8 to 6.9) | 0, 0, 0 | `test-runs.txt` |
| 14 | the coverage run again (`coverage-rerun`, with the json reporter added on the command line), then mapping the changed lines against `coverage-final.json` | 0 (183/183; 119/119 changed lines covered) | `coverage.txt` |
| 15 | `scripts/test-repeat.sh C 3` (load 2.3 to 3.8, after my teardown) | 0, 0, 0 | `test-runs.txt` |
| 16 | `PIN=0 scripts/test-repeat.sh P-pinned-cpu0-diagnostic 2` (`taskset -c 0 npm test`; diagnostic) | 0, 0 (34 s each) | `test-runs.txt` |
| 17 | `PIN=0 scripts/test-repeat.sh P-pinned-cpu0-8workers-diagnostic 1 --maxWorkers=8` | 1 (the two "View in feed" tests time out at 5160 and 5107 ms: the GAP-frontend4-2 reproduction) | `test-runs.txt` |
| 18 | the same as 17 with `--testTimeout=20000` | 0 (183/183) | `test-runs.txt` |
| 19 | `flock orch-trivy/.lock docker run --rm -v orch-trivy/cache/trivy:/root/.cache/trivy … aquasec/trivy:0.58.1 fs --skip-db-update --skip-java-db-update --scanners vuln --include-dev-deps` on a copy of `package.json` and `package-lock.json`: the table, then `--format json --list-all-pkgs` | 0, 0 (306 packages, 0 vulnerabilities) | `static-checks.txt` |
| 20 | `npm ls minimatch` | 0 (11.0.3, overridden) | `static-checks.txt` |
| 21 | `git diff -U0 6c15715..d10369b -- frontend/src/test/`, then `grep -rnE '\.(skip\|only\|todo)\(\|\bxit\(…' frontend/src/test/` | 0; grep 1 (no match) | `test-diff.txt` |
| 22 | `scripts/infra.sh backends`, `wait`, `fronts`, `pod` (my private stack, started with `setsid -f`) | the launcher records no exit code; every target answered `ready` | `results/infra-up.txt`, `results/infra-wait.txt`, `results/infra-fronts.txt` |
| 23 | `node g4-17-settle.js` | 0 (7/7; the superseded run 1 got 4/7 because of script errors) | `run-logs/g4-17-settle.txt`, `results/g4-17-settle-timeline.txt`, `results-superseded/` |
| 24 | `node g4-db-outage.js` (stops and starts `vf4-mongo`) | 0 (27/27; run 1 25/27) | `run-logs/g4-db-outage.txt`, `results/g4-db-outage-timeline.txt` |
| 25 | `node probe-dark-contrast.js` | 0 (3/3) | `run-logs/probe-dark-contrast.txt` |
| 26 | `node g4-focus-409.js` | 0 (21/22; the failed check is GAP-frontend4-1; run 1 19/22) | `run-logs/g4-focus-409.txt`, `results/g4-focus-409.jsonl.txt` |
| 27 | `scripts/run-regression.sh v1 v2 v3 v3b g3 probe-reload v6 v5` | 0 for each: 62/62, 46/46, 54/54, 3/3, 32/32, a probe with no checks, 8/8, 46/46 | `results/regression-summary.txt`, `run-logs/*.txt` |
| 28 | `scripts/run-regression.sh v7c v7b v7 v7d v7e v8 v4 v4c v4b` | 0 for each: 1/1, v7b (bash, prints its results), 13/14, 2/2, 2/2, 7/7, 8/9, 7/7, 7/7 | `results/regression-summary.txt`, `results/fails-classified.txt` |
| 29 | `docker exec mongo7 mongosh --quiet --eval …`, read-only: the event-log retention, then the `vf*` databases (listed twice) | 0 | `results/shared-log-retention.txt`, `results/shared-mongo-vf-databases.txt` |
| 30 | `python3 -I scripts/aggregate.py results` | 0 | `results/aggregate.txt` |
| 31 | `scripts/infra.sh status`; `scripts/infra.sh down`; `docker volume rm` on the two anonymous volumes of `vf4-mongo` | 0; 0; 0 | `results/infra-status.txt`, `results/infra-down.txt` |
| 32 | `curl` on :8080 readiness and :3000; `docker ps` | 200, 200; `mongo7`, `app` and `sidecar` up | `results/shared-stack-after.txt` |
| 33 | `bash scripts/make-evidence.sh` (rebuilds this folder) | 0 | this folder |

## 3. Feature verdicts

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | `run-logs/v2.txt` | A publish from the UI gets 201 with Location; ACTIVE, audience CUSTOMERS. |
| F-02 | PASS | `run-logs/v2.txt` (5 checks) | Save as draft sends `draft:true` and gets 201 DRAFT, with no View in feed. The draft is absent from the feed and its permalink answers 404. |
| F-06 | PASS | `run-logs/v3.txt`, `g4-focus-409.txt`, `g4-db-outage.txt` | A retire records the actor and note. A second retire is idempotent (200). An EXPIRED item gets 409. Escape and retire-while-busy behave as G-4-20 requires. |
| F-07 | PASS | `run-logs/v2.txt` | The 400 bodies (invariant and bean validation) are shown with their fields. |
| F-09 | PASS | `run-logs/v2.txt`, `v3.txt` | The ticket is upper-cased and becomes the default `externalRef`. The service-built url (`vf4.service-now.com`) opens in a new tab. |
| F-14 | PASS | `run-logs/v3.txt` | Filters, the size cap of 100, the 400s, the paging arithmetic. |
| F-15 | PASS | `run-logs/v3.txt` | The card leaves on its own timer 149 ms after `expiresAt`, also with Live updates off. |
| F-16 | PASS | `run-logs/v3.txt` | Future outages are hidden and maintenance inside 7 days shows under Upcoming, for both GETs and live frames. |
| F-18 | PASS | `run-logs/v3.txt`, `v3b.txt`, `g4-17-settle.txt`, `v4.txt` | One lower-case `snapshot` per visible item with numeric ids. Live frames are `created`/`updated`/`retired`. A frame proves the stream at once (Live at 17 and 39 ms). |
| F-20 | PASS | `run-logs/v4.txt`, `v4b.txt`, `v4c.txt`, `v7b.txt`, `v7c.txt` | Every attempt carries `?lastEventId=`. The browser's retry sends `Last-Event-ID`. Missed frames are replayed. Unknown and expired ids get a snapshot. |
| F-27 | PASS | `run-logs/v2.txt`, `v6.txt` | `X-Client-Id: communication-frontend`. A missing id gets 401 and a bad one 400, each with the service's text. |
| F-52 | PASS | `run-logs/v1.txt`, `v6.txt` | The shell and title. No tenant is pre-filled. The tenant field persists and the default-tenant build works. |
| F-53 | PASS | `run-logs/v1.txt`, `v6.txt` | The theme is applied before first paint; system, toggle and persistence all work. |
| F-54 | PASS | `run-logs/v1.txt` (24 checks) | The form's fields, segmented controls, hints and counters. |
| F-55 | PASS | `run-logs/v1.txt` (15 checks) | Inline errors, the summary, focus on the first invalid field, `aria-invalid`. |
| F-56 | PASS | `run-logs/v2.txt`, `g4-focus-409.txt` | The busy state, the confirmation card and its focus. View in feed focuses the list (G-4-19). |
| F-57 | PASS | `run-logs/v2.txt`, `v6.txt`, `g3.txt`, `v7.txt`, `g4-db-outage.txt`, `g4-focus-409.txt` | 409/400/401/500/503 and empty 502s are explained. The 409 uses `suggestedExternalRef`, and "none free" quotes the service. Edge: GAP-frontend4-1. |
| F-58 | PASS | `run-logs/v3.txt` | Default Type=Outage and the request parameters; filters and sorting. |
| F-59 | PASS | `run-logs/v3.txt`, `v2.txt`, `g4-db-outage.txt`, `g4-focus-409.txt` | Choose a tenant, skeletons, All clear, and the error state as an alert (G-4-18). |
| F-60 | PASS | `run-logs/v3.txt`, `g3.txt`, `g4-17-settle.txt` | The stream url carries `clientId`. Created, updated and retired frames are applied in place with no GET. Live only after a frame or 6 s. |
| F-61 | PASS | `run-logs/v4.txt`, `v4b.txt`, `v4c.txt`, `g4-17-settle.txt` | Backoff 1, 2, 4, 8, then a 10 s cap; reset once a stream works; one reload per recovery. Open-then-cut streams count as failed attempts. The 13.9 s check is the obsolete bound (gate (a)). |
| F-62 | PASS | `run-logs/v3.txt`, `v2.txt`, `g3.txt`, `g4-focus-409.txt` | The confirmation names the actor and tenant. Cancel, Escape, focus return and a failed resolve all behave. |
| F-63 | PASS | `run-logs/v3.txt`, `g3.txt`, `v8.txt` | The card's tags, Scheduled and Starts in …, Withdraw for a notice that has not started, the Automatic tag. |
| F-64 | PASS | `run-logs/v6.txt`, `v4b.txt` | Same-origin behind a proxy; the `VITE_API_BASE` cross-origin build; `X-Client-Id` and `?clientId=`. |
| F-65 | PASS | `run-logs/v5.txt` (46), `g4-db-outage.txt`, `g4-focus-409.txt`, `probe-dark-contrast.txt`, `g3.txt` | axe found 0 violations in every run, both themes. Sampled contrasts are all AA. Live regions and alerts work, and rows are at least 24 px. |
| F-66 | PASS | `static-checks.txt`, `test-runs.txt`, `coverage.txt` | Lint, typecheck and build pass 3/3. The suite passes 10 of 14 scored runs; the 4 failures are flakes under contention (GAP-frontend4-2), scored under test health. The matrix text is out of date: it says there is no lint, coverage or DOM test. |
| F-90 | PASS | `run-logs/v7.txt` | A publish in tab A shows in tab B 111 ms later with no GET. A resolve with a note leaves tab B 95 ms later. The permalink is RETIRED and its history has the actor and note. |
| F-91 | PASS | `run-logs/v8.txt`, `results/v8-pod-timeline.txt` | Pod UP registers the monitor. Pod DOWN raises a live OUTAGE card (6.8 s), which retires on UP (8.9 s). Two pods give the rollup. SIGTERM exits 0 and the pod is marked `left`. |
| F-92 | PASS | `run-logs/v7.txt`, `v7b.txt`, `v7c.txt`, `v7d.txt`, `v7e.txt`, `g4-db-outage.txt`, `v2.txt` | Backend down: the error state with Try again. Database down: 503 in about 5 s and the database wording, Service degraded or Reconnecting (n), recovery without a restart, no ERROR lines. |

| Fix item | Verdict | Evidence | Note |
|---|---|---|---|
| G-4-17 | PASS | `run-logs/g4-17-settle.txt`, `g4-db-outage.txt`, `v7.txt`, `v7d.txt`, `v7e.txt` | 18 checks; see section 1. |
| G-4-18 | PASS | `run-logs/g4-focus-409.txt`, `g4-db-outage.txt` | One new alert per failed retry, and focus on the new Try again. |
| G-4-19 | PASS | `run-logs/g4-focus-409.txt` | Keyboard and mouse both put focus on the results; the next Tab reaches Resolve. |
| G-4-20 | PASS | `run-logs/g4-focus-409.txt`, `g4-db-outage.txt` | Escape works from all three controls of both verbs, and is ignored while busy. |
| G-4-21 | PASS, with one failing edge | `run-logs/g4-focus-409.txt` | 5/6 checks pass; the parentheses edge is GAP-frontend4-1. |
| G-3-20 to G-3-26 | PASS (no regression) | see section 1 | |
| G-2-9 to G-2-13 | PASS (no regression) | see section 1 | |

## 4. Gaps

| Gap | Severity | Feature IDs | Root cause (file:line) | How reproduced | Suggested fix (one line) | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-frontend4-1 | minor | F-57, F-56, G-4-21 | `frontend/src/outages/errors.ts:75` `const NONE_FREE = /\(([^()]+ are taken as well)\)/` cannot match when the reference holds parentheses. So `:93-94` falls back to `nextReference(reference)`, and `:112` writes "such as <ref>-2" instead of quoting the service. The service accepts such references: `src/main/java/com/atlas/communication/publishing/domain/CreateCommunicationCommand.java:45-50` puts no pattern on `externalRef`. | `node scripts/g4-focus-409.js` (`run-logs/g4-focus-409.txt`) against backend A: publish `vf4 (eu) mvz4o5no` plus its 50 follow-ups (51 × 201), then the same reference again. The 409 has no `suggestedExternalRef` and says "(vf4 (eu) mvz4o5no-2 to vf4 (eu) mvz4o5no-51 are taken as well)". The banner says "…a follow-up needs another External reference, such as vf4 (eu) mvz4o5no-2.", a value the service has just reported as taken. | Anchor the parse (`/\((.+) are taken as well\)\.?$/`) or have the 409 signal "none free" in a field rather than in prose. | `frontend/src/test/errors.test.ts:124-136` covers "past 50 taken" with `INC9` only; add a reference with parentheses. |
| GAP-frontend4-2 | minor (test) | F-66 | Tests with little time margin that depend on real timing. jsdom and user-event tests run close to vitest's default 5 s `testTimeout`; `frontend/vite.config.ts:34-39` sets none. `App.test.tsx:70` alone takes 1.2 s when idle. `useOutageFeed.test.tsx:188-200` waits on a real-clock window of 200 ms (expiry at t0+250, start at t0+450). A timed-out test's pending typing leaks into the next test (`OutageCard.test.tsx:25-50`: the Withdraw test received note "fixe"). | 14 scored `npm test` runs: 05, 06, 07 and A-3 failed under 1-minute load of 16 to 30 on 4 CPUs (timeouts in `App.test.tsx:70`/`:99`, `OutageCard.test.tsx:25`, `PublishOutageForm.test.tsx:29`; an assertion in `useOutageFeed.test.tsx:197`; the cascade in the Withdraw test, `OutageCard.test.tsx:39`, failing at `:49`). All 7 runs at load 7 or below passed. Reproduced locally: `taskset -c 0 npm test -- --maxWorkers=8` times out the two "View in feed" tests (5160 and 5107 ms); with `--testTimeout=20000` the same passes 183/183 (`test-runs.txt`). | Fake timers for the time-window test, plus `testTimeout: 15000` or `userEvent.setup({ delay: null })` for the user-event tests. | A repeat or CPU-starved run in CI, for example `taskset -c 0 npx vitest run --maxWorkers=8` three times. |

**Observations (not gaps):**
1. **Live after a backend restart takes up to 16 s** (the 10 s cap plus the 6 s settle time; measured 13.9 s), because a resume with nothing missed carries no frame. `frontend/README.md:39-46` states the rule but names only the empty-filter case. A first frame the service sends on every subscription would make the badge Live at once.
2. **A page that was open before an outage stays Service degraded after the database returns, until Try again.** Its stream never dropped, so nothing reloads it. This is documented (`frontend/README.md:94-97`), and the alert says to try again in a moment.
3. **The results container has no visible focus indicator and no name.** View in feed, a successful Try again and resolving the last card all focus it, and it has `outline-none` (`frontend/src/outages/OutageFeed.tsx:163`, since G-2-10). The Usability Reviewer asked for this focus target (UX-54); whether it needs an indicator is their call.
4. **Focus drops to `<body>` while a retire call runs.** The busy confirm button is disabled by `loading={busy}`. The answer puts focus back (confirm on failure, the results on success). During the outage that took 5 s (`results/g4-db-outage.jsonl.txt`, G-4-20).
5. **The 409 banner still sits flush with the bottom of a 1280×800 viewport** (top 696, bottom 800), as in iterations 2 and 3.
6. **axe reports `color-contrast` as "incomplete" on the tinted server-error and 409 banners.** My sampler measures 5.31:1 (light) and 5.10:1 (dark) on that text (`results/v5-a11y.jsonl.txt`).
7. **A low dark-theme contrast reading was a timing artefact.** The 4.38:1 that run 1 of g4-focus-409 measured was sampled 200 ms after a theme switch, while the button's 150 ms transition was still running. `probe-dark-contrast` measured rgb(112,112,117) at +200 ms against a settled rgb(174,174,178); dark from first paint passes.
8. **Two harmless effects I hit while testing:**
   - the dev server makes two list GETs on first mount because of React StrictMode; the production bundle makes one;
   - a live `created` frame can arrive before the snapshot, because the service merges its live bus with the snapshot (`FeedUseCase.java:93-108`, documented), and the client dedupes by id and version.

## 5. Not exercised in this sandbox

- **OpenShift/Kubernetes:** there is no cluster. Admission under the restricted-v2 SCC, probes and real pod networking were not exercised. The pod was emulated with docker flags (UID 1000660000:0, read-only root, `--cap-drop ALL`, no-new-privileges, a shared network namespace).
- **UBI base images:** the registry is blocked (`confidence/evidence/environment.md:8`). I used the `fakeapp:ci` and `health-sidecar:ci` images built in this sandbox; the sidecar image comes from the repository's Dockerfile with substitute base images (`confidence/evidence/environment.md:24`).
- **ServiceNow:** no real instance. The ticket-url contract was checked with a configured instance URL (`https://vf4.service-now.com`), and no request goes to ServiceNow.
- **The 24 h event-log TTL:** I did not wait for it. Real expiry was simulated by deleting events in my private database (v7b). The shared log's oldest event expires at 2026-11-02T23:27Z.
- **Other browsers:** only Playwright's Chromium. No Firefox, WebKit/Safari or real mobile devices; narrow layouts were checked by viewport emulation only.
- **Screen readers:** no NVDA, JAWS or VoiceOver. The accessibility tree, live regions, alerts and focus were checked programmatically.
- **Locales and time zones:** only the browser's default locale and time zone.
- **CI:** no GitHub Actions run (no remote access). How the suite behaves on a CI runner is extrapolated from the runs under contention and the single-CPU reproduction.
- **Load:** no load or soak test of the feed or of many concurrent stream subscribers. No real proxy or router timeouts on SSE beyond my `rp.js`.
