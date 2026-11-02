# Iteration 0 — baseline verification (code at `191a0c5`, main after PR #8)

Reports: `iter-0/verifier-backend.md`, `verifier-frontend.md`, `verifier-sidecar.md`, `verifier-e2e.md`, `usability.md`,
audit `iter-0/audit.md`. Evidence: `evidence/iter-0/<area>/`. Environment: `evidence/environment.md`.

## Scores (audited)

| Score | Verifier claimed | Auditor | Hard gate | Why the audit changed it |
|---|---|---|---|---|
| Backend | 72 | **68** | tripped (F-20, F-61 fail E2E; HIGH CVEs open) | usability category taken from the Usability Reviewer's API score (41) |
| Frontend | 66 | **62** | tripped (F-20, F-61, F-16, F-65, F-06 clause) | usability category = UI score 17 |
| Sidecar | 77 | **77** | tripped (F-83, F-88); non-root / restricted-v2 gate itself OK | — |
| E2E system | 67 | **62** | tripped (F-20, F-61, F-88, F-92) | usability category = UI score 17 (journeys run through the UI) |
| **Overall (lowest)** | | **62** | | |

Audit sample: 61 of 309 claims re-run (seed 0), 0 contradicted, no veto, no score raised. No test was skipped,
deleted or loosened in iteration 0 (verifiers changed nothing).

## What the verification established
- Builds: backend compiles and 164 unit tests pass 3×; the 26 integration tests ran here for the first time ever
  (real mongod 7.0.45 seeded into flapdoodle's cache) and one fails deterministically; frontend typecheck/build/23 tests
  pass 3×, `npm audit` clean, no lint config; sidecar `go vet`/`go test -race` pass 3×, image builds (UBI base
  substituted, see environment.md), runs as UIDs 1000660000/4242/1000700123/65534 read-only with all capabilities
  dropped.
- Features: 61/64 backend rows, 21/26 frontend rows, 25.5/29 sidecar rows, 29/33 cross-service rows verified.
- The end-to-end chain works: UI publish → second browser live in ~0.3 s; sidecar in a shared-namespace "pod" →
  auto-registered monitor → app DOWN → OUTAGE in the UI after 17 s → DEGRADED swap → recovery; SIGTERM leaving report
  in &lt;100 ms; A↔B fan-out through the Mongo event log in 0.6 s.

## Gaps (details and IDs in `iter-1/gaps.md`)
Blockers: SSE resume with `Last-Event-ID` answers 500 (G-1-1); a crashed app makes the sidecar report UNKNOWN forever,
so no outage opens (G-1-2). Majors: browser never re-creates a closed EventSource (G-1-3); SSE headers held until the
first frame, 15 s on an empty tenant (G-1-4); operator-retired auto notice never re-opened (G-1-5); staleness valve
counts scaled-to-zero services and trips on small fleets (G-1-6); bursts of pod reports → 409 (G-1-7); no health
endpoint (G-1-8); Spring Boot 3.4.1 with HIGH Netty CVEs (G-1-9); contrast below WCAG AA (G-1-10); live list shows
future-dated items the GET hides (G-1-11); native-sidecar Kustomize patch drops existing init containers (G-1-18);
usability majors UX-1..UX-6, UX-21/22, UX-30/31. Minors: G-1-15..17, G-1-19..24.

## Not exercisable in this sandbox
Real Pod / SCC admission and `oc apply --dry-run=server` (kind cannot start: nested runc fails); the UBI base images
(registry blocked); online vulnerability scanners (OSV/NVD blocked; CVE review is knowledge-based with IDs);
Mongo-down behaviour of the shared stack; non-Chromium browsers and screen readers.
