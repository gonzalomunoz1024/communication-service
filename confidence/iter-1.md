# Iteration 1 — first remediation round (code at `0e14838`, 28 commits over `191a0c5`)

Reports: `iter-1/gaps.md` (G-1-1 … G-1-24), `iter-1/fixes.md` (gap → commit → guarding test), `iter-1/verifier-backend.md`,
`verifier-frontend.md`, `verifier-sidecar.md`, `verifier-e2e.md`, `usability.md`, audit `iter-1/audit.md`.
Evidence: `evidence/iter-1/<area>/`, fixers' before/after logs `evidence/iter-1/fixers/`, audit `evidence/iter-1/audit/`.

## Scores (audited)

| Score | Iteration 0 | Verifier claimed | Auditor | Δ vs iteration 0 | Hard gate | Why the audit changed it |
|---|---|---|---|---|---|---|
| Backend | 68 | 87 | **88** | +20 | none | usability category = Usability Reviewer's API score 93 |
| Frontend | 62 | 93 | **91** | +29 | none | usability category = UI score 74 |
| Sidecar | 77 | 88 | **89** | +12 | none | usability category = operator score 100 |
| E2E system | 62 | 86 | **85** | +23 | none | usability category = UI score 74 (journeys run through the UI) |
| **Overall (lowest)** | **62** | | **85** | **+23** | | |

Audit sample: 66 of 317 claims re-run (seed 1), 0 contradicted, no veto, no score raised on judgment.
Test-weakening check over the 26 fix commits: 30 test files changed (+2295 / −15 lines), 0 tests deleted, 0 skip or
disable markers added to existing tests; the 14 non-trivial removed lines are mock renames and record-arity changes
named in the fixers' commit messages (`iter-1/fixes.md` lists every touched existing test).

## What changed
All 24 gaps closed, each in its own commit with a regression test (`iter-1/fixes.md`). Headline: SSE resume with
`Last-Event-ID` works (G-1-1); a crashed app is reported DOWN, not UNKNOWN, by the sidecar (G-1-2); the browser reopens a
closed stream with backoff and `?lastEventId=` (G-1-3); the stream commits at once (G-1-4); operator-retired auto notices
reopen (G-1-5); the staleness valve ignores scaled-to-zero services (G-1-6); report bursts retry on 409 (G-1-7); Actuator
liveness/readiness probes (G-1-8); Spring Boot 3.5.16 past the HIGH Netty CVEs (G-1-9); WCAG AA tokens (G-1-10); the live
list applies the GET's visibility rule (G-1-11); the native-sidecar Kustomize component keeps existing init containers
(G-1-18); usability majors UX-1 … UX-6 (focus, labels, error wording, reachability), the README cookbook and the sidecar
onboarding docs.

## Verification results
Every Feature Matrix row passes end to end (backend 65/65 owned rows, frontend 29/29, sidecar 31/31 with F-80 partial on
the Go line, cross-service 33/33). Suites: backend 188 unit + 39 integration tests, 0 failures, 3× stable; frontend 78 tests
(12 files) 3×; sidecar 33 tests with `-race` 3×. Journeys: UI publish → second browser live in 0.3 s; dead app → "app is not
listening" → OUTAGE in the UI; SIGKILL of the backend → *Reconnecting (n)* → Live with replay; silent pod → DOWN after the
90 s staleness window; SIGTERM → `leaving` report.

## What kept the scores under 95 (→ `iter-2/gaps.md`)
No lint/static-analysis or coverage gate and no CI; `[removal]` warnings; Mongo-down behaviour (30 s blocking, driver text
in a 500, an ERROR with stack trace per sweep); the staleness valve can stay paused forever on abandoned monitors;
`failureThreshold + 1` after an operator retire; probe-now vs scheduler 409 race; snapshot frame id one poll behind; the
duplicate-`externalRef` wording ("Retire that notice first" on a permanent key); UI focus losses, backoff cap, `acme`
default tenant, hint wording; UI-kit coverage 42 %; sidecar Go 1.24 line, silent manifest-test skips, missing OCI labels,
send-at-heartbeat while DOWN; no in-repo browser↔backend↔sidecar test.

## Not exercisable in this sandbox
Unchanged from iteration 0: real Pod/SCC admission, UBI base images, online vulnerability databases, non-Chromium browsers,
screen readers. New this iteration: GitHub Actions (no CI existed yet), govulncheck (vuln.go.dev blocked).
