# Usability review, iteration 4

| | |
|---|---|
| Reviewer | Usability Reviewer, iteration 4 (the last iteration). Grades only: nothing in the repository changed except this report and its evidence folder (`git status --porcelain` lists only untracked `confidence/` paths) |
| Seats | (a) SRE publishing and resolving notices in the UI at 1280×800 and 390 px, keyboard only, screen-reader mindset; (b) developer integrating from the root `README.md` alone (cookbook, Swagger UI and every example in it, error texts, 409/400/401/503 wording, `externalRef` / `suggestedExternalRef` / `expectedVersion`, unknown-field rejections); (c) platform engineer onboarding a team from `sidecar/README.md` alone (Kustomize, Helm with `extraEnv`, plain YAML and its ConfigMap, proxies, "my service does not show up", `CS_LOG_LEVEL`, start-up errors) |
| When | 2026-11-02, walks 10:17–11:09 UTC |
| Code | `confidence-loop/2026-11-01` at `d10369b`. Its code is that of `1cd3f13`, the same as the brief's `aa37365`: `git diff --stat 1cd3f13 HEAD -- . ':!confidence'` is empty |
| Shared stack | backend :8080, frontend :3000, pod `app` + `sidecar`. Read freely; written only under `ux4-*` tenants, plus one verbatim cookbook call to `vmforge` that answered 409 and wrote nothing. Never stopped, restarted or reconfigured; nothing `docker exec`ed into `app` or `sidecar` |
| Private stack (torn down) | **A**: `communication-service-iter4.jar` on :19600, database `ux4` on `mongo7`, sweeps 1 s / 2 s, stale grace 0; Vite dev :3600 → A. **B**: the same jar on :19601 against its own `ux4-mongo` (127.0.0.1:19617, database `ux4b`); Vite dev :3601 → B; `vite preview` :3602 → B, serving the production bundle `frontend/dist` (built by someone else at 10:05 UTC, not touched). Emulated pods: `ux4-app` + `ux4-sidecar*` in the app's network namespace under `--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges` (`private-stack.txt`) |
| Evidence | `confidence/evidence/iter-4/usability/`: screenshots `shots/NN-*.png`, transcripts `*.txt`, JSON step logs, every script under `scripts/`. `[step]` below names a line of the run file it is cited with; the JSON file of the same name holds the untruncated record |

Severity scale (unchanged since iteration 2): **blocker** ≥ 30 (task impossible unaided), **major** 10 (done only by guessing or
after a wrong turn), **minor** 3 (noticeable, recoverable without a wrong turn), **cosmetic** 1 (polish).

## 1. Summary verdict and scores

| Surface | blocker | major | minor | cosmetic | deductions | score | iter-3 | Δ | hard gate |
|---|---|---|---|---|---|---|---|---|---|
| **UI** (SRE in the browser) | 0 | 0 | 4 (UX-65, 66, 67, 70) | 1 (UX-69) | 13 | **87** | 87 | 0 | none |
| **API** (developer with README, curl, Swagger UI) | 0 | 0 | 0 | 2 (UX-68, 71) | 2 | **98** | 90 | +8 | none |
| **Sidecar onboarding** (platform engineer) | 0 | 0 | 0 | 0 | 0 | **100** | 95 | +5 | none |

Provisional usability category (out of 10), folded as in the iteration-2 and iteration-3 audits:
**backend 9.8** (API), **frontend 8.7** (UI), **sidecar 10.0** (onboarding), **E2E 8.7** (the UI score, the lowest surface).
This seat grades only the usability category; the other five rubric categories and the weighted totals belong to the service
verifiers, as in iterations 2 and 3. The sidecar's 100 means no finding in what this sandbox can exercise; the cluster-only steps
in §5 are not verified and are not part of that number.

**Verdict.** In all three seats every task can be completed unaided: no blocker, no major. Iteration 3 left 14 items open
(UX-42 residual and UX-52 … UX-64). All 14 are closed, with evidence in §4.3. UX-59 is closed for counted references; for
date-shaped references the advice regressed, which is graded as new (UX-67, UX-68).

The iteration-4 fixes are visible from the seat:
- **UI.**
  - During a database outage no page shows "Live" next to an error or a skeleton. The badge says "Service degraded" or "Reconnecting (n)".
  - The error is a `role=alert`, announced again on each failure.
  - A page opened during the outage recovers by itself: 9.7 s after Mongo returned, and 5.2 s after a pause ended.
  - The 409 banner names the first free reference (-2, then -3, then -4) and says so when 50 follow-ups are taken.
  - "View in feed" focuses the results, and Escape cancels the inline confirmation.
- **API.**
  - Misspelled fields are rejected on monitor registration as well, and every unknown field is named in one 400: all 10 server fields of a GET document PUT back.
  - The OpenAPI document declares the real success codes and a shared 400/404/503 with examples.
  - Every Swagger example passes as offered.
  - The 409 carries `suggestedExternalRef`.
  - The cookbook body is plain text.
- **Sidecar.**
  - The plain-YAML row names the ConfigMap.
  - `extraEnv` is printed with its shape.
  - Proxies are documented and behave as written.
  - Zero or negative durations exit 2.
  - The monitor summary quotes the pod's own words.

What still costs a user, none of it blocking:
- **UI**
  - A page that was open before an outage, and on which Refresh was pressed during it, stays on "Couldn't load the feed" under "Service degraded" after the database is back. This lasted the full 62 s observed; its own text says "It recovers on its own". A notice published after recovery is not shown; only Try again brings the list back (UX-65).
  - Refresh pressed from the keyboard drops focus to `<body>`, and a successful refresh announces nothing (UX-66).
  - A duplicate date-shaped reference such as `payments-2026-11-12` gets the advice `payments-2026-11-13`, which is another date. Iteration 3 advised `payments-2026-11-12-2` (UX-67).
  - On a 390 px phone, Shift+Tab lands on "Minimum severity" entirely hidden under the sticky header (UX-70).
  - An empty feed says "Connecting" (amber, pulsing) for about 6 s after every open or filter change (UX-69).
- **API**
  - The 409's sentence and `suggestedExternalRef` give the same date-shaped advice (UX-68).
  - "Validation lists every failing field at once" holds only within one kind of check. Unknown fields are reported first, then constraints, then domain rules one at a time (UX-71).
- **Sidecar:** nothing deducted.

Four of the seven new items predate iteration 4:
- **UX-65:** the same reload triggers and error branch are at `4a0e84e:frontend/src/outages/useOutageFeed.ts:99-105,137` and `OutageFeed.tsx:143`.
- **UX-66:** `Button.tsx` disables a loading button at `908598a` and at `4a0e84e`.
- **UX-70:**
  - `git log -S scroll-padding -- frontend` is empty.
  - `Button.tsx`, `AppHeader.tsx` and `index.css` are unchanged from `4a0e84e` to `1cd3f13`.
  - Iteration 3's Shift+Tab run covered desktop only: `confidence/evidence/iter-3/usability/ux3-focus-reverse-run.txt` holds one 1280 px sequence. I missed it then.
