# Iteration 1 — Independent Audit

**Auditor:** Independent Auditor (did not write any code, test, fix or verifier report; did not modify any file outside `confidence/evidence/iter-1/audit/` and this report).
**When:** 2026-11-02 02:20–03:20 UTC. **Code under test:** commit `0e14838` on `confidence-loop/2026-11-01` (28 commits over the iteration-0 baseline `191a0c5`) — see section 7, because iteration-2 fix commits started landing on the branch at 03:01 UTC while this audit ran.
**Method:** seeded random sample (seed 1) of 20 % (ceil) of the 317 claims extracted from the five iteration-1 reports, stratified per report: backend 20 of 100, frontend 11 of 51, sidecar 10 of 48, E2E 12 of 56, usability 13 of 62 = **66 claims** (`evidence/iter-1/audit/00-claims-and-sample.txt`). Plus the three directed checks: (a) the test-weakening check over the 24 fix commits, (b) a recount of feature completeness, (c) at least one re-verified claim per closed gap G-1-1 … G-1-24. Every sampled claim was re-run or re-derived against the auditor's own instances (jar `communication-service-iter1.jar` on :19800–19806 with Mongo databases `audit1-*`, Vite dev servers on :3800/:3805/:3806, a static build on :3827, the probe stub on :19810, containers `audit1-*` for the pod emulation, the shared stack only read); the verifiers' own scripts were replayed re-pointed at those ports, or an equivalent check was written when the script was bound to the shared stack. Usability figures are the Usability Reviewer's (UI 74, API 93, sidecar 100), per the convention set by the iteration-0 audit.

## 1. Verdict per score

