# Iteration 4 — fixes (code at `1cd3f13`, 37 commits over the iteration-3 head `6c15715`)

Five fixers worked in git worktrees from `6c15715` (BE-U backend upgrade and API documentation, BE-H backend behaviour, FE-4
frontend, SC-4 sidecar, E2E-4 the e2e suite and CI). The orchestrator cherry-picked SC-4's, E2E-4's, FE-4's and BE-H's commits
onto an integration branch without a conflict; BE-U then rebased its four commits onto that branch, resolving its overlaps with
BE-H (the 409 annotations, `GlobalExceptionHandler`, README) in favour of both behaviours. The orchestrator added two small
commits of its own, each closing a hole the combination exposed: `67f0d77` (the sidecar's trim table had no rows for a status
word that is only white space, the case BE-H's Java half changed) and `1cd3f13` (the e2e contract smoke pinned the 409 body to
exactly `{error}`, which G-4-11 extends; the first e2e run on the combined code failed on it). Every fix commit carries its gap
id; before/after evidence is in `evidence/iter-4/fixers/<fixer>-G-4-<n>-{before,after}.txt` and
`evidence/iter-4/integration/`.

Gates on the combined code (`evidence/iter-4/integration/gates.txt`; full logs in the orchestrator's scratchpad `int4-gates/`; re-run by the iteration-4 verifiers):
- Backend `./gradlew --max-workers=2 --no-daemon build` on `5352449` (code identical to `1cd3f13` outside `e2e/`): BUILD
  SUCCESSFUL; 270 unit + 55 integration tests, 0 failures, 0 skipped; JaCoCo line 1545/1590 = 0.9717 (gate 0.92), branch
  825/954 = 0.8648 (gate 0.84); SpotBugs 0; SBOM scope check passes.
- Frontend `npm ci`, lint, typecheck, 183 tests in 19 files, build (271.5 kB JS, 84.8 kB gzip); no frontend file changed after
  the FE-4 commits.
- Sidecar with go1.27.3: `gofmt -l` empty, `go vet` clean, `CI=true go test -race -count=1 ./...` and `-shuffle=on` all seven
  packages ok, on `67f0d77` and again on `5352449` (after the backend's `application.yml` changed, which two sidecar tests read).
- E2E: `npm ci`, `npm run lint` and `npm run typecheck` clean; the suite 9 of 9 on three fresh stacks built from
  `1cd3f13` with `GO_IMAGE=local/go-toolset:1.27 BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot` (`stack.sh up` + suite +
  `down`: 162, 144 and 146 s; Playwright 2.1, 2.0 and 2.1 min; `retries: 0`). The first run on `5352449`, before `1cd3f13`, failed
  F-09 only (the 409's new field, see G-4-11); spec 07 (database outage, the late page) passed in all four runs, and the sidecar
  logged its new INFO "report delivered again" after the suite's database outage.
- Scans: Trivy 0.58.1 with the database of 2026-11-02 01:14Z: the backend SBOM (113 components: Spring Boot 4.0.9,
  Spring 7.0.10, Netty 4.2.19, reactor-netty 1.3.8, Jackson 3.1.7, and Jackson 2.21.7, which springdoc's swagger-core still brings)
  0 vulnerabilities of any severity (iteration 3: 3 CRITICAL, 10 HIGH); the backend image the e2e stack built (debian 13.7) with
  CI's flags on its OS packages 0 (of 77 entries of any severity none has a fix; the 4 HIGH are in `libuuid1`, status
  "affected"); the sidecar image (the Go 1.27.3 binary on distroless static) with CI's full command 0, the binary itself 0 at any
  severity (iteration 3: 4 HIGH). govulncheck v1.9.0 on the sidecar source and binary: no vulnerabilities (SC-4's evidence).

| Gap | Commit(s) | Guarding test(s) | Evidence |
|---|---|---|---|
| G-4-1 Spring Boot 4.0.9 (Framework 7.0.10, Netty 4.2.19, Jackson 3.1.7) | `b70c458` | the Trivy SBOM scan (0 findings); `JsonWireFormatTest` (2), `OperationsEndpointsIT.overallHealthWritesStatusBeforeGroups`, `GlobalExceptionHandlerMessagesTest.aNumberTooLargeForItsFieldIsNotCalledMalformedJson` | be-u-G-4-1 |
| G-4-2 sidecar on Go 1.27.3 | `8783226`, `3476fa4` | `deploy/dockerfile_test.go TestGoModAndDockerfileAgreeOnTheGoLine`; Trivy and govulncheck of the binary (0) | sc-4-G-4-2, e2e-4-G-4-2 |
| G-4-3 backend image on distroless java21-debian13, by digest | `a45e04c` | the image scan (0 fixable), UID 65532 | be-u-G-4-3 |
| G-4-4 on-demand probe vs the sweep's claim (GAP-backend3-1) | `5d25330` | `HealthMonitorUseCaseTest.anOnDemandProbeThatLosesTheRaceAppliesTheObservationItMadeInsteadOfProbingAgain`, `ForcedProbeWhileTheSchedulerProbesIT` | be-h-G-4-4 |
| G-4-5 strict monitor registration | `ccba721` | `RestControllerHealthAdapterTest.registerRejectsAMisspelledPolicyFieldNamingIt` | be-h-G-4-5 |
| G-4-6 readiness within 0.8 s during an outage | `6f53c84` | `MongoOutageReadinessTest.readinessWhileMongoIsUnreachableAnswersWithinAKubeletsDefaultProbeTimeout` | be-h-G-4-6 |
| G-4-7 late probe failure is one DEBUG line | `055e619` | `WebClientHealthProbeAdapterTest.aConnectFailureThatArrivesAfterTheProbeTimedOutIsOneDebugLineNotAnErrorWithATrace` | be-h-G-4-7 |
| G-4-8 access log with the client-id check off | `573b996` | `ClientIdWebFilterEdgeCasesTest.withTheCheckSwitchedOffEveryRequestIsStillLoggedUnidentifiedOnesAsADash` | be-h-G-4-8 |
| G-4-9 one WARN per event-log outage | `9316b56` | `MongoCommunicationEventsAdapterTest.aDatabaseOutageWhileTailingIsOneWarningWhenPollingStopsAndOneInfoWhenItWorksAgain`, `aPollThatFailsForAnotherReasonIsAWarningEachTime` | be-h-G-4-9 |
| G-4-10 stream 503 before any byte | `5c9b77b` | `OperationsEndpointsIT.aStreamOpenedWhileTheDatabaseIsUnreachableIs503BeforeAnyByteWithOneWarning`, `aStreamWhoseDatabaseGoesAwayAfterItOpenedEndsWithOneWarningAndNoError`, `RestControllerFeedAdapterTest.aStreamIs503BeforeItsFirstByteWhileTheDatabaseCannotBeReached`, `GlobalExceptionHandlerTest.the503IsJsonEvenForARequestThatAcceptsOnlyAnEventStream` | be-h-G-4-10 |
| G-4-11 the 409 names the first free follow-up value | `5eb9867`, `1cd3f13` | `MongoCommunicationRepositoryAdapterIT.theConflictSuggestsTheFirstFollowUpValueTheTenantDoesNotHoldYet`, `pastFiftyTakenFollowUpValuesTheConflictSaysSoAndSuggestsNone`, `GlobalExceptionHandlerTest.aStatusCarriesTheFieldsItWasGivenBesideTheError`, `OpenApiContractIT` (example), `e2e/tests/01-api-contract.spec.ts` F-09 | be-h-G-4-11, orch-G-4-11-e2e-contract |
| G-4-12 OpenAPI answers and examples | `eefec53` | `OpenApiContractIT.everyRouteDocumentsTheSuccessAnswerItGives`, `everyOperationDocumentsTheSharedErrorAnswersThatApplyToIt`, `everyRequestExampleIsAcceptedByItsRouteAsItIs` | be-u-G-4-12 |
| G-4-13 every unknown field named in one 400 | `4eff8f4` | `GlobalExceptionHandlerMessagesTest` (+2), `RestControllerPublishingAdapterTest` (+1), `CommunicationServiceE2EIT` (+1) | be-u-G-4-13 |
| G-4-14 plain text in the README example | `92cc4d7` | `ReadmeExamplesTest.titlesAndBodiesInTheExamplesArePlainText` | be-h-G-4-14 |
| G-4-15 all-UNKNOWN rollup says why | `d592c06` | `HealthRollupTest.podsThatAreAllStillUnknownLendTheRollupTheFirstOnesOwnWords` | be-h-G-4-15 |
| G-4-16 one trim rule for status words | `e2018dc`, `8559e50`, `67f0d77` | `probe_test.go TestStatusWordsAreTrimmedLikeTheService` (10 rows), `HealthStatusTest.aStatusIsTrimmedOfExactlyTheCharactersUpToUPlus0020LikeTheSidecar` | sc-4-G-4-16, be-h-G-4-16, orch-G-4-16-go-alone-rows |
| G-4-17 Live only once the stream works; *Service degraded* | `27a9fec` | `stream.test.ts` (4), `useOutageFeed.test.tsx` (2), `OutageFeed.test.tsx` (1) | fe-4-G-4-17 |
| G-4-18 the feed's load error is an alert | `d4988b0` | `OutageFeed.test.tsx` | fe-4-G-4-18 |
| G-4-19 focus after *View in feed* | `2587273` | `App.test.tsx` | fe-4-G-4-19 |
| G-4-20 Escape cancels the confirmation | `4e199a0` | `OutageCard.test.tsx` | fe-4-G-4-20 |
| G-4-21 the form uses `suggestedExternalRef` | `70d21c4` | `api.test.ts` (1), `errors.test.ts` (2), `PublishOutageForm.test.tsx` (1) | fe-4-G-4-21 |
| G-4-22 durations that would freeze the loop | `377da86` | `TestDurationsTheSidecarCannotUseAreRejected`, `TestRunRejectsAnUnusableValueWithExit2` (+2 rows) | sc-4-G-4-22 |
| G-4-23 what a report gets while the database hangs | `4c2ac91` | `TestReportTimeoutDefaultAgainstTheServiceDatabaseTimeouts` | sc-4-G-4-23 |
| G-4-24 reports honour the proxy variables, probes do not | `9474dab` | `TestProxyVariablesAreDocumented` | sc-4-G-4-24 |
| G-4-25 INFO when reports get through again | `6e67d19` | `TestDeliveryAgainAfterFailedSendsIsLoggedOnceAtInfo` | sc-4-G-4-25 |
| G-4-26 the shape of `extraEnv` | `02c7bd0` | `TestHelmExtraEnvFromTheReadmeReachesTheSidecar` | sc-4-G-4-26 |
| G-4-27 the ConfigMap the plain-YAML container needs | `942ba4c` | `TestEachAttachPathNamesTheConfigMapItsContainerReads` | sc-4-G-4-27 |
| G-4-28 CI: gofmt, `-race`, pinned govulncheck | `67f2d4a` | the workflow steps (not run: no GitHub Actions here); the same commands run locally | sc-4-G-4-28 |
| G-4-29 the e2e README's send cadence | `a5d1c90` | docs (timings measured) | e2e-4-G-4-29 |
| G-4-30 spec 07's late page | `09c035b` | `e2e/tests/07-f92-database-down.spec.ts` (records every badge and error change of the late page) | e2e-4-G-4-30 |
| G-4-31 image scans in CI | `13a878d` | the workflow steps (not run here); the same `trivy image` command run locally on both images | e2e-4-G-4-31 |

## Existing tests touched (each named in the commit that touched it)
- Backend, Spring Boot 4 (G-4-1, no assertion changed): Boot 4 moved classes, so `MongoCommunicationEventsAdapterIT`,
  `MongoHealthInstanceRepositoryAdapterIT` and `MongoHealthMonitorRepositoryAdapterIT` (`@DataMongoTest`), `MongoClientConfigTest`,
  `MongoReadinessIndicatorTest` (`Health`, `Status`) and `ClientIdWebFilterTest` (Jackson 3's `ObjectMapper`) change imports only;
  `@AutoConfigureWebTestClient` on the five `@SpringBootTest` classes (`CommunicationServiceE2EIT`, `HealthMonitoringE2EIT`,
  `OperationsEndpointsIT`, `OpenApiContractIT`, `ForcedProbeWhileTheSchedulerProbesIT`), because Boot 4 adds a `WebTestClient`
  only with it; `MongoOutageReadinessTest` uses Boot 4's class names and `spring.mongodb.uri` (Boot 4 ignores the old key, so the
  test would have probed localhost:27017); Jackson 3 types and constructors in `GlobalExceptionHandlerMessagesTest` and
  `ClientIdWebFilterEdgeCasesTest`; `asText()` → `asString()` in `OpenApiContractIT` (every removed assertion line reappears with
  the same expectation); Spring 7 renamed `PayloadTooLargeException` and `HttpStatus.PAYLOAD_TOO_LARGE` to
  `ContentTooLargeException` and `CONTENT_TOO_LARGE` (still 413), so the four 413 assertions use the new names.
- Backend, behaviour: `HealthMonitorUseCaseTest` (3 tests) stubbed `observation.probe`, which the use case no longer calls
  (G-4-4); they stub `probeTarget` + `observe`, keep the same expectations and also check that the target is probed once.
  `OperationsEndpointsIT.aStreamOpenedWhileTheDatabaseIsUnreachableEndsWithOneWarningAndNoError` pinned G-3-1's "200, then the
  stream ends", which G-4-10 replaces on purpose: renamed `…Is503BeforeAnyByteWithOneWarning`, same three failure forms and both
  URIs, now expecting a JSON 503 and one WARN; its old assertions moved unchanged to the new
  `aStreamWhoseDatabaseGoesAwayAfterItOpenedEndsWithOneWarningAndNoError`. `RestControllerFeedAdapterTest` stubs `head()` in a
  `@BeforeEach` (G-4-10). `MongoCommunicationEventsAdapterTest` loses a comment that a new test made untrue (G-4-9).
  `OpenApiContractIT` gains assertions (G-4-11, G-4-12). `FakeActuatorController` gains a 3 s path (G-4-4).
- Frontend (G-4-17): two `stream.test.ts` tests advance `STREAM_SETTLE_MS` after `open()` (they treated a bare open as a working
  stream, the rule the gap removes); `OutageFeed.test.tsx` "says the service cannot reach its database for its own 503" asserted
  *Live* next to the database error, which was the defect (UX-42 residual); it now asserts *Service degraded* and no *Live*.
- Sidecar: `TestGoModAndDockerfileAgreeOnTheGoLine` keeps its rule (go.mod names the patch floor, the image tag the minor line)
  and also checks `GOTOOLCHAIN=local` and the README (G-4-2); `TestReportTimeoutDefaultOutlastsTheServiceDatabaseTimeout` became
  `TestReportTimeoutDefaultAgainstTheServiceDatabaseTimeouts`, keeps its assertions and reads the service's timeouts from
  `application.yml` (G-4-23); `TestRunRejectsAnUnusableValueWithExit2` gains two rows (G-4-22); `renderConsumingChart` takes
  optional values files (G-4-26); `TestStatusWordsAreTrimmedLikeTheService` keeps its five rows and gains five (G-4-16).
- E2E: spec 07 extended, no assertion changed or loosened (G-4-30), with `markDocument()` split out of `openFeed()` in
  `helpers.ts`; spec 03 a comment (G-4-29); spec 01's F-09 now pins `{error, suggestedExternalRef}` instead of `{error}` (G-4-11,
  stronger: the old body fails it).
No test was deleted, skipped or given a wider tolerance.

## Deliberate behaviour changes (product-visible)
- The backend runs on Spring Boot 4.0.9 with Jackson 3; the wire format is unchanged (the Jackson 3 defaults that would change
  it are set back, `/v3/api-docs` is identical apart from the server URL) except that a body nested deeper than 500 levels (was
  1000) is answered "Failed to read HTTP message" — G-4-1. The image runs on distroless java21-debian13 — G-4-3.
- A stream opened while the database is unreachable answers `503 {"error":"database unavailable"}` (JSON) before any byte,
  instead of 200 and an early end — G-4-10. The UI treats it as a failed attempt and retries with its backoff.
- The duplicate-externalRef 409 names the first follow-up value the tenant does not hold yet and returns it as
  `suggestedExternalRef` beside `error`; the UI offers that value — G-4-11, G-4-21.
- Monitor registrations reject unknown fields with 400 (health reports stay lenient) — G-4-5; a 400 for unknown fields names
  all of them (a single one reads as before) — G-4-13.
- Readiness answers within 0.8 s during an outage (`communication.mongo.readiness-timeout: PT0.8S`, was 1 s) — G-4-6.
- Status words are trimmed of exactly the characters up to U+0020 on both sides: a lone U+00A0 now reads DEGRADED (was
  UNKNOWN), a lone U+0001 UNKNOWN (was DEGRADED) — G-4-16.
- Logs: one DEBUG line for a probe failure that arrives after its timeout (was an ERROR with a stack trace), `client=-` access
  lines with the client-id check off, one WARN and one INFO per event-log outage — G-4-7, G-4-8, G-4-9. The all-UNKNOWN rollup
  quotes the first pod's own words — G-4-15.
- UI: the badge says *Live* only once the stream delivered a frame or stayed open 6 s, and *Service degraded* while the stream
  works but the list could not be loaded; the load error is announced as an alert; *View in feed* moves focus to the list;
  Escape cancels an inline confirmation — G-4-17 … G-4-20.
- Sidecar: built with Go 1.27.3 (an older builder fails the build) — G-4-2; zero or negative timeouts and heartbeat, and a
  negative retry delay or grace, exit 2 at start-up (`CS_RETRY_DELAY=0` and `CS_STARTUP_GRACE=0` stay valid) — G-4-22; an INFO
  "report delivered again" after failed sends — G-4-25.
- CI: gofmt, `go test -race`, govulncheck v1.9.0 and image scans of the backend and the sidecar (`trivy image --scanners vuln
  --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1`) — G-4-28, G-4-31. The sidecar's scan runs on the UBI micro base,
  which could not be scanned here, so its first run in Actions may fail on that base's packages.

## Not verified here
- GitHub Actions runs of the new CI steps; the UBI images (`ubi9/go-toolset:1.27`, `ubi9/ubi-micro`); an OpenShift cluster.
- CI's full backend image command (`trivy image` on the jar and the OS together) needs Trivy's Java database (994 MB
  compressed), which does not fit this sandbox's disk; the jar's libraries are covered by the SBOM scan and the OS packages by
  the image scan with the same flags.
