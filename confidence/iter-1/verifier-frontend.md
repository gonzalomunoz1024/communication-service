# Frontend Verifier — iteration 1

Code under test: branch `confidence-loop/2026-11-01` at `0e14838` (iteration-1 fixes merged). Shared stack: iteration-1 jar on `:8080`, Vite dev server on `:3000`; private instances for the crash tests (backend `:19150`/`:19151` on Mongo db `fe1-reconnect`, Vite `:3150`, dead-port Vite `:3110`, static builds behind `rp.js` on `:3128`/`:3129`, cross-origin build on `:3127`). Tenant prefix `fe1-`. Evidence: `confidence/evidence/iter-1/frontend/` (scripts, raw JSON per check, console logs, screenshots). Baseline: `confidence/iter-0/verifier-frontend.md` (audited 62).

## 1. Summary

**Verdict: all 26 owned matrix rows PASS; no hard gate tripped. Score 93/100 (+31 vs the audited 62).** The seven iteration-0 failures (F-06, F-16, F-20, F-61, F-65 and the two usability-driven gaps) are fixed with fresh evidence; two low-severity gaps remain (keyboard focus is lost when the last card on the page is resolved; the client never uses the replay path after a real outage, by design). 202 automated browser checks ran, 200 passed; the two failures are the same focus defect seen from two scripts.

| Category | Weight | Score | Why |
|---|---|---|---|
| Builds & static | 10 | 9 | typecheck, lint (new ESLint flat config), build all exit 0; `npm audit --omit=dev` 0; `npm audit` 12 moderate, all `minimatch` under the ESLint toolchain (dev only) |
| Feature completeness | 30 | 29 | 26/26 rows PASS (`results/summary.md`); one deviation: focus falls to `<body>` after resolving the only card (GAP-frontend-1) |
| Automated test health | 20 | 18 | 78/78 tests × 3 runs, no flake, 12 files incl. jsdom component tests, 0 skipped; coverage 74 % statements (feature code `src/outages` 92 %, UI kit `src/ui` 42 %) |
| Integration & contracts | 20 | 19 | identity headers, feed query strings, SSE frames, `Last-Event-ID` and `?lastEventId=` replay, 409/400/401/5xx wording, cross-origin limitation all verified; caveat: resume is only used when the first retry reaches the service (GAP-frontend-2) |
| Resilience & ops | 10 | 9 | SIGKILL → `Reconnecting (n)` with 1/2/4/8 s delays → `Live` by itself after the restart (13.4 s after the service answered, cap 30 s); unreachable wording; Try again reopens the stream; boundary timers at `startsAt`/`expiresAt`; page-cap notice |
| Usability (my observation, defer to the Usability Reviewer) | 10 | 9 | clear states and copy, announcements and focus management, 375 px without overflow; nits: focus loss on the last card, `Starts In 24h` capitalisation in the state tag |
| **Total** | 100 | **93** | |

Hard gates: no FE matrix row fails E2E; tests were added, not weakened (`git diff 493be68..HEAD --stat -- frontend/src/test/`: 11 files, +975/−1, no removed `expect(`, no `.skip/.only/.todo`); `npm audit --omit=dev` reports 0 vulnerabilities (no critical/high); the sidecar gate is not mine. The audited iteration-0 gates on F-16, F-20, F-61 and F-65 are cleared below.

Regressions versus iteration 0: none. Every iteration-0 PASS row passes again with the iteration-0 scripts (updated only for the deliberate behaviour changes listed in `confidence/iter-1/fixes.md`: radiogroup name `Type`, empty-state copy, `Reconnecting (n)`, 409 wording, Withdraw, unreachable wording). No new console error, page error or visual breakage in either theme (`shots/feed-light.png`, `shots/feed-dark.png`, `shots/publish-light.png`, `shots/publish-dark.png`, `shots/publish-errors-light.png`, `shots/publish-done-light.png`, `shots/feed-light-375.png`).

## 2. Commands

All paths below are relative to `confidence/evidence/iter-1/frontend/`. Browser scripts exit 0 and record each check as PASS/FAIL in `results/<script>.json`; `results/summary.md` aggregates them per feature.