| Score | Claimed | Audit verdict | Audited value | Why |
|---|---|---|---|---|
| Backend | 87 | **ADJUST → 88** | 88.3 | All 20 sampled claims reproduced (builds, SpotBugs to the finding, 65/65 rows, cookbook, G-1-6 ERROR storm, retire-after-expiry 409, probe semantics, instance records). Only change: usability 8 (provisional) → 9.3 (reviewer's API score 93/100). No gate tripped. |
| Frontend | 93 | **ADJUST → 91** | 91.4 | All 11 sampled claims reproduced (lint/audit, 78/78 ×3, coverage 74.07 %, draft/feed/cards/empty states, cross-origin limitation, SIGKILL → *Reconnecting (n)* → Live, GAP-frontend-2 in the code and on the wire). Only change: usability 9 → 7.4 (reviewer's UI score 74/100). No gate tripped. |
| Sidecar | 88 | **ADJUST → 89** | 89.4 | All 10 sampled claims reproduced (gofmt/vet/build, 33 tests + `-race`, govulncheck blocked, no removed test line, DOWN with component detail, flap damping, TLS/CA, image facts, memory plateau, JSON logs). Only change: usability 9 → 10 (reviewer's operator score 100/100). No gate tripped. |
| E2E system | 86 | **ADJUST → 85** | 85.4 | All 12 sampled claims reproduced (108/108 HTTP checks, silent pod, log review, first byte, resume, fleet burst, WARN → DEGRADED, dead app, JSON logs, pod flows in the UI). Only change: usability 8 (provisional) → 7.4 (UI 74/100, the lowest surface a journey crosses). No gate tripped. |
| Usability Reviewer (UI 74 / API 93 / sidecar 100) | — | **ACCEPT** | — | 13 of 13 sampled claims reproduced, including UX-16 from the user's seat (409 after the retire the banner recommends), the contrast ratios, the Swagger Authorize flow in a real browser, and the Kustomize/Helm image override. |

**Overall iteration-1 confidence (lowest of the four): 85 / 100** (iteration 0: 62). No VETO. No score was raised on the auditor's judgment; every change is the substitution of the reviewer's usability figure for a verifier's provisional one.

## 2. Sampled claims and results (66)

Evidence files are in `confidence/evidence/iter-1/audit/` (`ev-a/…` below). "MATCH" = the claim reproduced as stated; "MATCH (nuance)" = reproduced, with a detail worth recording; "MATCH (equivalent)" = the verifier's exact command was bound to its own ports/stack, so an equivalent check was run. There is no MISMATCH in the sample.

### Backend verifier (20)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-1 `./gradlew --max-workers=2 --no-daemon clean compileJava compileTestJava` | MATCH | `ev-a/20` BUILD SUCCESSFUL (the chain went on to `test integrationTest`, 41 s); exactly the four `[removal]` `IndexOperations.ensureIndex` warnings |
| 2 | cmd-4 `dependencies --configuration runtimeClasspath` | MATCH | `ev-a/21`, `ev-a/22`: Spring Boot 3.5.16, Spring 6.2.19, Netty 4.1.135.Final, logback 1.5.34, springdoc 2.8.17, swagger-ui 5.32.2 — the versions the G-1-9 commit message records |
| 3 | cmd-9 SpotBugs 4.9.3 `-effort:max -low` with the jar's `BOOT-INF/lib` as aux classpath | MATCH (exact) | `ev-a/23`: 50 findings, priority 2/3 = 42/8; MALICIOUS_CODE 41, PERFORMANCE 3, STYLE 4, I18N 2; `EI_EXPOSE_REP2` 28 + `EI_EXPOSE_REP` 13, `URF_UNREAD_FIELD` 3, `UWF_*` 3, `DM_CONVERT_CASE` 2 (`GlobalExceptionHandler.java:117`, `RestControllerFeedAdapter.java:89`), `REC_CATCH_EXCEPTION` 1 (`WebClientHealthProbeAdapter.java:77`). A first attempt with an empty aux classpath was discarded (auditor error) |
| 4 | cmd-13 `check_a2_tenants.py` (tenant summary with the real field name) | MATCH | `ev-a/32` run 2 `cmd-13/F-24` PASS, `F-23a–e` PASS |
| 5 | cmd-16 `check_d_gaps.py` (42 checks re-verifying G-1-1/4/5/6/7/8/20/21/24) | MATCH | `ev-a/30`: 41/42 on the auditor's A/V instances and stub; the single FAIL is `D-6-c`, the same line that fails in the verifier's own run (`evidence/iter-1/backend/22*`, a script expectation on the valve text) |
| 6 | cmd-18 README cookbook verbatim (port only), then 5 + 10 forced probes | MATCH (nuance) | `ev-a/36`: every block rc=0 except the bounded `curl -N` streams (rc=124, by design) and the literal `<monitorId>` placeholder block; forced probes: 1 of the first 5 → 409 (the GAP-backend1-4 race, reproduced once), then 15/15 → 200; second run of example #1 → 409 duplicate `externalRef` (UX-21 residual, as claimed); `PUT` with `expectedVersion:0` → 409 "does not match current version 1", without it → 400 "expectedVersion: must not be null" |
| 7 | cmd-27 log review (access log, level counts, WARN/ERROR) | MATCH | `ev-a/60`: A 620 INFO / 10 WARN / 0 ERROR, 605 access-log lines with the client id; WARNs are 7 scheduler-side "409 CONFLICT … modified concurrently" skips (the same race as #6), 2 springdoc defaults, 1 valve line; shared backend 1456 INFO / 3 WARN / 0 ERROR |
| 8 | F-06 retire + audit note, idempotent, actor default; 409 after `expiresAt` | MATCH | `ev-a/32` F-06a–c PASS; run 3 `G-1-20` PASS (retire 409 "already expired; retiring would rewrite history", update 409, history untouched) |
| 9 | F-22 2 s sweeper: `activated` + `expired` frames, stored EXPIRED, audit by `sweeper` | MATCH | `ev-a/32` run 3 F-22a/b: frames `created` 236 → `activated` 237 → `expired` 238 on the stream, stored EXPIRED, history `created (SCHEDULED)` / `sweeper: SCHEDULED -> ACTIVE` / `sweeper: ACTIVE -> EXPIRED` (run 2's FAIL was the auditor's SSE reader, see the file header) |
| 10 | F-23 admin tenants / search / purge | MATCH | `ev-a/32` F-23a–e PASS |
| 11 | F-29 OpenAPI document, Swagger UI, `openApiSpecIsServed`, `OpenApiContractIT` | MATCH | `ev-a/32` F-29a–c + `UX-23b` (3.x document, `X-Client-Id` apiKey scheme, 401 documented, every README path in the document); `ev-a/33b` the Authorize flow in Chromium (`ev-a/59`); `ev-a/20` the two ITs in the 39 |
| 12 | F-31 monitor registration: 201 + Location, defaults, 409 duplicate, 400 bad urls, push-only without `url` | MATCH (nuance) | `ev-a/32` F-31a (defaults 30 s / 5000 ms / 2 / 2 / MAJOR / MINOR / CUSTOMERS / 50 % / `health-monitor`), F-31b 409, F-31c 400 ×2, F-31d 201. Nuance: a push-only monitor has **no `url` key at all** (nulls are not serialised); the auditor's `pushOnly`/`url: null` assertions were wrong, the behaviour is as claimed (probe-now answers 409 "is push-only (no url)") |
| 13 | F-34 probe-now updates `lastProbeAt`/streak; push-only → 409; GAP-4 race note | MATCH | `ev-a/32` run 3 F-34a (200 in 0.01 s, `lastProbeAt` set, `UP (HTTP 200)`), F-34b 409, F-34c 404 `monitor not-a-monitor not found`; the race reproduced once in `ev-a/36` |
| 14 | F-36 first push auto-registers push-only, 202 + monitor; 400s; legacy `details` map read | MATCH | `ev-a/32` F-36b/c (400 "status: must not be blank", "service … tenantId: must not be blank"), run 3 F-36a (202, monitor with the report's publisher `my-sidecar`, lastStatus UP), G-1-24a/b |
| 15 | F-37 document wins over HTTP status, plain 200/500, closed port, 200 ms timeout → DOWN < 2.5 s | MATCH | `ev-a/32` run 3 F-37: `DEGRADED (HTTP 200): cache DOWN`, `DOWN (HTTP 503): db DOWN`, `UP (HTTP 200)`, `DOWN (HTTP 500)`, `DOWN (probe failed: … Connection refused)`, `DOWN (probe failed: no response within 200ms)` in 0.22 s (run 2's FAIL: the stub had died, see the file header) |
| 16 | F-46 per-pod instance records: ordered, fields round-trip, upsert, 404 | MATCH | `ev-a/32` run 3 F-46: ids `pod-a, pod-b, pod-c`, keys as the verifier's B-46a, upsert 1.4.2 → 2.0.0 with 3 staying 3, `leaving: true` → `left: true`, rollup `UP (2 of 2 pods UP)`; F-46d 404 |
| 17 | F-51 index set (feed_idx, sweep_*, unique partial external_ref_idx, events_tenant_seq_idx, events_ttl_idx 86400, monitor_tenant_service_idx, instance_*) + counters | MATCH | `ev-a/34`: the same index names and options on a fresh database |
| 18 | F-62 (BE side) resolve with actor and note in the history | MATCH | `ev-a/32` F-06a–c; `ev-a/33` the UI resolve flow (G-1-13/F-62 steps) |
| 19 | GAP-backend1-6 one ERROR block per failed health sweep while Mongo is down | MATCH | `ev-a/35`: 6 ERROR blocks (606 lines) in a 60 s outage, `TaskUtils$LoggingErrorHandler`; also API 500 after 30.1 s with the raw driver message, readiness 503 after 31.0 s, liveness 200 throughout, readiness back 2.0 s after Mongo returned |
| 20 | GAP-backend1-7 no linter/static-analysis gate in `build.gradle.kts`; SpotBugs 50 findings | MATCH | `build.gradle.kts` at `0e14838` read: no such plugin or task; the 50 findings reproduced in `ev-a/23` |

### Frontend verifier (11)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-2 `npm run lint` | MATCH | `ev-a/11`: 0 errors, 0 warnings (ESLint flat config of G-1-17) |
| 2 | cmd-9 `npm audit --omit=dev` | MATCH | `ev-a/11`: 0 vulnerabilities |
| 3 | cmd-17 `node t6-xorigin.js` (static build on another origin + shared) | MATCH (equivalent) | static `dist/` served from :3827 against A: `ev-a/33` F-64a cross-origin → CORS error state (documented limitation, no ACAO on the preflight), F-64b same-origin through the proxy works |
| 4 | cmd-20 `curl -N --max-time 17 /v1/feed/stream` on the shared :8080 | MATCH | `ev-a/38`: `:connected` at once, `:keepalive` +15 s |
| 5 | F-02 draft: "Draft saved", no View in feed, absent from `/v1/feed`, permalink 404, publish → ACTIVE | MATCH | `ev-a/33` F-02 |
| 6 | F-20 `?lastEventId=` replay on the restarted instance; browser retry with `Last-Event-ID` | MATCH | `ev-a/42-*` (the verifier's `t4-reconnect-sigkill.js` re-pointed at :19806/:19807 and Vite :3806): 9/9 — SIGKILL → *Reconnecting*, *(1)…(4)* at ≈1/2/4/8 s, wire header `Last-Event-ID=1` on the browser's own retry, `?lastEventId=` on the client's reopen, Live by itself after the restart, a notice published through the other instance appears, `GET …?lastEventId=2` replays exactly; `ev-a/32` F-20/G-1-1 ×3 |
| 7 | F-59 "Choose a tenant", 3 skeletons in `aria-busy`, error + Try again, new empty-state copy | MATCH | `ev-a/33` F-59/UX-11 |
| 8 | F-63 card anatomy; Withdraw before start; capsule CSS-capitalised | MATCH | `ev-a/33` F-63/UX-12/UX-10; `ev-a/54`, `ev-a/55` |
| 9 | F-64 cross-origin static build → CORS error state; same-origin fine | MATCH | `ev-a/33` F-64a/b |
| 10 | F-66 typecheck/lint/build 0; 78/78 ×3; coverage report; 12 test files | MATCH | `ev-a/11`, `ev-a/12`: 78/78 three times, 74.07 % statements / 67.53 % branches / 76.23 % functions / 76.25 % lines; `src/outages` 92.06 %, `src/ui` 42.18 %; build exit 0 |
| 11 | GAP-frontend-2 resume is only used when the first retry reaches the service (`if (resume && !opened) lastSeq = undefined`) | MATCH | `frontend/src/outages/api.ts:174-179` read at `0e14838`; `ev-a/42-…-timeline.txt`: request #4 after the proxy's 502 carries only the wire header, #5 carries `?lastEventId=1` |

### Sidecar verifier (10)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-1 `gofmt -l . && go vet ./... && go build ./...` | MATCH | `ev-a/10`: all exit 0 |
| 2 | cmd-2 `go test -count=1 ./...` ×3, one with `-race`, `-v` names; once more with kustomize | MATCH | `ev-a/10`: 33 `Test*` functions PASS, 0 SKIP (kustomize present); `ev-a/40`: `-race` ok; without the tools the 3 manifest tests skip (GAP-sidecar-1 as recorded) |
| 3 | cmd-14 govulncheck `@latest` and `@v1.1.4` | MATCH | `ev-a/40`: `@latest` forces a toolchain switch and then `vuln.go.dev` answers 403 through the proxy; `@v1.1.4` the same 403 — unverifiable here, as the verifier said |
| 4 | cmd-15 `git log/diff --stat 191a0c5..HEAD -- sidecar`, removed test lines, `git status` | MATCH | `ev-a/40`: 0 removed test lines in `sidecar/`; `ev-a/01` for the whole repository |
| 5 | F-70 Actuator `DOWN` with `db DOWN` → report with components → notice body "Failing components" | MATCH | `ev-a/50c`: OUTAGE body "0 of 1 pod UP (DOWN: audit1-app-6d4f8b7c9-ab12c) / Failing components: - db: DOWN - database=PostgreSQL"; `ev-a/50b` DOWN → OUTAGE in 14–15 s |
| 6 | F-73 flap damping: one failed request + 2 s retry → stays UP, 1 report; sustained → DOWN then UP | MATCH | `ev-a/40` CASE 1: UP, 1 report, 0 DOWN lines; CASE 2: UP, DOWN, UP |
| 7 | F-79 TLS: no CA → x509 error, `CS_CA_FILE` works, `CS_INSECURE_SKIP_VERIFY` works | MATCH | `ev-a/40`: `x509: certificate signed by unknown authority` sent=0; with the CA sent; with skip-verify sent |
| 8 | F-80 PARTIAL: image builds from the repo Dockerfile with substituted bases, `User=1001`, `9465/tcp`, OCI labels | MATCH (as PARTIAL) | `ev-a/40`: User 1001, port 9465, title/source/description labels, 16.19 MB on the distroless stand-in; the UBI bases are unreachable (403), so the shipped base stays unverified — the verifier's PARTIAL stands |
| 9 | F-87 soak at 1 s probes / 2 s heartbeats: RSS plateau, no WARN/ERROR | MATCH (equivalent) | `ev-a/40`: two sidecars, 165 reports each, RSS 7.6 → 11.6 MB (plateau) and 7.4 → 9.4 MB, 0 WARN/ERROR lines (shorter than the verifier's 7–11 min, same shape) |
| 10 | F-89 JSON log lines (`time, level, msg, …`): starting, target found, reported, leaving | MATCH | `ev-a/52`: 13/13 lines parse as JSON with those fields |

### E2E verifier (12)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-2 `http_checks.py` (107 HTTP/SSE contract checks against A and B) | MATCH (nuance) | `ev-a/31`: 108/108 on the auditor's A/B (the script counts 108 here; the report says 107) |
| 2 | cmd-15 `pod_flows.js silent` (`docker pause` of the sidecar, nothing deleted) | MATCH (equivalent) | `ev-a/50`, `ev-a/50b`: pause → OUTAGE "1 pod has not reported since …" naming the pod after 92 s, 0 valve WARN (a lone silent monitor is not a valve case since G-1-6); unpause → notice retired 11.6 s later |
| 3 | cmd-19 grep of the backend logs (startup, shutdown, valve, notices, access log, WARN/ERROR) | MATCH | `ev-a/60` |
| 4 | F-06 retire semantics end to end | MATCH | `ev-a/32` F-06a–c, run 3 G-1-20; `ev-a/33` resolve in the UI |
| 5 | F-18 first byte at once (`:connected`) via header, `?clientId=`, instance B, the Vite proxy | MATCH | `ev-a/32` F-18/G-1-4 ×4: 200, headers at once, first line the connected comment |
| 6 | F-20 resume contract (200, exact replay from the last id, snapshot fallback) | MATCH | `ev-a/32` F-20/G-1-1 ×3 (`[created 234, retired 235]`, no snapshot); `ev-a/42-*` |
| 7 | F-36 push report contract | MATCH | as backend #14 |
| 8 | F-50 fleet burst: 20 parallel first-contact reports, all 202, rollup 20 of 20 | MATCH | `ev-a/32` F-50/G-1-7: 3 bursts → 60 × 202, `UP (20 of 20 pods UP)`, 20 instance records |
| 9 | F-70 app `WARN` → sidecar reports `WARN` → backend DEGRADED | MATCH | `ev-a/61`: pushed `WARN` → monitor `DEGRADED: disk DEGRADED`; probed `{"status":"WARN"}` → `DEGRADED (HTTP 200)`; `ev-a/50b` DEGRADED notice ~12 s after the swap |
| 10 | F-88 app process dead, sidecar alive: DOWN, "app is not listening (last target …)", `/status.target` empty + `lastTarget`, OUTAGE naming the pod | MATCH | `ev-a/50b`: DOWN 1.3 s after the stop, then "app is not listening (last target http://127.0.0.1:8080/actuator/health)" on every tick, OUTAGE "audit1-app is down" naming the pod ~14 s; `ev-a/51` the card in the UI; `ev-a/52` the log lines |
| 11 | F-89 JSON logs across the flows | MATCH | `ev-a/52`, `ev-a/60` |
| 12 | F-91 DOWN → OUTAGE, DEGRADED swap, recovery, SIGTERM/left, restart; no console errors | MATCH | `ev-a/50b`: DOWN → OUTAGE 14–15 s, DEGRADED ~12 s, recovery → retired ~14 s, SIGTERM 0.4 s exit 0 with "leaving report sent" → monitor `UNKNOWN (no live pod reports)`, restart → notice retired ~12 s; `ev-a/50`, `ev-a/51` screenshots; `ev-a/33` no page errors in the UI runs |

### Usability reviewer (13)

| # | Sampled claim | Result | Evidence |
|---|---|---|---|
| 1 | cmd-7 UX-16 from the user's seat: publish, Resolve, publish the same incident again, follow the banner | MATCH | `ev-a/33` UX-16a/b/c, `ev-a/53`: the banner names the incident and recommends retiring the notice; after Resolve the same reference still answers 409 — the advice cannot work, as the reviewer says |
| 2 | cmd-8 developer walk: cookbook verbatim, error walk, README paths vs OpenAPI | MATCH | `ev-a/36`; `ev-a/32` G-1-21a–g, `UX-cmd8-D1`, README-paths-vs-OpenAPI |
| 3 | F-54 publish form, hints, placeholders; one hint over-promises (UX-10) | MATCH | `ev-a/33` publish-form steps, UX-10b |
| 4 | F-63 cards, chips, relative times; capsule CSS-capitalised (UX-12) | MATCH | `ev-a/33` F-63/UX-12 |
| 5 | F-01/F-10 cookbook publish + schedule on a fresh service; second run 409s | MATCH | `ev-a/36` |
| 6 | F-34 `monitor not-a-monitor not found` | MATCH | `ev-a/32` F-34c/UX |
| 7 | UX-5 every measured text ≥ 4.5:1 in both themes | MATCH (nuance) | `ev-a/33` `measure()` + axe 0 violations; dark "tertiary" measured 7.31 where the reviewer wrote 5.93 (a different element was probably measured) — both pass |
| 8 | UX-10 the incident hint still over-promises | MATCH | `ev-a/33` UX-10b (hint text captured) |
| 9 | UX-11 "All clear — No outage is active for …" empty state | MATCH | `ev-a/33` F-59/UX-11 |
| 10 | UX-16 `(tenantId, externalRef)` is a permanent idempotency index (partial only on `externalRef` existing) | MATCH | `MongoCommunicationRepositoryAdapter.java:55-62` read; `ev-a/34` the index options; `ev-a/53` |
| 11 | UX-17 after "Publish another" focus is dropped on `<body>` | MATCH | `ev-a/33` UX-17 (`document.activeElement` = `BODY`) |
| 12 | UX-23 Swagger UI: scheme named `X-Client-Id`, Authorize explains what to paste, 401 documented, 200 after Authorize | MATCH | `ev-a/33b` (Chromium: dialog text, 401 row, live 200 with `-H 'X-Client-Id: vmforge-tools'` in the generated curl, no "Undocumented"), `ev-a/59`; `ev-a/32` F-29b/UX-23b |
| 13 | UX-31 "Image" section; `images:` override in Kustomize; Helm library note | MATCH | `ev-a/41`: the override renders in the classic and the native component; `helm lint`/`template` through a consuming chart succeed |

### Closed gaps — at least one claim re-verified per gap (directive c)

| Gap | Re-verified by | Gap | Re-verified by |
|---|---|---|---|
| G-1-1 | `ev-a/32` F-20/G-1-1 ×3 exact replay without a 500; `ev-a/30`; `ev-a/42` | G-1-13 | `ev-a/33` G-1-13 ("View in feed" lands on the published tenant/type) |
| G-1-2 | `ev-a/50b`, `ev-a/52` dead app → DOWN "app is not listening (last target …)" | G-1-14 | `ev-a/33` G-1-14 (unreachable wording; Try again reopens the stream) |
| G-1-3 | `ev-a/42-*` 9/9 (reopen with backoff, *Reconnecting (n)*, Live by itself) | G-1-15 | `ev-a/33b` G-1-15a (announcement in `role=status`, focus kept on the list with two cards); `ev-a/33` labelled filters, `h1` |
| G-1-4 | `ev-a/32` F-18/G-1-4 ×4 | G-1-16 | `ev-a/33` G-1-16a/b (time-driven states, "Showing the first 100 of N", Withdraw, 409 wording) |
| G-1-5 | `ev-a/32` run 3 G-1-5a–c (operator retire → monitor counts again → incident `:2`, `incidents=2`); `ev-a/30` D-5 | G-1-17 | `ev-a/11`, `ev-a/12` (lint 0, coverage report, jsdom component tests among the 78) |
| G-1-6 | `ev-a/37` 3/3 on a fresh database; `ev-a/30` D-6-a/b; `ev-a/60` the valve still fires at "2 of 3" (≥ 2 and ≥ 30 %) | G-1-18 | `ev-a/10` `TestNativeComponentKeepsExistingInitContainers` PASS with kustomize; `ev-a/41` native component renders |
| G-1-7 | `ev-a/32` F-50/G-1-7 60 × 202, no 409 | G-1-19 | `ev-a/10` `TestEveryEnvironmentVariableIsDocumented` PASS; `sidecar/README.md` read (CS_PUBLISHER row, Image and Debugging sections, helm library note, boot-unhealthy note) |
| G-1-8 | `ev-a/32` G-1-8a–c (health/liveness/readiness without an id; env/beans/configprops/loggers/metrics 404; the `/actuator` index lists only `self`/`health`); `ev-a/35` readiness 503 during the outage | G-1-20 | `ev-a/32` run 3 G-1-20 |
| G-1-9 | `ev-a/22` versions (the SBOM task itself was not re-run by the auditor; the verifier's `ev/04-cyclonedx.txt` stands) | G-1-21 | `ev-a/32` G-1-21a–g (400 names the field/allowed values/limit; 404, 405, 413, 415 wording) |
| G-1-10 | `ev-a/33` contrast `measure()` ≥ 4.5 in both themes, axe 0; `contrast.test.ts` in the 78 | G-1-22 | `ev-a/36` cookbook #1 runs today (rc=0); `ev-a/60` INFO access log per request; `ev-a/33b` Swagger scheme + 401; README explains `expectedVersion` and `<monitorId>` |
| G-1-11 | `ev-a/33` G-1-11 (frames filtered by the feed's visibility rule) | G-1-23 | `ev-a/39` SIGTERM with open streams: streams end in 33 ms, "Graceful shutdown complete" in 2 ms, process gone in 4.11 s |
| G-1-12 | `ev-a/33` G-1-12 (focus to the first invalid field, error summary links) | G-1-24 | `ev-a/32` G-1-24a/b (legacy `details` map read; components win) |

### Feature completeness recount (directive b)

Recounted from the verifiers' matrix sections: backend 65/65 PASS (30.0), frontend 26/26 PASS (formula 30.0; the verifier kept 29 for the GAP-frontend-1 deviation inside a passing row — a documented, conservative judgment the auditor leaves in place, see section 5), sidecar 26 PASS + 3 PARTIAL of 29 = 27.5/29 (28.4), E2E 33/33 (30.0). F-90…F-92 are E2E-only rows, as in iteration 0. The recount agrees with all four verifiers.

## 3. Test-weakening check (directive a)

`ev-a/01-test-weakening-check.txt` holds the full diff facts and a verdict per removed line.

- `git diff --stat 191a0c5..0e14838` over test paths: 30 files, **2295 insertions, 15 deletions**; `--diff-filter=DR`: **no test file deleted or renamed** (the one deleted file, `sidecar/deploy/kustomize/component/add-native-sidecar.yaml`, is the JSON patch that G-1-18 replaced with a strategic-merge component, guarded by a new test).
- Markers added to test code (`@Disabled`, `@Ignore`, `assume*`, `.skip(`, `xit(`, `test.todo`, `t.Skip(`): **one**, `t.Skip("kustomize not on PATH")` inside the *new* `deploy_test.go`; it ran unskipped here (`ev-a/10`, 0 SKIP) and the sidecar verifier already records the environment guard as GAP-sidecar-1. Nothing existing was skipped.
- The 14 non-trivial removed lines are all mechanical: 2 mock stubs renamed with the repository method (G-1-1), 3 `HealthProperties` constructor calls that gained the 4th component (G-1-6), 6 `HealthReportCommand` argument lists that gained `details` (G-1-24) — one of them the opener of `aPersistentConflictIsReturnedAfterTheRetries`, which moved to `StepVerifier.withVirtualTime` because G-1-7 added real backoff pauses, with the same expectation — and 2 dead keys in `src/test/resources/application.yml` removed with the production keys (G-1-22). Each is named in the fixer's commit message and in `confidence/iter-1/fixes.md` ("No existing test was deleted or weakened; existing tests touched: …").
- Suite sizes grew as claimed: backend 164 → 188 unit and 26 → 39 integration (0 failed, 0 skipped, `ev-a/20`, `ev-a/22`), frontend 23 → 78 (`ev-a/11`), sidecar 28 → 33 top-level `Test*` functions at `0e14838` (`ev-a/10`; `fixes.md` says 36, see section 6).

**Finding: no test was deleted, skipped, xfail'd or loosened. Gate not tripped for any service.**

## 4. Hard gates (per service)

| Gate | Backend | Frontend | Sidecar | E2E |
|---|---|---|---|---|
| Any Feature Matrix item fails E2E | no (65/65) | no (26/26) | no (29 rows: 26 PASS, 3 PARTIAL, 0 FAIL) | no (33/33) |
| Test skipped/deleted/loosened without justification | no | no | no | no |
| Sidecar not restricted-v2 / not non-root | n/a | n/a | passes: image `User=1001` (`ev-a/40`), run as `--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges` in the pod emulation (`ev-a/50`) | — |
| Open critical/high security finding | no: the versions at `0e14838` (Netty 4.1.135.Final, Spring 6.2.19, Boot 3.5.16, logback 1.5.34; `ev-a/22`) are past the fixes of the CVEs that tripped the iteration-0 gate (Netty 4.1.118/4.1.124/4.1.125) | no: `npm audit --omit=dev` 0 (`ev-a/11`) | no finding known: stdlib only, but govulncheck is unrunnable here (`ev-a/40`), so "none" rests on versions, not on a scan — already priced into Builds & static (−2) | no |

No cap applies; every audited total is above 80 on its own merits and no gate is tripped.

## 5. Recomputed scores

| Category (weight) | Backend verifier → audit | Frontend verifier → audit | Sidecar verifier → audit | E2E verifier → audit |
|---|---|---|---|---|
| Builds & static checks (10) | 7 → 7 | 9 → 9 | 8 → 8 | 7 → 7 |
| Feature completeness (30) | 30 → 30 (65/65) | 29 → 29 (26/26; formula 30, verifier's −1 kept) | 28.4 → 28.4 (27.5/29) | 30 → 30 (33/33) |
| Automated test health (20) | 17 → 17 | 18 → 18 | 17 → 17 | 14 → 14 |
| Integration & contracts (20) | 18 → 18 | 19 → 19 | 17 → 17 | 18 → 18 |
| Resilience & ops (10) | 7 → 7 | 9 → 9 | 9 → 9 | 9 → 9 |
| Usability (10) | 8 (provisional) → **9.3** (API 93/100) | 9 → **7.4** (UI 74/100) | 9 → **10** (operator 100/100) | 8 (provisional) → **7.4** (UI 74/100, lowest surface) |
| **Total** | 87 → **88.3 ≈ 88** | 93 → **91.4 ≈ 91** | 88.4 → **89.4 ≈ 89** | 86 → **85.4 ≈ 85** |

No category other than usability was changed: the 66-claim sample reproduced every claim, so there is no evidence that any verifier over- or under-scored a category, and the auditor does not re-grade on opinion. Under the strict formula the frontend would be 92.4; the overall is unaffected because the minimum is the E2E score. **Overall: 85 / 100 (lowest of the four).**

## 6. Nuances, auditor errors and harness incidents (all recorded, none changes a verdict)

Observations worth a gap decision in iteration 2:

1. **Stored vs effective status on the read model.** After `expiresAt` and before the sweep, `GET /v1/communications/{id}` still answers `status: ACTIVE` (version 0) while `POST …/retire` answers 409 "already expired" and the feed already omits the item (`ev-a/32` run 3 G-1-20). The README documents the stored/effective distinction, but a client that reads ACTIVE and is then refused on retire sees a contradiction for up to one sweep interval (30 s by default).
2. A push-only monitor is recognisable only by the **absence** of the `url` key (nulls are not serialised); the 409 text "push-only (no url)" is the only place the term appears (`ev-a/32`).
3. The `/actuator` discovery index is reachable without a client id and lists only `self` and `health` — not a leak, but "nothing else exposed" should mention it (`ev-a/32` G-1-8c).
4. The forced-probe vs scheduler race (GAP-backend1-4) reproduced once in 20 forced probes (`ev-a/36`) and shows from the scheduler's side as 7 WARN "skipping monitor … 409 CONFLICT" lines in A's log (`ev-a/60`).
5. The Go line at `0e14838` is `go 1.24` (`go.mod`, `Dockerfile` `go-toolset:1.24`); the 1.24 line left its support window with the 1.26 release. Iteration 2 already moves to 1.25 (`a5b1ea1`) — check that the chosen line is still one of the two supported majors. govulncheck remains unrunnable in this sandbox.

Nuances:

6. `fixes.md` says the sidecar has 36 test functions; `go test -v` at `0e14838` lists 33 top-level `Test*` functions (`ev-a/10`), the figure the sidecar verifier uses; 36 counts a later tree or subtests.
7. `http_checks.py` reports 108 checks here, the E2E report says 107 (a conditional check).
8. UX-5 dark "tertiary" measured 7.31 against the reviewer's 5.93; both are ≥ 4.5.
9. After `docker rm -f` of the paused sidecar (no leaving report possible) the silent pod opened another OUTAGE 90 s later, and a sidecar restarted after a SIGTERM resets the pod's `left` flag to false (`ev-a/50c`) — both as specified.
10. The shared backend's only valve WARN ("19 of 20 push-only monitors are silent at once") comes from the verifiers' fleet tests on the shared stack.

Auditor errors (each re-run; the discarded first attempts are kept in the scratchpad, not in the evidence):

11. Killed the wrong JVMs once while relaunching A and V, leaving a default-config A on :19800; the first `check_d_gaps`/`http_checks` replays were discarded and re-run after the fix.
12. `pkill -f` matched the auditor's own shell once; SpotBugs was first run with an empty aux classpath (0 findings) — discarded, re-run with the 79 jars (`ev-a/23`).
13. `audit-http.py` run 1 crashed because the auditor's own Mongo-outage test had stopped G's Mongo; run 2 produced 6 FAILs that were all the auditor's (an over-strict GET-by-id expectation, an SSE reader that broke on chunked reads after an idle period, a non-existent `pushOnly` field, and a dead probe stub); run 3 re-ran them with corrected assertions (`ev-a/32` header).
14. The pod-flow script's `waitfor` compared `"status":"UP"` against pretty-printed JSON, so every wait hit its 30 s limit; the timings in `ev-a/50b` are derived from the backend's and the sidecar's own log timestamps instead, and the `instance record:` lines in `ev-a/50` are empty (a jq expression error) — `left: true` is instead proven in `ev-a/32` run 3 F-46.
15. The first G-1-15a check used a single card (reproducing GAP-frontend-1 rather than G-1-15); the follow-up with two cards is `ev-a/33b`. The first two Swagger UI scripts failed on their own selectors; the third (`ev-a/33b`, `ev-a/59`) passed.

Harness incidents: Maven Central 429 (Google mirror), `fastdl.mongodb.org`/UBI/quay/`vuln.go.dev` blocked, kind unusable (Docker shared-netns emulation), as in iteration 0; a model switch earlier in the thread.

## 7. What code was actually under test

- Branch `confidence-loop/2026-11-01`, commit `0e14838` (01:28:13 UTC), 28 commits over `191a0c5`; the working tree had no tracked change outside `confidence/` during the audit.
- Backend: `scratchpad/communication-service-iter1.jar`, built 01:05:06 UTC, after the last backend code commit of the iteration (`544cab7`/`5aee2a4`, 01:03:04) — the same jar the verifiers used. The Gradle/SpotBugs evidence (`ev-a/20–23`) compiled the checkout at 02:28 UTC.
- Sidecar: image `health-sidecar:ci`, built 01:05:35 UTC after the last sidecar commit (00:45:00); `go test`/`vet`/`build` on the checkout at 02:24 UTC.
- Frontend: served by Vite from the working tree, whose `frontend/` matched `0e14838` (last frontend commit `c3bddf8`, 01:26:27) until 03:05:33 UTC; every UI check ran before that (`ev-a/33` 02:49, `ev-a/33b` G-1-15a 02:55:07; the t4 replay 02:43).
- Iteration 2 started landing while this audit ran: `3b18b1d` (02:19, documents only), then code from `b397f87` (03:01:36, README and e2e files), `eac1d0a…6ba70b0` (03:05:33, frontend), `37e6ad4`/`b0a71ef` (03:06, backend and build), `a5b1ea1…7006692` (03:08:51, sidecar). Evidence produced after 03:01 (`ev-a/32` run 3, `ev-a/33b` Swagger, `ev-a/50c`, `ev-a/60`, `ev-a/61`, `ev-a/42` copies, `ev-a/01`) depends only on the jar, the images, Mongo data, logs or `git diff` between fixed commits, not on the moving working tree.

## 8. Evidence index (`confidence/evidence/iter-1/audit/`)

`00-claims-and-sample.txt` (317 claims, the seed-1 sample) · `01-test-weakening-check.txt` · `10-sidecar-static-and-tests.txt` · `11-frontend-static-and-tests.txt` · `12-frontend-build-coverage.txt` · `20-gradle-compile-test-integrationTest.txt` · `21-gradle-dependencies.txt` · `22-gradle-counts-and-versions.txt` · `23-spotbugs-replay.txt` · `30-check-d-gaps-replay.txt` · `31-e2e-http-checks-replay.txt` · `32-audit-http-checks.txt` (runs 2 and 3 with the auditor-error notes) · `33-audit-ui-checks.txt` · `33b-audit-ui-followup.txt` · `34-mongo-indexes.txt` · `35-mongo-outage-gap6.txt` · `36-readme-cookbook-replay.txt` · `37-check-d2-valve-replay.txt` · `38-sse-keepalive-shared.txt` · `39-sigterm-open-streams.txt` · `40-sidecar-extras.txt` · `41-ux31-kustomize-helm.txt` · `42-t4-reconnect-replay.json`, `42-t4-reconnect-replay-timeline.txt`, `42-t4-sse-frames.json` · `50-pod-flow.txt`, `50b-pod-flow-timeline.txt`, `50c-pod-notice-bodies.txt` · `52-audit1-sidecar-log.txt` · `60-backend-log-review.txt` · `61-f70-warn-vocabulary.txt` · screenshots `50-pod-outage-in-ui.png`, `51-dead-app-outage-in-ui.png`, `53-409-after-retire.png`, `54-feed-cards-light.png`, `55-feed-cards-dark.png`, `56-publish-errors-light.png`, `57-publish-done-light.png`, `58-publish-errors-dark.png`, `59-swagger-after-authorize.png`. The auditor's scripts are in the scratchpad (`audit1/audit-http.py`, `audit-http-fix.py`, `audit-ui.js`, `audit-ui-followup.js`, `audit-swagger2.js`, `audit-pod.sh`, `audit-sidecar-extras.sh`, `audit-mongo-outage.sh`, `run-spotbugs.sh`, the re-pointed copies of the verifiers' scripts).

## 9. Clean-up

Stopped at the end of the audit: the private backends on :19800–:19806, the Vite dev servers on :3800/:3805/:3806, the static server on :3827, the probe stub on :19810, and the containers `audit1-mongo`, `audit1-netns`, `audit1-app`, `audit1-sidecar` (`docker rm -f`). Left in place: the shared stack (`mongo7`, backend :8080, Vite :3000, containers `app` and `sidecar`), the iteration-2 fixers' Gradle processes, and the `audit1-*` databases inside `mongo7` (small; drop them with `mongosh <db> --eval 'db.dropDatabase()'` when the evidence is no longer needed).
