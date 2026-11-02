# Final report: end-to-end confidence loop

communication-service, run from 2026-11-01 23:10Z to 2026-11-02 12:43Z. Original `main`: `191a0c5`. The loop's commits are on
`claude/project-thread-qxxxc3` (pull request #9; locally `confidence-loop/2026-11-01`). The code graded in iteration 4 is
`1cd3f13`; the commits after it add records under `confidence/` and the journey pages under `docs/journeys/`, not code.

Each iteration's own record is `iter-<n>.md` plus the folder `iter-<n>/` (gaps, fixes, verifier and usability reports), with the
evidence under `evidence/iter-<n>/`. Paths in this report are relative to `confidence/`.

## 1. Verdict

**NOT YET.**

The target was at least 95 for each of the backend, the frontend, the sidecar and the end-to-end system, with the overall
score the lowest of the four. After the fourth and last iteration the verifiers scored the backend 90, the frontend 97, the
sidecar 92.05 and the end-to-end system 97. The overall score is 90.

These four numbers are **not audited**. The independent audit of iteration 4 was stopped at Gonzalo's request at 12:43Z on
2026-11-02, before it ruled on any score, gate or the test-weakening check. The replays it had finished agreed with the
verifiers (34 of 34 sampled sidecar claims, 16 of 16 usability claims, and every backend and frontend replay it completed);
its partial evidence is in `evidence/iter-4/audit/`. Agreement in a partial sample is not a ruling, and the iteration-3 audit
lowered two of the verifiers' scores (sidecar 91.5 to 80, E2E 97 to 80), so the numbers above can still move.

Why the verdict is NOT YET:

- **Backend, 90.** A hung database (a frozen server, not a refused connection) gives 500s carrying the driver's message,
  including the database host and port, and stack traces from both sweeps (GAP-backend4-1, the only major gap left). One
  integration test is flaky against a 5 s default timeout (GAP-backend4-3). Hibernate Validator 9 changed `@NotBlank`
  (GAP-backend4-4). A forced probe can move `lastProbeAt` backwards (GAP-backend4-2).
- **Sidecar, 92.05.** 5.45 of the 7.95 missing points are things this sandbox cannot do: build on the UBI images (1), and run
  the manifests on an OpenShift cluster instead of a Docker emulation of the pod (1.45 for the PARTIAL rows F-80, F-82 and
  F-86, 3 under integration). The other 2.5 come from GAP-sidecar4-2 (a status word the service's validation rejects), its
  missing cross-check test, and README sentences that are wrong at the corners of GAP-sidecar4-1 and 4-2.
- **Frontend 97 and E2E 97** reach the target as the verifiers scored them.

Hard gates: the verifiers found none tripped. Two readings were left for the auditor and are not ruled:

1. **Security gate (D8 in §7).** The backend image's base (`distroless/java21-debian13`) has 4 HIGH entries in `libuuid1`
   with no fixed version in Debian. CI scans images with `--ignore-unfixed`, under which they do not count, and the backend
   verifier applied that rule. Read literally ("an open critical/high security finding"), the gate would cap the backend and
   the end-to-end system at 80, and the overall score at 80. Every library and binary the services ship scanned clean: the
   backend SBOM 0, the sidecar binary 0 (Trivy and govulncheck), `npm audit` 0.
2. **GAP-backend4-1 against rows F-18 (the stream) and F-28 (the error contract).** The backend verifier passed both with a
   note because the documented 503 holds for a stopped database. The auditor's replay with `mongod` frozen reproduced the
   gap: 15 of 108 calls got the 503, the others a 500 after 8 to 20 s, 93 bodies named the driver's pool or server, and
   streams opened during the freeze got an SSE-framed 500 (`evidence/iter-4/audit/22-backend-gate1-frozen-db.txt`). The
   iteration-3 code behaved the same way in the same rounds, so this is not a regression. Whether a hung database is inside
   those rows decides the "any matrix item fails" gate; the audit stopped before ruling.

Folding the Usability Reviewer's scores (UI 87, API 98, sidecar onboarding 100) into each usability category, the way the
audits of iterations 1 to 3 did, gives Backend 90.8, Frontend 95.7, Sidecar 92.55 and E2E 96.7: the same verdict.

## 2. Scorecard per iteration

Audited score first, the verifier's own score in brackets. Iteration 4 has the verifiers' scores only.

| | Iteration 0 (baseline) | 1 | 2 | 3 | 4 (not audited) |
|---|---|---|---|---|---|
| Backend | **68** (72) | **88** (87) | **94** (94) | **80** (80; 91 before the security cap) | 90 |
| Frontend | **62** (66) | **91** (93) | **96** (97) | **96** (96) | 97 |
| Sidecar | **77** (77) | **89** (88) | **91** (90.5) | **80** (91.5) | 92.05 |
| E2E system | **62** (67) | **85** (86) | **90** (90) | **80** (97) | 97 |
| **Overall (lowest)** | **62** | **85** | **90** | **80** | 90 |
| Hard gate | tripped: F-06 (one clause), F-16, F-20, F-61, F-65, F-83, F-88 and F-92 failed; HIGH CVEs open | none | none | security: 3 CRITICAL + 10 HIGH in Netty 4.1.135, Jackson 2.21.4, spring-webflux 6.2.19; 4 HIGH in the Go 1.25.14 standard library | none found by the verifiers; two readings unruled (§1) |
| Usability Reviewer: UI / API / sidecar onboarding | 17 / 41 / – | 74 / 93 / 100 | 84 / 89 / 94 | 87 / 90 / 95 | 87 / 98 / 100 |
| Gaps fixed (fix commits) | – | 24 (26) | 17 (22) | 32 (37) | 31 (35) |

The fall in iteration 3 came from a vulnerability database becoming reachable in the sandbox, not from worse code: without
the security cap that audit put the overall at 91. Iteration 4 cleared those findings with Spring Boot 4.0.9 (Spring 7.0.10,
Netty 4.2.19, Jackson 3.1.7) and Go 1.27.3.

Iteration 4 by category (weights in brackets):

| Category | Backend | Frontend | Sidecar | E2E |
|---|---|---|---|---|
| Builds & static checks (10) | 10 | 10 | 9 (UBI build not verifiable here) | 10 |
| Feature completeness (30) | 30 | 30 | 28.55 (3 of 31 rows PARTIAL) | 30 |
| Automated test health (20) | 17 (flaky OpenAPI IT; no test for a paused pool, `lastProbeAt` order or control-character input) | 18 | 19 | 19 |
| Integration & contracts (20) | 16 (GAP-backend4-1, 4-2, 4-4, 4-5) | 19 | 16 (GAP-sidecar4-1 to 4-4) | 19 |
| Resilience & ops (10) | 8 (GAP-backend4-1 under load) | 10 | 10 | 10 |
| Usability (10) | 9 | 10 | 9.5 | 9 |
| **Total** | **90** | **97** | **92.05** | **97** |

What each iteration changed, in one line each (details in `iter-<n>.md`):

- **Iteration 0** measured the original `main`. Headline defects: an SSE resume with `Last-Event-ID` answered 500 (the
  integration tests had never run); a crashed app made the sidecar report UNKNOWN forever, so no outage opened; the native
  sidecar Kustomize patch replaced a pod's existing init containers; the frontend never re-created a closed stream; text
  contrast below WCAG AA; the staleness valve counted services scaled to zero.
- **Iteration 1** fixed 24 gaps; every one of the 92 matrix rows passed and no gate tripped.
- **Iteration 2** fixed 17: `-Werror`, SpotBugs and JaCoCo gates and the CI workflows, a 503 within 5 s when MongoDB is down,
  the staleness valve's forget window, the duplicate-reference wording, UI focus, backoff and first-visit tenant, the sidecar
  reporting every probe while not UP, and the in-repo end-to-end suite (`e2e/`).
- **Iteration 3** fixed 32: one probe per due monitor across instances, a stream opened during an outage ending with one
  warning, input errors naming the value and position, resume from the later of `Last-Event-ID` and `?lastEventId=`, the
  sidecar's log level, report timeout and shared status vocabulary, the UI telling the service's own 503 from an unreachable
  service, and failure-path end-to-end specs.
- **Iteration 4** fixed 31: Spring Boot 4 on a distroless base pinned by digest, Go 1.27.3, the stream's 503 before any byte
  during a database outage, the 409's `suggestedExternalRef`, the UI's *Service degraded* badge, one 400 naming every unknown
  field, and the sidecar's "report delivered again" line.

## 3. Feature Matrix results (iteration 4, the code at `1cd3f13`)

The Feature Matrix has 92 rows (`00-inventory.md` §3, `feature-matrix.json`). Each owning verifier graded every row of its
area in iteration 4; the E2E column covers the 33 rows with an end-to-end path. Each link goes to the verifier's report,
whose row names the evidence files under `evidence/iter-4/<area>/` (commands, outputs, screenshots, run logs).
"PASS (note)" means the verifier passed the row and recorded a residual defect beside it (the remaining gap is in §5).
These are the verifiers' gradings. The iteration-4 audit, which would have re-checked a random sample of them, was stopped
before it ruled; the replays it finished agreed with the verifiers (§1, `evidence/iter-4/audit/`).

Totals: Backend 65 of 65 PASS (7 with a note: F-07, F-18, F-28, F-36, F-38, F-43, F-89), Frontend 29 of 29 PASS, Sidecar 28 PASS and 3 PARTIAL of 31, E2E 33 of 33 PASS.
The three PARTIAL rows are the parts that need an OpenShift cluster or the Red Hat registry, neither of which this sandbox
can reach: F-80 (the UBI image itself; the image built here used the distroless base), F-82 (applying the Kustomize
component to a cluster; the rendered output was checked with kubeconform) and F-86 (server-side validation and the
restricted-v2 SCC admission on a real cluster).

| ID | Feature | Services | Backend | Frontend | Sidecar | E2E |
|---|---|---|---|---|---|---|
| F-01 | Publish a communication | BE+FE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-02 | Draft | BE+FE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-03 | Read one communication with audit history | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-04 | Publisher listing | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-05 | Partial update | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-06 | Retire | BE+FE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-07 | Request validation → 400 {error} | BE+FE | [PASS (note)](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-08 | Idempotent publish | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-09 | Ticket add-on | BE+FE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-10 | Maintenance defaults | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-11 | Audit history | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-12 | Optimistic concurrency on the document (@Version) | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-13 | Lifecycle state machine | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-14 | Consumer feed | BE+FE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-15 | Effective status computed on read | BE+FE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-16 | Scheduled visibility | BE+FE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-17 | Permalink | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-18 | SSE stream | BE+FE | [PASS (note)](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-19 | SSE per-subscriber filtering | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-20 | Resume | BE+FE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-21 | Multi-instance fan-out | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-22 | Status sweeper | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-23 | Admin search | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-24 | Admin tenant summary | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-25 | Admin retire override | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-26 | Admin purge | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-27 | Caller identification | BE+FE+SC | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-28 | Error contract | BE | [PASS (note)](iter-4/verifier-backend.md) | – | – | – |
| F-29 | OpenAPI | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-30 | Backend operational endpoints | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-31 | Register a monitor | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-32 | Monitor policy validation | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-33 | Monitor reads | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-34 | Probe now | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-35 | Delete monitor | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-36 | Push a health report | BE+SC | [PASS (note)](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-37 | Pull probing | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-38 | Actuator vocabulary | BE+SC | [PASS (note)](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-39 | Debounce | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-40 | Notice content | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-41 | Open-notice lifecycle | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-42 | Notice claim exclusivity | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-43 | Health scheduler | BE | [PASS (note)](iter-4/verifier-backend.md) | – | – | – |
| F-44 | Staleness | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-45 | Staleness safety valve | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-46 | Per-instance records | BE+SC | [PASS](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-47 | Rollup rules (computed before the debounce from all live instances) | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-48 | Clean shutdown vs silence | BE+SC | [PASS](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-49 | Instance staleness window | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-50 | Concurrent instance reports | BE+SC | [PASS](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-51 | Mongo indexes and schema | BE | [PASS](iter-4/verifier-backend.md) | – | – | – |
| F-52 | App shell | FE | – | [PASS](iter-4/verifier-frontend.md) | – | – |
| F-53 | Theme | FE | – | [PASS](iter-4/verifier-frontend.md) | – | – |
| F-54 | Publish form fields | FE | – | [PASS](iter-4/verifier-frontend.md) | – | – |
| F-55 | Client-side validation mirrors the service | FE | – | [PASS](iter-4/verifier-frontend.md) | – | – |
| F-56 | Publish submit | FE+BE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-57 | Server error surfacing | FE+BE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-58 | Feed tab | FE+BE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-59 | Feed states | FE | – | [PASS](iter-4/verifier-frontend.md) | – | – |
| F-60 | Live updates | FE+BE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-61 | Reconnect behaviour | FE+BE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-62 | Resolve from the feed card | FE+BE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-63 | Outage card content | FE | – | [PASS](iter-4/verifier-frontend.md) | – | – |
| F-64 | Frontend ↔ backend identity and base URL | FE+BE | [PASS](iter-4/verifier-backend.md) | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-65 | Accessibility basics | FE | – | [PASS](iter-4/verifier-frontend.md) | – | – |
| F-66 | Frontend build & checks | FE | – | [PASS](iter-4/verifier-frontend.md) | – | – |
| F-67 | Configuration from env | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-68 | Port discovery | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-69 | Probe ladder (CS_PROBE=auto) | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-70 | Status normalisation and classification | SC+BE | [PASS](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-71 | Pinned target (CS_PORT set) | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-72 | Startup rule | SC+BE | [PASS](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-73 | Flap damping | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-74 | Send policy | SC+BE | [PASS](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-75 | Report wire contract (sidecar → POST /v1/health/reports) | SC+BE | [PASS](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-76 | Graceful shutdown | SC+BE | [PASS](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-77 | Rediscovery | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-78 | Sidecar's own endpoints on CS_LISTEN (:9465) | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-79 | TLS to the endpoint | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-80 | Container image | SC | – | – | [PARTIAL](iter-4/verifier-sidecar.md) | – |
| F-81 | Runs under restricted-v2 / non-root | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-82 | Kustomize component | SC | – | – | [PARTIAL](iter-4/verifier-sidecar.md) | – |
| F-83 | Kustomize native-sidecar variant (OpenShift 4.16+/K8s 1.29+) | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-84 | Helm library chart cs-health-sidecar 1.0.0 | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-85 | Plain-YAML snippet (deploy/manual/deployment.yaml) | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-86 | Manifest validity | SC | – | – | [PARTIAL](iter-4/verifier-sidecar.md) | – |
| F-87 | Probes and resources in the snippets | SC | – | – | [PASS](iter-4/verifier-sidecar.md) | – |
| F-88 | Startup ordering & restart behaviour | SC+BE | [PASS](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-89 | Logging & observability | SC+BE | [PASS (note)](iter-4/verifier-backend.md) | – | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-90 | E2E human flow | FE+BE | – | [PASS](iter-4/verifier-frontend.md) | – | [PASS](iter-4/verifier-e2e.md) |
| F-91 | E2E sidecar flow | FE+BE+SC | – | [PASS](iter-4/verifier-frontend.md) | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |
| F-92 | E2E failure paths | FE+BE+SC | – | [PASS](iter-4/verifier-frontend.md) | [PASS](iter-4/verifier-sidecar.md) | [PASS](iter-4/verifier-e2e.md) |

## 4. Gaps fixed

104 gaps were fixed over four iterations (24, 17, 32 and 31), in 120 commits whose subjects start with `Fix G-<iteration>-<n>`,
one gap per commit (a few gaps took a second commit, listed in the same row). The full description of each gap is in
`iter-<n>/gaps.md`, and the fixer's account, the tests it touched and why, in `iter-<n>/fixes.md`.
Commit hashes are on the branch `confidence-loop/2026-11-01`, which is what this report's pull request carries.

| Gap | Severity | Area | Commit(s) | Guarding test(s) |
|---|---|---|---|---|
| G-1-2 | blocker | SC | 0fd51b6 | `agent_test.go`: `TestAppThatStopsListeningStaysDownUntilItIsBack`, `TestAppNeverSeenUpIsUnknownWhileNothingListens`, `TestUnreadablePortTableIsUnknownNotDown` |
| G-1-18 | major (gate) | SC | ccecee8 | `sidecar/deploy/deploy_test.go`: `TestNativeComponentKeepsExistingInitContainers`, `TestClassicComponentAppendsTheContainer`, `TestBothComponentsShareTheContainerContract` (kubeconform 1.29/1.27) |
| G-1-19 | minor (usability/docs) | SC | 5a38919 | `config/docs_test.go`: `TestEveryEnvironmentVariableIsDocumented`; `deploy_test.go`: `TestManualSnippetSharesTheContainerContract` |
| G-1-1 | blocker | BE | b2b0a16 | existing `CommunicationServiceE2EIT.reconnectingWithLastEventIdReplaysWhatWasMissed` (unchanged, now passes); new `MongoCommunicationEventsAdapterIT` (3) |
| G-1-4 | major | BE | 9d47a47 | `CommunicationServiceE2EIT.streamIsCommittedAtOnceForATenantWithNothingVisible` |
| G-1-20 | minor | BE | 2e890f3 | `PublishingUseCaseTest`: `retireAfterExpiresAtButBeforeTheSweepIs409`, `updateAfterExpiresAtButBeforeTheSweepIs409`, `retireBeforeExpiresAtIsStillAllowed` |
| G-1-23 | minor (ops) | BE | 1f04bb7 | `MongoCommunicationEventsAdapterTest.closingTheContextCompletesEveryLiveStream`, new `RestControllerFeedAdapterTest.streamEndsWhenTheEventSourceEnds` |
| G-1-8 | major (ops) | BE | 556d814 | new `OperationsEndpointsIT` (5), `ClientIdWebFilterTest.letsProbesReachTheHealthEndpointWithoutAnId` |
| G-1-9 | major (gate: high findings) | BE | cc32685 | full suite (versions recorded in the commit message for the auditor) |
| G-1-21 | minor (usability) | BE | 49d120f | `RestControllerPublishingAdapterTest` (+9) |
| G-1-22 | minor (docs/usability) | BE | 080668a | `ClientIdWebFilterTest.logsEveryIdentifiedRequestWithItsOutcome`, new `OpenApiContractIT` (2) |
| G-1-5 | major | BE | 10333d0 | `HealthObservationUseCaseTest` (+2), `HealthMonitoringE2EIT.anOperatorRetiringTheAutoNoticeMakesTheMonitorCountAgain` |
| G-1-6 | major | BE | 193ea9b | `HealthSweepUseCaseTest` (+2) |
| G-1-7 | major | BE (+SC) | 5aee2a4 | `HealthMonitorUseCaseTest.conflictingReportsAreRetriedMoreThanThreeTimesWithAPauseInBetween`, `HealthMonitoringE2EIT.aFleetOfPodsReportingInTheSameInstantIsAccepted` (20 parallel) |
| G-1-24 | minor (doc) | BE | 544cab7 | `RestControllerHealthAdapterTest` (+1), `HealthReportTest` (+2) |
| G-1-17 | minor (test health) | FE | 912c8f8, 750b72c | `OutageCard.test.tsx`; lint 2 errors → 0 |
| G-1-3 | major (gate) | FE | c95dd65, c3bddf8 | `stream.test.ts` (6), `useOutageFeed.test.tsx` (4), `OutageFeed.test.tsx`, `feed-state.test.ts` reconcile (2) |
| G-1-10 | major (gate) | FE | 2ff9f45 | `contrast.test.ts` (computes ratios from `atlas.css`, 11), `kit-colours.test.tsx` (3) |
| G-1-11 | major (gate) | FE | d9c6941 | `feed-state.test.ts` (+3) |
| G-1-12 | major (usability) | FE | 127e20e | `PublishOutageForm.test.tsx` (+3) |
| G-1-13 | major (usability) | FE | a62260c | `App.test.tsx` |
| G-1-14 | major (usability) | FE | e9417b8 | `errors.test.ts` (3), form (2), feed (1) |
| G-1-15 | minor | FE | 4fdece9 | feed/form/App component tests (+4) |
| G-1-16 | minor | FE | 14e085f | feed-state, hook (real timers), feed, card, errors, form tests (+9) |
| G-2-1 | minor | BE | `37e6ad4` | the compile gate itself (7 warnings before, build fails with `-Werror`; clean after) |
| G-2-2 | major (score) | BE | `b0a71ef` | `GlobalExceptionHandlerTest.aStatusWithoutReasonLowerCasesItsPhraseTheSameWayInEveryLocale`, `RestControllerFeedAdapterTest.eventNamesAreLowerCasedTheSameWayInEveryLocale` (Turkish default locale), plus the gates |
| G-2-3 | major (score) | ALL | `463b647` | the workflow (validated as YAML; every step's command run locally) |
| G-2-4 | major (score) | BE | `00433c3` | `GlobalExceptionHandlerTest.anUnreachableDatabaseIs503WithoutTheDriversClusterDescription`, `MongoClientConfigTest`, `HealthSweepUseCaseTest`/`StatusSweepUseCaseTest` (+2 each), `OperationsEndpointsIT.theMongoClientGivesUpOnAnUnreachableDatabaseWithinSeconds` |
| G-2-5 | major (design) | BE | `851a1e4` | `HealthSweepUseCaseTest` +3 (14 silent 2 days + 1 silent 2 min → DOWN; forgotten left alone; 3 of 5 → paused) |
| G-2-6 | minor | BE | `dce5f89` | `HealthObservationUseCaseTest.afterAnOperatorsRetireTheNoticeReopensOnTheThresholdthFailingObservation`, `HealthMonitorTest.anOperatorsRetireStartsTheCountAgainWithTheObservationThatNoticedIt` |
| G-2-7 | minor | BE | `d3ac7eb` | `HealthMonitorUseCaseTest` +2 (conflict then success; persistent conflict → 409) |
| G-2-8 | minor | BE | `a08dfaf` | `FeedUseCaseTest.theSnapshotIsStampedWithTheLogHeadReadBeforeItIsQueried`, `MongoCommunicationEventsAdapterTest.headIsTheEndOfTheLogEvenWhileTheCursorTrailsIt` |
| G-2-9 | major (UX) | BE/FE | `6fd1088` (API), `eac1d0a` (UI) | `OpenApiContractIT.theIdempotencyKeyAndTheVersionCheckExplainThemselves`, `MongoCommunicationRepositoryAdapterIT.theExternalRefStaysTakenAfterItsHolderIsRetired`, `CommunicationServiceE2EIT` 409 body; vitest `errors.test.ts`/`PublishOutageForm.test.tsx` (bare and explained 409) |
| G-2-10 | minor | FE | `290c2ad` | `OutageFeed.test.tsx`, `PublishOutageForm.test.tsx` on `document.activeElement` |
| G-2-11 | minor | FE | `7bb0b6c` | `stream.test.ts` (+2: backoff restarts after a successful open; every attempt carries `lastEventId`) |
| G-2-12 | minor/cosmetic | FE | `8e644ce` | `App.test.tsx`, `errors.test.ts`, `OutageCard.test.tsx`, `PublishOutageForm.test.tsx`, `StateTag.test.tsx` |
| G-2-13 | minor | FE | `6ba70b0` | the new test files; `npm audit` |
| G-2-14 | minor | SC | `a5b1ea1` | `deploy/dockerfile_test.go` (go line, labels) |
| G-2-15 | minor | SC | `e54fe6a` | `TestStatusJSONMatchesTheDocumentedContract`, `cmd/health-sidecar/main_test.go` (3), `requireTool` |
| G-2-16 | minor | SC | `7006692` | `TestNotUpIsSentEveryProbeAndUpOnlyAtTheHeartbeat`, `TestTransitionsAreLoggedAtInfoAndRepeatedSendsAtDebug`, `TestRejectedDownReportKeepsTheHeartbeatCadence` |
| G-2-17 | major (score) | E2E | `b397f87`, `6dee344`, `3bf0946`, `5d650f3` | the suite: 6 tests, `6 passed (55.1s)` from a fresh stack |
| G-3-1 stream during a DB outage | minor | backend | `98e3fdc` | `OperationsEndpointsIT.aStreamOpenedWhileTheDatabaseIsUnreachableEndsWithOneWarningAndNoError` |
| G-3-2 probe slot claim | minor | backend | `507e918` | `HealthSweepUseCaseTest.twoInstancesSweepingTheSameDueMonitorProbeItOnceAndTheLoserStaysQuiet`, `HealthMonitorTest.claimingTheProbeSlotRecordsTheProbeTimeAndNothingElse` |
| G-3-3 effective status on publisher/admin reads | minor | backend | `7e265be` | 4 × `PublishingUseCaseTest`, `AdminUseCaseTest.searchReportsEachItemsEffectiveStatus`, `CommunicationServiceE2EIT.publisherAndAdminReadsReportTheEffectiveStatusBeforeTheSweeperRuns` |
| G-3-4 coverage gate scope + branch rule | minor | backend | `f141b2d` | the gate (BRANCH ≥ 0.84); `GlobalExceptionHandlerMessagesTest` (14), `ClientIdWebFilterEdgeCasesTest` (4) |
| G-3-5 SBOM scope | minor | backend | `412e10d` | the `verifySbomScope` task in `check` |
| G-3-6 outage log hygiene | minor | backend | `07e6e4d` | `MongoOutageReadinessTest`, `MongoReadinessIndicatorTest` |
| G-3-7 null/blank service entries | minor | backend | `083721a` | `RestControllerPublishingAdapterTest.aNullServiceEntryNamesItsPositionAndTheRule`, `anEmptyOrBlankServiceEntryIsRejected` |
| G-3-8 unknown fields | minor | backend | `2ebdaf2` | `RestControllerPublishingAdapterTest.aMisspelledFieldIs400NamingItAndListingTheKnownOnes`, `RestControllerHealthAdapterTest.aReportMayCarryKeysTheServiceDoesNotKnow`, `CommunicationServiceE2EIT.publishingRejectsUnknownFieldsWhileHealthReportsAcceptThem` |
| G-3-9 values in the expiresAt / expectedVersion 400s | minor | backend | `55ed84c` | `CommunicationTest.anExpiryNotAfterTheStartNamesBothValuesAndAStartThatDefaulted`, `RestControllerPublishingAdapterTest.anUpdateWithoutExpectedVersionSaysWhatToSendAndWhatA409Means`, an E2EIT case |
| G-3-10 docs (sidecar README, CI pins, root README) | minor (docs) | docs | `1415134`, `1914a99`, `b2b5314` | `deploy/helm_test.go TestHelmIncludeLinesFromTheReadmeRenderAValidDeployment`, `TestStatusShowsTheLastReportComposedSentOrNot` |
| G-3-11 resume precedence | minor | backend | `229dd04` | `RestControllerFeedAdapterTest.withBothAQueryIdAndALastEventIdHeaderTheStreamResumesAfterTheLaterOne` |
| G-3-12 restart spec proves replay | minor (test) | e2e suite | `f09d2f0` | `e2e/tests/04-f92-backend-restart.spec.ts` (fails against a backend with replay disabled) |
| G-3-13 e2e Go image and labels | minor (docs/build) | e2e suite | `4de88bf` | `stack.sh build`; image labels |
| G-3-14 `CS_LOG_LEVEL` | minor | sidecar | `ef5d3ad` | `TestLogLevelIsReadAndValidated`, `TestRunLogsAtTheConfiguredLevel` |
| G-3-15 report timeout 10 s | minor | sidecar | `d7b0a1b` | `TestReportTimeoutDefaultOutlastsTheServiceDatabaseTimeout` |
| G-3-16 degraded-by-component every probe | minor | sidecar | `92e63d0` | `TestUpWithAFailingComponentIsSentEveryProbe`, `TestFailingCountsTheComponentsTheServiceCounts` |
| G-3-17 boolean typos | minor | sidecar | `34f1cd1` | `TestInsecureSkipVerifyAcceptsTheDocumentedSpellingsOnly`, `TestRunRejectsAnUnusableValueWithExit2` |
| G-3-18 UNKNOWN at the heartbeat | minor | sidecar | `8723f78` | `TestUnknownIsSentAtTheHeartbeat` |
| G-3-19 heartbeat test on the fake clock | nit (test) | sidecar | `375ccea` | `TestNotUpIsSentEveryProbeAndUpOnlyAtTheHeartbeat` (rewritten, 20× `-race`) |
| G-3-20 service's 503 vs unreachable | minor | frontend | `ad8f6d2` | `errors.test.ts`, `OutageFeed.test.tsx`, `PublishOutageForm.test.tsx` (503 with body) |
| G-3-21 duplicate-reference 409 in the form's terms | minor | frontend | `05bec99` | `errors.test.ts` (6), `PublishOutageForm.test.tsx` (2) |
| G-3-22 focus into the confirmation | minor | frontend | `9cde57e` | `OutageCard.test.tsx` (3) |
| G-3-23 badge live region, waiting state, 24 px row | minor | frontend | `85edf1d` | `OutageFeed.test.tsx` (3) |
| G-3-24 one load per typed tenant | cosmetic | frontend | `d685898` | `App.test.tsx` (2) |
| G-3-25 automated notices (body, actor, chip) | cosmetic | backend + frontend | `56d6cc8`, `85bf46e` | `HealthNoticeTest.anAutomatedNoticeReadsAsPlainWordsWithTheTimeToTheSecond`, `HealthObservationUseCaseTest.aNoticeIsUpdatedAndRetiredUnderTheNameItWasPublishedWith`, `OutageCard.test.tsx` (2) |
| G-3-26 useTheme coverage | minor (test) | frontend | `54fead9` | `useTheme.test.tsx` (7) |
| G-3-27 e2e failure paths | minor (test) | e2e suite | `ac7026a` | `e2e/tests/05-f76-sidecar-sigterm`, `06-f39-pull-monitor`, `07-f92-database-down` |
| G-3-28 e2e lint | minor (build) | e2e suite | `7112b71` | `npm run lint` in `e2e/` and the workflow |
| G-3-29 backoff cap vs staleness window | minor | sidecar | `58f80ff`, `4a0e84e` | `TestRetriesAreNeverFurtherApartThanTheBackoffCap` |
| G-3-30 shared status vocabulary | minor | backend | `85dcd7f`, `06b822a` | `HealthStatusTest` |
| G-3-31 outage timings in the README | minor (docs) | backend | `1abd169` | docs (measured on a SIGSTOPped mongod) |
| G-3-32 values in the endsAt 400 | minor | backend | `72a14cd` | `CommunicationTest.anEndNotAfterTheStartNamesBothValuesAndAStartThatDefaulted` |
| G-4-1 Spring Boot 4.0.9 (Framework 7.0.10, Netty 4.2.19, Jackson 3.1.7) | blocker (hard gate) | backend build | `b70c458` | the Trivy SBOM scan (0 findings); `JsonWireFormatTest` (2), `OperationsEndpointsIT.overallHealthWritesStatusBeforeGroups`, `GlobalExceptionHandlerMessagesTest.aNumberTooLargeForItsFieldIsNotCalledMalformedJson` |
| G-4-2 sidecar on Go 1.27.3 | major (would trip the gate once scanned) | sidecar build | `8783226`, `3476fa4` | `deploy/dockerfile_test.go TestGoModAndDockerfileAgreeOnTheGoLine`; Trivy and govulncheck of the binary (0) |
| G-4-3 backend image on distroless java21-debian13, by digest | minor | backend image | `a45e04c` | the image scan (0 fixable), UID 65532 |
| G-4-4 on-demand probe vs the sweep's claim (GAP-backend3-1) | minor (regression of G-2-7) | backend health | `5d25330` | `HealthMonitorUseCaseTest.anOnDemandProbeThatLosesTheRaceAppliesTheObservationItMadeInsteadOfProbingAgain`, `ForcedProbeWhileTheSchedulerProbesIT` |
| G-4-5 strict monitor registration | minor | backend API | `ccba721` | `RestControllerHealthAdapterTest.registerRejectsAMisspelledPolicyFieldNamingIt` |
| G-4-6 readiness within 0.8 s during an outage | minor | backend ops | `6f53c84` | `MongoOutageReadinessTest.readinessWhileMongoIsUnreachableAnswersWithinAKubeletsDefaultProbeTimeout` |
| G-4-7 late probe failure is one DEBUG line | minor | backend logs | `055e619` | `WebClientHealthProbeAdapterTest.aConnectFailureThatArrivesAfterTheProbeTimedOutIsOneDebugLineNotAnErrorWithATrace` |
| G-4-8 access log with the client-id check off | minor | backend ops | `573b996` | `ClientIdWebFilterEdgeCasesTest.withTheCheckSwitchedOffEveryRequestIsStillLoggedUnidentifiedOnesAsADash` |
| G-4-9 one WARN per event-log outage | minor | backend logs | `9316b56` | `MongoCommunicationEventsAdapterTest.aDatabaseOutageWhileTailingIsOneWarningWhenPollingStopsAndOneInfoWhenItWorksAgain`, `aPollThatFailsForAnotherReasonIsAWarningEachTime` |
| G-4-10 stream 503 before any byte | minor | backend stream | `5c9b77b` | `OperationsEndpointsIT.aStreamOpenedWhileTheDatabaseIsUnreachableIs503BeforeAnyByteWithOneWarning`, `aStreamWhoseDatabaseGoesAwayAfterItOpenedEndsWithOneWarningAndNoError`, `RestControllerFeedAdapterTest.aStreamIs503BeforeItsFirstByteWhileTheDatabaseCannotBeReached`, `GlobalExceptionHandlerTest.the503IsJsonEvenForARequestThatAcceptsOnlyAnEventStream` |
| G-4-11 the 409 names the first free follow-up value | minor | backend API | `5eb9867`, `1cd3f13` | `MongoCommunicationRepositoryAdapterIT.theConflictSuggestsTheFirstFollowUpValueTheTenantDoesNotHoldYet`, `pastFiftyTakenFollowUpValuesTheConflictSaysSoAndSuggestsNone`, `GlobalExceptionHandlerTest.aStatusCarriesTheFieldsItWasGivenBesideTheError`, `OpenApiContractIT` (example), `e2e/tests/01-api-contract.spec.ts` F-09 |
| G-4-12 OpenAPI answers and examples | minor | backend API docs | `eefec53` | `OpenApiContractIT.everyRouteDocumentsTheSuccessAnswerItGives`, `everyOperationDocumentsTheSharedErrorAnswersThatApplyToIt`, `everyRequestExampleIsAcceptedByItsRouteAsItIs` |
| G-4-13 every unknown field named in one 400 | cosmetic | backend API | `4eff8f4` | `GlobalExceptionHandlerMessagesTest` (+2), `RestControllerPublishingAdapterTest` (+1), `CommunicationServiceE2EIT` (+1) |
| G-4-14 plain text in the README example | cosmetic | backend docs | `92cc4d7` | `ReadmeExamplesTest.titlesAndBodiesInTheExamplesArePlainText` |
| G-4-15 all-UNKNOWN rollup says why | cosmetic | backend health | `d592c06` | `HealthRollupTest.podsThatAreAllStillUnknownLendTheRollupTheFirstOnesOwnWords` |
| G-4-16 one trim rule for status words | minor (nit) | backend + sidecar | `e2018dc`, `8559e50`, `67f0d77` | `probe_test.go TestStatusWordsAreTrimmedLikeTheService` (10 rows), `HealthStatusTest.aStatusIsTrimmedOfExactlyTheCharactersUpToUPlus0020LikeTheSidecar` |
| G-4-17 Live only once the stream works; *Service degraded* | minor | frontend | `27a9fec` | `stream.test.ts` (4), `useOutageFeed.test.tsx` (2), `OutageFeed.test.tsx` (1) |
| G-4-18 the feed's load error is an alert | minor | frontend a11y | `d4988b0` | `OutageFeed.test.tsx` |
| G-4-19 focus after *View in feed* | minor | frontend a11y | `2587273` | `App.test.tsx` |
| G-4-20 Escape cancels the confirmation | cosmetic | frontend | `4e199a0` | `OutageCard.test.tsx` |
| G-4-21 the form uses `suggestedExternalRef` | minor | frontend | `70d21c4` | `api.test.ts` (1), `errors.test.ts` (2), `PublishOutageForm.test.tsx` (1) |
| G-4-22 durations that would freeze the loop | minor | sidecar config | `377da86` | `TestDurationsTheSidecarCannotUseAreRejected`, `TestRunRejectsAnUnusableValueWithExit2` (+2 rows) |
| G-4-23 what a report gets while the database hangs | minor (docs) | sidecar docs | `4c2ac91` | `TestReportTimeoutDefaultAgainstTheServiceDatabaseTimeouts` |
| G-4-24 reports honour the proxy variables, probes do not | minor (docs) | sidecar docs | `9474dab` | `TestProxyVariablesAreDocumented` |
| G-4-25 INFO when reports get through again | minor (ops) | sidecar logs | `6e67d19` | `TestDeliveryAgainAfterFailedSendsIsLoggedOnceAtInfo` |
| G-4-26 the shape of `extraEnv` | cosmetic | sidecar docs | `02c7bd0` | `TestHelmExtraEnvFromTheReadmeReachesTheSidecar` |
| G-4-27 the ConfigMap the plain-YAML container needs | minor | sidecar docs | `942ba4c` | `TestEachAttachPathNamesTheConfigMapItsContainerReads` |
| G-4-28 CI: gofmt, `-race`, pinned govulncheck | minor | sidecar CI | `67f2d4a` | the workflow steps (not run: no GitHub Actions here); the same commands run locally |
| G-4-29 the e2e README's send cadence | minor (docs) | e2e docs | `a5d1c90` | docs (timings measured) |
| G-4-30 spec 07's late page | minor | e2e | `09c035b` | `e2e/tests/07-f92-database-down.spec.ts` (records every badge and error change of the late page) |
| G-4-31 image scans in CI | minor | CI | `13a878d` | the workflow steps (not run here); the same `trivy image` command run locally on both images |

## 5. Remaining gaps

Iteration 4 was the last one the loop allows, so the gaps its verifiers found are open. None is a blocker.
"What it takes" is the verifier's suggested fix, checked against the code; the effort is an estimate.

### Found by the iteration-4 verifiers and the Usability Reviewer

| Gap | Severity | Area | What happens | What it takes | Human decision? |
|---|---|---|---|---|---|
| GAP-backend4-1 | major | backend | When MongoDB hangs (a frozen server rather than a refused connection), the driver pauses its pool and Spring Data reports `UncategorizedMongoDbException`, which the error handler does not recognise as "database unavailable". Calls then answer 500 with the driver's message, which includes the database host and port; an open stream gets the 500 as an SSE frame; both sweeps log an ERROR with a stack trace on every run. A refused connection still gets the documented 503. | Classify by the cause chain (pool cleared, socket, timeout, resource failure → 503) in the one predicate the handler, the stream, both sweeps and the poller share; answer any other 500 with a fixed sentence and log the detail. About half a day with an IT that SIGSTOPs the embedded mongod. | no |
| GAP-backend4-2 | minor | backend | A forced probe (`POST …/probe`) that finishes after the scheduler claimed the same monitor writes an older `lastProbeAt`, so the next scheduled probe comes early (60 target hits for 30 forced calls against a budget of 50). | Keep the later of the stored and the new instant. Small. | no |
| GAP-backend4-3 | minor (test) | backend | `CommunicationServiceE2EIT.openApiSpecIsServed` keeps WebTestClient's 5 s default; with springdoc 3 the first `/v3/api-docs` takes 2.8–3.6 s and failed once in three runs at 5.07 s. | A 30 s `responseTimeout` on that request (a wider timeout, to be justified as such), or build the document at start-up. | no |
| GAP-backend4-4 | minor | backend | Hibernate Validator 9 (with Boot 4) changed `@NotBlank`: a title, tenant or publisher made only of control characters is now accepted (201), and a report whose overall status is only U+2003 is rejected (400). | One custom constraint applying the service's trim rule (characters ≤ U+0020) to required text and to the report status. Small. | no |
| GAP-sidecar4-2 | minor | backend + sidecar | The same rule seen from the sidecar: an app whose health word is only U+2003 has every report rejected with 400, which the sidecar treats as permanent, so the service sees silence and opens a false MAJOR outage after 90 s. | Fixed by the GAP-backend4-4 constraint (validate the overall status with the trim rule). | no |
| GAP-sidecar4-1 | minor | backend + sidecar | Upper-casing differs for a few non-ASCII letters (Go's simple mapping keeps `ß`, Java's full mapping makes `SS`), so `paß` is UP in the service and an unknown word in the sidecar. | Upper-case ASCII letters only, on both sides, with a `paß` row in both shared test tables. | no |
| GAP-sidecar4-3 | minor | backend | A request the client abandons is logged as `-> 200` instead of `cancelled`, because on the Netty server the response status is never null; the unit test passes only on a mock exchange. | Decide from the signal first (`CANCEL` → cancelled), or trust the status only once the response is committed. | no |
| GAP-sidecar4-4 | minor | backend | With one pod leaving and another going silent, the DOWN message gives the leaving pod's goodbye time, and DOWN comes up to one heartbeat late (96.7 s instead of about 90 s). | Use the newest `lastSeenAt` among instances that have not left, for the window and the message. | no |
| GAP-backend4-5 | cosmetic | backend docs | Four wire differences from the Boot 4 move are not in `iter-4/fixes.md`: "property name" for "field name", `byte offset: #UNKNOWN` in a truncated body's 400, the 406 timestamp ending in `Z`, and a CORS preflight answering 200 (still without allow headers). | List them, and cut the location text from the 400. | no |
| GAP-backend4-6 | cosmetic (docs) | records | `iter-4/fixes.md` says a lone U+00A0 changed reading; iteration 3 already read it as DEGRADED. The character whose reading changed is U+2003 (UNKNOWN → DEGRADED). | This report is the correction; `fixes.md` was left as the fixer wrote it. | no |
| GAP-frontend4-1 | minor | frontend | When a reference contains parentheses and 50 follow-ups are taken, the form misreads the 409 and suggests `<ref>-2`, which the service has just reported as taken. | Anchor the parse at the end of the message, or have the 409 say "none free" in a field. | no |
| GAP-frontend4-2 | minor (test) | frontend | Four of 14 `npm test` runs failed under a load of 16–30 on 4 CPUs (5 s timeouts of jsdom/user-event tests, one real-clock window of 200 ms); all 7 runs at load 7 or below passed. | Fake timers for the time-window test, and `userEvent.setup({ delay: null })` or a 15 s `testTimeout`, the latter being a wider timeout that would need its own justification. | no |
| GAP-e2e4-1 | minor (docs) | e2e | `e2e/README.md` timings predate the 6 s settle (G-4-17): the suite took 2.3–3.2 min against "under two minutes"; spec 02 16.6–20.4 s against "under 6 s". | Re-measure on an idle machine and rewrite the table, or let `openFeed` wait for the list instead of *Live* where a test does not need *Live*. | no |
| GAP-e2e4-2 | cosmetic | sidecar | The instance message quotes the app's raw word (`"health document reports  DOWN\t"`), padding and control characters included; the status itself is normalised. | Quote the word with `%q` or use the trimmed one. | no |
| GAP-usability-1 (UX-65) | minor | frontend | A feed refreshed during a database outage keeps *Service degraded* and "Couldn't load the feed" after the database is back (62 s observed, though the text says it recovers on its own) and does not show a notice published after recovery; only *Try again* restores it. | Reload the list on the first event frame while the stream works and the last list load failed. | no |
| GAP-usability-2 (UX-66) | minor | frontend | Refresh pressed from the keyboard drops focus to the page body while it loads, and a successful refresh announces nothing. | `aria-disabled` plus a guard instead of `disabled`; announce "Feed refreshed". | no |
| GAP-usability-3 (UX-67, UX-68) | minor | backend + frontend | A duplicate of a date-shaped reference such as `payments-2026-11-12` gets the suggestion `payments-2026-11-13`, another date, which the real 13 November notice would then collide with. This came with G-4-11. | Treat a reference ending in a date as uncounted and suggest `<ref>-2`. | **yes**: the suggestion rule for references (see D2) |
| GAP-usability-4 (UX-70) | minor | frontend | At phone width, Shift+Tab can put focus on a control hidden under the sticky header (WCAG 2.2 SC 2.4.11). | `scroll-padding-top` of the header's height. | no |
| GAP-usability-5 (UX-69) | cosmetic | frontend + backend | An empty feed shows *Connecting* for about 6 s after every open or filter change, because a stream that sends nothing counts as working only after the settle time G-4-17 introduced. | An empty-snapshot frame from the service, or *Live* once the stream is open and the list has answered. | no |
| GAP-usability-6 (UX-71) | cosmetic | backend | "Validation lists every failing field at once" holds within one kind of check; unknown fields, constraints and domain rules come in separate rounds. | Collect domain-rule failures with the constraint failures, or qualify the README sentence. | no |

### Found by the audit

None recorded. The iteration-4 audit was stopped before it wrote its report; its partial evidence
(`evidence/iter-4/audit/`) reproduces GAP-backend4-1 and the libuuid1 entries; it had recorded no new gap when it stopped.

### Not verifiable in this environment

These are limits of the sandbox, not defects found. Each needs a person with the access listed.

| What | Why not here | Who can close it |
|---|---|---|
| The sidecar on OpenShift: restricted-v2 SCC admission, the Kustomize component applied to a cluster, server-side manifest validation (F-80, F-82, F-86 partial) | `kind` cannot run in the sandbox (nested runc fails); no cluster access | someone with an OpenShift 4.16+ namespace |
| The UBI base image (`ubi9/ubi-micro:9.5`) and a scan of the sidecar image built on it. (The builder `ubi9/go-toolset:1.27` turned out not to exist: PR #9's first CI run got "not found", and the builder is now upstream `golang:1.27`.) | `registry.access.redhat.com` and `quay.io` are blocked; the loop built the sidecar on `local/go-toolset:1.27` (golang 1.27.3 + the CA bundle) and distroless | CI on PR #9, or anyone who can pull from the Red Hat registry |
| The GitHub Actions workflows (`ci.yml`, `e2e.yml`), including the new image-scan and govulncheck steps | no Actions runner; every step's command was run locally instead | the pull request's own CI run |
| Trivy's Java database (`trivy image` reading the jar inside the backend image) | about 1 GB compressed, more than the sandbox's disk allows; the libraries were scanned through the SBOM instead (0 findings) | CI (`ci.yml` runs `trivy sbom` and `trivy image`) |
| A real screen reader, and browsers other than Chromium | only headless Chromium (Playwright) is available; accessibility was checked with axe-core, the accessibility tree and keyboard-only scripts | a manual pass with VoiceOver or NVDA |
| ServiceNow ticket links against a real instance | no ServiceNow instance; the link the service builds was checked with a made-up `instance-url` (`https://vf4.service-now.com`); the service never calls ServiceNow | someone with the production `instance-url` |
| The Helm chart from its repository | the chart repository URL in the docs is a placeholder; the chart was rendered from the source folder | the owner of the chart repository |
| Load beyond what the tests and verifiers ran (20 parallel reports in `HealthMonitoringE2EIT`, bursts of 6 calls in the outage runs) | out of the loop's scope | a load test in a staging environment |

## 6. Changed tests, with justification

The rule was that no check may be weakened to pass. Every fixer named each existing test it touched in its commit message and
in that iteration's `fixes.md`; each iteration's auditor diffed the fix commits' test changes against the code it audited and
against the original `main` (`191a0c5`).

| Iteration | Existing tests touched (where the justification is) | Auditor's test-weakening check |
|---|---|---|
| 1 | 30 test files changed; the 14 non-trivial removed lines are mock renames and record-arity changes (`iter-1/fixes.md`, "existing tests touched") | not tripped: 0 tests deleted, 0 skip/disable markers (`iter-1.md`) |
| 2 | 8 groups, e.g. G-2-6 `unhealthyStreak` 0 → 1 (the old assertions encoded the off-by-one the gap fixed), G-2-9 new 409 wording, G-2-11 reconnect cap 30 000 → 10 000 ms (tighter) (`iter-2/fixes.md`) | not tripped: 8 removed backend assertion lines (3 replaced by stronger ones, 5 encoded the fixed defect) (`iter-2.md`) |
| 3 | G-3-21 banner text, G-3-23 a status-role helper, G-3-19 heartbeat test rewritten on a fake clock with exact counts (stronger), G-3-25 plain-words notice body and publisher, G-3-32 exact message instead of a substring; spec 04 rewritten to prove replay, its card timeout tightened from 90 s to 30 s (`iter-3/fixes.md`) | not tripped: no test deleted or renamed, no marker added, no timeout raised (`iter-3/audit.md` §3) |
| 4 | Spring Boot 4 package moves and `@AutoConfigureWebTestClient` (no assertion changed; `asText()` → `asString()`, `PayloadTooLargeException` → `ContentTooLargeException`, still 413); G-4-4 three `HealthMonitorUseCaseTest` stubs follow the new `probeTarget`; G-4-10 the stream-outage IT now expects the JSON 503 (deliberate, its old assertions kept in a new test); G-4-17 two `stream.test.ts` tests advance the new settle time and one `OutageFeed.test.tsx` assertion that pinned the defect (*Live* beside the database error) now expects *Service degraded*; sidecar G-4-2/G-4-23 tests keep their rules and read more; e2e spec 01 F-09 pins `{error, suggestedExternalRef}` (stronger) (`iter-4/fixes.md`) | not ruled: the audit stopped first. Its diff of 6c15715..1cd3f13 (`evidence/iter-4/audit/01-test-weakening-check.txt`) found 0 deleted or renamed test files and one added skip marker, in a new Helm test (G-4-26) that skips only when `helm` is missing and fails instead under CI's `CI=true`; each iteration-4 verifier found no test skipped, deleted or loosened in its area |

No test was skipped, deleted or given a wider tolerance in any iteration, according to the fixers' records, the audits of
iterations 1 to 3 and the iteration-4 verifiers. The iteration-4 audit did not get to rule on it.

## 7. Assumptions and open questions

| # | Assumption or question | Reading the loop used | Confirmed? |
|---|---|---|---|
| Q1 | Should the UI cover admin and health-monitor features? | No: the UI's scope is what `frontend/README.md` states (publish, feed, live, resolve) | not confirmed by Gonzalo |
| Q2 | Is a frontend served from another origin (no CORS on the backend) supported? | No: same host or a proxy, as documented. Since Spring Boot 4 a CORS preflight answers 200 instead of 403, still without allow headers (GAP-backend4-5) | not confirmed |
| Q3 | Sidecar service name when `CS_SERVICE` is unset and the pod name has no recognisable suffix | the pod name is used as is; the snippets set `CS_SERVICE` from the `app.kubernetes.io/name` label | not confirmed |
| Q4 | Which OpenShift/Kubernetes versions must the manifests target? | Kubernetes 1.29 schemas for both forms, 1.27 for the classic form | not confirmed; no cluster was available |
| Q5 | No readiness/startup probe or `preStop` on the sidecar | intended: it must never gate the app's readiness | not confirmed |
| Q6–Q11 | backend health endpoints (added in iteration 1), unused configuration keys, integration tests against a real mongod, `CS_PUBLISHER` documentation, UI paging past 100 items, the actor of a UI resolve | as in `00-inventory.md` §5 | not confirmed |
| D1 | Move the backend to Spring Boot 4.0.9 (Spring 7, Netty 4.2, Jackson 3) to clear the critical/high CVEs, since no Spring Boot 3.5 / Spring 6.2 release carries the WebFlux fixes | done in iteration 4 (G-4-1); asked on a decision card at 08:05Z with "stay on 3.5" as the alternative | **open: the card is unanswered** |
| D2 | `externalRef` stays a permanent per-tenant idempotency key (a retired notice keeps it); follow-ups need a new value, which the 409 now suggests | kept; wording and the suggestion fixed instead of a partial unique index | not confirmed |
| D3 | First-visit tenant: no `acme` default any more (`VITE_DEFAULT_TENANT` or the last one used) | changed in iteration 2 (G-2-12) | not confirmed |
| D4 | `communication.servicenow.instance-url` is set in production so ticket links work | assumed | not confirmed |
| D5 | An admin hard delete (`DELETE /v1/admin/communications/{id}`) writes no event, so screens that show the notice keep it until they reload | left as is | **open product question** |
| D6 | A pod that never became UP stays UNKNOWN after the start-up grace instead of counting as DOWN (G-3-18) | left as is | **open product question** |
| D7 | The UBI images: `ubi9/go-toolset:1.27` (builder) and `ubi9/ubi-micro:9.5` (base) exist and scan clean; CI's new sidecar image scan runs on that base | not verifiable here (registry blocked); both are tags, not digests | **answered in part by PR #9's first CI run (2026-11-02 12:58Z): `ubi9/go-toolset:1.27` does not exist ("not found"), so the sidecar now builds on upstream `golang:1.27` and still runs on UBI micro (commit `1fa210b`; Gonzalo to confirm). `ubi9/ubi-micro:9.5` and digest pinning stay open** |
| D8 | HIGH entries with no fix released (4 in the backend image's `libuuid1`) are acceptable under CI's `--ignore-unfixed` rule | applied as the rule is written | **not ruled**: the backend verifier applied CI's rule; the audit stopped before ruling. Read literally, the gate would cap the backend and E2E at 80 (§1) |

## 8. How to reproduce from a clean checkout

```bash
git clone https://github.com/gonzalomunoz1024/communication-service && cd communication-service
git checkout <this branch>

# Backend (Java 21). check = -Werror compile, unit tests, integration tests (embedded MongoDB 7.0.14 downloaded by
# flapdoodle from fastdl.mongodb.org), SpotBugs, JaCoCo line >= 0.92 and branch >= 0.84, SBOM scope check.
./gradlew check bootJar
# dependency scan of the shipped libraries (CI does the same in .github/workflows/ci.yml)
trivy sbom --scanners vuln --severity CRITICAL,HIGH --exit-code 1 build/reports/cyclonedx/bom.json
docker build -t communication-service:local .
trivy image --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 communication-service:local

# Frontend (Node 22)
( cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm audit )

# Sidecar (Go 1.27.3)
( cd sidecar && test -z "$(gofmt -l .)" && go vet ./... && CI=true go test -race ./... \
  && go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./... )
docker build -t health-sidecar:local sidecar/        # UBI builder and base by default; see sidecar/README.md

# End-to-end suite (Docker compose + Playwright), as e2e/README.md describes
( cd e2e && npm ci && npm run lint && npm run typecheck && ./stack.sh up && npx playwright test; ./stack.sh down )
```

Where the UBI registry is unreachable, `e2e/README.md` shows the `local/go-toolset:1.27` stand-in and
`BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot`, which is how this loop built the sidecar. In this sandbox the
integration tests ran against a `mongod` copied from the `mongo:7.0` image into flapdoodle's cache, Trivy came from
`mirror.gcr.io` and govulncheck used `-db https://storage.googleapis.com/go-vulndb`.

The loop's own records: `confidence/00-inventory.md` (Phase 0 and the 92-row Feature Matrix, also as
`feature-matrix.json`), `confidence/iter-<n>.md` (one page per iteration), `confidence/iter-<n>/` (gaps, fixes, the five
reports and the audit) and `confidence/evidence/` (the raw evidence each report cites).