- **UX-71:** the README sentence is present at `4a0e84e`.

The other three come from iteration-4 changes:
- **UX-67 and UX-68:** G-4-11's `COUNTED_FOLLOW_UP`, together with G-4-21 preferring the service's value.
- **UX-69:** G-4-17's `STREAM_SETTLE_MS`.

**Hard gates from this seat: none tripped.**
- **Non-root, restricted-v2.** Every emulated pod ran the sidecar as UID 1000660000 with `--read-only --cap-drop ALL --security-opt no-new-privileges` (`scripts/sidecar-pod4.sh`, `sidecar-pod4-container-info.txt`). The image's user is 1001, and the image has no shell (`sidecar-manifests4.txt` S7, S9).
- **Tests.** I skipped, changed or loosened no test. The only test command I ran was the README's `go test ./...`: 7 packages ok.
- **Flows.** Every end-to-end flow in my matrix rows completes. UX-65 is a recovery defect in one page state that the page's own Try again resolves; I grade it minor, not a failing flow.
- **Security findings.** Dependency and image scans were not run from this seat; they belong to the service verifiers.

## 2. Commands run

| # | command | exit code | evidence file |
|---|---|---|---|
| 1 | Private stack: `docker run -d --name ux4-mongo -p 127.0.0.1:19617:27017 mongo:7.0`; `java -jar …/communication-service-iter4.jar --server.port=19600 --spring.mongodb.uri=mongodb://127.0.0.1:27017/ux4 --communication.health.sweep-interval-ms=1000 --communication.sweep.interval-ms=2000 --communication.health.stale-grace-after-start-ms=0` (A); the same jar `--server.port=19601 --spring.mongodb.uri=mongodb://127.0.0.1:19617/ux4b` (B); `COMM_BACKEND=… vite --port 3600` / `3601` and `vite preview --port 3602` from `frontend/` (nothing installed there) | 0 (A and B readiness 200) | `private-stack.txt` |
| 2 | `git rev-parse --short HEAD`; `git diff --stat 1cd3f13 HEAD -- . ':!confidence'`; `git log -S scroll-padding -- frontend`; `git show 4a0e84e:…` / `908598a:…` (`Button.tsx`, `useOutageFeed.ts`, `OutageFeed.tsx`, `README.md`); `git status --porcelain` | 0 | quoted in §1 and §4 |
| 3 | `node scripts/ux4-ui.js`: the SRE walk on the shared stack, tenant `ux4-sre`. Covers first visit, typing a tenant, publish, five 409 variants, cards, resolve and withdraw with Escape, mocked 5xx/abort, arrow keys, both themes, iPhone 14 at 390 px, 10 axe scans, the accessibility tree and a live-region log | 0 | `ux4-ui-run.txt`, `ux4-ui-log.json`, `aria-*.txt`, shots `01`–`17` |
| 4 | `node scripts/ux4-keyboard-only.js`, tenant `ux4-kbd`. Keyboard only: publish, View in feed, Escape in the note, Resolve against a mocked 500, Resolve again, Refresh (working and against a mocked 503) | 0 | `ux4-keyboard-only-run.txt`, `.json`, `18`–`20` |
| 5 | `node scripts/ux4-third-notice.js`, tenant `ux4-third`: three notices for one incident through the form, then a duplicate date-shaped maintenance reference | 0 | `ux4-third-notice-run.txt`, `.json`, `21`, `21c` |
| 6 | `node scripts/ux4-none-free.js`, private A, tenant `ux4-none-free`: 51 notices `INC4900001` … `-51`, then the 409 and the banner | 0 | `ux4-none-free-run.txt`, `.json`, `21d` |
| 7 | `bash scripts/api-walk4.sh`, shared :8080, tenant `ux4-api`. Covers identification, cookbook example 1 verbatim, retry and follow-ups, feed/stream/resume, PUT and `expectedVersion`, read-modify-write, retire, reads, 41 error-text probes (misspelled fields, nulls in arrays, wrong types) and health monitoring | not recorded (the transcript runs to its last section, the cleanup) | `api-walk4.txt` |
| 8 | `bash scripts/api-probes4b.sh`, private A: C5r2 redone, mixed validation, F-34 success path | 0 | `api-probes4b.txt` |
| 9 | `bash -v scripts/cookbook-literal.sh`, twice: the README cookbook pasted literally, host set to A, `curl -N` wrapped in `timeout 3` | 1; 1 (the last line, `<monitorId>`, is a placeholder bash reads as a redirection; every command before it answered) | `cookbook-literal4.txt` |
| 10 | `node scripts/swagger4.js` (private A, tenant `acme`): every example in Swagger UI tried as offered, before and after Authorize. Runs 1–2 failed in my script, not the product (selectors); run 3 read the wrong table; `swagger-probe.js` found the selectors | 1, 1, 0, **0** | `swagger4-run.txt`, `swagger4.json`, `22`, `23`, `23b` |
| 11 | `python3` over `/v3/api-docs` of :8080 and A: every operation's responses, `components.responses`, field descriptions | 0 | `openapi-responses4.txt` |
| 12 | `bash scripts/sidecar-manifests4.sh`. Covers the README's attach table; Kustomize classic, native, Image and Debugging; Helm alone, then the three pieces pasted with the native and `extraEnv` variants; plain YAML; bad configuration (S7); README Build (`go test ./...`, `go build`); image labels. Uses kustomize, helm 3.16.3 and `kubeconform -strict` (1.29) | 0 | `sidecar-manifests4.txt` |
| 13 | S5(b) redone by hand: the include without `nindent`, at column 8 | `helm template` 0, lint 0, kubeconform invalid (as the README warns) | `helm-include-variants4.txt` |
| 14 | `bash scripts/sidecar-pod4.sh` (calls `auto-notice4.js`). The emulated pod on A under restricted flags covers: sidecar first, then the app; the README's service-side checks; app stop and start; a failing component; debug logging; SIGTERM; causes 1 and 3; a dead `HTTP_PROXY`, then `NO_PROXY` | 0 | `sidecar-pod4.txt`, `sidecar-pod4-container-*.txt`, `25-*` |
| 15 | `node scripts/ux4-dbdown.js` on B. With feeds open on :3601, `docker stop ux4-mongo` for 85 s, then `docker pause` for 56 s. Captures API, UI (untouched, refreshed, fresh and publishing pages) and a sidecar against B | 0 | `ux4-dbdown-run.txt`, `ux4-dbdown-log.json`, `sidecar-b-container.txt`, `backend-19601-outage-warn.txt`, `26`–`29b` |
| 16 | `node scripts/ux4-stuck-error.js` on B: a page open before the outage, Refresh during it, then a notice published after recovery; dev and production pages compared | 0 | `ux4-stuck-error-run.txt`, `.json`, `29c` |
| 17 | `node scripts/ux4-reconnect.js`: SIGKILL of B (pid 29992) under open dev, production and empty feeds, restart (pid 22977), publish right after readiness | 0 | `ux4-reconnect-run.txt`, `ux4-reconnect-log.json`, `30`, `31` |
| 18 | `node scripts/ux4-contrast-focus-card.js`: axe's undecided contrast nodes checked by hand (shared :3000, read-only); focus under the sticky header (A, tenant `ux4-focus`); the README example body as a card (A, `vmforge`) | 0 | `ux4-contrast-focus-card-run.txt`, `.json`, `24` |
| 19 | `node scripts/ux4-focus-reverse-phone.js`: phone Shift+Tab with 700 ms and 1500 ms settles, `elementFromPoint` at each stop (A, tenant `ux4-focus2`) | 0 | `ux4-focus-reverse-phone-run.txt`, `.json`, `34-phone-shift-tab-700ms-step9` |
| 20 | `node scripts/ux4-console-sweep.js`: every console message over one full path, dev :3600 and production :3602 | 0 | `ux4-console-sweep-run.txt`, `.json` |
| 21 | `node scripts/ux4-identity.js`: what the UI sends to identify itself, dev and production | 0 | `ux4-identity-run.txt` |
| 22 | `bash scripts/hung-db-timing.sh` on B: one call per `docker pause ux4-mongo`, issued alone | 0 | `hung-db-timing.txt` |
| 23 | Teardown: kill my 3 Vite and 2 java processes by pid after checking each command line, `docker rm -f -v ux4-mongo`, remove scratch builds, check the shared stack | see §7 | §7 |

