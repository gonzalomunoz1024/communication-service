# Sidecar / OpenShift Verifier — iteration 4

Verifier: independent (wrote no iteration-4 fix). Scope: every Feature Matrix row whose services include `SC` (31 rows:
F-27, F-36, F-38, F-46, F-48, F-50, F-67..F-89, F-91, F-92); fresh evidence for the iteration-4 sidecar fixes G-4-2,
G-4-16, G-4-22 … G-4-28 (and the sidecar half of G-4-31); non-regression of G-3-10, G-3-14 … G-3-19, G-3-29, G-3-30 and of
G-2-3 (CI part), G-2-14, G-2-15, G-2-16; the sidecar README checked line by line against behaviour.

Code under test: `confidence-loop/2026-11-01` @ `aa37365` (the code of `1cd3f13`). HEAD is `d10369b` (records only):
`git diff --quiet 1cd3f13 HEAD -- sidecar .github` → 0 (`01` §0, `41` §1). The working tree holds only untracked
evidence folders. Date 2026-11-02, 10:15–11:20 UTC. Evidence root `confidence/evidence/iter-4/sidecar/`; files are
cited by their number (`16` = `16-failure-paths.txt`), every scenario's script is in `scripts/` there (`lib.sh` =
helpers, `stub-main.go` = the stub apps/services/proxy, `env.sh` = go1.27.3 toolchain and tools on `PATH`).

Destructive scenarios ran against **private backends** from `scratchpad/communication-service-iter4.jar` (Spring Boot
4.0.9): A `:19300` (database `vs4_main` on the shared Mongo) and B `:19302` on my own Mongo container `vs4-mongo`
(`mongo:7.0`, `:19301`) for the database cases, both with `--communication.health.sweep-interval-ms=1000
--communication.health.stale-grace-after-start-ms=0 --communication.health.stale-pause-min-silent=1000
--communication.sweep.interval-ms=2000` (`05`). Pods are emulated as in `evidence/environment.md`: a holder container
owns the network namespace, the app (a stub) and the sidecar join it with `--network container:`, the sidecar runs as
`--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges`. Names `vs4-*`, host ports
19300–19399, tenants `vs4-*`. Image under test `health-sidecar:vs4`, built from the repository Dockerfile with
`--build-arg GO_IMAGE=local/go-toolset:1.27 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot`:
**the UBI bases (`ubi9/go-toolset:1.27`, `ubi9/ubi-micro:9.5`) were not exercised** (`registry.access.redhat.com`
answers CONNECT 403, `docker pull` Forbidden, `03` §1). The shared stack was only read (`44`, `42` §H): nothing was
exec'd into `app` or `sidecar`. Gradle was not run.

Verdict convention for §3 (as in iterations 2 and 3): **PASS** = every claim of the row verified here; **PARTIAL**
(0.5) = the main claims verified, a named part impossible in this sandbox; **FAIL** (0) = a claim demonstrably false;
**NOT VERIFIED** (0) = nothing could be checked. Matrix text written before iterations 3 and 4 is graded against the
deliberate changes in `iter-3/fixes.md` and `iter-4/fixes.md` (report timeout 10 s, backoff capped at 30 s with
downward jitter, extended vocabulary, Go 1.27.3, durations validated).

## 1. Summary

**Sidecar score: 92.05 / 100. Hard gates: none tripped, so no cap.** (Iteration 3: 91.5 by its verifier, 92.05
audited, capped at 80 by AUD-3-1, which G-4-2 closes; see the security gate below.)

- *Matrix item fails E2E*: **no** — 28 PASS, 3 PARTIAL (F-80 UBI bases, F-82 Downward-API missing-label path, F-86
  server-side dry run: they need the UBI registry or a cluster), 0 FAIL, 0 NOT VERIFIED. The four new gaps (§4) are
  minor: two exotic status-word corners (GAP-sidecar4-1, -2) and two backend-side wording/log inaccuracies seen on the
  sidecar's paths (GAP-sidecar4-3, -4). None contradicts a row's stated behaviour for inputs a real health endpoint
  produces; §3 notes say where each one touches a row.
- *Test skipped / deleted / loosened*: **no**. `git diff 6c15715..1cd3f13` on the sidecar tests: +380 / −26 lines
  (`41` §2). The only removed test, `TestReportTimeoutDefaultOutlastsTheServiceDatabaseTimeout`, is replaced in the
  same commit (`4c2ac91`, G-4-23) by the stricter `TestReportTimeoutDefaultAgainstTheServiceDatabaseTimeouts`
  (`config_test.go:144-184`: reads both service timeouts from `application.yml` instead of a hard-coded 5 s, adds the
  15 s read-timeout bound and the README wording, keeps the 10 s default and the explicit override).
  `TestGoModAndDockerfileAgreeOnTheGoLine` moved its constant 1.25 → 1.27.3 and gained the `GOTOOLCHAIN=local` and
  README checks (`deploy/dockerfile_test.go:17-41`; listed in `fixes.md` "Existing tests touched"). `t.Skip` appears
  only on the laptop path (`deploy_test.go:39`, `helm_test.go:37`, `helm_test.go:86`, the last one new for G-4-26 and
  built the same way); with `CI=true` and the tools missing the 6 deploy tests that need them FAIL naming kustomize,
  kubeconform or helm (`01` §7).
- *Sidecar not non-root / not restricted-v2 compatible* (my gate): **holds**. Image `User=1001` (numeric); it runs as
  1001, 4242:0, 65534:65534, 1000660000:0 and 1000700123:1000700123 with `--read-only` (no tmpfs), all capabilities
  dropped, `no-new-privileges`, default seccomp: `CapInh/Prm/Eff/Bnd/Amb 0`, `NoNewPrivs 1`, `Seccomp 2`, rootfs `ro`,
  `/healthz` 200 and a report accepted in every case (`30`). strace of every thread: 0 path calls in 8 s of steady
  state; across a rediscovery only `/proc/net/tcp` and `/proc/net/tcp6` opened `O_RDONLY|O_CLOEXEC`, 0
  EACCES/EPERM/EROFS (`30`, `30b`). No shell, no setuid/setgid file (`03b`). Every rendered manifest form passes the
  10 restricted checks (`20`). Real SCC admission is not available (no cluster).
- *Open critical/high security finding*: **none**. No third-party module, no `go.sum` (`40` §1). govulncheck v1.9.0
  (database mirror `storage.googleapis.com/go-vulndb`) on the source and `-mode=binary` on the image's binary
  (go1.27.3): "No vulnerabilities found" (`40` §2–3). Trivy 0.58.1 with CI's own flags on `health-sidecar:vs4`:
  `Total: 0 (HIGH: 0, CRITICAL: 0)`; every severity: 4 UNKNOWN Debian entries of the distroless stand-in base only;
  the gobinary target lists `stdlib v1.27.3` with 0 findings (`40` §5–6, `40b`). Control: the iteration-3 tree built
  with go1.25.14 still gives govulncheck 8 findings and Trivy 14 (4 HIGH: CVE-2026-111943, -78667, -78669, -97031), so
  the tools here do see what AUD-3-1 saw, and the fix removes it. **AUD-3-1 is closed.** Caveat: the shipped UBI micro
  base could not be pulled, so its packages are unscanned.

