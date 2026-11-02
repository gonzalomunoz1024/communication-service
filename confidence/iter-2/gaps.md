# Iteration 2 — gap analysis

Iteration-1 provisional scores (verifier total with the Usability Reviewer's score in the usability category):
Backend 88, Frontend 91, Sidecar 89, E2E 85. No hard gate tripped; every Feature Matrix row passes. What is left is
category deductions (static/coverage gates, operational edges, usability friction) and the absence of an in-repo
cross-system test. Sources: `iter-1/verifier-*.md` §1 and §4, `iter-1/usability.md`.

| Gap | Service | Feature IDs / category | Severity | Root cause / evidence | Merges |
|---|---|---|---|---|---|
| G-2-1 | BE | builds | minor | four `[removal]` warnings: `ReactiveIndexOperations.ensureIndex` in `MongoCommunicationRepositoryAdapter.java:61`, `MongoCommunicationEventsAdapter.java:191`, `MongoHealthMonitorRepositoryAdapterIT.java:44`, `MongoHealthInstanceRepositoryAdapterIT.java:37` (`evidence/iter-1/backend/01b`) | GAP-backend1-5 |
| G-2-2 | BE | builds, test health | major (score) | no linter/static-analysis gate and no coverage tooling in `build.gradle.kts`; verifier-run SpotBugs: 2 `toLowerCase/toUpperCase` without `Locale`, 41 `EI_EXPOSE_REP*` (`evidence/iter-1/backend/08-spotbugs.txt`) | GAP-backend1-7, backend tests 17/20 |
| G-2-3 | ALL | ops | major (score) | no CI at all (`.github/workflows` absent): SBOM not scanned, govulncheck never runs, manifest tests skip silently without tools | GAP-backend1-8, GAP-sidecar1-1, GAP-sidecar1-2 |
| G-2-4 | BE | F-30, F-28 resilience | major (score) | Mongo unreachable → every call and readiness block 30 s (driver `serverSelectionTimeoutMS` default), then 500 whose body leaks the driver's cluster description; one ERROR with stack trace per scheduled sweep (`evidence/iter-1/backend/27`, `28`) | GAP-backend1-1, GAP-backend1-6 |
| G-2-5 | BE | F-45 design | major (design) | staleness valve counts monitors that are silent forever (decommissioned/test monitors) with no bound → can stay paused indefinitely and nothing is declared DOWN in that database (`evidence/iter-1/backend/25d`: 14/14 silent, paused since 01:34:44) | GAP-backend1-2 |
| G-2-6 | BE | F-41 | minor | after an operator retires an auto notice, re-opening needs `failureThreshold + 1` observations (`withClosedByOperator` resets the streak to 0 and the noticing observation is not counted); README says "counts again" | GAP-backend1-3 |
| G-2-7 | BE | F-34 | minor | a forced probe racing the scheduler answers 409 "modified concurrently" (`evidence/iter-1/backend/23`) | GAP-backend1-4 |
| G-2-8 | BE | F-18, F-20 | minor | snapshot frame `id` is the fan-out cursor, which can trail the log by one poll → a resume from a snapshot id re-delivers one `created` frame (`FeedUseCase.java:93-102`) | GAP-e2e-10, GAP-frontend1-3 |
| G-2-9 | BE/FE | F-08, F-57 usability | **major (UX)** | the 409 banner says "Retire that notice first" but `(tenantId, externalRef)` is a permanent idempotency index; API text and README never say the key is permanent or how to publish a follow-up; the cookbook's first example works only once per service; `expectedVersion` has no OpenAPI description | UX-16, UX-26, UX-21, UX-24 |
| G-2-10 | FE | F-62, F-65, F-57 | minor | focus falls to `<body>` after resolving the last card (`OutageFeed.tsx:75-80`) and after "Publish another"; the server-error banner's second line is below the fold at 1280×800 and focus is not moved to it | GAP-frontend1-1, UX-17, UX-18 |
| G-2-11 | FE | F-61, F-20 | minor | reopen backoff capped at 30 s with no reset on recovery → up to 30 s to heal after a long outage; `lastSeq` cleared after a refused resume so the replay path is never used after a real restart (`api.ts:50-57,174-179`) | GAP-e2e-9, GAP-frontend1-2 |
| G-2-12 | FE | F-52, F-54, F-63, F-57, F-62 | minor/cosmetic | first visit pre-fills tenant `acme` (`App.tsx:28`); ticket hint promises a link the default config never gives; `Starts In 59m` CSS-capitalised and shown twice on a maintenance card; Save-as-draft switch 30×18 px; empty-body 500 reads "The service rejected this. 500 Internal Server Error"; resolve confirmation does not say who acts | UX-13, UX-10, UX-12, UX-15, UX-19, UX-8 |
| G-2-13 | FE | F-66 | minor | UI kit coverage 42 % (`format.ts` 21.6 %, `Segmented` 27.8 %, `Tabs` 29.4 %); dev-only `npm audit` 12 moderate (`minimatch` under the ESLint toolchain) | GAP-frontend1-5, GAP-frontend1-6 |
| G-2-14 | SC | F-80 builds | minor | Go toolchain line 1.24 past upstream support (`go.mod:3`, `Dockerfile:6`); image lacks `org.opencontainers.image.version`/`revision` labels | GAP-sidecar1-2, GAP-sidecar1-3 |
| G-2-15 | SC | F-83, F-86, F-78 tests | minor | `deploy_test.go` skips silently without kustomize/kubeconform (a CI image without the tools never runs the G-1-18 guard); no test pins the `/status` JSON contract the README documents; `cmd/health-sidecar` has no test | GAP-sidecar1-1, sidecar tests 17/20 |
| G-2-16 | SC | F-74, F-88, F-89 | minor | while the app is not UP the sidecar only re-sends at the heartbeat, so at default settings the backend reaches `failureThreshold` 30 s after the first DOWN instead of one probe interval later; README says `app is not listening …` "on every probe" while the first probe after a stop says `connection refused`; the log shows no line for that transition | sidecar resilience −1, GAP-sidecar1-4, GAP-e2e-11 |
| G-2-17 | E2E | test health | major (score) | no automated test in the repository drives browser↔backend or sidecar↔backend together; only the verifiers' scripts do | e2e tests 14/20 |

Decisions taken by the orchestrator (to be confirmed by Gonzalo, listed in the final report): keep the permanent
`externalRef` index and fix the wording (G-2-9); bound the staleness valve with a forget-after window instead of
changing its 30 % semantics (G-2-5); add CI workflows since none exist (G-2-3); the e2e suite builds images from
pre-built artefacts (jar, `dist/`) so no network is needed inside `docker build` (G-2-17).

## Fixer assignment (iteration 2)
| Fixer | Gaps | Scope |
|---|---|---|
| BE-D static/coverage/CI | G-2-1, G-2-2, G-2-3 | `build.gradle.kts`, the four `ensureIndex` sites, Locale fixes, `.github/workflows/ci.yml` |
| BE-E runtime/contract/docs | G-2-4, G-2-5, G-2-6, G-2-7, G-2-8, G-2-9 (backend half) | `config/**`, `health/**`, `feed/**`, `publishing/**`, `README.md`, OpenAPI annotations |
| FE-2 | G-2-9 (UI half), G-2-10, G-2-11, G-2-12, G-2-13 | `frontend/**` |
| SC-2 | G-2-14, G-2-15, G-2-16 | `sidecar/**` |
| E2E-S | G-2-17 | new `e2e/**`, root `Dockerfile` (backend), `frontend/Dockerfile` or `e2e/frontend.Dockerfile`, `.github/workflows/e2e.yml` |