## 3. Feature verdicts from the three seats

| ID | verdict | evidence | note |
|---|---|---|---|
| F-52 app shell, tenant | PASS | `ux4-ui-run.txt` `[landing]`, `[type-tenant]`, `[type-then-tab]`, `[clear-tenant-850ms]`; `01`, `02` | first visit: empty field, a prompt, "Waiting for a tenant"; one GET and one stream per typed tenant; Tab out commits in 380 ms |
| F-53 theme | PASS | `[theme-after]`, `[dark-409]`, `[feed-dark]`; `11`, `12`, `17` | 0 axe violations in the three dark scans |
| F-54 publish form fields | PASS | `ux4-keyboard-only-run.txt` `[form-walk]`; `[segmented-arrow]`, `[tabs-arrow]` | 14 named stops with a visible ring from the Publish tab to submit |
| F-55 client validation | PASS | `[submit-empty]`, `[bad-ticket]`, `[severity-floor]`, `[maintenance-needs-end]`, `[phone-submit-empty]`; `03`, `15` | "2 fields need attention: Title (Title is required), Publisher (Publisher is required)."; focus on the first |
| F-56 publish submit | PASS | `[publish-success]`, `[publish-another-focus]`, `[maintenance-success]`, `[draft-saved]`, `[view-in-feed]`; `04`, `18` | View in feed focuses the results, named "ACTIVE NOW 4" (UX-54 closed) |
| F-57 server errors | PASS | `[duplicate-409*]`, `[variant-*]`, `[feed-503-db]`; `ux4-third-notice-run.txt`; `ux4-none-free-run.txt`; `05`, `05b`, `10`, `10b`, `21`, `21d` | the banner names the first free reference, and says when none of 50 is free; **friction** UX-67 |
| F-58 feed tab | PASS | `[feed-all-types]`, `[cap-notice]`, `[empty-filter]`; `ux4-identity-run.txt`; `06` | "Showing the first 100 of 103 notices. Narrow the filters to see the rest."; **friction** UX-66 (Refresh) |
| F-59 feed states | PASS | `[empty-no-tenant]`, `[empty-fresh-all-types]`, `[feed-503-db]`, `[try-again-*]`, `[phone-feed-error]`; `ux4-dbdown-run.txt`; `ux4-stuck-error-run.txt`; `16c`, `26`–`29c` | every state appears and the error is announced; **friction** UX-65 (an error that outlives the outage) |
| F-60 live updates | PASS | `[live]`; `ux4-reconnect-run.txt` `[open-*]` | created 864 ms and retired 833 ms after the API call; **friction** UX-69 |
| F-61 reconnect | PASS | `ux4-reconnect-run.txt`, `ux4-reconnect-log.json`; `30`, `31` | "Reconnecting", then (1) … (6) through a SIGKILL; "Live" and the new card 9.05 s after readiness, with no manual refresh |
| F-62 resolve / withdraw | PASS | `[resolve-*]`, `[withdraw-*]`, `[after-*]`, `[phone-resolve-*]`; `ux4-keyboard-only-run.txt` `[escape-in-note]`, `[resolve-fails]`, `[resolve-retry]`; `08`, `09`, `14`, `19` | Escape cancels from the note and from the button, desktop and phone (UX-55 closed); a failed resolve keeps the card, shows the error and returns focus |
| F-63 cards | PASS | `[card-anatomy]`, `[maintenance-card]`; `ux4-contrast-focus-card-run.txt` `[readme-body-card]`; `06`, `07`, `24` | the README's example body renders as plain text (UX-61 closed) |
| F-64 identity, base URL | PASS | `ux4-identity-run.txt` | `X-Client-Id: communication-frontend` on the list GET, `?clientId=communication-frontend` on the stream, dev and production bundle |
| F-65 accessibility | PASS | 10 × `[axe:*]` (0 violations); `aria-*.txt`; `ux4-contrast-focus-card-run.txt`; `[form-walk]`, `[tabs-arrow]`, `[segmented-arrow]`, `[phone-feed]` | every clause holds; the feed error is `role=alert` (UX-53 closed); axe's undecided contrast node checked by hand (§6); **friction** UX-70, UX-66 |
| F-91 sidecar flow (UI side) | PASS | `sidecar-pod4.txt` P5–P7b; `25-*` | OUTAGE in the feed 7.5 s after the app stops, gone 10.7 s after it returns; a failing-component notice after 8.4 s; desktop and phone |
| F-92 failure paths (UI and API side) | PASS | rows 15–17 and 22 of §2; `api-walk4.txt` E0; `cookbook-literal4.txt` | Mongo stopped: 503 `{"error":"database unavailable"}` in 5.0 s, readiness DOWN in 815 ms, liveness UP, ready 1.5 s after Mongo returns; backend killed: Reconnecting, then Live; an unknown `lastEventId` gives a snapshot; **friction** UX-65 |
| F-01, F-10 cookbook | PASS | `cookbook-literal4.txt` runs 1 and 2; `api-walk4.txt` C1–C3 | run 1 publishes; run 2 answers 409 with `suggestedExternalRef` `INC0012345-3` for both ticket examples; maintenance defaults hold |
| F-05 PUT `expectedVersion` | PASS | `api-walk4.txt` C5, C5r; `api-probes4b.txt` P1 | a GET document PUT back names every server field at once; dropping them and sending the version read answers 200, version 1 |
| F-09 ticket | PASS | `api-walk4.txt` C1', E10; `[duplicate-409-lowercase-ticket]` | a lower-case ticket is normalised; a bad number is named with the expected form |
| F-20 resume | PASS | `api-walk4.txt` C4; `cookbook-literal4.txt` | `lastEventId=2288` resumes at 2289; an id the log does not hold gives a snapshot, as the README says |
| F-27 identification | PASS | `api-walk4.txt` E0; `swagger4-run.txt` `tryBeforeAuthorize` | the 401 names the header and the `?clientId=` alternative; a bad id gets a 400 naming the allowed characters |
| F-28 error contract | PASS | `api-walk4.txt` E1–E18, H8–H8c; `api-probes4b.txt` P2–P3 | every 4xx is `{"error"}` naming the field, the value and the rule; **friction** UX-71 |
| F-29 OpenAPI / Swagger UI | PASS | `openapi-responses4.txt`; `swagger4-run.txt`, `swagger4.json`; `22`, `23`, `23b` | real success codes, a shared 400/404/503, every example passes as offered (UX-57, UX-58 closed) |
| F-30 database down | PASS | `ux4-dbdown-run.txt`, `ux4-dbdown-log.json`, `hung-db-timing.txt`, `backend-19601-outage-warn.txt` | graded against the README's "When Mongo is down" (the matrix text predates the actuator): 5.0 s stopped; paused, one call: 15.0 s write, 20.0 s read; 58 WARN, 0 ERROR, 0 stack traces |
| F-31 register a monitor | PASS | `api-walk4.txt` H1–H8c; `api-probes4b.txt` P2 | misspelled policy fields answer 400 naming every one (UX-56 closed) |
| F-34 probe now | PASS | `api-probes4b.txt` P4; `api-walk4.txt` H2 | a probed monitor answers 200 with `lastStatus` UP, `lastProbeAt` set, "UP (HTTP 200)"; push-only answers 409 saying why |
| F-47 rollup message for starting pods | PASS | `sidecar-pod4.txt` P2, P13 | the summary quotes the pod's own words (UX-63 closed) |
| F-67 sidecar configuration | PASS | `sidecar-manifests4.txt` S7 | every bad value named at once, exit 2; zero and negative durations rejected |
| F-76 graceful shutdown | PASS | `sidecar-pod4.txt` P10 | SIGTERM gives the instance `left: true` |
| F-78 `/status`, logs, debugging | PASS | `sidecar-pod4.txt` P2, P8, P9, P11–P13; `sidecar-pod4-container-debug.txt`; `sidecar-b-container.txt` | the README's causes 1–3 reproduce exactly; `CS_LOG_LEVEL=debug` shows every send; "report delivered again" after the outage |
| F-80 image | NOT VERIFIED (UBI) | `sidecar-manifests4.txt` S9; `sidecar-pod4-container-info.txt` | the UBI registry is blocked; the image under test runs as UID 1001 with no shell, and as 1000660000 under the restricted flags |
| F-82, F-83 Kustomize | PASS | `sidecar-manifests4.txt` S1–S3b | classic and native render; kubeconform 2/2 valid each |
| F-84 Helm library chart | PASS | `sidecar-manifests4.txt` S4–S5; `helm-include-variants4.txt` | the README's three pieces render a valid Deployment and lint clean; the printed `extraEnv` list renders, the map form fails as the README warns (UX-62 closed) |
| F-85 plain YAML | PASS | `sidecar-manifests4.txt` S6 | the row names the ConfigMap; a team Deployment plus the ConfigMap plus the pasted container validates 2/2 (UX-64 closed) |
| F-86 manifest validity | PASS | `sidecar-manifests4.txt` S1–S6 | every attach form valid under `kubeconform -strict` 1.29 |
| F-88 startup ordering | PASS | `sidecar-pod4.txt` P1, P3, P5, P7 | sidecar first: UNKNOWN "starting: waiting for the app to listen", then the app is found; no false outage; stop and start give DOWN and UP (Docker emulation; a real node is §5) |

