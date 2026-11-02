# Iteration 2 — fixes

Branch `confidence-loop/2026-11-01`; 24 commits over `595d74f` (the iteration-1 audit record), one per gap unless noted;
fixers worked in git worktrees and the orchestrator cherry-picked, resolving two README/test-file overlaps by hand.
Fixers' before/after logs: `evidence/iter-2/fixers/<fixer>-G-2-<n>-{before,after}.txt`.

| Gap | Commit(s) | What changed | Guarding test(s) | Evidence |
|---|---|---|---|---|
| G-2-1 | `37e6ad4` | `ensureIndex` → `createIndex` at the four sites; javac `-Xlint:deprecation,removal,unchecked -Werror` | the compile gate itself (7 warnings before, build fails with `-Werror`; clean after) | `be-d-G-2-1-*` |
| G-2-2 | `b0a71ef` | SpotBugs 4.10.5 (effort max, confidence medium) and JaCoCo (line ≥ 0.92, measured 0.956) wired into `check`; 31 findings fixed by defensive copies in records, 5 justified entries in `config/spotbugs/exclude.xml`; `Locale.ROOT` at the two case conversions; README "Build gates" | `GlobalExceptionHandlerTest.aStatusWithoutReasonLowerCasesItsPhraseTheSameWayInEveryLocale`, `RestControllerFeedAdapterTest.eventNamesAreLowerCasedTheSameWayInEveryLocale` (Turkish default locale), plus the gates | `be-d-G-2-2-*` |
| G-2-3 | `463b647` | `.github/workflows/ci.yml`: backend (`check`, reports, SBOM scan with anchore), frontend (lint/typecheck/test/build/audit), sidecar (vet, `CI=true go test` with kustomize+kubeconform+helm, govulncheck, image build); README "Continuous integration" | the workflow (validated as YAML; every step's command run locally) | `be-d-G-2-3-local-run.txt` |
| G-2-4 | `00433c3` | `MongoClientSettingsBuilderCustomizer` (server selection 5 s, connect 5 s, read 15 s, `communication.mongo.*`); driver failures → 503 `{"error":"database unavailable"}`; sweeps log one WARN without stack; README "When Mongo is down" | `GlobalExceptionHandlerTest.anUnreachableDatabaseIs503WithoutTheDriversClusterDescription`, `MongoClientConfigTest`, `HealthSweepUseCaseTest`/`StatusSweepUseCaseTest` (+2 each), `OperationsEndpointsIT.theMongoClientGivesUpOnAnUnreachableDatabaseWithinSeconds` | `be-e-G-2-4-*` (30.02 s/500 → 5.02 s/503) |
| G-2-5 | `851a1e4` | `communication.health.stale-forget-after` (default `PT24H`): monitors silent longer are outside the valve's numerator and denominator; README staleness section | `HealthSweepUseCaseTest` +3 (14 silent 2 days + 1 silent 2 min → DOWN; forgotten left alone; 3 of 5 → paused) | `be-e-G-2-5-*` |
| G-2-6 | `dce5f89` | `HealthMonitor.withClosedByOperator()` keeps the noticing observation as the first of the new count | `HealthObservationUseCaseTest.afterAnOperatorsRetireTheNoticeReopensOnTheThresholdthFailingObservation`, `HealthMonitorTest.anOperatorsRetireStartsTheCountAgainWithTheObservationThatNoticedIt` | `be-e-G-2-6-*` |
| G-2-7 | `d3ac7eb` | `probeNow` retried up to 3× on an optimistic-lock conflict, re-reading the monitor | `HealthMonitorUseCaseTest` +2 (conflict then success; persistent conflict → 409) | `be-e-G-2-7-*` |
| G-2-8 | `a08dfaf` | `CommunicationEventsPort.head()`; snapshot frames stamped with the log head read before the snapshot query; README: at-least-once, dedupe on `(id, version)` | `FeedUseCaseTest.theSnapshotIsStampedWithTheLogHeadReadBeforeItIsQueried`, `MongoCommunicationEventsAdapterTest.headIsTheEndOfTheLogEvenWhileTheCursorTrailsIt` | `be-e-G-2-8-*` |
| G-2-9 | `6fd1088` (API), `eac1d0a` (UI) | 409 body names the holder and says the key is permanent; `@Schema` on `externalRef`/`expectedVersion`, documented 409; README cookbook follow-up example; UI banner explains permanence, no "Retire" advice | `OpenApiContractIT.theIdempotencyKeyAndTheVersionCheckExplainThemselves`, `MongoCommunicationRepositoryAdapterIT.theExternalRefStaysTakenAfterItsHolderIsRetired`, `CommunicationServiceE2EIT` 409 body; vitest `errors.test.ts`/`PublishOutageForm.test.tsx` (bare and explained 409) | `be-e-G-2-9-*`, `fe-2-G-2-9-*` |
| G-2-10 | `290c2ad` | focus to the list region after resolving the last card, to Title after "Publish another", to the server-error banner (`tabIndex=-1`, `scrollIntoView`) | `OutageFeed.test.tsx`, `PublishOutageForm.test.tsx` on `document.activeElement` | `fe-2-G-2-10-*` |
| G-2-11 | `7bb0b6c` | reopen backoff 1,2,4,8,10 s (cap 30 → 10 s), reset on open; `lastSeq` kept across failed attempts, `?lastEventId=` on every reopen (the backend never refuses an id: unknown ids get a snapshot) | `stream.test.ts` (+2: backoff restarts after a successful open; every attempt carries `lastEventId`) | `fe-2-G-2-11-*` |
| G-2-12 | `8e644ce` | UX-13 no `acme` default (`VITE_DEFAULT_TENANT` → last used → empty + prompt); UX-10 ticket hint; UX-12 "Scheduled" capsule once, sentence case; UX-15 Save-as-draft row target; UX-19 5xx wording; UX-8 confirmation names actor and tenant | `App.test.tsx`, `errors.test.ts`, `OutageCard.test.tsx`, `PublishOutageForm.test.tsx`, `StateTag.test.tsx` | `fe-2-G-2-12-*` |
| G-2-13 | `6ba70b0` | tests for `format.ts`, `Segmented`, `Tabs`, job state, kit layout (`src/ui` 47.8 % → 92.0 % lines); `overrides: minimatch ^11` (audit 12 moderate → 0) | the new test files; `npm audit` | `fe-2-G-2-13-*` |
| G-2-14 | `a5b1ea1` | `go 1.25`; Dockerfile `GO_IMAGE` default go-toolset 1.25, `REVISION` arg, OCI `version`/`revision` labels; README build command | `deploy/dockerfile_test.go` (go line, labels) | `sc-2-G-2-14-*` |
| G-2-15 | `e54fe6a` | manifest tests fail (not skip) without tools when `CI` is set; `/status` JSON contract test; `main` → `run()` with tests | `TestStatusJSONMatchesTheDocumentedContract`, `cmd/health-sidecar/main_test.go` (3), `requireTool` | `sc-2-G-2-15-*` |
| G-2-16 | `7006692` | send after every probe while not UP (heartbeat only for UP), INFO on transitions, DEBUG for repeats, one "not listening" message from the first failed probe; README send policy | `TestNotUpIsSentEveryProbeAndUpOnlyAtTheHeartbeat`, `TestTransitionsAreLoggedAtInfoAndRepeatedSendsAtDebug`, `TestRejectedDownReportKeepsTheHeartbeatCadence` | `sc-2-G-2-16-*` (live: OUTAGE 5.8 s after the stop) |
| G-2-17 | `b397f87`, `6dee344`, `3bf0946`, `5d650f3` | root `Dockerfile` (distroless Java 21, non-root); `e2e/fakeapp`; `e2e/` Playwright 1.63 suite over a compose stack (F-90, F-91, F-92, API contract); `.github/workflows/e2e.yml`; `e2e/README.md` | the suite: 6 tests, `6 passed (55.1s)` from a fresh stack | `e2e-s-G-2-17-*` |
| merge | `908598a` | two varargs stubbings from G-2-7/G-2-8 chained so the G-2-1 gate accepts them (same answers) | unchanged tests | `logs` of the merged `check` |

Merged-tree results after the cherry-picks: `./gradlew clean check` BUILD SUCCESSFUL (unit 208/0 failed, integration 42/0,
SpotBugs 0 findings, JaCoCo line 0.9561 ≥ 0.92, `-Werror` clean, SBOM written); frontend `npm ci`, lint, typecheck,
141 tests (18 files), build, `npm audit` 0; sidecar `gofmt`/`go vet`/`CI=true go test ./...` with the tools on PATH all ok
under go1.25.0.

## Existing tests touched (each named in the commit that touched it)
- G-2-1: `HealthMonitorUseCaseTest` three varargs stubbings chained; `OpenApiContractIT` `JsonNode.fields()` → `properties()` (same entries). No assertion changed.
- G-2-6: `HealthObservationUseCaseTest` (2), `HealthMonitorTest.claimAndCloseBookkeeping`, `HealthMonitoringE2EIT.anOperatorRetiringTheAutoNoticeMakesTheMonitorCountAgain`: `unhealthyStreak` 0 → 1 after an operator retire and the fresh notice expected on the threshold-th probe (the old assertions encoded the off-by-one the README contradicted).
- G-2-8: `FeedUseCaseTest` snapshot tests stub `head()` instead of `position()` (API change; assertions kept, one strengthened).
- G-2-9: `MongoCommunicationRepositoryAdapterIT.duplicateExternalRefWithinTenantIsConflict` expects the new wording with the holder id; `CommunicationServiceE2EIT` now asserts the 409 body.
- G-2-9 (UI): two assertions pinning "Retire that notice first" now pin the new sentence.
- G-2-11: cap expectation 30 000 → 10 000 ms; "second attempt opens without `lastEventId`" → "carries `lastEventId=12`" (both encoded GAP-e2e-9/GAP-frontend1-2).
- G-2-12: `App.test` "View in feed" seeds `localStorage` with `acme` instead of relying on the removed pre-fill.
- G-2-16: `TestAppThatStopsListeningStaysDownUntilItIsBack` additionally asserts the first message (strengthened).
No test was skipped, deleted or loosened.

## Deliberate behaviour changes (product-visible)
- Mongo unreachable: 503 `database unavailable` within ~5 s instead of 500 after 30 s; the service still exits when Mongo is unreachable at startup (index creation), now after ~17 s.
- A JSON `affectedServices` containing `null` is rejected with 400 at binding (was a 500 inside the domain).
- Duplicate `externalRef`: the key stays permanent per tenant; wording and docs changed (decision for Gonzalo to confirm).
- First visit of the UI no longer pre-fills tenant `acme` (decision for Gonzalo to confirm); `VITE_DEFAULT_TENANT` restores a fixed default.
- Stream reopen backoff cap 30 s → 10 s.
- Sidecar: a report after every probe while the app is not UP (1,000 unhealthy pods ≈ 67 req/s); UNKNOWN during startup grace is also sent every probe.
- Operator retire of an auto notice: reopened on the `failureThreshold`-th failing observation (was threshold + 1).
