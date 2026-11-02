# Usability review, iteration 3

| | |
|---|---|
| Reviewer | Usability Reviewer, iteration 3. Grades only: nothing in the repository changed except this report and its evidence folder |
| Seats | (a) SRE publishing and resolving notices in the UI at 1280×800 and 390 px, keyboard only, screen-reader mindset; (b) developer integrating from the root `README.md` alone (cookbook, Swagger UI, error texts); (c) platform engineer onboarding a team from `sidecar/README.md` alone |
| When | 2026-11-02, walks 06:48–07:37 UTC |
| Code | `confidence-loop/2026-11-01` at `e3968c4` (code identical to `4a0e84e`) |
| Shared stack | backend :8080, frontend :3000, pod `app` + `sidecar` (`health-sidecar:ci`, `ci-iter3`); read freely, written only under `ux3-*` tenants; never stopped or reconfigured |
| Private stack (torn down) | **A**: `communication-service-iter3.jar` on :19600, database `ux3` on `mongo7`, sweeps 1 s / 2 s, stale grace 0, Vite :3600 → A. **B**: the same jar on :19601 against its own `ux3-mongo` (127.0.0.1:19617, database `ux3b`), Vite :3601 → B. Emulated pods: `ux3-app` (`fakeapp:ci`) + `ux3-sidecar` (`health-sidecar:ci` in the app's network namespace) and three single-purpose sidecars, all reporting to A, every sidecar as UID 1000660000 with `--read-only --cap-drop ALL --security-opt no-new-privileges` |
| Evidence | `confidence/evidence/iter-3/usability/`: screenshots `NN-*.png`, transcripts `*.txt`, JSON logs, every script under `scripts/`. `[step]` below names a line of the run file it is cited with |

Severity scale (unchanged from iteration 2): **blocker** ≥ 30 (task impossible unaided), **major** 10 (done only by guessing or
after a wrong turn), **minor** 3 (noticeable, recoverable without a wrong turn), **cosmetic** 1 (polish).

## 1. Summary verdict and scores

| Surface | blocker | major | minor | cosmetic | deductions | score | iter-2 | Δ | hard gate |
|---|---|---|---|---|---|---|---|---|---|
| **UI** (SRE in the browser) | 0 | 0 | 4 (UX-52, 53, 54, UX-42 residual) | 1 (UX-55) | 13 | **87** | 84 | +3 | none |
| **API** (developer with README, curl, Swagger UI) | 0 | 0 | 2 (UX-56, 57) | 4 (UX-58, 59, 60, 61) | 10 | **90** | 89 | +1 | none |
| **Sidecar onboarding** (platform engineer) | 0 | 0 | 1 (UX-64) | 2 (UX-62, 63) | 5 | **95** | 94 | +1 | none |

Provisional usability category (out of 10) per service, with the fold the auditor used in `confidence/iter-2/audit.md:217-220`:
**backend 9.0** (API), **frontend 8.7** (UI), **sidecar 9.5** (onboarding), **E2E 8.7** (the UI score, the lowest surface).

**Verdict.** In all three seats every task can be completed unaided: no blocker, no major. Iteration 2 left 15 items open (UX-40 to
UX-51, plus the residuals UX-15, UX-21b and UX-24; UX-43 is one of the twelve). Fourteen are closed, with evidence in §4.3.
UX-42 is closed for its wording but not for its badge, which is graded again below as the UX-42 residual.

The iteration-3 fixes are visible from the seat:
- The 409 banner uses the form's terms, and its advice works.
- Focus moves into the Resolve confirmation and comes back out of it.
- The connection badge is a polite live region. A screen reader hears it all the way through a real backend restart.
- Misspelled fields and nulls in arrays are named on every publishing endpoint.
- The README's Helm snippet renders a valid Deployment.
- `CS_LOG_LEVEL=debug` shows every send.

What still costs a user, none of it blocking:
- **UI:**
  - For a third notice on one incident, the duplicate-reference advice names a value the tenant already holds (UX-52).
  - During a database outage the feed's badge says "Live", and a page opened then spends most of its time on a loading skeleton (UX-42 residual).
  - The feed's load error is never announced to a screen reader (UX-53).
  - "View in feed" drops focus to `<body>` (UX-54).
  - Escape does not cancel the inline confirmation (UX-55).
- **API:**
  - Monitor registration still drops misspelled policy fields, `staleAfterSeconds` among them. The README says push-only services need that field for crash detection (UX-56).
  - The OpenAPI document gets most success and error responses wrong, or leaves them out (UX-57).
  - Swagger's own publish example is rejected four times in a row (UX-58).
  - Three cosmetic text items (UX-59, UX-60, UX-61).
- **Sidecar:**
  - The plain-YAML row of "Attach it" leaves out the ConfigMap that the pasted container needs (UX-64).
  - `extraEnv` is named without its shape (UX-62).
  - The monitor summary says "none reporting yet" about a pod that reports at every heartbeat (UX-63).

Three of the new items predate iteration 3; I missed them in iteration 2:
- UX-53: the same markup is at `908598a` (`feed-error-markup.txt`).
- UX-57: the same `@ApiResponse` declarations are at `908598a` (`openapi-iter2-vs-iter3.txt`).
- UX-64: the row is unchanged since `f18057d` (`sidecar-plain-yaml3.txt`).

**Hard gates from this seat: none tripped.**
- In every pod emulation the sidecar ran as non-root (UID 1000660000) under the restricted-v2 flags (`scripts/sidecar-pod3.sh:6`).
- I skipped or loosened no test. The only test command I ran was the README's `go test ./...`, and every package passed.
- Every end-to-end flow in the matrix rows below completes.
- F-65 fails one of its clauses: "errors use role=alert" does not hold for the feed's load error (UX-53). I grade that as a minor finding, not as a failing flow. If the auditor reads "a matrix item fails" clause by clause, F-65 is the only row concerned.

## 2. Commands run

| # | command | exit code | evidence file |
|---|---|---|---|
| 1 | Private stack: `docker run -d --name ux3-mongo -p 127.0.0.1:19617:27017 mongo:7.0`; `java -jar …/communication-service-iter3.jar --server.port=19600 --spring.data.mongodb.uri=mongodb://127.0.0.1:27017/ux3 --communication.health.sweep-interval-ms=1000 --communication.sweep.interval-ms=2000 --communication.health.stale-grace-after-start-ms=0`; `java -jar …/communication-service-iter3.jar --server.port=19601 --spring.data.mongodb.uri=mongodb://127.0.0.1:19617/ux3b`; in `frontend/` (no install) `COMM_BACKEND=http://127.0.0.1:19600 ./node_modules/.bin/vite --port 3600 --host 127.0.0.1 --strictPort`, and the same for 19601 → 3601 | 0 (all four answered) | `backend-19601-outage-warn-error.txt` (B's WARN/ERROR lines) |
| 2 | `node scripts/ux3-ui.js`: the SRE walk on the shared stack (tenant typing, publish, five 409 variants, cards, resolve and withdraw, mocked 5xx/abort variants, arrow keys, both themes, iPhone 14 at 390 px, 9 axe scans, accessibility tree, live-region log) | 0 | `ux3-ui-run.txt`, `ux3-ui-log.jsonl`, `aria-landing.txt`, `aria-publish.txt`, `aria-409.txt`, `aria-feed.txt`, `aria-confirm.txt`, `01`–`17` |
| 3 | `node scripts/ux3-focus-obscured.js`; `node scripts/ux3-focus-reverse.js`: is a focused stop, or the confirmation's question, hidden under the sticky header (Tab and Shift+Tab, desktop and phone, 700 ms settle) | 0; 0 | `ux3-focus-obscured-run.txt`, `ux3-focus-obscured.jsonl`, `ux3-focus-reverse-run.txt`, `18`–`20` |
| 4 | `node scripts/ux3-third-notice.js`: three notices for one incident through the form (tenant `ux3-third`) | 0 | `ux3-third-notice-run.txt`, `ux3-third-notice.jsonl`, `21`, `21b` |
| 5 | `node scripts/ux3-keyboard-only.js`: publish, then View in feed, then Resolve, by keyboard only; the first retire answers a mocked 500 | 0 | `ux3-keyboard-only-run.txt`, `ux3-keyboard-only.json`, `32` |
| 6 | `node scripts/ux3-view-in-feed-focus.js`, run twice | 0; 0 | `ux3-view-in-feed-focus.txt` |
| 7 | `node scripts/ux3-contrast-incomplete.js`; `node scripts/ux3-contrast-body.js` (read-only, shared :3000) | 0; 0 | `contrast-incomplete.txt` |
| 8 | `node scripts/ux3-dbdown.js`: `docker stop ux3-mongo` under backend B for 51 s (API, UI and sidecar views), then `docker start ux3-mongo` | 0 | `ux3-dbdown-run.txt`, `ux3-dbdown-log.jsonl`, `backend-19601-outage-warn-error.txt`, `26`, `28` |
| 9 | `node scripts/ux3-fresh-during-outage.js`: a page opened during the outage, 45 one-second samples, every request counted | 0 | `ux3-fresh-during-outage.json`, `27`, `29` |
| 10 | `node scripts/ux3-reconnect.js`: SIGKILL backend A under an open feed (pid 29242), restart it (pid 15347), publish right after readiness | 0 | `ux3-reconnect-run.txt`, `ux3-reconnect-log.jsonl`, `30`, `31` |
| 11 | `bash scripts/api-walk3.sh`: the README cookbook (C1 verbatim in `vmforge` on the shared store answers 409 and writes nothing; then C1–C7 in `ux3-api`), error probes E0–E18, health H1–H8, cleanup | 0 | `api-walk3.txt` |
| 12 | The cookbook pasted literally, twice, on private A (fresh store) | 0 | `cookbook-literal.txt` |
| 13 | Monitor registration with misspelled policy fields (A, `ux3-api`), and the same kind of typo on publish (shared) | 0 | `monitor-typos.txt` |
| 14 | `/v3/api-docs`: the documented responses per operation, against the answers seen in row 11 | 0 | `openapi-responses.txt` |
| 15 | `node scripts/swagger3.js`: Swagger UI Authorize, try-it-out before and after it, and the publish, monitor and report examples executed as offered (on A) | 1 (my own selector), then 0 | `swagger3.json`, `22`, `23` |
| 16 | Swagger's publish example fixed one error at a time: on A at 07:01Z, and again on the shared store under `ux3-swagger` through to the 201 at 07:35Z (the draft then deleted, 204) | 0 | `swagger-example-chain.txt` |
| 17 | `node scripts/md-card.js`: the README's first example body rendered by the UI (A, Vite :3600) | 0 | `readme-example-body.txt`, `24` |
| 18 | `bash scripts/sidecar-manifests3.sh`: Kustomize classic and native, the Image block, `CS_LOG_LEVEL` in the ConfigMap, the consuming Helm chart built from the README's three pieces, plain YAML, the image with bad configuration, the README's Build commands (`go test ./...`, `go build`) | 0 | `sidecar-manifests3.txt` |
| 19 | Include-line variants and `extraEnv` shapes in the consuming chart (`helm template`, `helm lint`, `kubeconform -strict`, schema 1.29) | 0 | `helm-include-variants.txt` |
| 20 | `bash scripts/sidecar-pod3.sh` + `node scripts/auto-notice3.js`: the sidecar alone; the app starts; the app stops (automated OUTAGE); the app returns; a failing component; the default-level log; `CS_LOG_LEVEL=debug`; SIGTERM; README cause 1 | 0 | `sidecar-pod3.txt`, `sidecar-pod3-container-info.txt`, `sidecar-pod3-container-debug.txt`, `25-*` |
| 21 | README debugging cause 3 past the grace (nothing listens; wrong port), and the service-side summary | 0 | `sidecar-cause3.txt` |
| 22 | `bash scripts/sidecar-plain-yaml3.sh`: the plain-YAML row read literally | 0 | `sidecar-plain-yaml3.txt` |
| 23 | Static comparisons with iteration 2 (`git show 908598a:…`, `git log -S`; read-only) | 0 | `openapi-iter2-vs-iter3.txt`, `feed-error-markup.txt`, `sidecar-plain-yaml3.txt` (end) |
| 24 | Teardown: kill A, B and both Vite servers by pid, matched on the exact command line; `docker rm -f` the `ux3-*` containers; check the shared stack (`/actuator/health` 200, `:3000` 200) and what `ux3-*` left in its store | 0 | §7 |

Notes on these runs:
- Row 15's first run failed because of my own selector: `hasNotText: 'probe'` excluded the monitor block. The rerun selects each operation by its exact path.
- Step S5(b) of row 18 is my mistake. My `sed` put the include line at column 16, so `helm template` failed for my reason, not the README's. Row 19 has the corrected variants. At column 8 without `nindent`, `helm template` and `helm lint` pass and kubeconform rejects the Deployment (`/spec … additionalProperties`). That is exactly what the README warns about, so it is not a finding.
- Expected non-zero exits inside the scripts are part of the evidence:
  - helm `exit 1` for the include variants the README warns against;
  - the image's `exit 2` for bad configuration.
- Two lines of `api-walk3.txt` need explaining:
  - The "(accepted: …)" line after E7c is a script artifact; that request was a 400.
  - "active left: 1" at the end is a notice that had just expired by time. It was still stored ACTIVE until the shared stack's 30 s sweep ran.
- The P2 "after grace" read in `sidecar-pod3.txt` fell inside the grace plus one probe interval. `sidecar-cause3.txt` re-checks it properly.
- In `ux3-dbdown-run.txt` the sidecar's `sendError` appears 50.8 s after the stop. That reflects the order of my script (it reads the sidecar last), not the sidecar.
- One stray container was mine. `docker run --rm --entrypoint '' fakeapp:ci /fakeapp -h` started a long-running anonymous container, which I removed by id (`a5a1a9803cba`). The shared `app` and other verifiers' containers were not touched.

## 3. Feature verdicts from the three seats

| ID | verdict | evidence | note |
|---|---|---|---|
| F-52 app shell, tenant | PASS | `ux3-ui-run.txt` `[landing]`, `[type-tenant]`, `[type-then-tab]`, `[clear-tenant-*]`; `01` | first visit: empty field, a prompt, "Waiting for a tenant"; one GET and one stream per typed tenant (UX-49, UX-50 closed) |
| F-53 theme | PASS | `[theme-after]`; `11`, `12`, `17` | 0 axe violations in the three dark scans |
| F-54 publish form fields | PASS | `ux3-keyboard-only-run.txt` `[form-walk]`; `[segmented-arrow]` | 14 stops from the Publish tab to submit, every one named and with a visible ring |
| F-55 client validation | PASS | `[submit-empty]`; `03`, `15` | "2 fields need attention: Title (Title is required), Publisher (Publisher is required)."; focus on the first |
| F-56 publish submit | PASS | `[publish-success]`, `[publish-another-focus]`; `04` | the result heading gets focus; "Publish another" focuses Title; **friction** UX-54 ("View in feed") |
| F-57 server errors | PASS | `[duplicate-409*]`, `[variant-*]`, `[feed-*]`; `ux3-dbdown-run.txt`; `05`, `05b`, `10`, `16`, `16b`, `28` | the 409 is in the form's terms and its advice works (UX-40 closed); 503 and 5xx are in plain words (UX-42 wording closed); **friction** UX-52, UX-42 residual |
| F-58 feed tab | PASS | `[feed-all-types]`, `[cap-notice]`, `[empty-filter]`; `06` | "Showing the first 100 of 103 notices. Narrow the filters to see the rest." |
| F-59 feed states | PASS | `[empty-*]`; `ux3-fresh-during-outage.json`; `02`, `27`, `29` | **friction** UX-42 residual (a page opened during the outage shows its error 10 of 45 s); UX-53 |
| F-60 live updates | PASS | `[live]` | the card appears 845 ms after the publish; a retired card leaves 188 ms after the retire |
| F-61 reconnect | PASS | `ux3-reconnect-run.txt`; `30`, `31` | "Reconnecting" in 0.5 s, then (1)…(7), then "Live" 8.6 s after readiness; a notice published 0.4 s after readiness is shown 8.9 s after it; all of it announced (UX-48 closed) |
| F-62 resolve / withdraw | PASS | `[resolve-*]`, `[withdraw-confirm]`, `[after-*]`; `ux3-keyboard-only-run.txt` `[resolve-fails]`; `08`, `09`, `14`, `32` | focus goes into the note; Cancel returns it to Resolve; a failed resolve returns it to Resolve with a `role=alert` error (UX-41 closed); **friction** UX-55 |
| F-63 cards | PASS | `[card-anatomy]`, `[maintenance-card]`; `sidecar-pod3.txt` P6; `06`, `07`, `25-*` | automated notices: "Automatic" chip and a plain-words body to the second (UX-47 closed); **friction** UX-61 (asterisks from the README's example body) |
| F-64 identity, base URL | PASS | `[type-tenant]` requests | `clientId=communication-frontend` on the stream; every request goes through the dev proxy |
| F-65 accessibility | **FAIL (one clause)** | 9 × `axe:*` (0 violations); `contrast-incomplete.txt`; `aria-*.txt`; `[form-walk]`, `[tabs-arrow]`, `[segmented-arrow]`, `[phone-feed]`; `ux3-dbdown-log.jsonl` announcements; `feed-error-markup.txt` | every clause holds except "errors use role=alert": the feed's load error is a plain `div` (UX-53); also UX-54; the switch's label row is 74×26 px (UX-15 residual closed); no horizontal scroll at 390 px |
| F-91 sidecar flow (UI side) | PASS | `sidecar-pod3.txt` P5–P7; `25-*` | OUTAGE in the feed 7.4 s after the app stops; gone 12.9 s after it returns, retired by `health-sidecar` |
| F-92 failure paths (UI and API side) | PASS | rows 8–10 of §2 | database down: 503 within 5.0 s, wording right; backend killed: Reconnecting, then Live; **friction** UX-42 residual |
| F-01, F-10 cookbook | PASS | `api-walk3.txt` C1–C3; `cookbook-literal.txt` | fresh store: every example exits 0 (201; 201 SCHEDULED with `expiresAt` = `endsAt`); verbatim on the shared store: the 409 that the README now announces (UX-43 closed); **friction** UX-61 |
| F-05 PUT `expectedVersion` | PASS | `api-walk3.txt` C5 | 200, then `409 expectedVersion 0 does not match current version 1`; omitted, the 400 says what to send (UX-24 residual closed); **friction** UX-60 (C5r) |
| F-09 ticket | PASS | `[duplicate-409]`; E6b, E10 | the form explains that the incident number doubles as the reference |
| F-20 resume | PASS | `api-walk3.txt` C4 | `lastEventId=1879` replays `id:1880 created` |
| F-27 identification | PASS | `api-walk3.txt` E0; `swagger3.json` | the 401 names the header and the `?clientId=` alternative; the Authorize dialog says what to paste |
| F-28 error contract | PASS | `api-walk3.txt` E1–E18 | values, rules and fields named; nulls and blanks named by position (UX-45 closed); unknown fields named on publish, update, retire and ticket (UX-44 closed). The matrix row's "unknown JSON fields ignored" no longer holds there, by design (G-3-8). **friction** UX-56, UX-60 |
| F-29 OpenAPI / Swagger UI | PASS | `swagger3.json`; `openapi-responses.txt`; `22`, `23` | 20 operations, a lock on each, Authorize explains, try-it-out goes from 401 to 200; **friction** UX-57, UX-58 |
| F-30 database down | PASS | `ux3-dbdown-run.txt` | `503 database unavailable` in 5.0 s; readiness `DOWN` in 1.0 s; liveness `UP`; ready again 1.8 s after Mongo returns |
| F-31 register a monitor | PASS | `api-walk3.txt` H1, H6–H8; `monitor-typos.txt` | 201 with Location; a duplicate gets 409; **friction** UX-56 |
| F-34 probe now | NOT VERIFIED | `api-walk3.txt` H2 | only the push-only error was exercised ("monitor … is push-only (no url) and cannot be probed", clear); the success path was not run from this seat |
| F-67 sidecar configuration | PASS | `sidecar-manifests3.txt` S7 | every bad value named at once, exit 2; an invalid `CS_LOG_LEVEL` exits 2 and names the allowed values |
| F-76 graceful shutdown | PASS | `sidecar-pod3.txt` P10 | the leaving report on SIGTERM |
| F-78 `/status`, logs, debugging | PASS | `sidecar-pod3.txt` P2, P4, P9, P11; `sidecar-cause3.txt` | the README's three causes reproduce as described; `CS_LOG_LEVEL=debug` shows every send (UX-51 closed); **friction** UX-63 |
| F-80 image | NOT VERIFIED (UBI) | `sidecar-manifests3.txt` S9 | the UBI registry is blocked; the repository Dockerfile with a distroless base runs as UID 1001, and as 1000660000 under the restricted flags |
| F-82, F-83 Kustomize | PASS | `sidecar-manifests3.txt` S1, S2, S3, S3b | both variants render and validate; the README's Image and `CS_LOG_LEVEL` steps apply as written |
| F-84 Helm library chart | PASS | `sidecar-manifests3.txt` S5; `helm-include-variants.txt` | the README's three pieces render a valid Deployment (UX-46 closed); **friction** UX-62 |
| F-85 plain YAML | PASS | `sidecar-manifests3.txt` S6; `sidecar-plain-yaml3.txt` | the file is valid and its container matches the Kustomize patch (51 settings); **friction** UX-64 (the README row leaves out the ConfigMap) |
| F-86 manifest validity | PASS | `sidecar-manifests3.txt` S1–S6 | every form valid under `kubeconform -strict` 1.29 |
| F-88 startup ordering | PASS | `sidecar-pod3.txt` P1, P3, P5, P7 | sidecar first: UNKNOWN "starting: waiting for the app to listen", then the app is found when it starts; stop and start give DOWN and UP |

## 4. Findings

### 4.1 List

| ID | severity | surface | feature | what the user experiences | fix |
|---|---|---|---|---|---|
| UX-42 residual | minor | UI | F-59, F-61, F-30 | while the database is down the badge says "Live" next to "Couldn't load the feed"; a page opened then shows a skeleton under "Live" most of the time and announces Live/Reconnecting in a loop | count the stream as live only after its first frame; keep the error on screen through the reload; say "service degraded" on the badge after a 503 |
| UX-52 | minor | UI | F-57, F-09 | third notice for one incident: the 409 banner advises `INC…-2`, which the second notice already holds; following it gets a second 409 | the service returns the first free reference in the 409 and the banner uses it |
| UX-53 | minor | UI | F-65, F-59 | "Couldn't load the feed" appears silently: a screen reader hears nothing after Refresh or a failing load | render the feed's error state in `role="alert"` |
| UX-54 | minor | UI | F-56, F-65 | after "View in feed" focus is on `<body>`; the next Tab lands on the Service filter | focus the results container (already `tabIndex=-1`) or the new card |
| UX-55 | cosmetic | UI | F-62 | Escape inside the inline Resolve/Withdraw confirmation does nothing | Escape cancels, as the Cancel button does |
| UX-56 | minor | API | F-31, F-28 | `intervalSecond`, `failureTreshold` or `staleAfterSecond` on monitor registration are silently dropped (201 with defaults); a misspelled `staleAfterSeconds` leaves a push-only service with no crash detection | declare the strictness on `RegisterMonitorCommand`; name the endpoint in the README |
| UX-57 | minor | API | F-29 | Swagger shows no 201/200 response for publish and update, "200" where the service answers 201/202/204, and every 400 as "Undocumented Error: Bad Request" | declare every success code with its schema and one shared 400 `{"error"}` response |
| UX-58 | cosmetic | API | F-29 | Swagger's own publish example is rejected four times in a row before it passes; the monitor example is rejected too | give the request schemas field examples that pass |
| UX-59 | cosmetic | API | F-28, F-01 | the 409's "for example" value can be taken already (`INC0012345-2` on a third notice) or awkward (`INC0012345-2-2`) | the same fix as UX-52 |
| UX-60 | cosmetic | API | F-28, F-05 | only the first unknown field is named; a GET document PUT back is rejected on `id` alone, then on the next field | collect and name every unknown field |
| UX-61 | cosmetic | API (README) | F-01, F-63 | the cookbook's first body carries `**elevated errors**` in a plain-text field; the card shows the asterisks | drop the asterisks from the example |
| UX-62 | cosmetic | Sidecar | F-84, F-78 | the README names `csHealthSidecar.extraEnv` without its shape; the map form an engineer may guess fails `helm template` at "line 47" of the rendered Deployment | print the three-line list snippet |
| UX-63 | cosmetic | Sidecar (service side) | F-47, F-78 | the monitor list says "UNKNOWN (1 pod starting, none reporting yet)" about a pod that reports "no health target found … set CS_PORT and CS_PATH" at every heartbeat | summarise the pods' own message |
| UX-64 | minor | Sidecar | F-85 | the plain-YAML row says "pastes the container block"; the block reads a `cs-health-sidecar` ConfigMap the row never mentions, and the file's header calls everything above the container "the team's own Deployment" | name the ConfigMap and its keys in the row, as the Kustomize row does; fix the header comment |

Deductions: UI 4 × 3 + 1 × 1 = 13; API 2 × 3 + 4 × 1 = 10; sidecar 1 × 3 + 2 × 1 = 5.

### 4.2 Detail: root cause, reproduction, fix, test that should have caught it

#### UX-42 residual · minor · UI: the badge says "Live" while the service cannot read its database
- **Where:** the Feed tab during a real outage: `ux3-mongo` was stopped for 51 s under backend B (F-59, F-61, F-30).
- **What the user experiences:**
  - The words are right now: "Couldn't load the feed. The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment."
  - The green badge next to them reads **"Live"** (`26-feed-mongo-down.png`; `ux3-dbdown-run.txt` `[ui-feed-while-down]`).
  - A page opened during the outage cycles every ~8 s. It shows a loading skeleton under "Live" for ~5 s, then the error under "Reconnecting" for ~3 s.
  - In 45 one-second samples: "Live" with the skeleton 29 times, the error visible 10 times, "Reconnecting" with the skeleton 5 times, "Connecting" once. 7 feed GETs (all 503) and 6 streams.
  - A screen reader hears "Live", "Reconnecting", "Live", … and never the error (`ux3-dbdown-log.jsonl`, page2 announcements).
- **Root cause:**
  - The stream answers 200 with `: connected` before its snapshot query runs. The snapshot then fails after the 5 s server-selection timeout and the stream closes.
  - `frontend/src/outages/useOutageFeed.ts:96-103` treats `onopen` as live. When the stream had been down, it reloads (`setTick`), which clears the error.
  - `frontend/src/outages/OutageFeed.tsx:143-158` shows the skeleton whenever `loading && items.length === 0`.
- **Reproduction:** run `scripts/ux3-dbdown.js` and `scripts/ux3-fresh-during-outage.js` against a backend whose Mongo you can stop.
- **Fix:**
  - Count the stream as live only after its first frame (snapshot or event).
  - Keep the last error on screen while the reload after a reconnect is in flight.
  - When the last load answered 503 "database unavailable", let the badge say so (for example "Service degraded") instead of "Live".
- **Test that should have caught it:**
  - `useOutageFeed` test: a stream that opens and closes without a frame stays "Reconnecting".
  - `OutageFeed.test.tsx`: the error state survives the reload after a reconnect.
- **Evidence:** `ux3-fresh-during-outage.json`; `ux3-dbdown-run.txt` (`[ui-fresh-page-while-down]` `badgeOverTime`); `26`, `27`, `29`.

#### UX-52 · minor · UI: the duplicate-reference advice names a value the tenant already holds
- **Where:** the Publish tab, the 409 banner, the third notice for one incident (F-57, F-09).
- **What the user experiences:**
  1. Notice 1 for INC3100001 publishes.
  2. Notice 2 gets a 409 advising INC3100001-2; following the advice publishes it.
  3. Notice 3 gets the same advice, "such as INC3100001-2", which is the value notice 2 now holds.
  4. Following it gives a second 409: "INC3100001-2 is already the External reference of a notice in tenant ux3-third … such as INC3100001-3".
  5. INC3100001-3 publishes.

  No guessing is needed, but the advice costs one extra round trip, from the third notice on.
- **Root cause:**
  - `frontend/src/outages/errors.ts:62-65`: `nextReference()` derives the suggestion from the rejected value alone (`${reference}-2`, or the trailing digit + 1).
  - The service's own example has the same blind spot (UX-59, `MongoCommunicationRepositoryAdapter.java:92`).
- **Reproduction:** `node scripts/ux3-third-notice.js` (tenant `ux3-third`).
- **Fix:** the service computes the first free value (one indexed query on `external_ref_idx`) and returns it in the 409 body, for example `suggestedExternalRef`. The banner shows that value.
- **Test that should have caught it:**
  - `PublishOutageForm.test.tsx`: a 409 for `X` when `X-2` is also taken.
  - A service test: the 409's suggestion is free.
- **Evidence:** `ux3-third-notice-run.txt:4-6`; `21-third-notice-suggests-taken-value.png`; `21b-third-notice-advice-rejected.png`.

#### UX-53 · minor · UI: the feed's load error is not announced
- **Where:** the Feed tab, the "Couldn't load the feed" state (F-65, F-59, F-57).
- **What the user experiences:**
  - The error replaces the list inside a plain `<div>`. A screen-reader user who presses Refresh or "Try again", or whose first load fails, hears nothing (WCAG 4.1.3).
  - In the real outage the live-region log recorded the publish banner (`role=alert`) and the badge, never the feed error.
  - The publish banner and the card error are `role=alert` (`PublishOutageForm.tsx:282`, `:300`; `OutageCard.tsx:149`). The feed is the one error that is not.
- **Root cause:** `frontend/src/outages/OutageFeed.tsx:143-154` renders `EmptyState` for the error, and `frontend/src/ui/EmptyState.tsx:21` has no role and no live region. The markup is the same at `908598a`, so this predates iteration 3.
- **Reproduction:** run row 8 of §2, or any failing `GET /v1/feed`, then read the announcements.
- **Fix:** render the feed's error state inside `role="alert"`, or give `EmptyState` a `role` prop and use `alert` here.
- **Test that should have caught it:** `OutageFeed.test.tsx`: after a failing refresh, `getByRole('alert')` contains "Couldn't load the feed".
- **Evidence:** `ux3-dbdown-log.jsonl` (announcements, page1 and page2); `feed-error-markup.txt`; `26`, `27`.

#### UX-54 · minor · UI: "View in feed" drops focus to `<body>`
- **Where:** the Publish result, "View in feed" (F-56, F-58, F-65).
- **What the user experiences:**
  - The tab, tenant and type switch to the new notice's feed, but focus falls to `<body>`.
  - A screen reader hears only "Connecting… Live".
  - The next Tab starts at the Service filter, not at the notice just published.
  - Measured twice, with the same result. This is the same class as iteration 1's UX-17, which was fixed for "Publish another" (that button now focuses Title, `[publish-another-focus]`).
- **Root cause:** `frontend/src/App.tsx:140-144`: `onViewFeed` calls `showTenant`, `setFeedType` and `go('feed')`, and moves no focus.
- **Reproduction:** `node scripts/ux3-view-in-feed-focus.js`.
- **Fix:** after the switch, focus the results container (`OutageFeed.tsx:140` already has `tabIndex={-1}`) or the new card's heading.
- **Test that should have caught it:** `App.test.tsx`: after "View in feed", `document.activeElement` is inside the feed results.
- **Evidence:** `ux3-view-in-feed-focus.txt` (runs 1 and 2: `focusAfterViewInFeed: body`); `ux3-keyboard-only-run.txt` `[view-in-feed]`.

#### UX-55 · cosmetic · UI: Escape does not cancel the inline confirmation
- **Where:** a feed card's Resolve or Withdraw confirmation (F-62).
- **What the user experiences:** Escape leaves the confirmation open with focus in the note field. Cancel is one Tab away, so the user is not stuck.
- **Root cause:** `frontend/src/outages/OutageCard.tsx:126` (the `role="group"` box) has no key handler; `confirm(open)` is at `:39`.
- **Fix:** on Escape, call `confirm(false)`, which returns focus to Resolve as Cancel does.
- **Test that should have caught it:** `OutageCard.test.tsx`: pressing Escape closes the box and focuses Resolve.
- **Evidence:** `ux3-ui-run.txt` `[resolve-escape]`.

#### UX-56 · minor · API: monitor registration ignores misspelled policy fields
- **Where:** `POST /v1/health/monitors` (F-31, F-28).
- **What the user experiences:**
  - `{"intervalSecond":3600,"failureTreshold":5}` answers 201 with `intervalSeconds 30` and `failureThreshold 2`.
  - `{"staleAfterSecond":60}` answers 201 with no `staleAfterSeconds` at all.
  - The README (`README.md:354-355`) tells push-only services to set `staleAfterSeconds` "so a hard crash, which can no longer push anything, is still detected". The sweep only checks push-only monitors that have it (`HealthSweepUseCase.java:148`), so a misspelling silently switches crash detection off.
  - The same mistake on the publishing endpoints is a 400 naming the field. The README's paragraph on unknown fields (`README.md:216-219`) says nothing about registration.
  - A careful developer can spot the problem only by comparing the policy echoed in the 201.
  - Minor, like UX-44 in iteration 2.
- **Root cause:** `src/main/java/com/atlas/communication/health/domain/RegisterMonitorCommand.java:14` does not declare `@JsonIgnoreProperties(ignoreUnknown = false)`. `RejectUnknownFieldsModule` rejects unknown fields only for types that declare it: `Ticket.java:17`, `CreateCommunicationCommand.java:31`, `UpdateCommunicationCommand.java:27`, `RetireRequest.java:6`.
- **Reproduction:** `monitor-typos.txt` (on A). `api-walk3.txt` H8 shows the same on the shared store.
- **Fix:** declare the annotation on `RegisterMonitorCommand` (health reports stay lenient) and add the endpoint to the README's sentence.
- **Test that should have caught it:** `RestControllerHealthAdapterTest`: a misspelled policy field gives a 400 naming it and the known fields.
- **Evidence:** `monitor-typos.txt:2-13`; `api-walk3.txt:175-177`.

#### UX-57 · minor · API: OpenAPI responses are missing or wrong
- **Where:** `/v3/api-docs` and Swagger UI (F-29).
- **What the user experiences:**
  - `POST /v1/communications` and `PUT /v1/communications/{id}` document only 401 and 409. There is no 201/200 response and no response schema.
  - `POST /v1/health/monitors` (answers 201), `POST /v1/health/reports` (202), `DELETE /v1/health/monitors/{id}` and `DELETE /v1/admin/communications/{id}` (204) are all documented as 200.
  - No operation documents a 400. Swagger labels every input error "Undocumented Error: Bad Request" and a report "202 Undocumented".
  - Nothing in the document says unknown fields are rejected (`openapi-responses.txt`: "any operation mentioning unknown fields: False").
  - This predates iteration 3: the same declarations are at `908598a`.
- **Root cause:**
  - `RestControllerPublishingAdapter.java:43-45`: POST declares only `@ApiResponse(responseCode = "409")`; springdoc then omits the success response. The same at `:78-80` for PUT.
  - `RestControllerHealthAdapter.java:44` (`created`), `:72` (`noContent()`) and `:85` (`ACCEPTED`), and `RestControllerAdminAdapter.java:71` (`noContent()`): springdoc infers 200 from the return type.
- **Reproduction:** `curl -s localhost:8080/v3/api-docs` and list `paths.*.*.responses` against the walk's answers (`openapi-responses.txt`).
- **Fix:** declare every success code with its schema, plus one shared 400 response (`{"error": …}`, with an unknown-field example) on every write operation.
- **Test that should have caught it:** an `OpenApiContractIT` that compares each operation's documented codes with the codes the handler returns.
- **Evidence:** `openapi-responses.txt`; `openapi-iter2-vs-iter3.txt`; `swagger3.json` (`post400: ""`, `put400: ""`, `defaultReport` "202 Undocumented"); `22`.

#### UX-58 · cosmetic · API: Swagger's offered examples fail
- **Where:** Swagger UI "Try it out" with the example bodies as offered (F-29).
- **What the user experiences:**
  - The publish example gets four 400s in a row, one per fix:
    1. `ticket.url must be an http(s) link`
    2. `endsAt … must be after startsAt …` (the example sends the same instant for both)
    3. the same for `expiresAt`
    4. `INCIDENT requires severity MINOR or higher`
  - The fifth try passes and creates a draft.
  - The monitor example fails with `downSeverity must be MINOR or higher`.
  - The report example is accepted (202) and auto-registers a monitor named `string` in tenant `string`. That happened on private A. It follows from the deliberately lenient reports, but it leaves junk behind on any shared environment.
  - Every message is clear, so the user recovers alone; hence cosmetic.
- **Root cause:** the request records (`CreateCommunicationCommand`, `RegisterMonitorCommand`, `Ticket`) carry no `@Schema(example = …)` on these fields, so Swagger invents `"string"`, `INFO` and one shared timestamp.
- **Fix:** add field examples that pass together (an `https://` ticket URL, `severity` MAJOR, no `endsAt`/`expiresAt` or later ones, `downSeverity` MAJOR).
- **Test that should have caught it:** a test that posts each operation's generated example body and expects a 2xx.
- **Evidence:** `swagger-example-chain.txt`; `swagger3.json` (`defaultPublish`, `defaultMonitor`, `defaultReport`); `23`.

#### UX-59 · cosmetic · API: the 409's "for example" value is not checked
- **Where:** `POST /v1/communications` 409 text (F-28, F-01).
- **What the user experiences:**
  - On a third notice for `INC0012345` the text suggests `INC0012345-2`, which the second notice already holds (C2b).
  - For `INC0012345-2` it suggests `INC0012345-2-2`, while the UI suggests `-3` (cookbook run 2).
- **Root cause:** `MongoCommunicationRepositoryAdapter.java:92` builds `"(for example " + ref + "-2)"` without looking.
- **Fix:** the same as UX-52; one helper computes the first free value for both.
- **Test that should have caught it:** a repository-adapter IT in which `ref-2` is taken.
- **Evidence:** `api-walk3.txt:19-20`; `cookbook-literal.txt:43`.

#### UX-60 · cosmetic · API: only the first unknown field is named
- **Where:** the 400 for unknown fields (F-28, F-05).
- **What the user experiences:**
  - `{"expiryAt":…,"sevrity":…}` names only `expiryAt` (E6f).
  - A read-modify-write that PUTs the whole GET document back is rejected on `id` alone (C5r). Then come `tenantId`, `publisher` and the rest, one round trip each, unless the developer reads the list of known fields that every message carries. That list is what keeps this cosmetic.
- **Root cause:** `src/main/java/com/atlas/communication/config/RejectUnknownFieldsModule.java:45-50` throws `UnrecognizedPropertyException` at the first unknown property.
- **Fix:** collect the unknown names during deserialisation and report them all ("unknown fields 'id', 'tenantId', …").
- **Test that should have caught it:** `RestControllerPublishingAdapterTest`: two unknown fields are both named.
- **Evidence:** `api-walk3.txt:51-52`, `:100-101`.

#### UX-61 · cosmetic · API (README): the first cookbook example uses Markdown in a plain-text body
- **Where:** `README.md:376` (F-01, F-63).
- **What the user experiences:**
  - The body is `"We are investigating **elevated errors**."`, while `README.md:319` says bodies are plain text and the form's hint says "Plain text." (`PublishOutageForm.tsx:177`).
  - The card shows the asterisks literally (`24-readme-example-body-card.png`).
  - A developer who copies the example learns to send Markdown that consumers then see raw.
- **Fix:** drop the asterisks.
- **Test that should have caught it:** none practical; a docs lint for `**` inside JSON strings in the cookbook would do.
- **Evidence:** `readme-example-body.txt`; `24`.

#### UX-62 · cosmetic · Sidecar: `extraEnv` is named without its shape
- **Where:** `sidecar/README.md:250-251`, "with Helm to `csHealthSidecar.extraEnv`" (F-84, F-78).
- **What the user experiences:**
  - The list form (`- name: CS_LOG_LEVEL` / `value: debug`) works.
  - The map form an engineer may guess (`CS_LOG_LEVEL: debug`) fails `helm template` with "YAML parse error … line 47: did not find expected '-' indicator". Line 47 is in the rendered Deployment, not in the values file.
  - The chart's `values.yaml` does show `extraEnv: []`, which is the hint that recovers it.
- **Root cause:** the README sentence; `deploy/helm/cs-health-sidecar/templates/_container.tpl` renders `extraEnv` with `toYaml . | nindent`.
- **Fix:** print the three-line snippet next to the sentence.
- **Test that should have caught it:** extend `deploy/helm_test.go` (which already renders the README's include lines) with the README's `extraEnv` snippet.
- **Evidence:** `sidecar-manifests3.txt` (f) and (g); `helm-include-variants.txt:21`.

#### UX-63 · cosmetic · Sidecar (service side): "none reporting yet" about a pod that reports
- **Where:** `GET /v1/health/monitors`, the summary the README's debugging section has the engineer read (F-47, F-78).
- **What the user experiences:**
  - The monitor lists "UNKNOWN (1 pod starting, none reporting yet)".
  - Meanwhile the pod, past its grace, reports "no health target found after 10s: no listening port answered; set CS_PORT and CS_PATH" at every heartbeat.
  - For the wrong-port pod it says the same while that pod reports "… never answered UP since start; check CS_PORT …".
  - The instances command does show the pod's message, so the engineer recovers by following the README's next step.
- **Root cause:** `src/main/java/com/atlas/communication/health/domain/HealthRollup.java:104` (`live + " pod starting" + ", none reporting yet"`) describes every live UNKNOWN pod as starting.
- **Fix:** when every live pod is UNKNOWN, carry the most recent pod message ("1 pod UNKNOWN: no health target found … set CS_PORT and CS_PATH").
- **Test that should have caught it:** a `HealthRollup` test in which a pod past its grace reports UNKNOWN with a message.
- **Evidence:** `sidecar-cause3.txt:3-15`.

#### UX-64 · minor · Sidecar: the plain-YAML row leaves out the ConfigMap the container needs
- **Where:** `sidecar/README.md:32` ("Plain YAML … pastes the container block") and `sidecar/deploy/manual/deployment.yaml:1-2` (F-85).
- **What the user experiences:**
  - The Kustomize row (`:30`) names the `cs-health-sidecar` ConfigMap and its keys (`CS_ENDPOINT`, `CS_TENANT`, optionally `CS_CLUSTER`). The plain-YAML row names only the container block, and so does `:113` ("the pasted container block").
  - The pasted block reads that ConfigMap (`deployment.yaml:38-40`, `envFrom … configMapRef: cs-health-sidecar`, not `optional`).
  - The linked file's header says "Everything above the "health-sidecar" container is the team's own Deployment". That includes the ConfigMap at lines 3–10, which is not the team's.
  - The debugging section does not cover a missing ConfigMap.
  - A team that does what the row says gets a Deployment that `kubeconform -strict` accepts. Kubernetes then cannot create the sidecar container (`CreateContainerConfigError`, configmap "cs-health-sidecar" not found), so the pod never becomes Ready and the rollout stalls.

  The ConfigMap is visible at the top of the linked file, and `:250` mentions it in passing. A careful reader notices the gap, hence minor rather than major.
- **Root cause:** the README row and the header comment of `deploy/manual/deployment.yaml`. Both are unchanged since `f18057d`, so this predates iteration 3.
- **Reproduction:** `bash scripts/sidecar-plain-yaml3.sh`.
- **Fix:**
  - Write the row as "applies the `cs-health-sidecar` ConfigMap (`CS_ENDPOINT`, `CS_TENANT`, optionally `CS_CLUSTER`) and pastes the container block".
  - Make the header comment say that the ConfigMap is the sidecar's and only the Deployment is the team's.
  - Optionally, add "a pod stuck in CreateContainerConfigError" to the debugging section.
- **Test that should have caught it:** none in code. A docs check that each attach path's row names every object its snippet references would.
- **Evidence:** `sidecar-plain-yaml3.txt`. The kubelet's answer was not exercised (no cluster, §5); it is Kubernetes' documented behaviour for a missing, non-optional `envFrom` ConfigMap.

### 4.3 Iteration-2 findings re-checked

| ID (iteration 2) | was | now | evidence |
|---|---|---|---|
| UX-40 409 banner in the API's words | minor | **CLOSED**: "INC3000001 is already the reference of a notice in tenant ux3-sre (the ServiceNow incident number doubles as the reference). References are permanent … such as INC3000001-2." The service's sentence sits under "What the service said". The advice publishes, for the ticket form and for an explicit External reference, on desktop, phone and dark. A new edge case is UX-52 | `ux3-ui-run.txt` `[duplicate-409]`, `[duplicate-409-details]`, `[duplicate-advice-works]`, `[duplicate-409-extref]`, `[duplicate-extref-advice-works]`, `[phone-409]`; `aria-409.txt`; `05`, `05b`, `11`, `16`, `16b` |
| UX-41 focus lost when the confirmation opens | minor | **CLOSED**: focus goes into the note field; the group is named by its question; Cancel returns focus to Resolve; a failed resolve returns focus to Resolve with a `role=alert` error; after the last card, focus stays on the page | `[resolve-confirm]`, `[resolve-cancel]`, `[after-resolve]`, `[withdraw-confirm]`; `ux3-keyboard-only-run.txt` `[resolve-fails]`, `[resolve-retry]`; `aria-confirm.txt`; `08`, `14`, `32` |
| UX-42 a 503 from the service shown as "unreachable" | minor | **PARTLY CLOSED**: the words are right on both tabs, in a mocked and in a real outage. The badge remains "Live", graded as the UX-42 residual | `[variant-503-db]`, `[feed-503-db]`; `ux3-dbdown-run.txt` `[ui-publish-while-down]`, `[ui-feed-while-down]`; `10`, `10b`, `26`, `28` |
| UX-43 cookbook says "works on any day" | cosmetic | **CLOSED**: the intro now says that where `vmforge` has published `INC0012345` the first example answers 409 naming the notice, and the second does the same for `-2`; verbatim on the shared store it does exactly that | `README.md:359-362`; `api-walk3.txt` C1; `cookbook-literal.txt` run 2 |
| UX-44 misspelled field silently dropped | minor | **CLOSED** on publish, update, retire and inside `ticket`: a 400 names the field and lists the known ones, case included. The same class remains on monitor registration (UX-56) | `api-walk3.txt` E6–E6f; `README.md:216-219` |
| UX-45 null in `affectedServices` → "Failed to read HTTP message" | minor | **CLOSED**: `affectedServices[1]: must not be null`, `… must not be blank`, `affectedServices: expected a JSON array` | `api-walk3.txt` E7, E7b, E7c |
| UX-46 the Helm include, pasted as printed, renders invalid | minor | **CLOSED**: the README's three pieces render a valid Deployment and lint clean; the variants the README warns against fail exactly as it says | `sidecar-manifests3.txt` S5; `helm-include-variants.txt` |
| UX-47 automated notice rough (internal reference chip, wording, actor) | cosmetic | **CLOSED**: "Automatic" chip; "payments-api is DOWN as of 2026-11-02 07:09:16 UTC. Reported by its pods: 0 of 1 pod UP (DOWN: …)"; one actor (`health-sidecar`) through ACTIVE → RETIRED | `sidecar-pod3.txt` P5–P7; `25-*` |
| UX-48 badge invisible to a screen reader | minor | **CLOSED**: `status "Live"` in the accessibility tree; "Reconnecting", "(1)"…"(7)", "Live" announced through a real kill and restart | `aria-feed.txt`; `ux3-reconnect-run.txt` `[announcements]` |
| UX-49 every keystroke reloads the tenant | cosmetic | **CLOSED**: typing `ux3-sre` sends one GET and opens one stream; Tab out commits at once (one GET) | `[type-tenant]`, `[type-then-tab]` |
| UX-50 "Paused" next to an on switch with no tenant | cosmetic | **CLOSED**: "Waiting for a tenant" | `[landing]`, `[clear-tenant-850ms]`; `01` |
| UX-51 debug logging promised but unreachable | minor | **CLOSED**: `CS_LOG_LEVEL=debug` shows every send; `verbose` exits 2 naming the allowed values; the README says where to set it for each path (the Helm shape is UX-62) | `sidecar-pod3.txt` P9; `sidecar-pod3-container-debug.txt`; `sidecar-manifests3.txt` S7 |
| UX-15 residual: feed switch 30×18 px with no row target | cosmetic | **CLOSED**: the switch sits in a 74×26 px label row (≥ 24 px, WCAG 2.5.8) | `[phone-feed]` `smallTargets` |
| UX-21b residual: date 400 without values | minor | **CLOSED**: values named, including a defaulted `startsAt`, for `expiresAt` and `endsAt` | `api-walk3.txt` E4, E4b, E4c |
| UX-24 residual: bare 400 without `expectedVersion` | cosmetic | **CLOSED**: "expectedVersion is required: send the version from your last GET of this notice; a 409 means someone changed it since" | `api-walk3.txt` C5 (`C5-put-omitted`) |

## 5. Not exercised in this sandbox, and why

- **OpenShift and Kubernetes:**
  - There is no OpenShift cluster, and kind cannot start pods here (`confidence/evidence/environment.md`).
  - The manifests were rendered and validated only (kustomize, helm, `kubeconform -strict` 1.29).
  - `oc logs`, `oc port-forward` and `oc rollout restart` from the README were emulated with Docker: `docker logs`, published ports, and a restarted sidecar container.
  - Not seen at all: the kubelet's and admission's answers, including the `CreateContainerConfigError` behind UX-64 and the native-sidecar ordering on a real node.
- **UBI base image:** the registry is blocked. The image under test was built from the repository Dockerfile on `gcr.io/distroless/static-debian12:nonroot`, at 16.3 MB against the README's "about 10 MB" for UBI; with a different base the two are not comparable.
- **A real screen reader:** none here. Substitutes:
  - the accessibility tree (`ariaSnapshot`);
  - axe-core 4.10 (WCAG 2.0/2.1/2.2 A and AA tags);
  - keyboard-only traversal;
  - a MutationObserver log of every `role=status`, `role=alert` and `aria-live` change.

  The phone is Chromium's iPhone 14 emulation, not a device.
- **The ServiceNow link:** the instance URL is unset in this stack, so the ticket chip was reviewed as text, not as a link.
- **The Helm chart repository:** the README's repository URL is a placeholder. The consuming chart used a local `file://` copy of `deploy/helm/cs-health-sidecar`.
- **F-34's success path:** not run from this seat (§3).

## 6. Observations without deduction

- **Contrast.** axe left `color-contrast` "incomplete" on the four publish-form scans. The node is the Details textarea, "partially obscured by another element". Checked by hand:
  - text 15.46:1 (light) and 15.63:1 (dark);
  - placeholder 4.66:1 and 5.93:1.

  All are at or above 4.5:1 (`contrast-incomplete.txt`).
- **Tenant field.** For the first ~400 ms after the tenant field is cleared, the badge still reads "Live"; after that it shows "Waiting for a tenant". This is the documented settle time (`[clear-tenant-150ms]`, `[clear-tenant-850ms]`).
- **Backend B's log during the 51 s outage:** 61 WARN lines and 0 ERROR (`backend-19601-outage-warn-error.txt`). They break down as:
  - 19 `event log poll failed`;
  - 14 `GET /v1/feed -> 503`, which is the UX-42 residual's reload loop;
  - 10 `feed stream closed`;
  - 8 health-sweep and 2 status-sweep skips;
  - 7 other 503s;
  - one `readiness DOWN`.

  Each line names its cause. Log volume is the backend verifier's area.
- **Hidden focus.** No focused stop is hidden under the sticky header. Tested with real Tab and Shift+Tab, a 700 ms settle, desktop and phone (`ux3-focus-obscured-run.txt`, `ux3-focus-reverse-run.txt`, `18`–`20`). An earlier screenshot (`08`) shows the question under the header, but it was caused by my script's programmatic `focus()`, not by keyboard use.
- **What works well:**
  - 9 axe scans with 0 violations, across both themes and both widths.
  - 14 named, ringed stops from the Publish tab to submit.
  - Live create in 845 ms and retire in 188 ms.
  - Outage: 503 in 5.0 s, readiness DOWN in 1.0 s, ready 1.8 s after Mongo returns, and the sidecar's `sendError` names the 503.
  - Automated OUTAGE 7.4 s after the app stops, retired 12.9 s after it returns.
  - The README's three "does not show up" causes reproduce exactly.
  - Every attach path validates.
  - Configuration errors are named together, with exit 2.
  - The README's `go test ./...` passes on the host's Go 1.24.7 through the toolchain download.

## 7. Data left behind and teardown

- **Shared store**, tenants with the `ux3` prefix only:
  - `ux3-api`: 1 EXPIRED, 5 RETIRED;
  - `ux3-focus`: 12 RETIRED;
  - `ux3-kbd`: 1 RETIRED;
  - `ux3-kbd2`: 2 RETIRED;
  - `ux3-sre`: 8 RETIRED, plus 1 DRAFT, which no feed shows;
  - `ux3-third`: 3 RETIRED.

  There are no monitors under any `ux3-*` tenant. The `ux3-swagger` draft from row 16 was deleted (204; the GET afterwards answers 404). `vmforge` received the first cookbook example verbatim once, which answered 409 and wrote nothing. `ux3-fresh-tenant` and `ux1-many` were only read.
- **Private:**
  - database `ux3` on `mongo7` is left in place (my own database);
  - `ux3-mongo` (database `ux3b`) and every `ux3-*` container are removed;
  - ports 19600, 19601, 19617, 3600 and 3601 are free.
- **Shared stack at the end:** `/actuator/health` 200, `:3000` 200, containers `app`, `sidecar` and `mongo7` up and untouched.

## 8. Reproduce

The scripts are under `confidence/evidence/iter-3/usability/scripts/`. They expect to run from a scratch folder that contains `playwright` (resolvable globally here) and `@axe-core/playwright` (installed in that folder, never in `frontend/`). They write their logs to `../logs` and screenshots to `../shots`. Row 1 of §2 starts the private stack they assume. Tenants and ports are at the top of each script.
