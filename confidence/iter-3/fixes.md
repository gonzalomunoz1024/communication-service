# Iteration 3 — fixes (code at `4a0e84e`, 37 commits over `23c297d`)

Five fixers worked in git worktrees from `3806e7c` (FE-3 frontend, SC-3 sidecar, BE-F backend contracts, BE-G backend
operations and build gates, E2E-T the e2e suite and the root README); the orchestrator cherry-picked their commits onto an
integration copy, resolved one README conflict (both backend fixers rewrote the "When Mongo is down" paragraph; the merged
text keeps BE-G's readiness and logging sentences and BE-F's stream sentence), added two small commits of its own
(`1914a99` CI pins for the new Helm test, `4a0e84e` the staleness relation on the service side), ran every gate on the
combined code and fast-forwarded the loop branch. Every fix commit carries its gap id; before/after evidence is in
`evidence/iter-3/fixers/<fixer>-G-3-<n>-{before,after}.txt`.

Gates on the combined code (`4a0e84e`; logs in the orchestrator's scratchpad, re-run by the iteration-3 verifiers):
`./gradlew check` BUILD SUCCESSFUL (247 unit + 46 integration tests, 0 failures, SpotBugs 0, JaCoCo line 0.965 ≥ 0.92 and
branch 0.847 ≥ the new 0.84 gate, SBOM scope check); frontend lint, typecheck, 169 tests in 19 files, build; sidecar
`gofmt`, `go vet`, `CI=true go test -race ./...` all packages ok; e2e suite `npm run lint`, typecheck and 9 of 9 tests on three
fresh stacks built from the combined code (91, 97, 95 s wall).

| Gap | Commit(s) | Guarding test(s) | Evidence |
|---|---|---|---|
| G-3-1 stream during a DB outage | `98e3fdc` | `OperationsEndpointsIT.aStreamOpenedWhileTheDatabaseIsUnreachableEndsWithOneWarningAndNoError` | be-f-G-3-1 |
| G-3-2 probe slot claim | `507e918` | `HealthSweepUseCaseTest.twoInstancesSweepingTheSameDueMonitorProbeItOnceAndTheLoserStaysQuiet`, `HealthMonitorTest.claimingTheProbeSlotRecordsTheProbeTimeAndNothingElse` | be-g-G-3-2 |
| G-3-3 effective status on publisher/admin reads | `7e265be` | 4 × `PublishingUseCaseTest`, `AdminUseCaseTest.searchReportsEachItemsEffectiveStatus`, `CommunicationServiceE2EIT.publisherAndAdminReadsReportTheEffectiveStatusBeforeTheSweeperRuns` | be-f-G-3-3 |
| G-3-4 coverage gate scope + branch rule | `f141b2d` | the gate (BRANCH ≥ 0.84); `GlobalExceptionHandlerMessagesTest` (14), `ClientIdWebFilterEdgeCasesTest` (4) | be-g-G-3-4 |
| G-3-5 SBOM scope | `412e10d` | the `verifySbomScope` task in `check` | be-g-G-3-5 |
| G-3-6 outage log hygiene | `07e6e4d` | `MongoOutageReadinessTest`, `MongoReadinessIndicatorTest` | be-g-G-3-6 |
| G-3-7 null/blank service entries | `083721a` | `RestControllerPublishingAdapterTest.aNullServiceEntryNamesItsPositionAndTheRule`, `anEmptyOrBlankServiceEntryIsRejected` | be-f-G-3-7 |
| G-3-8 unknown fields | `2ebdaf2` | `RestControllerPublishingAdapterTest.aMisspelledFieldIs400NamingItAndListingTheKnownOnes`, `RestControllerHealthAdapterTest.aReportMayCarryKeysTheServiceDoesNotKnow`, `CommunicationServiceE2EIT.publishingRejectsUnknownFieldsWhileHealthReportsAcceptThem` | be-f-G-3-8 |
| G-3-9 values in the expiresAt / expectedVersion 400s | `55ed84c` | `CommunicationTest.anExpiryNotAfterTheStartNamesBothValuesAndAStartThatDefaulted`, `RestControllerPublishingAdapterTest.anUpdateWithoutExpectedVersionSaysWhatToSendAndWhatA409Means`, an E2EIT case | be-f-G-3-9 |
| G-3-10 docs (sidecar README, CI pins, root README) | `1415134`, `1914a99`, `b2b5314` | `deploy/helm_test.go TestHelmIncludeLinesFromTheReadmeRenderAValidDeployment`, `TestStatusShowsTheLastReportComposedSentOrNot` | sc-3-G-3-10, e2e-t-G-3-10 |
| G-3-11 resume precedence | `229dd04` | `RestControllerFeedAdapterTest.withBothAQueryIdAndALastEventIdHeaderTheStreamResumesAfterTheLaterOne` | be-f-G-3-11 |
| G-3-12 restart spec proves replay | `f09d2f0` | `e2e/tests/04-f92-backend-restart.spec.ts` (fails against a backend with replay disabled) | e2e-t-G-3-12 |
| G-3-13 e2e Go image and labels | `4de88bf` | `stack.sh build`; image labels | e2e-t-G-3-13 |
| G-3-14 `CS_LOG_LEVEL` | `ef5d3ad` | `TestLogLevelIsReadAndValidated`, `TestRunLogsAtTheConfiguredLevel` | sc-3-G-3-14 |
| G-3-15 report timeout 10 s | `d7b0a1b` | `TestReportTimeoutDefaultOutlastsTheServiceDatabaseTimeout` | sc-3-G-3-15 |
| G-3-16 degraded-by-component every probe | `92e63d0` | `TestUpWithAFailingComponentIsSentEveryProbe`, `TestFailingCountsTheComponentsTheServiceCounts` | sc-3-G-3-16 |
| G-3-17 boolean typos | `34f1cd1` | `TestInsecureSkipVerifyAcceptsTheDocumentedSpellingsOnly`, `TestRunRejectsAnUnusableValueWithExit2` | sc-3-G-3-17 |
| G-3-18 UNKNOWN at the heartbeat | `8723f78` | `TestUnknownIsSentAtTheHeartbeat` | sc-3-G-3-18 |
| G-3-19 heartbeat test on the fake clock | `375ccea` | `TestNotUpIsSentEveryProbeAndUpOnlyAtTheHeartbeat` (rewritten, 20× `-race`) | sc-3-G-3-19 |
| G-3-20 service's 503 vs unreachable | `ad8f6d2` | `errors.test.ts`, `OutageFeed.test.tsx`, `PublishOutageForm.test.tsx` (503 with body) | fe-3-G-3-20 |
| G-3-21 duplicate-reference 409 in the form's terms | `05bec99` | `errors.test.ts` (6), `PublishOutageForm.test.tsx` (2) | fe-3-G-3-21 |
| G-3-22 focus into the confirmation | `9cde57e` | `OutageCard.test.tsx` (3) | fe-3-G-3-22 |
| G-3-23 badge live region, waiting state, 24 px row | `85edf1d` | `OutageFeed.test.tsx` (3) | fe-3-G-3-23 |
| G-3-24 one load per typed tenant | `d685898` | `App.test.tsx` (2) | fe-3-G-3-24 |
| G-3-25 automated notices (body, actor, chip) | `56d6cc8`, `85bf46e` | `HealthNoticeTest.anAutomatedNoticeReadsAsPlainWordsWithTheTimeToTheSecond`, `HealthObservationUseCaseTest.aNoticeIsUpdatedAndRetiredUnderTheNameItWasPublishedWith`, `OutageCard.test.tsx` (2) | be-g-G-3-25, fe-3-G-3-25 |
| G-3-26 useTheme coverage | `54fead9` | `useTheme.test.tsx` (7) | fe-3-G-3-26 |
| G-3-27 e2e failure paths | `ac7026a` | `e2e/tests/05-f76-sidecar-sigterm`, `06-f39-pull-monitor`, `07-f92-database-down` | e2e-t-G-3-27 |
| G-3-28 e2e lint | `7112b71` | `npm run lint` in `e2e/` and the workflow | e2e-t-G-3-28 |
| G-3-29 backoff cap vs staleness window | `58f80ff`, `4a0e84e` | `TestRetriesAreNeverFurtherApartThanTheBackoffCap` | sc-3-G-3-29 |
| G-3-30 shared status vocabulary | `85dcd7f`, `06b822a` | `HealthStatusTest` | be-f-G-3-30 |
| G-3-31 outage timings in the README | `1abd169` | docs (measured on a SIGSTOPped mongod) | be-g-G-3-31 |
| G-3-32 values in the endsAt 400 | `72a14cd` | `CommunicationTest.anEndNotAfterTheStartNamesBothValuesAndAStartThatDefaulted` | be-f-G-3-32 |

## Existing tests touched (each named in the commit that touched it)
- Frontend: `errors.test.ts` and `PublishOutageForm.test.tsx`, one test each pinned the verbatim duplicate-reference banner that
  G-3-21 deliberately replaces; same inputs, they now assert the form's explanation (and the server text inside the details).
  `OutageFeed.test.tsx`: two tests used `getByRole('status')`, ambiguous once the badge has its own live region (G-3-23); they
  read the same element through a helper with the same assertions. The test EventSource stub records URLs (G-3-24).
- Sidecar: `TestNotUpIsSentEveryProbeAndUpOnlyAtTheHeartbeat` rewritten on the harness clock with exact per-tick counts
  (stronger than the old 3–20 window; G-3-19); a WARN row added to it (G-3-18); `TestRunSendsLeavingReportOnShutdown` sets
  `Sleep = sleep`, the real wait it had before (G-3-19).
- Backend: `HealthSweepUseCaseTest` (3 tests) stub the claim save and verify the probe on the claimed monitor; one gained a WARN
  assertion (G-3-2). `HealthNoticeTest` (3), `HealthObservationUseCaseTest`, `HealthSweepUseCaseTest.silentPushOnlyMonitorsAreObservedAsDown`
  and `HealthMonitoringE2EIT` (3 body assertions) pin the new plain-words body and the monitor's own publisher as actor
  (G-3-25; the old assertions encoded the format and actor the gap replaces). `CommunicationTest.endsBeforeStartIsRejected` now
  asserts the exact message with values instead of a substring (G-3-32). `AdminUseCaseTest.setUp` and `MongoClientConfigTest`
  only pass a new constructor argument; `LogCapture` gained a logger-name factory.
- E2E: spec 04 rewritten to prove replay (all earlier assertions kept, the card timeout tightened from 90 s to 30 s); its
  `if (restartError) throw restartError` became `expect(await restart).toBeNull()` for the new lint rule (G-3-28).
No test was deleted, skipped or given a wider tolerance.

## Deliberate behaviour changes (product-visible)
- Publish, update, retire and ticket bodies reject unknown fields with 400 (health reports stay lenient) — G-3-8.
- Publisher and admin reads answer with the effective status (EXPIRED after `expiresAt`) without writing — G-3-3.
- Automated notices read as plain sentences and are updated/retired under the monitor's publisher (`health-sidecar` for
  sidecar services) instead of `health-monitor` — G-3-25; the UI shows "Automatic" instead of a `health:` reference.
- Readiness answers within 1 s (`communication.mongo.readiness-timeout`) and logs two lines per outage — G-3-6.
- The service reads PASS/GREEN/SERVING as UP and FAIL/FAILED/ERROR/RED/NOT_SERVING as DOWN — G-3-30.
- Sidecar: `CS_REPORT_TIMEOUT` 10 s, `CS_LOG_LEVEL`, strict booleans, UNKNOWN at the heartbeat, degraded-by-component every
  probe, retry backoff capped at 30 s — G-3-14 … G-3-18, G-3-29.
- UI: the header tenant commits after a 400 ms pause, on Enter or blur — G-3-24.