| # | command (cwd) | exit | evidence |
|---|---|---|---|
| 1 | `npm run typecheck` (frontend/) | 0 | `static-checks.txt` §typecheck |
| 2 | `npm run lint` (frontend/) | 0 | `static-checks.txt` §lint (no output = clean) |
| 3 | `npm run build` (frontend/) | 0 | `static-checks.txt` §build (266.99 kB JS, 30.80 kB CSS) |
| 4–6 | `npm test` × 3 (frontend/) | 0, 0, 0 | `static-checks.txt` §test run 1..3: 12 files / 78 tests passed each run, 10.45 s / 10.14 s / 11.86 s; names in `test-names.txt` |
| 7 | `npm run test:coverage` (frontend/) | 0 | `static-checks.txt` §coverage: 74.07 % stmts, 67.53 % branches, 76.23 % funcs, 76.25 % lines |
| 8 | `npm audit` (frontend/) | 1 | `static-checks.txt` §audit: 12 moderate (`minimatch <11.0.1` via eslint / typescript-eslint, dev only) |
| 9 | `npm audit --omit=dev` (frontend/) | 0 | `static-checks.txt` §audit omit dev: 0 vulnerabilities |
| 10 | `VITE_API_BASE=http://127.0.0.1:8080 npx vite build --outDir <scratch>/dist-xorigin` (frontend/) | 0 | `build-xorigin.txt` |
| 11 | `node t1-shell-theme-form.js` (shared :3000/:8080) | 0 | `run-logs/t1.txt`, `results/t1-shell-theme-form.json`: 55 checks, 0 failed |
| 12 | `node t2-publish-errors.js` (shared + dead-port :3110 + rp.js :3128) | 0 | `run-logs/t2.txt`, `results/t2-publish-errors.json`: 37/0 (two earlier runs superseded, see note) |
| 13 | `node t3-feed.js` (shared) | 0 | `run-logs/t3.txt`, `results/t3-feed.json`: 49 checks, 1 failed (the failure is GAP-frontend-1) |
| 14 | `node t4-reconnect-sigkill.js` (private :19150/:19151 behind Vite :3150) | 0 | `run-logs/t4.txt`, `results/t4-reconnect-sigkill.json`: 9/0; `results/t4-reconnect-timeline.txt`, `results/t4-sse-frames.json` |
| 15 | `node t4b-replay-in-browser.js` (private :19150 behind rp.js :3129) | 0 | `run-logs/t4b.txt`, `results/t4b-replay-in-browser.json`: 6/0; `results/t4b-replay-timeline.txt`, `run-logs/rp-3129-replay-proxy.txt` |
| 16 | `node t5-a11y.js` (shared) | 0 | `run-logs/t5.txt`, `results/t5-a11y.json`: 30/0; `results/t5-axe-violations.json`, `results/t5-contrast-samples.json` |
| 17 | `node t6-xorigin.js` (static :3127 + shared) | 0 | `run-logs/t6.txt`, `results/t6-xorigin.json`: 3/0 |
| 18 | `node t7-iter1-gaps.js` (shared) | 0 | `run-logs/t7.txt`, `results/t7-iter1-gaps.json`: 11/0; `shots/*.png` |
| 19 | `node t8-focus-after-resolve.js` (shared) | 0 | `run-logs/t8.txt`, `results/t8-focus-after-resolve.json`: 2 checks, 1 failed (GAP-frontend-1) |
| 20 | `curl -N --max-time 17 /v1/feed/stream?tenantId=…` (shared :8080) | 0 | `sse-frames-keepalive.txt` |
| 21 | `git diff 493be68..HEAD --stat -- frontend/src/test/` | 0 | quoted in §1 (test-weakening check) |

Note on superseded runs (kept in `run-logs/*-superseded-*.txt`): t2 run 2 failed one check because my loop reused one ticket number for several notices in one tenant, which the service rightly rejects as a duplicate `externalRef` (409) — a test-design error, fixed by using one number per notice. t4 run 1 and t4b run 2 failed only because `route.request().allHeaders()` does not show the `Last-Event-ID` header Chromium adds to an EventSource retry, and because `context.setOffline(true)` does not cut an already open SSE connection; the reruns read the headers on the wire through CDP (`Network.requestWillBeSentExtraInfo`) and cut the stream at the proxy (`rp.js /__drop`). No product behaviour differed between runs.

