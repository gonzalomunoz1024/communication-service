# Iteration 3 — third remediation round (code at `4a0e84e`, 37 commits over the iteration-2 head `be19645`)

Reports: `iter-3/gaps.md` (G-3-1 … G-3-32), `iter-3/fixes.md` (gap → commit → guarding test), `iter-3/verifier-backend.md`,
`verifier-frontend.md`, `verifier-sidecar.md`, `verifier-e2e.md`, `usability.md`, audit `iter-3/audit.md`.
Evidence: `evidence/iter-3/<area>/`, fixers' before/after logs `evidence/iter-3/fixers/`, audit `evidence/iter-3/audit/`.

## Scores (audited)

| Score | Iteration 2 (audited) | Verifier claimed | Auditor | Δ vs iteration 2 | Hard gate | Why the audit changed it |
|---|---|---|---|---|---|---|
| Backend | 94 | 80 (91 before the cap) | **80** | −14 | open critical/high finding: 3 CRITICAL and 10 HIGH entries in netty 4.1.135, jackson 2.21.4 and spring-webflux 6.2.19 (GAP-backend3-6) | accepted: the auditor's own Trivy run on a freshly downloaded database found the same 29 entries |
| Frontend | 96 | 96 | **96** | 0 | none | accepted (95.7 with the UI usability score 87) |
| Sidecar | 91 | 91.5 | **80** | −11 | open high finding: 4 HIGH entries in the Go 1.25.14 standard library of the shipped binary (AUD-3-1) | the verifier could not run govulncheck (`vuln.go.dev` blocked); the auditor scanned the binary with Trivy; 92.05 before the cap |
| E2E system | 90 | 97 | **80** | −10 | inherited from GAP-backend3-6 and AUD-3-1 | as in the iteration-0 and iteration-2 audits, the system score inherits the security gate of the services it ships; 96.7 before the cap |
| **Overall (lowest)** | **90** | | **80** | **−10** | | |

The drop is a measurement change, not code that got worse: a vulnerability database became reachable here in iteration 3
(Trivy 0.58.1 and its database through `mirror.gcr.io`). Every entry was published between 2026-07-21 and 2026-10-21,
before iteration 2, and iteration 2 shipped the same Spring Boot 3.5.16 and the same Go 1.25 line. Without the security gate
the lowest score would be the backend's 91. The one regression found is GAP-backend3-1: since G-3-2 the sweep saves each
probe twice, and an on-demand probe that loses that race re-probes on every retry, so with a slow endpoint and a 1 s sweep the
iteration-2 G-2-7 scenario fails 30 of 30 calls (the iteration-2 jar passes it).

Usability Reviewer: UI 87 (iteration 2: 84), API 90 (89), sidecar onboarding 95 (94); accepted by the audit.

Audit sample: 93 of 460 claims re-run (seed 3, stratified 20 %), 92 reproduced (61 MATCH, 18 exact, 10 with a nuance,
3 by an equivalent check), 1 checked against the verifier's log only (a crashed run that cannot be repeated), 0 partial,
0 contradicted; no veto; no category re-graded on judgment.

Test-weakening check over the 37 fix commits (against `be19645`) and the whole branch (against `191a0c5`): not tripped. No
test deleted or renamed, no skip/only/xfail/todo marker added, no timeout raised (one tightened); every removed assertion is
replaced by an equal or stronger one or is a deliberate change named in `fixes.md` and its commit; six touched files not named
in `fixes.md` lose only comments, imports or harness code. No test modelled the GAP-backend3-1 race.

Gate rulings: GAP-backend3-6 applies (the CI job's own rule fails on it and nothing triages it). F-34 stays PASS with a note
(the default 5 s sweep still answers forced probes, with retries of up to 9 s). F-65 passes as the matrix defines it; the
feed's load error has no `role=alert` (UX-53), a minor finding already counted in UI 87.

## What changed
All 32 gaps closed, each in its own commit with a regression test or a build gate (`iter-3/fixes.md`). Headline: a stream
opened during a database outage ends with one warning instead of ERROR stack traces (G-3-1); one probe per due monitor across
instances via a claimed probe slot (G-3-2); the effective status on publisher and admin reads (G-3-3); a JaCoCo branch gate and
an SBOM limited to runtime components (G-3-4, G-3-5); quieter logs during a Mongo outage (G-3-6); input errors that name the
value and position (G-3-7, G-3-9, G-3-32) and reject unknown publish fields (G-3-8); resume from the later of `Last-Event-ID`
and `?lastEventId=` (G-3-11); the sidecar's `CS_LOG_LEVEL`, a 10 s report timeout, every probe sent while degraded by a
component, strict booleans, UNKNOWN only at the heartbeat, a backoff cap below the staleness window and one status vocabulary
shared with the service (G-3-14 … G-3-19, G-3-29, G-3-30); the frontend tells the service's own 503 from an unreachable service,
explains the duplicate-reference 409 in the form's terms, moves focus into confirmations, announces the badge and loads once
per typed tenant (G-3-20 … G-3-26); the e2e suite gained failure-path specs, a lint and a restart spec that tells replay from
reload (G-3-12, G-3-27, G-3-28).

## Verification results
Every Feature Matrix row the verifiers own passes end to end except the sidecar's three cluster/UBI halves: backend 65/65
(68/68 with F-90 to F-92), frontend 29/29, sidecar 28 PASS + 3 PARTIAL of 31 (F-80 UBI base, F-82 Downward-API missing-label
path, F-86 server-side dry run), cross-service 33/33. Suites: backend 297 tests (251 unit + 46 integration) three times, 0
failures or skips; frontend 169 tests (19 files) three times, 96.77 % statements; sidecar `go test` with and without `-race`
and with `CI=true` (53 tests + 21 subtests, 0 skips); the in-repo e2e suite 9 of 9 on three fresh stacks, plus the E2E
verifier's HTTP contract checks (119/119) and UI flows (34/34).

## What kept the scores under 95 (→ `iter-4/gaps.md`, 31 gaps)
Backend: the open CVEs in Netty, Jackson 2 and spring-webflux 6.2 (no Spring Boot 3.5 release carries the WebFlux fixes, so
G-4-1 moves to Spring Boot 4.0.9) and in the debian12 base image (G-4-3); GAP-backend3-1 (G-4-4); monitor registration
ignores misspelled fields; readiness takes a full second during an outage, which is the kubelet's default probe timeout;
late probe failures logged as ERROR with a stack trace; no access log with the client-id check off; one WARN per event-log
poll during an outage; a stream opened during an outage answers 200 and then ends; the duplicate-externalRef 409 can suggest a
value that is already taken; the OpenAPI document lacks success codes, shared error answers and working examples; a 400 names
only the first unknown field; Markdown in the README's plain-text example; an all-UNKNOWN rollup says nothing about why; the
service and the sidecar trim status words differently. Frontend: the badge says *Live* during a database outage (UX-42
residual), the feed's load error is not announced (UX-53), focus after *View in feed*, Escape on the inline confirmation, the
follow-up reference suggestion. Sidecar: the Go 1.25 standard library (AUD-3-1), durations that freeze the loop, README gaps
(503 timing, proxy variables, `extraEnv` shape, the ConfigMap), no INFO when reports get through again, CI without gofmt,
`-race` or a pinned govulncheck. E2E: the README's send cadence, spec 07's late page, no image scans in CI.
Environmental (not fixable here): no OpenShift cluster or SCC admission, no UBI registry, no GitHub Actions run.