## 4. Findings

### 4.1 List

| ID | severity | surface | feature | what the user experiences | fix |
|---|---|---|---|---|---|
| UX-65 | minor | UI | F-59, F-92, F-30 | a feed open before a database outage, refreshed during it, keeps "Service degraded" and "Couldn't load the feed" after recovery, for the full 62 s observed. Its text says "It recovers on its own". A notice published after recovery is not shown; only Try again restores the list | while a working stream sits next to a failed list, reload the list: on the first event frame, or on a backoff while the error is a 503 |
| UX-66 | minor | UI | F-58, F-65 | Refresh pressed from the keyboard sends focus to `<body>` (no ring) while loading and after; a successful refresh announces nothing | keep the button focusable while it loads (`aria-disabled`, ignore clicks); announce the result |
| UX-67 | minor | UI | F-57, F-09 | a duplicate `payments-2026-11-12` gets "such as payments-2026-11-13": another date, which the real 13 November notice will then collide with. Iteration 3 advised `payments-2026-11-12-2` | the service counts on only from a short count, never from the day of a date, as `errors.ts:63` promises |
| UX-68 | cosmetic | API | F-28, F-01 | the 409 says "for example payments-2026-11-13, which is still free" and `suggestedExternalRef` is `payments-2026-11-13` | the same fix as UX-67 |
| UX-69 | cosmetic | UI | F-60 | an empty feed shows amber, pulsing "Connecting" for 6.2–6.5 s after every open or filter change (feeds with notices: 0.3–0.9 s); 14.9 s after a backend restart against 9.05 s | let the service send a frame for an empty snapshot, or count the stream as live once it is open and the list has answered |
| UX-70 | minor | UI | F-65 | iPhone 14 width, Shift+Tab from "Live updates": "Minimum severity" (23–53 px) is focused entirely under the 57 px sticky header; nothing scrolls (WCAG 2.2 SC 2.4.11) | `scroll-padding-top` at least the header's height on the scrolling element |
| UX-71 | cosmetic | API | F-28, F-31 | "validation lists every failing field at once" holds within one kind of check. Unknown fields come first (E6h, E6i); constraints are listed together; domain rules come only after the constraints pass, one at a time (P2a/P2b, P3b/P3c). A payload with three kinds of mistake takes three or four round trips | collect domain-rule failures with the constraint failures, or qualify the README sentence |

Deductions: UI 4 × 3 + 1 × 1 = 13; API 2 × 1 = 2; sidecar 0.

**Gaps in the required format** (cosmetic UX items have no gap severity of their own, so they are filed as minor and marked "UX: cosmetic"):