## 3. Feature verdicts

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-01 | PASS | t2: UI publish → 201 + `Location`, `ACTIVE`, audience `CUSTOMERS`; t3: `created` frame arrives live | |
| F-02 | PASS | t2: draft → `Draft saved`, no View in feed; `GET /v1/feed` absent, permalink 404; `/publish` → 200 ACTIVE, again → 409; the published draft appears live | |
| F-06 | PASS | t3: Resolve → `POST /retire {actor, note}` 200, history `ACTIVE -> RETIRED: fixed by failover`; already retired elsewhere → 200; **EXPIRED (past `expiresAt`, sweeper not run) → 409** `already expired; retiring would rewrite history` | iteration-0 clause fixed (backend) |
| F-07 | PASS | t2: forced OUTAGE@INFO → 400 shown with `The service rejected this.`; blank title + 25 services → 400 naming `title` and `affectedServices` | |
| F-09 | PASS | t2: `inc0012345` → `{servicenow, INC0012345}`, `externalRef` = number, chip; t3: ticket with url → `a[target=_blank][rel~=noreferrer]`; t2 combos: one notice per ticket number per tenant (a reused number is a duplicate `externalRef` → 409, see superseded run) | |
| F-14 | PASS | t3: query strings per filter, `size=500` → 100, `page=-1`/`size=0`/blank tenant → 400, paging math (`hasNext`) | |
| F-15 | PASS | t3: server feed excludes at `expiresAt`, permalink `EXPIRED`; **UI drops the card 149 ms after `expiresAt` by its own timer**, and 512 ms after with Live updates off (no GET, no stream) | G-1-16 |
| F-16 | PASS | t3: GET side as before; **a future-dated OUTAGE published while the feed is open is not listed; MAINTENANCE 3 d out is listed under Upcoming, 10 d out is not; a reload agrees** (`liveTitles == reloaded == serverTitles`) | G-1-11, iteration-0 gate cleared |
| F-18 | PASS | `sse-frames-keepalive.txt`: `:connected`, `id:`/`event:snapshot`/`created` lower-cased, `:keepalive` within 17 s; `results/t4-sse-frames.json`, `results/t4b-replay-timeline.txt`: snapshot/created/retired frames with ascending ids applied by the UI | see GAP-frontend-3 for the snapshot id lag |
| F-20 | PASS | t4: `GET /v1/feed/stream?lastEventId=9` on the restarted instance replays `created` 10 + `retired` 11, no snapshot; t4b (a): browser retry with `Last-Event-ID: 15` → replay `created#16`, no snapshot; t4b (b): `?lastEventId=16` → replay `created#17`, no snapshot | iteration-0 500 gone |
| F-27 | PASS | t6: `X-Client-Id: communication-frontend` on every fetch, `?clientId=` on the stream, all 200; t2: header stripped → 401 text shown, `bad id!` → 400 text shown | |
| F-52 | PASS | t1 (13 checks): title per tab, tenant persisted in `comm-tenant`, deep link `#/publish`, badge = Active now count | |
| F-53 | PASS | t1 (7): toggle persists `atlas-theme`, no flash (class set at `readyState=interactive`), follows OS in system mode; `shots/*-dark.png` | |
| F-54 | PASS | t1 (21): every field reaches the POST body (local → UTC, services split/deduped, ticket upper-cased, audience, ref, draft); Clear keeps tenant/publisher/type | |
| F-55 | PASS | t1 (14): every rule inline with `role=alert` + `aria-invalid`, Timing opens on a timing error, nothing sent while invalid; t7 (6): **first invalid field focused and scrolled into view (Title, Severity segment, Ends, ServiceNow incident), summary `3 fields need attention:` with one button per field, buttons move focus** | G-1-12 |
| F-56 | PASS | t2 (14): busy state, confirmation card per type, heading focused, Publish another/View in feed, publisher remembered, every type with and without a ticket; t7 (3): **View in feed for INCIDENT/MAINTENANCE/CHANGE published to another tenant lands on that tenant's feed filtered to the type, item listed (Upcoming for the scheduled one)** | G-1-13 |
| F-57 | PASS | t2: 409 → `The service rejected this. A notice with the reference <ref> already exists for tenant <tenant> …` (no raw `duplicate externalRef`); 500 JSON → text with prefix; **502/503/504 and connection failure → the unreachable wording, no prefix, no status line**; dead backend through the dev proxy (502) and behind rp.js (502) → `Couldn't load the feed` + unreachable wording, **Try again re-requests the feed and reopens the stream within 400 ms**; resolve 409/503 under the confirm row | G-1-14, G-1-16 |
| F-58 | PASS | t3: GET on load and on every filter change, stale response ignored, sections with counts, sort order, Refresh; **103 items → 100 shown + `Showing the first 100 of 103 notices. Narrow the filters to see the rest.`** | G-1-16 |
| F-59 | PASS | t3: `Choose a tenant`, 3 skeletons in `aria-busy`, error + Try again, **new empty-state copy for Outage / Maintenance / All types, naming `<tenant> on <service>`**; t2: badge never `Live` while the backend is down (`Reconnecting (n)`) | |
| F-60 | PASS | t3 (8): `created`/`updated`/`retired` applied without a GET; scheduled → Active now 132 ms after `startsAt` (UI timer, sweeper frame confirms); Live switch → Paused / Live and the snapshot brings the missed item; EventSource URL `?tenantId&clientId=` | |
| F-61 | PASS | t4: SIGKILL → `Reconnecting`, `Reconnecting (1)…(5)` with gaps 1 / 2 / 4 / 8 / 16 s; restart → `Live` by itself 13.4 s after the service answered; notice published after the restart arrives live; publish + retire through a second instance while down → list converges (snapshot + one reload); t4b: browser retry carries `Last-Event-ID` on the wire (CDP and proxy log), 502 to it → client `?lastEventId=` after 1 s → `Live`; exactly one list reload per recovery, none in the idle window | G-1-3, iteration-0 gate cleared; see GAP-frontend-2 |
| F-62 | PASS (one defect) | t3: inline confirm, note + actor in the audit, idempotent resolve, **announcement `Resolved “…”. It has left every consumer's feed.` in the `role=status` region, Withdraw on a not-started item with its own copy and `Withdrew “…”` announcement**; t8: focus on the list container after resolving one of two cards, **but on `<body>` after resolving the only card** | G-1-15/G-1-16; GAP-frontend-1 |
| F-63 | PASS | t3: rail/tags/chip/externalRef/body/services/times/publisher/`Updated`; Withdraw instead of Resolve before start; `shots/feed-light.png` | cosmetic: `Starts In 24h` in the state tag |
| F-64 | PASS | t6: cross-origin static build → CORS error state (documented limitation, preflight without ACAO); same-origin dev proxy carries header + `clientId`; t2/t4b: same-origin static build behind rp.js works incl. SSE | |
| F-65 | PASS | t5: **axe wcag2a/2aa/21a/21aa: 0 violations in all six scans (feed, publish, publish-with-errors × light/dark), 24 rules passing each; best-practice also 0**; sampled ratios: tertiary text 4.66:1 (light, on `#f5f5f7`) / 5.93:1 (dark) and up, nothing below AA (`results/t5-contrast-samples.json`); labels, roles (`Type`/`Severity` radiogroups), roving tabindex, arrow keys, switch keys, focus ring, `h1`, `getByLabel('Service')`, live region, 375 px without overflow | G-1-10/G-1-15, iteration-0 gate cleared |
| F-66 | PASS | static-checks: typecheck/lint/build 0; 78/78 × 3; coverage report; `test-files.txt`: 12 files incl. `App`, `OutageCard`, `OutageFeed`, `PublishOutageForm`, `useOutageFeed` component tests; `npm run lint` exists and is clean | G-1-17 |