| Category | Weight | Score | Why, and what would close the deduction |
|---|---|---|---|
| Builds & static checks | 10 | 9 | `gofmt -l` 0 files, `go vet` 0, `go build` 0 (`01` §1–3); CI's gofmt step run verbatim → exit 0 (`28`); the repository Dockerfile builds with substituted bases: go1.27.3, `-trimpath`, `CGO_ENABLED=0`, `-s -w`, 7.6 MB static binary (no `NEEDED`, no `INTERP`), image 17.5 MB, `User=1001`, `9465/tcp`, OCI labels title/description/source/version `1.0.0-vs4`/revision `d10369b2…`, 148 CA certificates at the UBI path, 0 setuid/setgid files, 0 shells, 0 repository files (`03`, `03b`); golang:1.25 and golang:1.24 builders stop with `go.mod requires go >= 1.27.3 (… GOTOOLCHAIN=local)` (`03` §9); no high/critical finding (gate above). **Minus 1 (environment):** the default UBI build (`ubi9/go-toolset:1.27`, whose existence with Go ≥ 1.27.3 README L336-340 itself calls unverified) and the shipped `ubi-micro` base are unbuilt and unscanned, and README L19's "about 10 MB" is unmeasured. Closed by one build from the real UBI images with its size recorded and its Trivy scan (CI's image and scan steps do exactly this when they run). |
| Feature completeness | 30 | 28.55 | 28 PASS + 3 PARTIAL (×0.5) of 31 rows = 29.5/31 = 0.952 → 28.55. The three halves need a cluster (`oc apply --dry-run=server`, a pod without the `app.kubernetes.io/name` label) and the UBI registry. |
| Automated test health | 20 | 19 | 59 `Test*` + 25 subtests pass plain, with `-race`, with `CI=true -race` (CI's own command, 0 SKIP), with `-cover` (total 90.4 %: cmd 80.8, agent 91.8, config 91.1, discover 92.3, probe 91.9, report 80.0 %) and in 3 shuffled runs; `CI=true` without the tools → 6 FAIL naming the tool, without `CI` → 5 SKIP and the module green (`01`). Every iteration-4 change has its own test; the agent, config and probe ones pass 20/20 with `-race`, the `cmd` ones 5/5 (`01` §9). No test was loosened (`41`). **Minus 1:** the G-4-16 vector tables (`TestStatusWordsAreTrimmedLikeTheService`, `HealthStatusTest`) test the word parser only: neither reaches the service's request validation (`@NotBlank`, GAP-sidecar4-2) and neither has a case-mapping row (`paß`, GAP-sidecar4-1); G-4-24's test is a source grep (`docs_test.go:74-75`), so nothing automated runs a probe with a proxy in the environment (`14b` had to). Closed by a web-layer test that posts every row of the shared table as the overall status, case rows in both tables, and one behavioural proxy test. |
| Integration & contracts | 20 | 16 | Wire contract end to end against the real (private) service: headers (`X-Client-Id` = `CS_SERVICE` or `CS_CLIENT_ID` verbatim, `User-Agent: health-sidecar/<version>`, `Content-Type`/`Accept: application/json`), body and instance, 253/254-character instance id (400, permanent), 401/400 client-id rules, retry classes (5xx/408/409/429/timeout/refused retried; 400/401 permanent), the 10 s report timeout (7 s answers accepted, 12 s ones cut at 10.00–10.01 s), a stopped database → `503 database unavailable` in 5.03 s, a hung one → the first report cut at 10 s, then 503 in 5.0 s (direct: 20.02 s, then 5.01 s), recovery without restart; per-pod records with a 1-day TTL index, two-pod rollup, 60 parallel reports → 60 × 202; TLS (private CA via `CS_CA_FILE`, skip-verify spellings, TLS 1.1 refused) and the proxy rules (`14`, `14b`, `15`, `15b`, `15c`, `16`, `42` §D). **Minus 3 (environment, unchanged):** the pod contract is a Docker shared-netns emulation (no kubelet, no SCC admission, no native-sidecar ordering, no `--dry-run=server`, no missing-label Downward API). **Minus 1:** GAP-sidecar4-2: an app whose overall status is Unicode white space beyond U+0020 (U+2003 here) makes the sidecar send a word that the service's `@NotBlank` rejects with 400, permanently; the pod then looks silent and after 90 s the service opens a MAJOR OUTAGE while the sidecar keeps reporting (`15d`). Closed by validating the overall status with the trim rule both READMEs state. |
| Resilience & ops | 10 | 10 | Dead app → DOWN `app is not listening (last target …)` in 4.3 s, OUTAGE 4.2 s later, rediscovered and UP 2.7 s after it listens again; sidecar SIGKILL + restart → UP, same instance, no notice; SIGTERM → leaving report, exit 0 in 0.19–0.31 s (`10`, `15c`); retries never more than 30 s apart (max 28.1 s at the defaults, 29.4 s at a 45 s interval), the first attempt 1.9–19.5 s after the service returns; a 22 s service outage keeps the pod live (48.9 s of silence), a 100 s one makes it DOWN 91.0 s after its last accepted report and UP again with its first accepted one (`17a–c`, `17-gaps-recomputed`); database stopped or hung → 503 or timeout, backoff, one INFO `report delivered again`, the app container untouched (`16`, `18`); unusable durations now stop the sidecar at start (G-4-22, `04`); 10-minute soak ≤ 12.8 MB RSS, ≤ 0.17 % CPU, 9 fds, 8–10 threads (`31`). The iteration-3 minus (0 s timeouts freezing the loop) is closed. |
| Usability | 10 | 9.5 (provisional) | 39 invalid environments → exit 2 and one ERROR line naming every bad variable at once; 36 valid spellings start (`04`); the README's environment table = the 27 names `config.go` reads, its `/status` table = the 11 live keys, every anchor and link resolves (`42` §F); its build and try-out commands work as printed (`42` §A–B); the proxy row, the `extraEnv` shape, the ConfigMap row and the usual causes are now there (G-4-24/26/27). **Minus 0.5:** README L197-199 ("the service reads the status words … the same way") is false at the corners of GAP-sidecar4-1/-2; L155-156's request rates are upper bounds (O-1); L26 says the team's manifests do not change on the Helm path, where its template gains one `include` line; `CS_PROBE=grpc` also prints `CS_PORT is required when CS_PROBE=grpc` (`config.go:210`, `04` §2). Deferred to the Usability Reviewer. |
| **Total** | 100 | **92.05** | no cap applies |

Closure evidence for the iteration-4 sidecar gaps:

| Gap | Commit(s) | Fresh evidence | Verdict |
|---|---|---|---|
| G-4-2 (Go 1.27.3; closes AUD-3-1) | `8783226`, `3476fa4` | `go.mod` `go 1.27.3`; `Dockerfile:12` `ubi9/go-toolset:1.27`, `:17` `GOTOOLCHAIN=local`; CI `setup-go` reads `go-version-file: sidecar/go.mod` (`ci.yml:100-102`); the image binary is go1.27.3 (`03` §5); golang:1.25 (go1.25.14) and golang:1.24 (go1.24.13) builders stop the build with `go.mod requires go >= 1.27.3 (running go 1.25.14; GOTOOLCHAIN=local)` and no image is produced (`03` §9); on the go1.24.7 host `GOTOOLCHAIN=local` build/test exit 1 with the same message, `auto` switches to go1.27.3 and with an empty module cache downloads it (README L334) (`01` §12); govulncheck (source and binary) and Trivy clean while the go1.25.14 control still has 4 HIGH (`40`, `40b`); `TestGoModAndDockerfileAgreeOnTheGoLine` passes | **closed** (whether Red Hat publishes `go-toolset:1.27` with Go ≥ 1.27.3 is unverified, as README L336-340 says) |
| G-4-16 (one trim rule) | `e2018dc`, `8559e50`, `67f0d77` | `probe.go:275-276` trims runes ≤ U+0020, `HealthStatus.java:25-29` uses `trim()`; `15b` §1–2: all 14 trim rows (space, tab, U+0001 padding; U+00A0, U+2003 padding and alone; empty) agree on both sides as component words, end to end through live sidecars (send cadence = the service's classification); padded overall words agree (§1b); both vector tests pass 20/20 (`01` §9) | **closed for the trim rule**; residuals: an overall status made only of white space beyond U+0020 is rejected by the service's `@NotBlank` (GAP-sidecar4-2), and `paß` is upper-cased differently (GAP-sidecar4-1) |
| G-4-22 (durations) | `377da86` | `04` §3: `CS_REPORT_TIMEOUT=0s`/`0`/`-5s`, `CS_PROBE_TIMEOUT=0s`/`-1s`, `CS_HEARTBEAT=0s`/`-30s` → exit 2 `… must be more than 0 (got …)`; `CS_RETRY_DELAY=-2s`/`-1ns`, `CS_STARTUP_GRACE=-1m` → exit 2 `… must not be negative (got …)`; all five at once → one ERROR line naming each; §4: `CS_RETRY_DELAY=0`/`0s` and `CS_STARTUP_GRACE=0`/`0s` start and exit 0 on SIGTERM | **closed** |
| G-4-23 (database stopped vs hung, README L228-236) | `4c2ac91` | `16` B (`docker stop vs4-mongo`): direct reports 503 `database unavailable` in 5.03 s and 5.01 s; the sidecar's `sendError` = that 503, WARN steps 1/2/4/8 s, `report delivered again` 1.8 s after `docker start`; C1 (`docker pause`): the first report cut at 10 s with `context deadline exceeded (Client.Timeout exceeded while awaiting headers)`, the next ones 503 after 5.0 s, steps up to 30 s, delivered again after unpause; C2: direct reports 503 after 20.02 s, then 5.01 s and 5.01 s; 202 in 0.02 s after unpause | **closed**: the README's account is what happens |
| G-4-24 (proxy) | `9474dab` | `14`: dead `HTTPS_PROXY` → `proxyconnect tcp: dial tcp 172.17.0.1:19399: connect: connection refused` in `sendError`; `NO_PROXY=172.17.0.1` → sent; lower-case `https_proxy` honoured; `HTTP_PROXY` used for an `http://` endpoint (the recording proxy got the POST); `HTTPS_PROXY` alone not used for `http://`. `14b`: the app probed on the pod's non-loopback IP (`CS_HOST=172.17.0.4`) with dead `HTTP_PROXY`/`HTTPS_PROXY`/`http_proxy` → UP; with `HTTP_PROXY` = a recording stub that stub received exactly `POST /v1/health/reports` ×1 and no probe GET. (`14`'s own probe case was void: empty pod IP, superseded by `14b`.) README L225 | **closed** (its test is a source grep) |
| G-4-25 (INFO `report delivered again`) | `6e67d19` | one INFO line per recovery with `status`, `failedAttempts`, `failingFor`: `17a` (10, 3m36.766s), `17b` (9, 2m17.552s), `17c` (1, 15.95s; then 6, 1m51.973s), `16` A (3, 36.655s), B (4, 42.505s), C1 (6, 1m20.373s); `18`: after four rejected sends (400, 400, 401, 401) at the default level → `report delivered again` (4, 17.608s) | **closed** |
| G-4-26 (`extraEnv` shape) | `02c7bd0` | `20` §9: the README snippet (L267-271) in a consuming chart → `helm template` 0, `CS_LOG_LEVEL=debug` in the sidecar's env, kubeconform 1.27.0/1.29.0 valid; the map form fails `helm template` (`did not find expected '-' indicator`) as L263-264 warn | **closed** |
| G-4-27 (the ConfigMap; usual causes) | `942ba4c` | `20` §10: README L32 names the `cs-health-sidecar` ConfigMap and its keys; the manual file's header says the same and that without it the container cannot start (`CreateContainerConfigError`); the Kustomize and manual outputs both `envFrom` that ConfigMap; usual cause 4 at L311-313; `TestEachAttachPathNamesTheConfigMapItsContainerReads` passes | **closed** (the kubelet error itself needs a cluster) |
| G-4-28 (CI: gofmt, `-race`, pinned govulncheck) | `67f2d4a` | `ci.yml:119-126` gofmt step run verbatim → exit 0 (`28`); `go vet ./...` 0 and `CI=true go test -race ./...` 0 with kustomize v5.5.0, helm v3.16.3, kubeconform v0.6.7 = CI's pins (`01` §2, §6; `20` §11); `govulncheck@v1.9.0 ./...` 0 (`40` §2, mirror database); the Trivy image digest pinned at `ci.yml:21` = the local mirror's (`40` §7) | **closed** for the commands; no GitHub Actions run here |
| G-4-31, sidecar half (image scan in CI) | `13a878d` | `ci.yml:136-140` runs Trivy `image --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1`; the same command here → `Total: 0` on the stand-in image (`40` §5) | holds for the stand-in; the UBI image is unscanned |

Iteration-3 closures, re-checked (no regression):

| Gap | Fresh evidence | Verdict |
|---|---|---|
| G-3-10 (README Helm lines) | `20` §3, `20b`: the README's `containers` and `initContainers` lines pasted into a consuming chart → `helm lint` 0, `helm template` 0, kubeconform valid (classic 1.27.0/1.29.0, native 1.29.0); without `nindent` lint and template still pass and kubeconform rejects `additionalProperties 'env', 'image', 'securityContext', 'ports', 'livenessProbe', 'imagePullPolicy', 'resources' not allowed`, as L56-61 say; the library alone → `library charts are not installable` (L69) | holds |
| G-3-14 (`CS_LOG_LEVEL`) | `04` §2, §6: `debug`, `DEBUG`, `info`, `Warn`, `error`, `' ERROR '` start; `loud`, `warning`, `trace`, `DEBUG+1` → exit 2; the level applies from the first line (`error` → 0 lines logged) | holds |
| G-3-15 (10 s report timeout; stopped database → its 503) | `16` A: 7 s answers accepted (7.00–7.01 s per attempt), 12 s ones cut at 10.00–10.01 s, accepted at once when fast again; B: 503 in `sendError` | holds |
| G-3-16 (UP with a failing component sent every probe) | `12` at 3 s/30 s: `comp-down`, `comp-warn`, `comp-nested`, `comp-fail`, `comp-notserving`, `comp-error` → 18–19 sends per 60 s, `up`, `comp-unknown`, `comp-pass`, `overall-pass` → 2; HEALTH notices exactly for the former | holds |
| G-3-17 (strict booleans) | `04` §2, §5: `maybe`, `2`, `enabled` → exit 2; all 16 documented spellings start; `14`: `yes` → verification off (sent), `No` → on (`x509: certificate signed by unknown authority`, 0 sent) | holds |
| G-3-18 (UNKNOWN at the heartbeat) | `12`: `never-up` and `pinned-never-up` → 2 sends per 60 s, the end-of-grace message sent at once; `19`: an unpinned app that boots DOWN stays UNKNOWN through the 8 s grace, then DOWN flows and an OUTAGE opens (README L159-160) | holds |
| G-3-19 (heartbeat test on the fake clock) | `01` §9: `TestNotUpIsSentEveryProbeAndUpOnlyAtTheHeartbeat` 20/20 with `-race`; `41`: `agent_test.go` only gained lines (+60/−0) | holds |
| G-3-29 (retries ≤ 30 s apart; first attempt ≤ 30 s after the return; README relation) | `17a` (defaults, 503 for 240 s): gaps 15.1–28.1 s, steps 1, 2, 4, 8, 16, 30 s; `17b` (45 s interval, refused 180 s): gaps 0.9–29.4 s, last refused → first accepted 27.6 s; `17c`: heartbeats 33.3–34.3 s apart (`42` §G), a 22 s outage → 48.9 s of silence and no DOWN, a 100 s one → DOWN 91.0 s after the last accepted report, first accepted 1.9 s / 19.5 s after the returns (`17-gaps-recomputed`) | holds |
| G-3-30 (the same words on both sides) | `15` §3: 34 spellings overall and as a component; `12` and `15b` §2 through live sidecars | holds (corners: GAP-sidecar4-1/-2) |

Iteration-2 closures, re-checked:

| Gap | Fresh evidence | Verdict |
|---|---|---|
| G-2-3 (CI part) | `ci.yml:91-140`: a sidecar job with gofmt, `go vet`, `CI=true go test -race`, govulncheck v1.9.0, the image build and the Trivy scan; the deploy tests fail instead of skipping under `CI=true` (`01` §7) | holds (no Actions run here) |
| G-2-14 (Go line; labels) | go1.27.3 as above; labels `org.opencontainers.image.version=1.0.0-vs4`, `…revision=d10369b21d65…` (`03` §4); `TestImageCarriesVersionAndRevisionLabels` passes | holds |
| G-2-15 (deploy tests fail in CI without tools; `/status` pinned; `main` tested) | `01` §7; `TestStatusJSONMatchesTheDocumentedContract` passes and the live keys equal the README table (`13b`, `42` §F); `cmd/health-sidecar` 80.8 %, its `TestRun…` tests 5/5 with `-race` | holds |
| G-2-16 (not-UP sent every probe; first DOWN message; transitions logged) | `12`: DOWN/WARN 14 per 60 s (3 s + jitter + the 1 s retry probe), UP 2; `10` D: the first DOWN after the app dies says `app is not listening (last target …)`; `11` §6: one DOWN per switch, then UP; `10` H: INFO only on transitions | holds |

Observations (no score impact unless a category says so):
- **O-1** (carried) README L155-156 (33 req/s per 1,000 healthy or never-UP pods, 67 for failing ones) are upper
  bounds (1000/30 s, 1000/15 s). With the measured cadence (heartbeats 33.3–34.3 s apart; a DOWN cycle 18.5 s, a
  degraded-by-component one 16.5 s) it is ≈ 30 req/s healthy and ≈ 54 to 61 req/s failing (`42` §G).
- **O-2** (carried) `/status.lastSendAt` is the start of the tick whose report was accepted or rejected, not the time of
  the answer: with a 7 s service it reads 10:45:14.665 for a report accepted at 10:45:21.670 (`16` A). README L290
  says "when the service last accepted or rejected"; identical within milliseconds normally.
- **O-6** (carried) A SIGTERM during the first tick sends one UNKNOWN leaving report (`15c`), so the "nothing composed:
  nothing to retract" branch is effectively reached only before `Run` starts. Harmless; untested.
- **O-8** (new) `CS_PROBE_TIMEOUT=1ms`, `CS_REPORT_TIMEOUT=1ms` and `CS_HEARTBEAT=1ns` start (`04` §4): within the
  documented rule ("0 or less" is refused), but a 1 ms report timeout can never succeed; a floor (e.g. 100 ms) would
  turn a typo into exit 2.
- **O-9** (new) The shared pod's image label says revision `ec4cfcb`, a records-only commit (`git diff --quiet ec4cfcb
  1cd3f13 -- sidecar` → 0); it ran as `1000660000:0`, read-only, `cap-drop ALL`, `no-new-privileges`, 0 restarts, 79
  reports, no `sendError` (`44`, `42` §H).
- **O-10** (new) Backend B, through four database outages: one `event log poll skipped` WARN per outage, WARN
  `health/status sweep skipped`, 0 ERROR, 0 stack frames, 0 secret-looking strings (`43`); backend A: 873 × 202, 20 ×
  400 (all from my negative cases).

## 2. Commands run

Scripts do not stop on a failing step; each step prints its own exit code in its evidence file, and a scenario script
that reached its closing `end …` line exited 0. Evidence files are in `confidence/evidence/iter-4/sidecar/`, scripts in
its `scripts/` folder. Toolchain: go1.27.3 from the module cache with `GOTOOLCHAIN=local` (`scripts/env.sh`), kustomize
v5.5.0, helm v3.16.3, kubeconform v0.6.7.

| # | command | exit code | evidence file |
|---|---|---|---|
| 1 | `git diff --quiet 1cd3f13 HEAD -- sidecar .github`; `git status --porcelain -- sidecar` | 0; 0 lines | `01-static-and-tests.txt` §0 |
| 2 | `gofmt -l .` (in `sidecar/`) | 0, 0 files listed | `01` §1 |
| 3 | `go vet ./...` | 0 | `01` §2 |
| 4 | `go build ./...` | 0 | `01` §3 |
| 5 | `go test -count=1 ./...` (plain) | 0 | `01` §4 |
| 6 | `go test -count=1 -race ./...` | 0 | `01` §5 |
| 7 | `CI=true go test -count=1 -race -v ./...` (tools on `PATH`, CI's command) | 0; 59 PASS, 0 FAIL, 0 SKIP (+25 subtests) | `01` §6 |
| 8 | `CI=true go test -count=1 -v ./deploy/` without kustomize/helm/kubeconform on `PATH` | 1; 6 FAIL, each naming its tool | `01` §7 |
| 9 | the same without `CI`; then `go test ./...` without the tools | 0 (5 SKIP); 0 | `01` §7 |
| 10 | `CI=true go test -count=1 -cover -coverprofile=… ./...`; `go tool cover -func` | 0; total 90.4 % | `01` §8 |
| 11 | iteration-4 and related tests `-count=20 -race` (agent, config, probe), `-count=5 -race` (cmd) | 0, 0, 0, 0 | `01` §9 |
| 12 | `CI=true go test -count=1 -shuffle=on ./...` × 3 | 0, 0, 0 | `01` §10 |
| 13 | host go1.24.7 in `sidecar/`: `GOTOOLCHAIN=auto go version`; `GOTOOLCHAIN=local go build ./...`; `… go test ./...`; empty `GOMODCACHE` + `auto` | 0 (go1.27.3); 1; 1; 0 (downloads go1.27.3) | `01` §12 |
| 14 | `bash -e` of the `ci.yml:119-126` gofmt step | 0 | `28-ci-gofmt-step.txt` |
| 15 | `curl https://registry.access.redhat.com/v2/`; `docker pull …/ubi9/go-toolset:1.27`; `docker pull …/ubi9/ubi-micro:9.5` | 56 (CONNECT 403); 1; 1 | `03-image-build.txt` §1 |
| 16 | `docker build -t health-sidecar:vs4 --build-arg GO_IMAGE=local/go-toolset:1.27 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot --build-arg VERSION=1.0.0-vs4 --build-arg REVISION=d10369b… sidecar/` | 0 | `03` §3 |
| 17 | `docker image inspect`, `go version -m`, `readelf`, `docker export` + `tar` of the image | 0 | `03` §4–7, `03b-image-filesystem.txt` |
| 18 | `docker run --rm health-sidecar:vs4` (no environment) | 2 | `03` §8 |
| 19 | `docker build` with `GO_IMAGE=golang:1.25` and `golang:1.24` | 1, 1 (`go.mod requires go >= 1.27.3`) | `03` §9 |
| 20 | `scripts/04-config-errors.sh`: 39 invalid environments, 36 valid ones, `--network none`, restricted flags | 0 (39 × container exit 2, 36 × exit 0 after SIGTERM) | `04-config-errors.txt` |
| 21 | `scripts/05-backend.sh` (private backends A :19300, B :19302 + `vs4-mongo`); readiness re-read at the end | 0; 200, 200 | `05-backends.txt` |
| 22 | `scripts/10-lifecycle.sh` (discovery, DOWN/OUTAGE, recovery, crash + rediscovery, SIGKILL, two pods, SIGTERM, log shape) | 0 | `10-lifecycle.txt` |
| 23 | `scripts/11-ladder.sh` (probe ladder, rediscovery, ignore list, TLS port, redirect) | 0 | `11-ladder.txt` |
| 24 | `scripts/12-send-policy.sh` (14 documents at 3 s/30 s, 60 s windows) | 0 | `12-send-policy.txt` |
| 25 | `scripts/13-variants.sh` (flap damping, retry delay 0, pinned targets, ignore-all + grace, 253/254-char ids) | 0 | `13-variants.txt` |
| 26 | `scripts/13b-own-endpoints.sh` (`/healthz`, `/status`, 404/405, header timeout) | 0 | `13b-own-endpoints.txt` |
| 27 | `scripts/14-tls.sh` (private CA, skip-verify spellings, TLS 1.1, empty CA file, proxy variables) | 0 (its probe-on-pod-IP case was void: empty IP) | `14-tls.txt` |
| 28 | `scripts/14b-probe-no-proxy.sh` (probe on the pod IP with dead and recording proxies) | 0 | `14b-probe-no-proxy.txt` |
| 29 | `scripts/15-backend-contract.sh` (client id, body rules, 34 words, nesting, instances, 60 parallel, silence vs leaving) | 0 | `15-backend-contract.txt` |
| 30 | `scripts/15b-vocabulary-edges.sh` (16 edge words on the service and through 16 live sidecars) | 0 | `15b-vocabulary-edges.txt` |
| 31 | `scripts/15c-ttl-and-early-sigterm.sh` (indexes via a throw-away `mongosh` container; SIGTERM in the first tick) | 0 (mongosh 0) | `15c-ttl-and-early-sigterm.txt` |
| 32 | `scripts/15d-overall-whitespace.sh` (overall status words from the app, through the sidecar, 110 s) | 0 | `15d-overall-whitespace.txt` |
| 33 | `scripts/15e-detail-cap.sh` (a 300-character component error) | 0 | `15e-detail-cap.txt` |
| 34 | `scripts/16-failure-paths.sh` (slow service; database stopped; database paused, through a sidecar and direct) | 0 | `16-failure-paths.txt` |
| 35 | `scripts/16b-access-log-cancel.sh` (`curl --max-time 3` while `vs4-mongo` is paused; control that waits) | 0 (the abandoned curl: 28, by design) | `16b-access-log-cancel.txt` |
| 36 | `javap -c -p org/springframework/http/server/reactive/ReactorServerHttpResponse.class` (spring-web 7.0.10 from the jar) | 0 | `16c-reactor-status.txt` |
| 37 | `scripts/17a-backoff-503.sh`, `17b-backoff-refused-45s.sh`, `17c-staleness.sh` | 0, 0, 0 (17a/17b's own gap summaries raised a datetime TypeError in my script; recomputed from the raw lines) | `17a-…`, `17b-…`, `17c-staleness.txt`, `17-gaps-recomputed.txt` |
| 38 | `scripts/18-rejected-then-accepted.sh` (400, 401, then 202, default log level) | 0 | `18-rejected-then-accepted.txt` |
| 39 | `scripts/19-boots-unhealthy.sh` (app DOWN from the start, 8 s grace) | 0 | `19-boots-unhealthy.txt` |
| 40 | `scripts/20-manifests.sh` (every Kustomize/Helm/manual form; lint; kubeconform `-strict` 1.27.0 and 1.29.0; restricted checks; extraEnv; ConfigMap) | 0 (inner: native forms on 1.27.0 → 1 as expected; no-`nindent` → 1 as the README says; library alone, missing endpoint/tenant, extraEnv map → 1 by design; every other form 0) | `20-manifests.txt` |
| 41 | `kubeconform -strict -kubernetes-version 1.27.0 / 1.29.0 helm-no-nindent.yaml` (full message) | 1, 1 (expected) | `20b-no-nindent-message.txt` |
| 42 | `scripts/30-restricted-v2.sh` (5 UID/GID choices, `/proc/<pid>/status`, strace 8 s, no shell, `--network none`) | 0 | `30-restricted-v2.txt` |
| 43 | `scripts/30b-strace-rediscovery.sh` (strace across an app stop/start) | 0 | `30b-strace-rediscovery.txt` |
| 44 | `scripts/31-soak.sh` (10 minutes, defaults and 1 s/2 s) | 0 | `31-soak.txt` |
| 45 | `go list -m all`; `go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 -db https://storage.googleapis.com/go-vulndb ./...` | 0; 0 (no vulnerabilities) | `40-security.txt` §1–2 |
| 46 | the same with `-mode=binary` on the image's binary; on the go1.25.14 control build | 0; 1 (`go run` reports govulncheck's non-zero exit as 1: 8 vulnerabilities, GO-2026-6608 … -6809) | `40` §3–4 |
| 47 | `flock …/orch-trivy/.lock docker run … trivy:0.58.1 image --skip-db-update --skip-java-db-update --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 health-sidecar:vs4` | 0 (Total 0) | `40` §5 |
| 48 | the same, every severity; `trivy rootfs` on the vs4 binary and on the control | 1 (4 UNKNOWN, base); 0; 1 (14, 4 HIGH) | `40` §5–6 |
| 49 | `trivy image/rootfs … --list-all-pkgs --format json` | 0, 0, 0 | `40b-trivy-json.txt` |
| 50 | `docker buildx imagetools inspect ghcr.io/aquasecurity/trivy:0.58.1 \| head -3` | 255 (`head` closed the pipe after the digest line was printed) | `40` §7 |
| 51 | `scripts/41-test-diff.sh` (`git diff --numstat/-U0 6c15715 1cd3f13 -- sidecar/**/*_test.go`, `git grep t.Skip`) | 0 | `41-test-diff.txt` |
| 52 | `scripts/42-readme.sh` (README build and try-out, ignore range, retry classes, headers, docs parity, rates, scaled to zero, shared pod) | 0 | `42-readme.txt` |
| 53 | `scripts/43-backend-log.sh` (the private backends' logs summarised) | 0 | `43-backend-log.txt` |
| 54 | `scripts/44-shared-pod.sh` (`docker inspect sidecar`, `curl 127.0.0.1:19465/status` and `/healthz`, `docker logs sidecar`) | 0 | `44-shared-pod.txt` |
| 55 | `CGO_ENABLED=0 go build -trimpath -o bin/v6app scripts/v6app-main.go` (go1.27.3; an app bound to exactly one address) | 0 | `45-cs-host.txt` |
| 56 | `scripts/45-cs-host.sh` (app on `[::1]` or `127.0.0.1` only; sidecar with the default `CS_HOST`, `127.0.0.1`, `::1`) | 0 | `45-cs-host.txt` |

## 3. Feature verdicts

28 PASS, 3 PARTIAL, 0 FAIL, 0 NOT VERIFIED (29.5 / 31).

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-27 | PASS | `15` §1: no `X-Client-Id` → 401 with the documented message, `bad id!` → 400, a valid id → 202, `OPTIONS` without header → 200, `/swagger-ui.html` without header → 302 (exempt); `42` §D: the sidecar sends `X-Client-Id` = `CS_SERVICE` (`rc`) by default and `CS_CLIENT_ID` verbatim (`my-team/my-repo`); `43`: request lines carry the id | the id is logged at INFO per request (deliberate since G-1-22); `?clientId=` is the FE/BE part |
| F-36 | PASS | `15` §2: missing or blank `status`, missing `tenantId`/`service` → 400 naming the field; unknown keys accepted (202); `10` A: the first sidecar report → 202 and an auto-registered push-only monitor (`url=None`, publisher `health-sidecar`, stale 90) with the pod's instance | an overall status of white space beyond U+0020 is also answered 400: GAP-sidecar4-2 |
| F-38 | PASS | `15` §3: 34 spellings overall and as a component (UP words → UP; DOWN words → DOWN / `DEGRADED: c DOWN`; `UNKNOWN` → UNKNOWN / not failing; `WARN`/`DEGRADED`/`PARTIAL`/`foo` → DEGRADED); §4 nested + legacy `details` → `DEGRADED: db.primary DOWN, cache.redis DOWN`; `15b`: padded and white-space words; `15e`: a 300-character error detail stored as 200 characters, `error=` first, ending `...` | corners: GAP-sidecar4-1 (`paß`), GAP-sidecar4-2 (overall U+2003) |
| F-46 | PASS | `15` §5: pods a, b, a → two records with namespace/node/cluster/version/sidecar, `lastSeen`; unknown monitor → 404 `monitor … not found`; `15c`: `health_instances` index `instance_ttl_idx {lastSeenAt: 1}`, `expireAfterSeconds 86400` | |
| F-48 | PASS | `10` G: SIGTERM → `left=True`, rollup `UP (1 of 1 pod UP)` at once; `42` §E: the only pod leaves → `UNKNOWN (no live pod reports)`, no notice after 100 s (scaled to zero, never stale); `15` §7: one pod leaves, the other is SIGKILLed → `DOWN (1 pod has not reported since … (silent-7f9c6d5b4-pod2))` + OUTAGE; `17c`: a silent pod → DOWN 91.0 s after its last report | the "since" time and the window start at the leaving pod's report, not the silent pod's: GAP-sidecar4-4 |
| F-50 | PASS | `15` §6: 3 rounds × 20 parallel reports for one service → 60 × 202, `UP (20 of 20 pods UP)`, monitor version 60; `42` §D: a 409 is retried with backoff (WARN), not dropped | a persistent 409 needs a forced conflict: backend unit tests (Backend Verifier) |
| F-67 | PASS | `04`: 39 invalid environments → exit 2 and one `invalid configuration` (or `cannot build report client`) line naming every bad variable at once; 36 valid spellings start; `DeriveService` on 6 pod-name shapes and the hostname fallback (§7); defaults visible in `/status` and the reports (`13b`, `42` §B); `CS_PUBLISHER` now documented (README L209); G-4-22 bounds (§3–4) | matrix text predates the 10 s report timeout; "required when underivable" is unreachable from the environment (hostname fallback), covered by `config_test.go` only |
| F-68 | PASS | `30b`: during a rediscovery the sidecar opens only `/proc/net/tcp` and `/proc/net/tcp6`, read-only; `42` §C: the default ignore range (an Actuator app on 15021) and the sidecar's own port are skipped → `/healthz` on 16000; `11` STEP 7: `CS_IGNORE_PORTS=9003` skips the Actuator port | "either file may be missing" is a unit-test case (`internal/discover`) |
| F-69 | PASS | `11`: Actuator on 9003 beats `/healthz` 9002, `/` 9001 (404) and raw TCP 9004; each stop falls one pass down (5.1–5.7 s); a returning 9003 does not displace the kept target; a TLS-only port → `https://…` after the plain-HTTP hint; `/health` answering 302 is accepted, not followed; `14b`: `CS_HOST` takes the probe to the pod IP | `::1` (second default host) not exercised live |
| F-70 | PASS | `10` B: Actuator DOWN with `db DOWN` → report DOWN with components, `health document reports DOWN`; `12`: `WARN` → DEGRADED, UP with a failing component → DEGRADED naming it, UNKNOWN component not failing; `15d` A: `" "` and `"\u0001"` overall (HTTP 200) → `''` → UNKNOWN → UP by the HTTP code; `15b` §2 cadence = classification | `" "` and `paß`: GAP-sidecar4-2 / -1 |
| F-71 | PASS | `13` CASE 3: five pinned variants (auto + path → http; auto → actuator path; tcp ignores the path; scheme http); `42` §B: a pinned port keeps the probe's own error (`connection refused`) and is never dropped; `12` `pinned-never-up` stays UNKNOWN with the configuration hint | |
| F-72 | PASS | `13` CASE 4: `starting: waiting for the app to listen`, then `no health target found after 6s: … set CS_PORT and CS_PATH`; `19`: an app that answers DOWN from the start → UNKNOWN `starting: waiting for the first healthy answer from …` through the grace, then DOWN and an OUTAGE; `12`: `pinned-never-up` UNKNOWN after the grace with `check CS_PORT, CS_PATH and CS_SCHEME`; `10` D: DOWN after the app dies once UP was seen | |
| F-73 | PASS | `13` CASE 1: one failing answer with the default 2 s retry delay → only UP reported; CASE 2: `CS_RETRY_DELAY=0` → `UP, DOWN, UP` | |
| F-74 | PASS | `12`: changes at once, DOWN/degraded every probe, UP/UNKNOWN at the 30 s heartbeat; `17a–c`: backoff 1, 2, 4, 8, 16, 30 s, each step up to 20 % shorter, attempts ≤ 30 s apart, steps restart at 1 s; `42` §D and `18`: 400/401 → `report rejected` (ERROR), not retried until the next heartbeat; 429/408/409/5xx → `report failed; will retry` | matrix text predates the 30 s cap (G-3-29, deliberate) |
| F-75 | PASS | `42` §D headers; recorded bodies (`15c`, `11` §6, `15d`); `10` A instance (namespace, node, cluster, version, sidecar `1.0.0-vs4`); `13` CASE 6: 253-character id accepted, 254 → 400 `instance.id: size must be between 0 and 253`, permanent, 1 send in 5 s | the overall-status corner of GAP-sidecar4-2 is a contract mismatch (charged in §1) |
| F-76 | PASS | `10` G: SIGTERM → leaving report, `left=True`, exit 0, `docker stop` 0.31 s; `15c`: SIGTERM inside the first tick → one `UNKNOWN`, `instance shutting down`, `leaving: true` report, stop in 0.19 s; `42` §B: the host-built binary logs `leaving report sent`, `health sidecar stopped`, exit 0; `20` §8: no preStop/grace in the snippets | O-6 |
| F-77 | PASS | `10` D: app container stopped → `app is not listening (last target …)` DOWN, target dropped, rediscovered and UP 2.7 s after it listens again; `11` STEP 2–4: three successive port changes followed; `30b`: rediscovery logged `health target gone; will rediscover` / `health target found` | |
| F-78 | PASS | `13b`: `GET /healthz` → 200 `text/plain` `ok`; `GET /status` → JSON with the 10 keys (11 with `sendError` while failing, `16` A); `/nope`, `/status/x`, `/` → 404; `POST` → 405 `Allow: GET, HEAD`; a silent client is closed after 5.0 s | |
| F-79 | PASS | `14`: unknown CA → `x509: certificate signed by unknown authority`, 0 sent; `CS_CA_FILE` (read-only mount) → sent; skip-verify `yes` → sent, `No` → verified; TLS 1.1-only endpoint → `remote error: tls: protocol version not supported`; empty CA file → exit 2 `no certificates found`; proxies as in G-4-24 (`14`, `14b`); `11` STEP 8: localhost TLS not verified | |
| F-80 | PARTIAL | `03`: the repository Dockerfile with substituted bases → `User=1001`, `ENTRYPOINT /usr/local/bin/health-sidecar`, `9465/tcp`, five OCI labels, 17.5 MB; go1.27.3 static binary (`-trimpath`, `CGO_ENABLED=0`, `-s -w`, `main.version` set); CA bundle at `/etc/pki/tls/certs/ca-bundle.crt` (148 certificates); `03b`: 0 setuid/setgid files, 0 shells, 0 repository files (`.dockerignore` works); no environment → exit 2 | the UBI bases are unreachable (CONNECT 403): the shipped `go-toolset:1.27` / `ubi-micro:9.5` build, "about 10 MB" (README L19) and the UBI bundle not verified |
| F-81 | PASS | `30`: 5 UID/GID choices, `--read-only` (no tmpfs), `--cap-drop ALL`, `no-new-privileges`, default seccomp → running, `/healthz` 200, 5/5 monitors `UP (1 of 1 pod UP)`; capability sets 0, `NoNewPrivs 1`, `Seccomp 2`, rootfs `ro`, RSS 8.3–8.5 MB; strace 8 s: 0 path calls; `30b`: only `/proc/net/tcp{,6}` read; no shell; `--network none` still serves `/healthz` | real SCC admission not available |
| F-82 | PARTIAL | `20` §1–2, §6–8: `components: [../component]` appends `health-sidecar` to the Deployment and the StatefulSet and keeps their init containers; ConfigMap `cs-health-sidecar` without hash suffix (`CS_ENDPOINT`, `CS_TENANT`, `CS_CLUSTER`), `envFrom` + Downward API `POD_NAME/POD_NAMESPACE/NODE_NAME`, `CS_SERVICE`/`CS_VERSION` from the labels, port `cs-status` 9465, liveness `/healthz` every 30 s, 10m/16Mi–50m/32Mi, restricted checks 10/10; the README `images:` override rewrites only the sidecar image | a `fieldRef` to a missing `app.kubernetes.io/name` label (the kubelet's answer and the sidecar's fallback in a real pod) needs a cluster |
| F-83 | PASS | `20` §2: the native component on a Deployment and a StatefulSet that already have init containers → `[health-sidecar(restartPolicy=Always), db-migrate]` / `[…, fetch-config]`; example-native → one init container; kubeconform valid on 1.29.0, rejected on 1.27.0 only at `/spec/template/spec/initContainers/0` (README: 1.29+) | start-before/stop-after and Jobs are kubelet behaviour (no cluster) |
| F-84 | PASS | `20` §3–4, §9: lint 0 via a consuming chart; the README's `containers` and `initContainers` lines render; pinned port/path, literal service, clientId, cluster, image override, extraEnv; missing `endpoint`/`tenant` → `helm template` exit 1 `csHealthSidecar.endpoint is required` / `…tenant is required`; the library alone → `library charts are not installable`; same probes, port, securityContext as Kustomize (only `env`/`envFrom` differ, §7) | |
| F-85 | PASS | `20` §5, §10: `deploy/manual/deployment.yaml` → ConfigMap + Deployment, the container block identical to the Kustomize one (no differing keys, §7), restricted checks 10/10, valid on 1.27.0 and 1.29.0; README L32 and the file header name the ConfigMap (G-4-27) | |
| F-86 | PARTIAL | `20` §6: `kubeconform -strict` valid on 1.29.0 for every form (kust-example, native-with-init, example-native, classic-with-init, images-override, helm-containers, helm-init, helm-pinned, helm-extraenv, manual) and on 1.27.0 for every classic form; restricted checks 10/10, no `runAsUser`/privileged/host namespaces/`hostPath` | no `oc apply --dry-run=server` (no cluster) |
| F-87 | PASS | `20` §1, §8: liveness `httpGet /healthz` on `cs-status` every 30 s only, no readiness or startup probe, no preStop/grace in any snippet source, 10m/16Mi–50m/32Mi; `31`: 10 minutes at the defaults and at 1 s/2 s stay inside the limits (≤ 12.8 MB, ≤ 0.17 % CPU, 9 fds) | |
| F-88 | PASS | `10` D/E: app crash → DOWN, rediscovery when it returns; sidecar SIGKILL → restarted and UP, same instance, no notice; `12`, `19`: pods that are not UP yet stay UNKNOWN through the grace, no notice; `17a–c`, `16`: the service or its database unreachable → backoff, the app container untouched (`restarts=0`); `15` §7, `17c`: silence > 90 s → DOWN naming the pod | native ordering and kubelet restarts emulated (graded as in iterations 2 and 3) |
| F-89 | PASS | `10` H: JSON lines only; the start line carries version/service/tenant/instance/endpoint/probe; INFO `reported` only on transitions, `health target found` / `health target gone; will rediscover`, `leaving report sent`, `health sidecar stopped`; `17a–c`, `16`: `report failed; will retry` with `in`, INFO `report delivered again`; `18`, `42` §D: `report rejected` at ERROR; `43`: backend request lines with the client id, `opened OUTAGE`, `retired notice …`, 0 ERROR, 0 stack frames, 0 secret-looking strings | the backend's access line says 200 for a request its caller abandoned: GAP-sidecar4-3 |
| F-91 | PASS (sidecar/backend path) | `10`: app UP → monitor + instance; DOWN document → OUTAGE `vs4-app is down` (MAJOR, publisher `health-sidecar`) in the feed, instance DOWN with components; UP → retired; SIGTERM → `left: true`; two pods: `UP (1 of 2 pods UP (DOWN: …cd34e))`, no notice; both DOWN → OUTAGE; both UP → retired | the UI rendering is the E2E/Frontend verifiers' part |
| F-92 | PASS (sidecar parts) | `16` A slow service (cut at 10 s, retried, recovered); `17b` service down (refused, backoff, accepted 10.0 s after it listened again); `16` B/C database stopped/paused behind the service → 503 or timeout, recovery without restart; `17c`, `15` §7 silence → DOWN naming the pod; `13` CASE 6, `18`, `42` §D: 400/401 permanent; `15` §1 client-id 401/400 | UI error state, `Last-Event-ID`, `?clientId=` are FE/BE/E2E parts; GAP-sidecar4-3 seen here |

### README line by line (`sidecar/README.md`, 351 lines at `1cd3f13`)

✔ = matches behaviour here; ◐ = true with a stated exception; ✘ = contradicted; n/v = not verifiable here (why).

| Lines | Claim | Verdict | Evidence |
|---|---|---|---|
| 3-7 | finds the app, probes every 15 s over localhost, pushes to `POST /v1/health/reports`; the service rolls pods up, debounces, publishes OUTAGE/HEALTH like human notices | ✔ | `10`, `12`, `17c` (probes 15–18 s apart) |
| 9-17 | diagram | ✔ | (illustration of the above) |
| 19 | "about 10 MB image on UBI micro" | n/v | UBI blocked; the stand-in image is 17.5 MB (`03`) |
| 19 | 16 Mi memory request; runs under `restricted-v2` | ✔ / n/v | `20` (requests 16Mi; restricted checks 10/10), `30` (emulated); SCC admission needs a cluster |
| 20 | no Kubernetes API, no RBAC, no secrets; identity from the Downward API | ✔ | `20` (env `fieldRef`s only), `30`/`30b` (no file access but `/proc/net/tcp*`) |
| 21-22 | Spring apps get dependency detail; any HTTP endpoint UP/DOWN; anything else a TCP check | ✔ | `10` (components), `11` (`/healthz`, `/`, TCP) |
| 26 | "the team's own manifests do not change in the first two" | ◐ | true for Kustomize; with Helm the team's template gains the `include` line (L44-48 say so) |
| 30-32 | what each path needs (component + ConfigMap; dependency + include + values; ConfigMap + container block) | ✔ | `20` §1–5, §10 |
| 34-54 | the three Helm pieces | ✔ | `20` §3: pasted verbatim, lint 0, template 0, valid on 1.27.0/1.29.0 |
| 56-61 | without `nindent`: lint and template pass, kubeconform rejects with `additionalProperties 'env', 'image', …` | ✔ | `20` §3, `20b` |
| 63-67 | `CS_ENDPOINT` and `CS_TENANT` are the two values; tenants come from the owners | ✔ / n/a | `04` §1 (both required); onboarding is organisational |
| 69-73 | the library alone fails by design; render through the consumer; lint misses a bad indent, kubeconform does not | ✔ | `20` §3, `20b` |
| 75-86 | native form: Kustomize component keeps existing init containers; Helm `initContainer` include | ✔ | `20` §2–3, kubeconform 1.29.0 valid |
| 75-77 | native form starts before the app, stops after it, never keeps a Job alive | n/v | kubelet behaviour, no cluster |
| 88-89 | admission webhook planned | n/a | |
| 93-114 | placeholder image; Kustomize `images:` and Helm `image` overrides; pin a tag; `IfNotPresent` | ✔ | `20` §2 (images-override rewrites only the sidecar), §4 (Helm), pull policy in every form |
| 118-127 | discovery steps 1–5 (own port and 15000-15099 skipped; Actuator on any port, lowest first; health paths; `/`; TCP) | ✔ | `11`, `42` §C, `30b` |
| 129-131 | first target kept; rediscovery when its port disappears; HTTPS tried; localhost certificates not verified | ✔ | `11` STEP 2–5, 8 |
| 133-138 | `show-details: always` gives dependency detail | ✔ (stub) | `10`/`12`: components forwarded; no real Spring app here |
| 142-143 | probe every 15 s; a non-UP answer probed again after 2 s | ✔ | `13` CASE 1–2, `17c` |
| 144-153 | send at once on change; DOWN/degraded every probe (failure threshold one interval later); UP and UNKNOWN only at the 30 s heartbeat | ✔ | `12`, `10` B (OUTAGE 4.3 s after DOWN at 2 s) |
| 155-156 | 33 req/s per 1,000 healthy or never-UP pods, 67 failing | ◐ | upper bounds; measured ≈ 30 and 54–61 (`42` §G, O-1) |
| 157-162 | UNKNOWN until the first UP, at most `CS_STARTUP_GRACE`; a service that boots unhealthy is invisible for the grace, then flows; a pinned target that never answers UP stays UNKNOWN with a hint | ✔ | `12`, `13` CASE 4, `19` |
| 163-167 | after UP, a vanished port → DOWN `app is not listening (last target …)` from that probe on, then rediscovered; a pinned port keeps its own error | ✔ | `10` D, `11` STEP 6, `42` §B (`connection refused`) |
| 168-169 | SIGTERM → one `leaving: true` report; the pod drops out at once | ✔ | `10` G, `15c`, `42` §E |
| 170-175 | retried on unreachable/timeout/5xx/408/409/429; latest status only; steps 1…30 s, up to 20 % shorter; never more than 30 s apart; steps restart; app unaffected | ✔ | `17a–c`, `16`, `42` §D, `17-gaps-recomputed` |
| 176-183 | last accepted report ≤ one heartbeat (30–36 s) old; next attempt ≤ 30 s after the return; 90 s window; an outage < 24 s cannot make a healthy pod silent | ✔ | `17c` (33.3–34.3 s; 22 s outage → 48.9 s silence, no DOWN; 100 s → DOWN at 91.0 s; back 1.9 s / 19.5 s after) |
| 185-195 | report body shape | ✔ | `15c`, `10` A, `13` CASE 6 |
| 197-199 | the service reads the words, overall and per component, the same way | ◐ | true for the vocabulary and the trim rule (`15`, `15b`); not for an overall status of white space beyond U+0020 (GAP-sidecar4-2) or `paß` (GAP-sidecar4-1) |
| 201 | `X-Client-Id` carries `CS_CLIENT_ID`, default the service | ✔ | `42` §D |
| 203-226 | configuration table: 27 names = what `config.go` reads; defaults; `CS_HOST` (override honoured, `45` C/D; the `::1` half not verified, no IPv6 here); ignore range; heartbeat rule; timeouts; grace; retry delay `0`; listen; log levels; CA file; skip-verify spellings; proxy row | ✔ | `42` §F, `04`, `13`, `13b`, `14`, `14b`, `42` §C, `45` |
| 222 | "the image carries the UBI bundle" | n/v | the stand-in carries its builder's bundle at that path (148 certificates, `03b`) |
| 228-236 | database stopped → 503 after 5 s inside the report timeout; hung → about 20 s, so the report ends at 10 s with `context deadline exceeded` and is retried; later 503 after 5 s; app unaffected | ✔ | `16` B, C1, C2 |
| 238-242 | unusable values (incl. 0 s timeouts/heartbeat, negative delay/grace) → exit 2, one ERROR line naming every variable; unreadable CA → `cannot build report client` | ✔ | `04` §1–3, `14` (empty CA) |
| 244-246 | `/status` shows target, last report composed (sent or not), last accept/reject time, last error | ◐ | `13b`, `42` §D; `lastSendAt` is the tick's start (O-2) |
| 250-256 | no shell or curl in the image; read it from outside | ✔ / n/v | `03b`, `30` (no shell); `oc logs`/`port-forward` need a cluster (`docker logs` and a published port used instead) |
| 258-264 | INFO `reported` on changes, DEBUG for repeats; how to set `CS_LOG_LEVEL` per path; a map `extraEnv` fails `helm template` | ✔ | `10` H, `12`, `17a`, `20` §9 |
| 266-272 | the `extraEnv` snippet | ✔ | `20` §9 (renders `CS_LOG_LEVEL=debug`) |
| 274 | restart the pods to apply | n/v | needs a cluster (the environment is read at start: `04` §6) |
| 276-279 | WARN failures with `in`, ERROR rejections, one INFO `report delivered again` with `status`, `failedAttempts`, `failingFor` | ✔ | `16`, `17a–c`, `18` |
| 281-293 | `/status` fields; names pinned by `TestStatusJSONMatchesTheDocumentedContract` | ✔ | `13b`, `42` §F (11 names = live keys), `01` |
| 295-300 | service-side `curl` commands | ✔ | used throughout (`lib.sh` `mon`, `inst`) |
| 302-310 | usual causes 1–3 (`sendError` incl. `proxyconnect …`; tenant; `upSeen` false; set `CS_PORT`/`CS_PATH`) | ✔ | `14`, `12`, `13` CASE 4 |
| 311-313 | cause 4: missing ConfigMap → `CreateContainerConfigError` | n/v | kubelet behaviour, no cluster; the files name the ConfigMap (`20` §10) |
| 317-322 | `go test ./...`, `go build …`, `podman build …` | ✔ | `42` §A (host go 1.24.7 → go1.27.3, test 0, build 0); `03` (docker build with substituted bases) |
| 325-327 | `VERSION` → binary version, `sidecar` field, `User-Agent`, `/status`, label; `REVISION` → label | ✔ | `03` §4–5, `42` §B, §D |
| 329-334 | standard library only; Go ≥ 1.27.3; the four named CVEs; `GOTOOLCHAIN=local` stops older builders; a laptop downloads 1.27.3 | ✔ | `40` §1, §4, §6, `03` §9, `01` §12 |
| 336-340 | the default builder `ubi9/go-toolset:1.27` is unverified; pass another `GO_IMAGE` with the CA bundle at the stated path | ✔ (as a statement) | the stand-in build used that override (`03` §2–3) |
| 342-345 | deploy tests skip on a laptop without the tools, fail naming the tool under `CI` | ✔ | `01` §7 |
| 347-351 | try-out command | ✔ | `42` §B (ports changed; UP, version `1.0.0` in `/status` and reports) |

## 4. Gaps

All four are new in iteration 4 (none was listed in `iter-4/gaps.md`). None trips a gate. GAP-sidecar4-3 and -4 are in backend code that the sidecar's paths reach; the Backend Verifier owns those files.

| ID | Severity | Feature(s) | Root cause (file:line) | How reproduced | Suggested fix (one line) | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-sidecar4-1 | minor | F-38, F-70 | `sidecar/internal/probe/probe.go:276` upper-cases with `strings.ToUpper` (Unicode *simple* case mapping: `ß` stays `ß`), the service with `word.toUpperCase(Locale.ROOT)` (`src/main/java/com/atlas/communication/health/domain/HealthStatus.java:29`, *full* mapping: `ß` → `SS`). So `paß` is `PASS` → UP on the service and `PAß` → an unknown word → failing in the sidecar. README L197-199 and the root README say both sides read the words the same way | `15b` §1/§1b: `"paß"` as a component and as the overall status → HTTP 202, service `UP`; §2 through a live sidecar (`CS_INTERVAL=3s`): 13 sends in 40 s (the failing cadence, every probe; UP words: 2) while the service shows `UP (1 of 1 pod UP)`. `faıl` maps the same on both sides (DOWN) | upper-case ASCII letters only, on both sides, so that a word means the same thing everywhere | the shared vector tables (`TestStatusWordsAreTrimmedLikeTheService` in the sidecar, `HealthStatusTest` in the service) have no case-mapping row: a `paß` row in both would fail one of them |
| GAP-sidecar4-2 | minor | F-36, F-38, F-70, F-75 (G-4-16 residual) | `src/main/java/com/atlas/communication/health/domain/HealthReportCommand.java:28`: `@NotBlank String status` treats a string as blank by `Character.isWhitespace`, which is not the trim rule the service applies to the word (`HealthStatus.java:25` `trim()`, root README L354-356, the service's own `HealthStatusTest.java:60` row `" "` → DEGRADED). The sidecar keeps U+2003 (above U+0020, `probe.go:276`) and forwards the overall word, and the service rejects it with 400, which the sidecar treats as permanent | `15d` A: app answers `{"status":" "}` → `report rejected: HTTP 400 {"error":"status: must not be blank"}`. `15d` B: a pod that was UP; at 10:34:13.689 its app switches to `" "`; every report is rejected (ERROR 10:34:16, 10:34:48, 10:35:19, 10:35:51); the service sees silence and at 10:35:39 opens a MAJOR OUTAGE `ows-switch is down` (`DOWN (1 pod has not reported since 10:34:07 …)`), while the sidecar reports every 30 s. `15b` §1b, overall status by direct POST: `" "` → 400, `"\u0001"` → 202 UNKNOWN, `" "` → 400 | validate the overall status by the trim rule: reject only when `status.trim()` is empty (or, in the sidecar, never forward a word the service calls blank) | a web-layer test (`WebTestClient` on `POST /v1/health/reports`) that posts every row of the shared vector table as the overall status; today the rows reach only the word parser (`HealthStatusTest`) and the sidecar's own normaliser |
| GAP-sidecar4-3 | minor (backend) | F-89, F-92 | `src/main/java/com/atlas/communication/config/ClientIdWebFilter.java:93-100` assumes `exchange.getResponse().getStatusCode()` is null until a handler sets a status. On the real server it never is: `ReactorServerHttpResponse.getStatusCode()` falls back to the Netty response's status, 200 (`16c`, javap of spring-web 7.0.10 from the iteration-4 jar). So the `CANCEL -> "cancelled"` branch never runs, and a request whose client gave up is logged as `-> 200` | `16` C1: Mongo paused behind backend B; the sidecar cuts its report at 10 s; the backend logs `client=dbhang POST /v1/health/reports -> 200 (9999 ms)` although it answered nothing. `16b`: `curl --max-time 3` gives up (exit 28) → `client=vs4-cancel … -> 200 (3001 ms)`; the control, a client that waits → `503 (20022 ms)` | choose the outcome from the signal first (`CANCEL` → `cancelled`, `ON_ERROR` → `error`), or trust the status only when `getResponse().isCommitted()` | `ClientIdWebFilterEdgeCasesTest.aRequestTheCallerAbandonsBeforeAStatusIsSetIsLoggedAsCancelled` (line 60) asserts `cancelled`, but it runs on `MockServerWebExchange`, whose response returns null; an integration test on the Netty server with a client that disconnects would fail |
| GAP-sidecar4-4 | minor (backend) | F-48 | `src/main/java/com/atlas/communication/health/application/HealthSweepUseCase.java:221` writes `" not reported since " + monitor.staleBaseline()`, and the staleness window (`HealthMonitor.java:141`) starts from the same instant. `staleBaseline()` (`HealthMonitor.java:144-146`) is the monitor's `lastReportAt`, which every pod's report moves forward, including a leaving pod's goodbye. When one pod leaves and the other goes silent, the message gives the goodbye's time, and DOWN comes up to one heartbeat late | `15` §7: pod1 SIGTERM (leaving report 10:31:28.962), pod2 SIGKILL (last report 10:31:23.859). At 10:33:00.520: `DOWN (1 pod has not reported since 2026-11-02 10:31:28 UTC (silent-7f9c6d5b4-pod2))`. The time given is pod1's goodbye, and DOWN came 96.7 s after pod2's last report instead of about 90 s | for both the window and the message, use the newest `lastSeenAt` among instances that have not left; fall back to the monitor's baseline when there are none | `HealthSweepUseCaseTest.aServiceWhosePodsWentSilentIsDownAndNamesThem` (lines 401-418) builds exactly this case (pod-a left at −100 s, pod-b silent since −110 s) but asserts no time; asserting `since <NOW − 110 s>` would fail |

Observations that are not gaps (in §1): O-1 the README's request rates are upper bounds; O-2 `/status` `lastSendAt` is the start of the tick; O-6, O-8, O-9, O-10 as described there.

## 5. Not exercisable in this sandbox

These items are not counted as verified. They are scored as in iterations 2 and 3.

- **No OpenShift or Kubernetes cluster.** The following were not exercised:
  - real SCC admission under `restricted-v2`. Emulated instead with `--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges` (`30`) and the 10 restricted checks on every rendered form (`20`);
  - native-sidecar ordering (starts before the app, stops after it, does not keep a Job alive; README L75-77);
  - kubelet liveness restarts, and the `/healthz` probe as the kubelet calls it;
  - the Downward API for a pod without the `app.kubernetes.io/name` label (the missing half of F-82);
  - `CreateContainerConfigError` for a missing ConfigMap (README L311-313);
  - `oc apply --dry-run=server` (the missing half of F-86), where `kubeconform -strict` with the 1.27.0 and 1.29.0 schemas was used instead;
  - `oc logs`, `oc port-forward`, and a rollout restart to apply `CS_LOG_LEVEL` (README L250-256, L274). `docker logs` and a published port were used instead.
- **UBI registry blocked** (`registry.access.redhat.com` answers CONNECT 403, `docker pull` is Forbidden, `03` §1). The following were not exercised:
  - whether `ubi9/go-toolset:1.27` exists and which Go it ships (README L336-340);
  - the `ubi9/ubi-micro:9.5` base;
  - the real image size (README L19, "about 10 MB"; the stand-in is 17.5 MB);
  - the UBI CA bundle (README L222);
  - an OS-package scan of the shipped base;
  - CI's default `docker build .` without build arguments (the missing half of F-80).

  The image under test was built from the repository Dockerfile with `local/go-toolset:1.27` and `gcr.io/distroless/static-debian12:nonroot`.
- **No GitHub Actions run.** The sidecar job's commands were replayed here:
  - the gofmt step verbatim (`28`);
  - `CI=true go test -race` (`01`);
  - govulncheck v1.9.0 (`40`);
  - the docker build with substituted bases (`03`);
  - Trivy with CI's flags (`40`).

  Not exercised: the hosted runner, `actions/setup-go`, the steps that download kubeconform and helm, and govulncheck against its default database `vuln.go.dev`, which is blocked here (its mirror `storage.googleapis.com/go-vulndb` was used, as the brief says). The Trivy image digest pinned at `ci.yml:21` was only read.
- **No real Spring Boot application behind a sidecar.** The apps were Go stubs (`scripts/stub-main.go`) that serve Actuator-shaped documents, `/healthz`, `/` and bare TCP. README L133-138 (`show-details: always` gives the dependency detail) was checked against that shape only. The *service* side was real: the iteration-4 jar.
- **Probing over `::1`** (the second address in the `CS_HOST` default) is not exercisable here. The container network namespaces have no IPv6: an app asked to listen on `[::1]:8080` fails with `socket: address family not supported by protocol` (`45` A, B).
  - What was verified: the override is honoured. An app on `127.0.0.1:8080` with `CS_HOST=::1` gives no target, only UNKNOWN `starting: waiting for the app to listen`. The same app with the default `CS_HOST` → `http://127.0.0.1:8080/actuator/health`, UP, and `UP (1 of 1 pod UP)` on the service (`45` C, D).
  - Not verified: whether a pod whose app binds only `::1` is found through the default.
- **The trim/vocabulary corners** use code points that no real Actuator emits (U+2003 and `ß`). They were driven from the stubs, which is why GAP-sidecar4-1 and -2 are rated minor.

## Cleanup (11:15 UTC)

- **Removed:**
  - private backends A (`:19300`) and B (`:19302`), via SIGTERM to my two `java -jar …iter4.jar` processes; nothing answers on either port afterwards;
  - container `vs4-mongo` and its two anonymous volumes (`docker rm -f -v`);
  - every `vs4-*` pod, app, sidecar, soak and proxy container (0 left);
  - image `health-sidecar:vs4` (0 `:vs4` images left);
  - scratch builds `sidecar4/bin` and `sidecar4/work` (rootfs tar, iteration-3 source, renders, binaries).
- **Checked afterwards:** no host process of mine is running, and nothing listens on 19300–19399.
- **Left in place:**
  - database `vs4_main` on the shared Mongo (0.8 MB, tenant-prefixed). Dropping it from a throw-away `mongosh` container was refused by this session's permission check, so it stays for the orchestrator to drop if wanted;
  - the shared images (`local/go-toolset:1.27`, the distroless bases, `mongo:7.0`, Trivy) and the Trivy cache, which are not mine;
  - the BuildKit cache of my two builds, because no selective prune touches only mine;
  - my scratch scripts, raw outputs and logs (about 1 MB).
- **Not done:** `docker system prune` or `builder prune`, as the rules forbid.
- **The shared stack** (`app`, `sidecar`, Mongo `:27017`, backend `:8080`, frontend `:3000`) was only read.