| GAP | severity | feature ID(s) | root cause (file:line) | how reproduced | suggested fix (one line) | test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-usability-1 (UX-65) | minor | F-59, F-92, F-30 | `frontend/src/outages/useOutageFeed.ts:110-116` reloads the list only when a stream that was down works again; `:135-139` keeps the error until a reload answers; `frontend/src/outages/OutageFeed.tsx:166-169`: the error branch replaces the list | `scripts/ux4-stuck-error.js` on B: feed open, `docker stop ux4-mongo`, Refresh, `docker start`, publish → 20 s later the page still shows the error with 0 cards; fresh dev and production pages show both notices (`ux4-stuck-error-run.txt`; `ux4-dbdown-run.txt` `[recovery-untouched-60s]`) | reload the list on the first event frame (or on a backoff) while the stream works and the list's last answer was an error | `useOutageFeed` test: open stream, failed list load, then an event frame → the list is reloaded and the error cleared |
| GAP-usability-2 (UX-66) | minor | F-58, F-65 | `frontend/src/ui/Button.tsx:64-65` disables a loading button, so the focused Refresh (`OutageFeed.tsx:148`) loses focus to `<body>` | `scripts/ux4-keyboard-only.js` `[refresh-by-keyboard]`: focus `body` ×6 while loading and after; the only announcement is an empty status | `aria-disabled` plus a guard instead of `disabled` while loading; announce "Feed refreshed" | `OutageFeed.test.tsx`: Refresh by keyboard keeps `document.activeElement` on the button |
| GAP-usability-3 (UX-67, UX-68) | minor | F-57, F-09, F-28, F-01 | `src/main/java/com/atlas/communication/common/adapters/outbound/MongoCommunicationRepositoryAdapter.java:59` counts any `-n` with n ≤ 99, the day of a date included; `frontend/src/outages/errors.ts:93-94` prefers the service's value over `nextReference` (`:63-67`, which leaves dates alone) | `api-walk4.txt` C2e/C2f; `ux4-third-notice-run.txt` `[m2-same-date-ref]`; `21c` | treat a reference ending in a date (`\d{4}-\d{2}-\d{2}$`) as uncounted and suggest `<ref>-2` | `MongoCommunicationRepositoryAdapterIT`: `payments-2026-11-12` → `payments-2026-11-12-2` (what `frontend/src/test/errors.test.ts:138-146` pins for the UI's own rule) |
| GAP-usability-4 (UX-70) | minor | F-65 | no `scroll-padding-top` in the frontend (`frontend/src/index.css`); the header is `sticky top-0` (`frontend/src/ui/AppHeader.tsx:14`) | `scripts/ux4-focus-reverse-phone.js`: iPhone 14, Tab to the end, Shift+Tab ×9 → `select "Minimum severity" 23..53 hdr=57 centre=HEADER covers it`, with 700 ms and 1500 ms settles; `34-phone-shift-tab-700ms-step9.png` | `html { scroll-padding-top: 4.5rem }` (header height plus a margin) | Playwright: at 390 px every Tab and Shift+Tab stop lies below the header |
| GAP-usability-5 (UX-69) | minor (UX: cosmetic) | F-60 | `frontend/src/outages/api.ts:76` `STREAM_SETTLE_MS = 6_000`, `:221`: a stream that sends no frame counts as working only after 6 s, and an empty feed sends none | `[type-tenant]` 0.66 s Connecting → 6.51 s Live; `ux4-reconnect-run.txt` `[open-prodEmpty]` 6.2 s, `[recovery]` 14.9 s | an empty-snapshot frame from the service, or live once the stream is open and the list answered 200 | `api.test.ts`: an empty tenant's stream reports working within 1 s |
| GAP-usability-6 (UX-71) | minor (UX: cosmetic) | F-28, F-31 | the checks run in stages, and each stage stops the request: unknown fields (`config/RejectUnknownFieldsModule.java`), then bean constraints, then domain rules that throw at the first failure (`common/domain/Communication.java:192-207`, `health/domain/HealthMonitor.java:60-66`). `README.md:246` promises "every failing field at once" | `api-walk4.txt` E6h, E6i; `api-probes4b.txt` P2a/P2b, P3b/P3c | collect domain-rule failures with the constraint failures in one 400, or qualify the README sentence | controller test: a blank `title` together with `endsAt` not after `startsAt` names both |

### 4.2 Detail

#### UX-65 · minor · UI: the feed keeps its error after the database is back
- **Where:** the Feed tab, a page that was open before a database outage and on which Refresh was pressed during it (F-59, F-92, F-30).
- **What the user experiences:**
  - **During the outage:** Refresh answers "Couldn't load the feed. The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment." The badge says "Service degraded", and both are announced (`ux4-dbdown-run.txt` `[page1-after-refresh-while-down]`; `26`).
  - **After recovery:** Mongo came back at 10:31:33. At 10:32:35 the page still showed the error, "Service degraded", 0 cards and nothing announced (`[recovery-untouched-60s]`, `[page1-after-60s]`; `29`). A page opened during the outage recovered by itself 9.7 s after Mongo returned (`29b`).
  - **Second run:** Refresh at 10:37:11, ready at 10:37:14, a CRITICAL notice published at 10:37:14. Twenty seconds later the page still showed the error with 0 cards. Fresh dev and production pages showed both notices. Try again restored both (`ux4-stuck-error-run.txt`; `29c`).
- **Root cause:**
  - The page's stream never dropped: an open stream stays up on keepalives, as the README says.
  - `useOutageFeed.ts:110-116` reloads the list only when a stream that had been down works again.
  - The list's last answer was the 503, kept by `:135-139` until a reload answers.
  - The badge combines the two as "degraded" (`:143`).
  - `OutageFeed.tsx:166-169` renders the error instead of the items. Events that arrive meanwhile are applied to `items` but are not visible.
  - The same triggers are at `4a0e84e:…useOutageFeed.ts:99-105` with `error: settled ? loaded.error : null` at `:137`, so the defect predates iteration 4. It used to hide behind the UX-42 residual's "Live" badge.
- **Reproduction:** `scripts/ux4-stuck-error.js` (B and its own Mongo).
- **Fix:**
  - While `connection === 'degraded'`, reload the list on the next event frame, or on a capped backoff while the error is a 503.
  - Or say "Try again to see the latest" instead of "It recovers on its own".
- **Test that should have caught it:** a `useOutageFeed` test. A stream works, a list load fails, then an event arrives: the list must be reloaded and the error cleared.

#### UX-66 · minor · UI: Refresh drops keyboard focus
- **Where:** the Feed tab's Refresh button, reached with Tab and pressed with Enter or Space (F-58, F-65).
- **What the user experiences:**
  - Focus goes to `<body>` the moment the load starts, stays there afterwards, and shows no ring (`ux4-keyboard-only-run.txt` `[refresh-by-keyboard]`: `focusWhileLoading` `body` ×6, `after` `body`, accessibility tree `role none, ignored`).
  - A successful refresh announces nothing: one empty status change.
  - Chrome keeps the sequential focus point, so the next Tab reaches the first card's Resolve. Shift+Tab reaches "Live updates" (`[refresh-space-then-shift-tab]`).
  - When the refresh fails, the alert is announced and the next Tab is Try again (`[refresh-fails-by-keyboard]`; `20`).
