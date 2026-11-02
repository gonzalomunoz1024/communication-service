# Iteration 1 — fixes landed on `confidence-loop/2026-11-01`

Five fixers worked in separate git worktrees (one per area) and never scored anything; the orchestrator cherry-picked
their commits in the order below. Each commit names the gap it closes; each fix carries a regression test that failed
before and passes after (before/after logs: `evidence/iter-1/fixers/`, and the fixers' commit messages).

| Gap | Commit | Change (one line) | Test that now guards it |
|---|---|---|---|
| G-1-2 | 0fd51b6 | sidecar reports a vanished app as DOWN (`app is not listening (last target …)`) after the first UP; UNKNOWN only before the first UP / for a pinned port | `agent_test.go`: `TestAppThatStopsListeningStaysDownUntilItIsBack`, `TestAppNeverSeenUpIsUnknownWhileNothingListens`, `TestUnreadablePortTableIsUnknownNotDown` |
| G-1-18 | ccecee8 | native sidecar form is now a strategic-merge component (`deploy/kustomize/component-native`) that keeps existing init containers; JSON patch removed | `sidecar/deploy/deploy_test.go`: `TestNativeComponentKeepsExistingInitContainers`, `TestClassicComponentAppendsTheContainer`, `TestBothComponentsShareTheContainerContract` (kubeconform 1.29/1.27) |
| G-1-19 | 5a38919 | README: `CS_PUBLISHER`, what `CS_TENANT` is, Image and Debugging sections, helm library note, boot-unhealthy note; manual YAML aligned | `config/docs_test.go`: `TestEveryEnvironmentVariableIsDocumented`; `deploy_test.go`: `TestManualSnippetSharesTheContainerContract` |
| G-1-1 | b2b0a16 | explicit `@Query` window on the event log instead of a derived method with two `seq` criteria | existing `CommunicationServiceE2EIT.reconnectingWithLastEventIdReplaysWhatWasMissed` (unchanged, now passes); new `MongoCommunicationEventsAdapterIT` (3) |
| G-1-4 | 9d47a47 | stream opens with a `: connected` comment so the response commits at once | `CommunicationServiceE2EIT.streamIsCommittedAtOnceForATenantWithNothingVisible` |
| G-1-20 | 2e890f3 | retire/update decide on the effective status → 409 after `expiresAt` even before the sweep | `PublishingUseCaseTest`: `retireAfterExpiresAtButBeforeTheSweepIs409`, `updateAfterExpiresAtButBeforeTheSweepIs409`, `retireBeforeExpiresAtIsStillAllowed` |
| G-1-23 | 1f04bb7 | `ContextClosedEvent` completes the fan-out sink and per-request keepalives, so SIGTERM ends streams in ms, not 30 s | `MongoCommunicationEventsAdapterTest.closingTheContextCompletesEveryLiveStream`, new `RestControllerFeedAdapterTest.streamEndsWhenTheEventSourceEnds` |
| G-1-8 | 556d814 | Spring Boot Actuator: `/actuator/health`, `/liveness`, `/readiness` (Mongo in readiness), outside the client-id rule, nothing else exposed | new `OperationsEndpointsIT` (5), `ClientIdWebFilterTest.letsProbesReachTheHealthEndpointWithoutAnId` |
| G-1-9 | cc32685 | Spring Boot 3.4.1 → 3.5.16, springdoc 2.8.17, CycloneDX SBOM task; Netty 4.1.135, Spring 6.2.19, logback 1.5.34, swagger-ui 5.32.2 | full suite (versions recorded in the commit message for the auditor) |
| G-1-21 | 49d120f | error bodies name the field/allowed values/limit/verb/media type (400/404/405/413/415) | `RestControllerPublishingAdapterTest` (+9) |
| G-1-22 | 080668a | README cookbook runs on any day, `expectedVersion`/monitor id explained, INFO access log per request, Swagger scheme `X-Client-Id` with 401 documented, dead config keys removed | `ClientIdWebFilterTest.logsEveryIdentifiedRequestWithItsOutcome`, new `OpenApiContractIT` (2) |
| G-1-5 | 10333d0 | an open auto notice retired by an operator is noticed on the next observation; the monitor counts again | `HealthObservationUseCaseTest` (+2), `HealthMonitoringE2EIT.anOperatorRetiringTheAutoNoticeMakesTheMonitorCountAgain` |
| G-1-6 | 193ea9b | staleness valve ignores scaled-to-zero services and needs ≥ `stale-pause-min-silent` (2) silent monitors as well as the 30 % share | `HealthSweepUseCaseTest` (+2) |
| G-1-7 | 5aee2a4 | conflicting instance reports retried with jittered backoff (up to 8 attempts) | `HealthMonitorUseCaseTest.conflictingReportsAreRetriedMoreThanThreeTimesWithAPauseInBetween`, `HealthMonitoringE2EIT.aFleetOfPodsReportingInTheSameInstantIsAccepted` (20 parallel) |
| G-1-24 | 544cab7 | pushed reports accept the legacy top-level `details` map | `RestControllerHealthAdapterTest` (+1), `HealthReportTest` (+2) |
| G-1-17 | 912c8f8, 750b72c | jsdom + Testing Library infrastructure; ESLint flat config (`npm run lint`), coverage (`npm run test:coverage`) | `OutageCard.test.tsx`; lint 2 errors → 0 |
| G-1-3 | c95dd65, c3bddf8 | client reopens a CLOSED EventSource with backoff and `?lastEventId=`, badge "Reconnecting (n)", list reconciled after recovery, Try again reopens the stream, dev proxy drops the browser response when upstream dies; a refused resume falls back to a fresh open | `stream.test.ts` (6), `useOutageFeed.test.tsx` (4), `OutageFeed.test.tsx`, `feed-state.test.ts` reconcile (2) |
| G-1-10 | 2ff9f45 | Atlas tokens raised to WCAG AA in both themes; semantic `text-*-fg` utilities for text on tints | `contrast.test.ts` (computes ratios from `atlas.css`, 11), `kit-colours.test.tsx` (3) |
| G-1-11 | d9c6941 | `inFeed()` mirrors the server's visibility rule; stream frames filtered by it | `feed-state.test.ts` (+3) |
| G-1-12 | 127e20e | focus and scroll to the first invalid field, error summary with links, `aria-invalid`/`aria-describedby` | `PublishOutageForm.test.tsx` (+3) |
| G-1-13 | a62260c | "View in feed" switches tenant and type to the published notice | `App.test.tsx` |
| G-1-14 | e9417b8 | unreachable service (0/502/503/504) explained as such; Try again reopens the stream | `errors.test.ts` (3), form (2), feed (1) |
| G-1-15 | 4fdece9 | resolve announcement (`role=status`), focus kept, labelled filters and groups, `h1`, h2 cards | feed/form/App component tests (+4) |
| G-1-16 | 14e085f | time-driven card states at `startsAt`/`expiresAt`, "Showing the first N of M" cap notice, Withdraw for not-started items, 409 wording names the incident | feed-state, hook (real timers), feed, card, errors, form tests (+9) |

Test counts after the merge (orchestrator's run on the merged branch, `evidence/iter-1/merged-suite-counts.txt`):
backend unit 188 (was 164), integration 39 (was 26, 1 failing → 0 failing), frontend 78 (was 23), sidecar 36 test
functions (was 28). No existing test was deleted or weakened; existing tests touched:
`MongoCommunicationEventsAdapterTest` (mock method renamed with the repository method), `HealthSweepUseCaseTest.silenceIsNotTrustedWhenMostMonitorsGoSilentTogether`
(gained a stub for the new instances lookup, assertions unchanged), `HealthMonitorUseCaseTest.aPersistentConflictIsReturnedAfterTheRetries`
(moved to virtual time, same assertions), `HealthProperties` constructor arity in two test classes, `ClientIdWebFilterTest`
and `RestControllerPublishingAdapterTest` (tests added only).

Deliberate behaviour changes a verifier script written against iteration 0 will notice: the type radiogroup is named
"Type"; empty-state copy changed; the badge reads "Reconnecting (n)"; the 409 banner names the incident instead of
"duplicate externalRef"; not-started items say **Withdraw**; accent/critical colours and grey levels changed;
`communication.feed.default-page-size`/`max-page-size`/`communication.limits.*` keys were removed from `application.yml`.