## 4. Gaps

| ID | Severity | Feature IDs | Root cause | How reproduced | Suggested fix | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-frontend-1 | low | F-62, F-65 | `frontend/src/outages/OutageFeed.tsx:75-80`: `resolve()` calls `feed.remove()` and then `list.current?.focus()`, but the list container (`OutageFeed.tsx:158`, `div tabIndex=-1`) is rendered only while items exist; when the resolved card was the last one the container unmounts on the next render and focus falls to `<body>` (the `role=status` announcement still fires) | `scripts/t8-focus-after-resolve.js`: tenant with one card, Resolve with the keyboard → `document.activeElement` = `body`; with two cards → the list div (`results/t8-focus-after-resolve.json`, also `results/t3-feed.json` check "focus moves to the list") | keep one stable focus target across the list/empty states (e.g. a wrapper `div tabIndex=-1` around both the list and the `All clear` state, or focus the filter bar when the list empties) | `OutageFeed.test.tsx`: resolve the only item and assert focus is not on `document.body` |
| GAP-frontend-2 | low (design note) | F-61, F-20 | `frontend/src/outages/api.ts:174-179`: a resume attempt that never opened clears `lastSeq`, so after any outage where the first `?lastEventId=` attempt is refused (every real restart: the proxy answers 502 until the service is back) all later attempts are fresh and recovery is by snapshot + one list reload; the replay path only runs when the first retry reaches a live service | `results/t4-reconnect-timeline.txt`: attempt #5 `?lastEventId=1` → 502, #6–#9 without it, recovery stream = `snapshot` frames (+ 1 GET); `results/t4b-replay-timeline.txt`: replay works when the retry reaches the service | not a defect (the list converges, verified); if replay across restarts is wanted, keep `lastSeq` on a non-200 and rely on the service's own fallback to a snapshot for ids it no longer holds (F-20) | `stream.test.ts`: after a non-200 to a resume, the next attempt still carries `lastEventId` (only if the behaviour is changed) |
| GAP-frontend-3 | low (backend observation, FE tolerates it) | F-18, F-20 | the snapshot frame's `id` can lag the latest event of the items it contains: `sse-frames-keepalive.txt` shows `snapshot` id 1265 followed by `created` id 1266 for the same notice; `results/t4b-replay-timeline.txt` shows snapshot id 11 for `seed a` whose `created` is seq 12, so a resume from 11 replays `created#12` again | open the stream right after a publish and read the ids; resume from the snapshot id | for the Backend Verifier: stamp the snapshot with the position after the items were read (or the max `seq` among them); the UI upserts by id and ignores older `updatedAt`, so duplicates are harmless today | backend `FeedUseCase` test: snapshot id ≥ max seq of the items it carries |
| GAP-frontend-4 | cosmetic | F-63 | the state tag renders `Starts In 24h` (title-cased) while the footer reads `Starts in 24h` (`shots/feed-light.png`): `OutageCard.tsx:48` passes `Starts in …` to `StateTag`, and `frontend/src/ui/Tag.tsx:95` applies Tailwind `capitalize` to every tag | open any feed with an upcoming item | drop `capitalize` for multi-word tag text (or title-case the single-word tags in code instead of CSS) | component snapshot/text assertion on `OutageCard` for an upcoming item |
| GAP-frontend-5 | info | F-66 | coverage of `src/ui` is 42 % statements (`format.ts` 21.6 %, `Segmented.tsx` 27.8 %, `Tabs.tsx` 29.4 %, `PageHeader.tsx` 0 %) while `src/outages` is 92 % (`static-checks.txt` §coverage) | `npm run test:coverage` | tests for `format.ts` (relativeTime/longDate edge cases) and keyboard behaviour of `Segmented`/`Tabs` (currently only proven in the browser by t5) | n/a |
| GAP-frontend-6 | info | F-66 | `npm audit` (dev): 12 moderate, all `minimatch <11.0.1` (GHSA-g3hv-75wg-m249, ReDoS) under `eslint`/`typescript-eslint`; the shipped bundle has no dependency on it (`npm audit --omit=dev`: 0) | `static-checks.txt` §audit | bump the ESLint toolchain when a release with `minimatch ≥ 11.0.1` is available (`npm audit fix --force` proposes a major jump) | n/a |

## 5. Not exercisable here

- A real OpenShift Route / HAProxy in front of the UI: the production-shaped SSE behaviour (ending the browser's response when the upstream dies, 502 while the service restarts) is emulated with `scripts/rp.js`; the Vite dev proxy now behaves the same (verified in t4).
- Screen readers: the live region, roles, names and focus order are checked structurally (axe + DOM), not with NVDA/VoiceOver.
- `VITE_CLIENT_ID` misconfiguration at build time: covered by rewriting the header in flight (t2), not by a separate build.
- Clock skew between browser and service for the boundary timers (`startsAt`/`expiresAt`): both ran on the same host.