- **Root cause:**
  - `frontend/src/ui/Button.tsx:65` has `disabled={disabled || loading}`, and `OutageFeed.tsx:148` passes `loading={feed.loading}`. A focused button that becomes disabled loses focus.
  - The same code is at `908598a` and `4a0e84e`.
- **Fix:** while loading, set `aria-disabled` and ignore clicks instead of `disabled`. Announce "Feed refreshed: n notices" in the polite region.
- **Test that should have caught it:** an `OutageFeed` test. Focus Refresh, press Enter, resolve the request: `document.activeElement` must still be the button.

#### UX-67 · minor · UI, and UX-68 · cosmetic · API: date-shaped references get the next day
- **Where:**
  - UI: the 409 banner on the Publish tab (F-57, F-09).
  - API: `POST /v1/communications` 409 (F-28, F-01).
- **What the user experiences:**
  - A maintenance notice with External reference `payments-2026-11-12` publishes. A second one with the same reference gets: "payments-2026-11-12 is already the External reference of a notice in tenant ux4-third. References are permanent, even after a notice is retired, so a follow-up needs another External reference, such as payments-2026-11-13." (`ux4-third-notice-run.txt` `[m2-same-date-ref]`; `21c`).
  - Following that advice gives the follow-up the reference of another day. The real 13 November notice would then get a 409 naming it.
  - The API says the same: "for example payments-2026-11-13, which is still free", with `"suggestedExternalRef":"payments-2026-11-13"` (`api-walk4.txt` C2f).
  - In iteration 3 the banner advised `payments-2026-11-12-2`. Counted references work as intended: `INC4100001` → `-2` → `-3` (`[n3-attempt1]`), and `INC4900001-51` → `-52` (`ux4-none-free-run.txt`).
- **Root cause:**
  - `MongoCommunicationRepositoryAdapter.java:59`, `COUNTED_FOLLOW_UP = (.+)-([1-9][0-9]?)` (G-4-11), counts on from any 1–99 suffix, the day of a date included.
  - `frontend/src/outages/errors.ts:93-94` (G-4-21) prefers the service's value to its own `nextReference`. That function's comment at `:63` and its test at `errors.test.ts:138-146` say a date's end "is not a count" and expect `payments-2026-11-12-2`.
  - The backend IT covers `CHG-2026` (`MongoCommunicationRepositoryAdapterIT.java:87-105`) but no date.
- **Fix:** do not count on from a reference that ends in a date (`\d{4}-\d{2}-\d{2}$`); suggest `<ref>-2`.
- **Test that should have caught it:** `MongoCommunicationRepositoryAdapterIT`, case `payments-2026-11-12` → `suggestedExternalRef` `payments-2026-11-12-2`.

#### UX-69 · cosmetic · UI: an empty feed waits about 6 s for "Live"
- **Where:** the Feed tab's connection badge (F-60).
- **What the user experiences:**
  - After typing a tenant with nothing active: "0.66 s Connecting, 6.51 s Live" (`[type-tenant]`).
  - Production bundle, empty tenant: "0.1 s Connecting, 6.2 s Live" (`ux4-reconnect-run.txt` `[open-prodEmpty]`).
  - Any filter change that empties the list shows "Connecting" again (`[empty-filter]`).
  - Feeds with notices are Live in 0.3–0.9 s (`[feed-all-types]`, `[open-dev]`, `[open-prod]`).
  - After a backend restart, the empty page is Live 14.9 s after readiness, against 9.05 s for pages with notices (`[recovery]`).
  - "Connecting" is the amber, pulsing state (`OutageFeed.tsx:28`), which an SRE reads as "not yet".
- **Root cause:** `frontend/src/outages/api.ts:76`, `STREAM_SETTLE_MS = 6_000`, and `:221`. The G-4-17 fix counts a stream as working only after a frame or 6 s open, and an empty snapshot sends no frame.
- **Fix:** have the service send a frame for an empty snapshot (for example a `snapshot-end` comment-event), or count the stream as working once it is open and the list has answered 200.
- **Test that should have caught it:** an `api.test.ts` case. An open stream with no frames, plus a successful list load, reports working within 1 s.

#### UX-70 · minor · UI: on a phone, Shift+Tab can focus a control hidden under the header
- **Where:** the Feed tab at 390 px (iPhone 14 emulation), moving backwards with Shift+Tab (F-65).
- **What the user experiences:**
  - Tab to the end of the page, then Shift+Tab: Resolve ×6, Refresh, Live updates, then **"Minimum severity" at 23–53 px**, entirely under the 57 px glass header.
  - `elementFromPoint` at its centre is the header. The page does not scroll (scrollY stays 277), with both a 700 ms and a 1500 ms settle (`ux4-focus-reverse-phone-run.txt`, step 9).
  - The screenshot shows only the ghost of "Any severity" through the translucent header, with no ring (`34-phone-shift-tab-700ms-step9.png`).
  - The next Shift+Tab ("Type") scrolls the page to the top.
  - Forward Tab and the desktop width are fine (`ux4-contrast-focus-card-run.txt` `[focus-desktop]`, `[focus-phone]`; the stops listed there inside the header are the header's own controls).
  - This is WCAG 2.2 SC 2.4.11, Focus Not Obscured (Minimum), AA. 390 px is also what a 1280 px desktop shows at about 330 % zoom.
- **Root cause:**
  - The header is `sticky top-0` (`frontend/src/ui/AppHeader.tsx:14`).
  - Nothing reserves its height for scroll-into-view: no `scroll-padding-top` anywhere (`git log -S scroll-padding -- frontend` is empty).
  - The browser treats an element under the header as already visible.
- **Fix:** `html { scroll-padding-top: <header height + margin>; }`.
- **Test that should have caught it:** a Playwright check at 390 px. Every Tab and Shift+Tab stop's rectangle lies below the header's bottom.

#### UX-71 · cosmetic · API: "every failing field at once" holds within one stage only
- **Where:** publish and monitor registration (F-28, F-31). `README.md:246` says: "validation lists every failing field at once (`publisher: must not be blank; title: must not be blank`)."
- **What the developer experiences:**
  - **Constraints alone are listed together:**
    - "publisher: must not be blank; title: must not be blank" (P3a);
    - "intervalSeconds: must be greater than or equal to 5; service: must not be blank" (P2c).
  - **Unknown fields win over everything else:**
    - with an unknown field and a bad enum value, only the bad value is named (E6h);
    - with an unknown field and missing required fields, only the unknown field is named (E6i).
  - **Domain rules appear only after the constraints pass, one at a time:**
    - `intervalSeconds: 2` with `downSeverity: INFO` names only the interval; the second call names "downSeverity must be MINOR or higher (it publishes an OUTAGE)" (P2a, P2b);
    - a blank title with `endsAt` equal to `startsAt` and `expiresAt` before it names the title; the next call names `endsAt`; `expiresAt` comes after that (P3b, P3c).
- **Root cause:**
  - Unknown fields are collected during deserialization (`RejectUnknownFieldsModule`) and answered before validation.
  - Bean constraints run next.
  - Domain rules throw at the first failure (`Communication.java:192-207`, `HealthMonitor.java:60-66`).
  - Present at `4a0e84e`, with the same README sentence.
- **Fix:** collect the domain-rule failures into the constraint answer, or write "lists every failing constraint at once; rules between fields are checked after".
- **Test that should have caught it:** a controller test. A blank `title` together with `endsAt` not after `startsAt` must name both.

### 4.3 Iteration-3 findings re-checked

| ID (iteration 3) | was | now | evidence |
|---|---|---|---|
| UX-42 residual: "Live" during a database outage | minor | **CLOSED**. No page shows "Live" next to an error or a skeleton. A refreshed page says "Service degraded" with the error as an announced alert. A page opened during the outage shows "Connecting", then "Reconnecting (n)" with the error; it recovers by itself 9.7 s after Mongo returns (5.2 s after a pause). An untouched page keeps "Live" with its cards, which is accurate: its stream stays up and nothing can be published meanwhile (publish answers 503). Its recovery defect is new: UX-65 | `ux4-dbdown-run.txt` `[page1-*]`, `[page2-*]`, `[page4-*]`, `[recovery-*]`; `26`, `27`, `27b`, `29b` |
| UX-52 third notice advised a taken value | minor | **CLOSED**. Notice 2 is advised `-2`, notice 3 `-3`; each publishes at once. Past 50 taken values the banner says "(INC4900001-2 to INC4900001-51 are taken as well)" and suggests none | `ux4-third-notice-run.txt`; `ux4-none-free-run.txt`; `21`, `21d` |
| UX-53 feed error never announced | minor | **CLOSED**. `role=alert`, announced on Refresh, Try again and the phone width; re-announced on each failure (`key={feed.failures}`); 0 axe violations | `[feed-503-db]`, `[try-again-fails-again]`, `[phone-feed-error]`; `aria-feed-error.txt`; `16c` |
| UX-54 View in feed drops focus | minor | **CLOSED**. Focus lands on the results, which the accessibility tree names "ACTIVE NOW 4"; the next Tab is the first card's Resolve | `[view-in-feed]`, `[view-in-feed-next-tabs]`; `ux4-keyboard-only-run.txt` `[view-in-feed]`; `18` |
| UX-55 Escape does nothing in the confirmation | cosmetic | **CLOSED**. Escape cancels from the note and from the button, desktop and phone; focus returns to Resolve or Withdraw; a half-typed note is kept for the next opening | `[resolve-escape-*]`, `[withdraw-escape]`, `[phone-resolve-escape]`, `[resolve-reopen-note]` |
| UX-56 misspelled monitor fields dropped | minor | **CLOSED**. `intervalSecond`, `failureTreshold` and `staleAfterSecond` answer 400 naming each field and listing the known ones | `api-walk4.txt` H8, H8b |
| UX-57 OpenAPI responses wrong or missing | minor | **CLOSED**. Every operation declares its real success code (201 publish and register, 202 report, 204 delete) and a shared 400/404/503 with `Error` and an example. Observation: the 409 has an example but no schema | `openapi-responses4.txt` |
| UX-58 Swagger's own examples rejected | cosmetic | **CLOSED**. Every example passes as offered: publish 201, the same again 409 with a suggestion, PUT 200, retire 200, admin retire 200, both monitor examples 201, report 202 | `swagger4-run.txt`, `swagger4.json`; `22`, `23`, `23b` |
| UX-59 409 example taken or awkward | cosmetic | **CLOSED for counted references** (`INC0012345-2` → `-3`, never `-2-2`); date-shaped references regressed: UX-68 | `api-walk4.txt` C2b–C2f |
| UX-60 only the first unknown field named | cosmetic | **CLOSED**. A GET document PUT back names all 10 server fields at once (9 for a notice without a ticket). Dropping exactly those and sending the version read answers 200 | `api-walk4.txt` C5r; `api-probes4b.txt` P1 |
| UX-61 asterisks in the cookbook body | cosmetic | **CLOSED**. The README body is plain text and the card shows it as such | `cookbook-literal4.txt`; `[readme-body-card]`; `24` |
| UX-62 `extraEnv` named without its shape | cosmetic | **CLOSED**. The README prints the list form, which renders, lints and validates; the map form fails with the error the README quotes | `sidecar-manifests4.txt` S5; `helm-include-variants4.txt` |
| UX-63 "none reporting yet" about a reporting pod | cosmetic | **CLOSED** in substance. The summary now carries the pod's own words, for example "UNKNOWN (1 pod starting, none reporting yet (payments-api-…: no health target found after 20s: no listening port answered; set CS_PORT and CS_PATH))". The README documents that exact form (`README.md:310-312`); the wording is kept as an observation in §6 | `sidecar-pod4.txt` P2, P13 |
| UX-64 plain-YAML row omits the ConfigMap | minor | **CLOSED**. The row names the ConfigMap and its keys, the file header is fixed, and Debugging gains cause 4 (CreateContainerConfigError) | `sidecar-manifests4.txt` S0, S6 |

## 5. Not exercised in this sandbox, and why

- **OpenShift and Kubernetes.**
  - There is no cluster, and kind cannot start pods here (`confidence/evidence/environment.md`).
  - Manifests were rendered and validated only: kustomize, helm 3.16.3, `kubeconform -strict` 1.29.
  - The README's `oc logs`, `oc port-forward` and `oc rollout restart` were emulated with Docker: `docker logs`, published ports, a restarted sidecar container.
  - Not seen at all:
    - the kubelet's and admission's answers, including `CreateContainerConfigError` (Debugging cause 4);
    - native-sidecar ordering on a real node;
    - liveness restarts.
- **UBI base image.** The registry is blocked. The image under test (`health-sidecar:ci`, version `ci-iter4`, 17.5 MB) uses the substitute base described in the environment notes, so the README's size and base claims for UBI are not verified (F-80).
- **A real screen reader.** None here. Substitutes:
  - the accessibility tree (`ariaSnapshot`, and CDP `Accessibility.getPartialAXTree` for the focused node);
  - axe-core 4.10.3 with the WCAG 2.0, 2.1 and 2.2 A/AA tags;
  - keyboard-only traversal;
  - a MutationObserver log of every `role=status`, `role=alert` and `aria-live` change.

  The phone is Chromium's iPhone 14 emulation, not a device.
- **The ServiceNow link.** No instance URL is set in this stack, so the ticket chip was reviewed as text.
- **The Helm chart repository.** The README's URL is a placeholder; the consuming chart used a `file://` copy of `deploy/helm/cs-health-sidecar`.
- **GitHub Actions and anything remote.** Not run (rule 4).
- **Security scans (Trivy, govulncheck, npm audit).** Not run from this seat; the service verifiers own the security gate.

## 6. Observations without deduction

- **Hung database, concurrent calls.**
  - The README's timings hold for a single call: 15.0 s for a publish and 20.0 s for a read under `docker pause` (`hung-db-timing.txt`).
  - Three calls issued together right after the pause took longer: 25.1 s for the feed GET and for the publish, 20.1 s for the stream (`ux4-dbdown-log.json` `[api-while-paused]`). A client timeout sized from "about 20 s" can fire first under load. This is for the backend verifier.
- **A page opened during an outage.**
  - It shows the loading skeleton under "Connecting" or "Reconnecting (1)" until the first 503 arrives: 5.7 s for the production bundle, about 10 s in dev, where StrictMode doubles the first GET (`ux4-stuck-error-run.txt` `[fresh-page-timelines]`).
  - The UI cannot know sooner than the service's 5 s timeout.
- **The 409 in OpenAPI.** It has an example but no schema; `suggestedExternalRef` appears only in its description and example. The documented 401 example lacks the "(EventSource clients may send ?clientId= instead)" tail that the real 401 carries (`openapi-responses4.txt`; `api-walk4.txt` E0).
- **Lenient inputs.**
  - A numeric title `123` is stored as "123" (E7f).
  - `affectedServices: null` is stored as `[]` (E7h).
  - The sidecar takes `CS_LOG_LEVEL=DEBUG` in upper case (S7 j).
- **The cookbook on a re-run.** The maintenance example carries no reference, so a second run publishes a second copy (`cookbook-literal4.txt`, run 2).
- **UX-63's wording.** "1 pod starting, none reporting yet (pod: …)" next to the quoted report of that very pod, with nested parentheses. It is documented as such in `README.md:310-312`.
- **Contrast.** axe left `color-contrast` "incomplete" on the publish-form scans; the node is the Details textarea ("partially obscured"). Checked by hand: text 15.46:1 (light) and 15.63:1 (dark), placeholder 4.66:1 and 5.93:1, all at or above 4.5:1 (`ux4-contrast-focus-card-run.txt`).
- **Console.**
  - Over a full path, dev and the production bundle log no warning and no page error. The only error lines are "Failed to load resource" for the one 409 the path provokes (`ux4-console-sweep-run.txt`).
  - The UI walk's 17 console errors are the same kind for responses it provoked or mocked. The 12 kept are 409 ×3, 500 ×3, 503 ×3, 502 ×2 and connection refused ×1 (`ux4-ui-run.txt` `[console]`).
- **Backend B's log during the outages.**
  - 58 WARN, 0 ERROR and 0 stack-trace lines in 10:29–10:36, each naming its cause.
  - "readiness DOWN: MongoDB did not answer a ping: no answer within 800 ms" when the outage starts.
  - "readiness UP: MongoDB answers again" and "event log poll resumed: database reachable again after 17 skipped poll(s)" when it ends, as the README promises (`backend-19601-outage-warn.txt`).
- **The sidecar during the outage.**
  - `/status` `sendError` reads "HTTP 503 {"error":"database unavailable"}".
  - When reports go through again, an INFO line "report delivered again" with `failedAttempts` 6 and `failingFor` 1m16.8s (5 and 51.4 s after the pause) (`sidecar-b-container.txt`).
- **What works well:**
  - 10 axe scans with 0 violations, both themes and both widths.
  - 14 named, ringed stops from the Publish tab to submit.
  - Live create in 864 ms and retire in 833 ms.
  - Reconnecting (1)…(6) announced through a SIGKILL.
  - No horizontal scroll at 390 px; the only small target, the 30×18 switch, sits in a 74×26 label row.
  - Automated OUTAGE 7.5 s after the app stops, gone 10.7 s after it returns.
  - Proxies:
    - a dead `HTTP_PROXY` shows "proxyconnect tcp: … connection refused" in `sendError` while probes still work;
    - `NO_PROXY` fixes it, exactly as the README says.
  - A pinned wrong port is named in `/status` and in the monitor summary ("never answered UP since start; check CS_PORT, CS_PATH and CS_SCHEME").
  - Every bad configuration exits 2 with one ERROR line naming every variable.
  - The README's `go test ./...` (7 packages) and `go build` (7,729,415 bytes) pass.

## 7. Data left behind and teardown

- **Shared store**, under `ux4-*` tenants only (`GET /v1/admin/tenants` after teardown):
  - `ux4-api`: 1 EXPIRED, 8 RETIRED;
  - `ux4-kbd`: 2 RETIRED;
  - `ux4-sre`: 9 RETIRED. This includes the DRAFT that `[draft-saved]` created, retired at teardown (actor `ux4-reviewer`), so no draft is left;
  - `ux4-third`: 4 RETIRED.

  There are no monitors under any `ux4-*` tenant. `vmforge` received the first cookbook example verbatim once (`api-walk4.txt` C1); it answered 409 and wrote nothing.
- **Private:**
  - My processes are stopped: backend A (pid 29832) and B (pid 22977) by SIGTERM, each after a graceful shutdown; Vite 30150 and 30162; preview 20035. Each was matched by its exact command line before the kill.
  - `ux4-mongo` (database `ux4b`) and its two anonymous volumes are removed (`docker rm -f -v`). No `ux4-*` container, image or volume remains.
  - Ports 19600, 19601, 19617, 3600, 3601 and 3602 are free.
  - The scratch builds are deleted: the sidecar binary, the rendered manifests and the Helm and Kustomize working copies.
  - Left in place:
    - database `ux4` on `mongo7`, my own database for backend A, as iteration 3 left `ux3` (it includes `ux4-none-free`'s 51 notices and the Swagger walk's `acme` notices);
    - the scratchpad's `usability/node_modules` (`@axe-core/playwright`, 17 MB), which the scripts need.
- **Shared stack at the end:** `/actuator/health` 200, `:3000` 200; containers `app`, `sidecar` and `mongo7` up and untouched.

## 8. Reproduce

The scripts are under `confidence/evidence/iter-4/usability/scripts/`. They run from a scratch folder that contains `playwright`
(resolvable globally here) and `@axe-core/playwright` 4.10.2, installed in that folder, never in `frontend/`. They write their logs
to `../logs` and their screenshots to `../shots`.
1. Start the private stack of §2 row 1:
   - backend A on :19600 over database `ux4` on the shared Mongo;
   - backend B on :19601 over its own `ux4-mongo`;
   - `COMM_BACKEND=http://127.0.0.1:19600 vite --port 3600` and `COMM_BACKEND=http://127.0.0.1:19601 vite --port 3601` from `frontend/`;
   - `vite preview --port 3602` for the production bundle.
2. Run the rows of §2 in order. Rows 3–5, 7 and the contrast part of row 18 use the shared stack, under `ux4-*` tenants only. Everything that stops a database or a backend (rows 15–17, 22) uses B and its own Mongo.
3. For the sidecar rows, kustomize, helm and kubeconform come from the scratchpad's `tools/`. `sidecar-pod4.sh` builds nothing: it runs the `health-sidecar:ci` image under the restricted flags, joined to a fake app container's network namespace.
