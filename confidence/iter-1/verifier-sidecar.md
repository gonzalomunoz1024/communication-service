# Sidecar / OpenShift Verifier — iteration 1

Verifier: independent fork (did not write any of the fixes). Scope: every Feature Matrix row whose services include `SC`
except F-90..F-92 (29 rows: F-27, F-36, F-38, F-46, F-48, F-50, F-67..F-89), plus fresh evidence for the three sidecar
gaps closed in this iteration (G-1-2, G-1-18, G-1-19) and a regression check against iteration 0 (25.5/29, score 77).
Code under test: `confidence-loop/2026-11-01` @ `0e14838`. Date: 2026-11-02, 01:30–02:10 UTC.
Evidence root: `confidence/evidence/iter-1/sidecar/` (`ev/…` below); the scripts that produced the pod scenarios are in
`ev/scripts/` (the Go stub server is the iteration-0 one, `confidence/evidence/iter-0/sidecar/scripts/stub-main.go`).
Destructive scenarios ran against a **private backend** on `:19300` (database `sc1-main`, started from the iteration-1
jar) and containers named `sc1-*`; the shared stack (`:8080`, `:3000`, `app`/`sidecar`) was not stopped or reconfigured
(see O-4 for the one inherited script that posted to it). Image under test: `health-sidecar:sc1`, built from the repo
Dockerfile at `0e14838` with the two base images substituted (UBI registries are unreachable here, `ev/03`).

Verdict convention for §3: **PASS** = every claim of the row verified here; **PARTIAL** (counts 0.5) = the row's main
claims verified but a named part is impossible in this sandbox; **FAIL** (0) = a claim demonstrably false;
**NOT VERIFIED** (0) = nothing could be checked.

## 1. Summary

**Sidecar score: 88 / 100 (iteration 0: 77, +11). Hard gates: none tripped.**

- *Matrix item fails E2E*: no — 26 PASS, 3 PARTIAL (F-80, F-82, F-86: UBI base, Downward-API-missing-label and
  server-side dry-run are not exercisable here), 0 FAIL. F-83 and F-88, the two iteration-0 failures, pass with fresh
  evidence (`ev/20`, `ev/21`, `ev/10`).
- *Test skipped / deleted / loosened*: `git diff 191a0c5..HEAD -- sidecar` removes **0** test lines (`ev/42`); it adds
  102 lines to `agent_test.go` and two new files (`deploy_test.go`, `config/docs_test.go`). One new skip site exists,
  justified and visible (`deploy_test.go:20`, kustomize absent); it did not fire here because the tools are on `PATH`
  (33 `Test*` functions, 0 FAIL, 0 SKIP, `ev/01`). See GAP-sidecar-1 for why CI should not rely on it.
- *Sidecar not restricted-v2 / non-root*: holds. Image `User=1001`; runs as 1001, 4242, 65534, 1000660000 and
  1000700123 with gid 0 and with a non-zero gid, `--read-only` (no tmpfs), all capabilities dropped, no-new-privileges,
  default seccomp: `CapEff 0`, `NoNewPrivs 1`, `Seccomp 2`, rootfs `ro`, 6 open fds, no setuid files, RSS ≈ 7.5 MB
  (`ev/30`). Every rendered manifest sets the restricted-v2 security context and none sets `runAsUser` (`ev/20` §7,
  `ev/21`). Real SCC admission is not available in this sandbox.
- *Open critical/high security finding*: none known. `govulncheck` still cannot run here (`vuln.go.dev` → 403; the
  current tool also needs Go ≥ 1.26, `ev/40`, `ev/41`); the module has zero third-party dependencies. Recorded as
  GAP-sidecar-2 (low) because the Go 1.24 line is past upstream support and the scan must happen in CI.

Regressions vs iteration 0: **none** — every row that passed in iteration 0 passed again with the fixed code; the G-1-2
change did not alter the ladder, the flap damping, the send policy, the grace rules or the wire contract (`ev/11`,
`ev/12`, `ev/13` reproduce the iteration-0 scripts on the new image with the same results, plus the new DOWN rule).

| Category | Weight | Score | Why |
|---|---|---|---|
| Builds & static checks | 10 | 8 | `gofmt -l`, `go vet`, `go build` clean; image builds from the repo Dockerfile (`-trimpath`, `CGO_ENABLED=0`, go1.24.13, 6.7 MB binary, 16 MB image on the distroless stand-in); zero third-party modules. Minus 2: the vulnerability scan is still not runnable in this sandbox and the toolchain line (1.24) is past upstream support (GAP-sidecar-2). |
| Feature completeness | 30 | 28 | 26 PASS + 3 PARTIAL (×0.5) of 29 rows = 27.5/29 = 0.948 → 28.4. Iteration 0: 25.5/29. |
| Automated test health | 20 | 17 | 33 `Test*` functions pass 3× plus `-race`; coverage agent 89 %, config 88 %, discover 92 %, probe 89 %, report 80 % (`ev/42`); every gap fixed this iteration has a guarding test that fails on the old behaviour (`agent_test.go` ×3, `deploy_test.go` ×4, `docs_test.go`); a 2 s retry-delay case now exists (`agent_test.go:343,403`). Minus 3: the manifest tests skip silently without kustomize and only log without kubeconform (GAP-sidecar-1); `cmd/health-sidecar` is untested (wiring only); no test pins the `/status` JSON contract the README now documents. |
| Integration & contracts | 20 | 17 | Wire contract verified end to end against the fixed backend: headers, body, 253/254-char id, 202/400/409/5xx handling, leaving, per-instance records, vocabulary (UP/DEGRADED/DOWN/UNKNOWN, nested composite), DOWN → OUTAGE in 2 reports → RETIRED on recovery, 3 × 20 parallel reports → 60 × 202 (iteration 0: 11 × 409). Minus 3: the pod contract is still a Docker shared-network-namespace emulation (no kubelet, no SCC, no `oc --dry-run=server`), and the Downward-API-missing-label path is not exercisable. |
| Resilience & ops | 10 | 9 | Dead app → DOWN in 4 s and an OUTAGE within 12 s at test cadence, recovery → notice retired in 9 s; SIGTERM 0.12–0.19 s with a leaving report; SIGKILL + restart → UP in 2 s without a notice; backend 5xx/409 → 1/2/4/8 s backoff, 400 → permanent and re-tried only at the heartbeat; proxy variables honoured for the endpoint and ignored for localhost; `/healthz` liveness, 10m/16Mi–50m/32Mi. Soak (`ev/31`): RSS plateaus at 11.8–12.3 MB (VmHWM 12.1 MB) of the 32Mi limit after ~5 min at 15× the default probe rate, live heap 0 MB after every GC, fds/threads constant, CPU ≈ 0.1–0.2 % of a core, 0 WARN/ERROR. Minus 1: at default settings the notice-opening second DOWN report follows the first by the 30 s heartbeat (O-3), and the first DOWN message is not the documented one (GAP-sidecar-4); a soak at the default cadence was not run. |
| Usability | 10 | 9 | Config errors name the variable and exit 2 (all errors listed at once); `/status` now shows `lastTarget`, and the README's Debugging section matches the real key set; `CS_PUBLISHER` and every other variable documented (`docs_test.go`); the `images:` override from the README works (`ev/21` §2''); Helm names the missing value. Minus 1: README wording vs the first DOWN message (GAP-sidecar-4), "about 10 MB on UBI micro" unverifiable, no version label on the image (GAP-sidecar-3). |
| **Total** | 100 | **88** | no cap applies |

Closure evidence for the three sidecar gaps of this iteration:

| Gap | Commit | Fresh evidence | Verdict |
|---|---|---|---|
| G-1-2 (dead app → UNKNOWN forever) | `0fd51b6` | `ev/10` STEP B/C: app container stopped inside a live netns → `DOWN` after 4 s, `app is not listening (last target http://127.0.0.1:8080/actuator/health)` on every following tick, `target` empty / `lastTarget` kept, backend OUTAGE `sc1-app is down` after the second DOWN report (12 s), app back → `UP` in 2 s → notice `RETIRED`, feed empty after 9 s. STEP F: a pod that was never UP stays `UNKNOWN` (`no health target found after 20s …`), a pinned port that never answers stays `UNKNOWN` (`… never answered UP since start; check CS_PORT, CS_PATH and CS_SCHEME`), neither opens a notice. `ev/01`: the three new agent tests pass. | closed |
| G-1-18 (native form destroyed init containers) | `ccecee8` | `ev/20` §3: testdata Deployment (`db-migrate`) and StatefulSet (`fetch-config`) through `component-native` keep their init containers and gain `health-sidecar` (`restartPolicy: Always`); `ev/21` §2': the example switched to the native component renders; §3b': the classic component on the same workloads leaves `initContainers` untouched; kubeconform 1.29.0 valid for all; old JSON-patch file removed; `deploy_test.go` ×4 pass. | closed (note O-2 on ordering) |
| G-1-19 (README/manual-snippet drift) | `5a38919` | `ev/42`: README `/status` table = `target, lastTarget, upSeen, lastReport, lastSendAt, reportsSent, sendError`, real keys `version, service, tenant, instance, target, lastTarget, upSeen, lastReport, reportsSent, sendError` (+ `lastSendAt`, omitted while empty — `ev/42` last block: present once `reportsSent` > 0); `TestEveryEnvironmentVariableIsDocumented` passes; `ev/20` §8: manual snippet now identical to both components (differing keys: none); `ev/21` §2'': the documented `images:` override rewrites only the sidecar image. | closed |

## 2. Commands run

Exit codes are the ones recorded in the evidence files. `$S` = the session scratchpad.

| # | Command | Exit code | Evidence file |
|---|---|---|---|
| 1 | `cd sidecar && gofmt -l . && go vet ./... && go build ./...` | 0 / 0 (no files) / 0 | `ev/01-static-and-tests.txt` |
| 2 | `go test -count=1 ./...` ×3 (one with `-race`), `go test -v` for the names; once more with kustomize/kubeconform off `PATH` | 0 ×4; 33 `Test*`, 0 FAIL, 0 SKIP (3 SKIP without the tools) | `ev/01` |
| 3 | `go test -count=1 -cover ./...` | 0; agent 89.4 %, config 88.4 %, discover 92.3 %, probe 88.7 %, report 80.0 % | `ev/42-tests-and-docs.txt` |
| 4 | `docker build -t health-sidecar:sc1 --build-arg GO_IMAGE=local/go-toolset:1.24 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:latest --build-arg VERSION=1.0.0-sc1 sidecar/`; `docker image inspect`; `go version -m`; no-env run | 0; `User=1001`, `9465/tcp`, 16.2 MB | `ev/03-image-build.txt` |
| 5 | host binary with 12 invalid environments; valid pinned-port run + `/status` + SIGTERM | 2 each; clean stop | `ev/04-config-errors.txt` |
| 6 | `ev/scripts/g12-lifecycle.sh` — netns holder + `fakeapp:ci` + sidecar (`--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges`) vs the private backend; DOWN document, app stop/start, sidecar SIGKILL/restart, SIGTERM, never-UP and pinned side pods, log shape | 0 | `ev/10-g12-lifecycle.txt` |
| 7 | `ev/scripts/ladder.sh` — four listeners + recording backend stub; ladder, rediscovery ×3, 500/400/409/202, heartbeat count, SIGTERM, recorded requests | 0 | `ev/11-ladder.txt` |
| 8 | `ev/scripts/variants.sh` (iteration-0 script, names/image adapted) — flap damping, pins, ignore-ports, grace, WARN at boot, 253/254-char id, own endpoints | 0 | `ev/12-variants.txt` |
| 9 | `ev/scripts/tls.sh` (iteration-0 script adapted) + CASE 4b/5b appended inline — private CA, `CS_CA_FILE`, skip-verify, `HTTP(S)_PROXY`/`NO_PROXY` | 0 | `ev/13-tls.txt` |
| 10 | raw `curl` reports to the private backend (12 vocabulary words + nested composite, 3 × 20 parallel), WARN-after-UP pod, monitor states after leaving/SIGKILL | 202 / 400 as listed | `ev/14-backend-contract.txt` |
| 11 | `kustomize build` ×7 forms, `helm lint` + `helm template` ×5 (consuming chart via `file://`), `kubeconform -strict -kubernetes-version 1.29.0` and `1.27.0` ×14, key grep, drift diff, README `images:` override | 0 (two absolute-path builds in `ev/20` §2/§3b errored and were redone with relative paths in `ev/21`; 1.27.0 rejects the native forms as expected) | `ev/20-manifests.txt`, `ev/21-manifests-native.txt` |
| 12 | `docker run` × 7 UID/flag combinations, `/proc/<pid>/{status,mounts,fd}`, `docker export | tar -tv`, `--network none` | 0 | `ev/30-restricted-v2.txt` |
| 13 | soak: three sidecars at `CS_INTERVAL=1s CS_HEARTBEAT=2s` (HTTP probe, HTTP probe + `GODEBUG=gctrace=1`, TCP probe + gctrace) sampled every 30 s | — (309 / 209 / 209 reports, 0 WARN/ERROR, all monitors UP) | `ev/31-soak.txt` |
| 14 | `go run golang.org/x/vuln/cmd/govulncheck@latest ./...` and `@v1.1.4 ./...`; reachability of `proxy.golang.org`, `vuln.go.dev`; `go list -m all` | 1 (`requires go >= 1.26.0`) / 1 (`vuln.go.dev … Forbidden`) | `ev/40-govulncheck.txt`, `ev/41-followups.txt` |
| 15 | `git log/diff --stat 191a0c5..HEAD -- sidecar`, removed test lines, `git status` | 0 removed test lines; only `ev/` untracked | `ev/42` |

## 3. Feature verdicts

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| F-27 | PASS | `ev/11` recorded requests: every POST carries `X-Client-Id: sc1-ladder-repo` (= `CS_CLIENT_ID`), `User-Agent: health-sidecar/1.0.0-sc1`, `Content-Type`/`Accept: application/json`; `ev/10` STEP A: the default id (= service) is accepted by the real backend | header names seen: Accept, Accept-Encoding, Content-Length, Content-Type, User-Agent, X-Client-Id |
| F-36 | PASS | `ev/10` STEP A: the first report auto-registers monitor `sc1-app` and its instance; `ev/14` F-38: status missing or blank → 400, every vocabulary word → 202 | |
| F-38 | PASS | `ev/14` F-38: OK/HEALTHY/UP → `UP (1 of 1 pod UP)`; WARN/DEGRADED → `DEGRADED`; DOWN/OUT_OF_SERVICE/FATAL/UNHEALTHY → `DOWN`; UNKNOWN → `UNKNOWN (1 pod starting, none reporting yet)`; nested composite → `DOWN …: db.primary DOWN`, instance `components [{"name":"db.primary","status":"DOWN"}]` | |
| F-46 | PASS | `ev/14` F-50: 20 instances recorded and listed sorted by id; `ev/10` STEPs A–D: the same `instanceId` is upserted across a sidecar SIGKILL/restart (`instances: 1`, `lastSeenAt` advancing) | |
| F-48 | PASS | `ev/10` STEP E: `left: true`, `instance shutting down` 1 s after SIGTERM; `ev/14` F-48: that monitor then reads `UNKNOWN (no live pod reports)` with no notice (scaled to zero); the two side pods removed with SIGKILL (no leaving) became `DOWN (1 pod has not reported since …)` with an OUTAGE after the staleness window | silence rule works; see O-1 |
| F-50 | PASS | `ev/14` F-50: 3 rounds × 20 parallel instance reports → 60 × 202, 0 × 409 (iteration 0: 11 × 409), rollup `UP (20 of 20 pods UP)`, monitor version 60; `ev/11` STEP 5: a backend 409 is retried with 1/2/4/8 s backoff | backend side of G-1-7 holds under the burst the matrix asks for |
| F-67 | PASS | `ev/04`: 12 invalid environments → exit 2 naming the variable (both required ones at once, multi-error lists); missing/empty `CS_CA_FILE` → exit 2 `cannot build report client`; `TestFromEnv*`, `TestDeriveService`, `TestParsePortRanges` pass; `ev/42`: `CS_SERVICE=""` + `POD_NAME=payments-api-7f9c6d5b4-x2k4q` → service `payments-api` | |
| F-68 | PASS | `ev/11` STEP 1: four listeners in the namespace, `CS_IGNORE_PORTS=9100` hides the backend stub; `ev/12` CASE 6: ignoring every port → `starting: waiting for the app to listen` then `no health target found after 6s … set CS_PORT and CS_PATH`; `ev/10` STEP A: fakeapp on 8080 found in < 1 s | |
| F-69 | PASS | `ev/11` STEPs 1–4: 9003 Actuator preferred over 9001/9002 → `http://127.0.0.1:9002/healthz` → `http://127.0.0.1:9001/` (404 counts as up) → `tcp://127.0.0.1:9004` | |
| F-70 | PASS | `ev/10` STEP B0: Actuator document `DOWN` with `db DOWN` → report DOWN with components, notice body `Failing components: db: DOWN - database=PostgreSQL`; `ev/14` F-70: `WARN` **after** the first UP → report `WARN`, backend `DEGRADED … db DEGRADED`; `OUT_OF_SERVICE` → report `DOWN`; `ev/11`: connection refused → DOWN | WARN at boot stays UNKNOWN for the grace (documented, `ev/12` CASE 8) |
| F-71 | PASS | `ev/12` CASEs 3–5: `CS_PORT=9003 CS_PATH=/ping` → `http://…:9003/ping`; `CS_PROBE=tcp` → `tcp://…:9003` (path ignored); `CS_PROBE=actuator` → `/actuator/health`; `ev/10` STEP F: pinned `CS_PORT=9999` | |
| F-72 | PASS | `ev/12` CASE 7: pinned never-UP → `starting: waiting for the first healthy answer …` then `… never answered UP since start; check CS_PORT, CS_PATH and CS_SCHEME`; app UP → UP; DOWN again → DOWN now counts; `ev/10` STEP F: both rules against the real backend open no notice | |
| F-73 | PASS | `ev/12` CASE 1: one failed request with the default 2 s retry → stays UP, 1 report, 0 DOWN lines; CASE 2: `CS_RETRY_DELAY=0` → `UP, DOWN, UP` sent; `ev/42`: `agent_test.go:343,403` exercise a 2 s delay | |
| F-74 | PASS | `ev/11` STEP 5: 500 → `sendError` set, retries after 1/2/4 s (3 requests in 12 s); 400 → `report rejected` once per heartbeat (2 in 12 s); 409 → retried like 5xx (4 in 12 s); 202 → `sendError` cleared; STEP 6: heartbeats 6.4–6.8 s apart at `CS_HEARTBEAT=6s` (3–4 per 24 s); `ev/10` STEP B: the heartbeat carries the DOWN that opens the notice | see O-3 |
| F-75 | PASS | `ev/11` FIRST/LAST BODY: `tenantId, service, status, components, message, observedAt, publisher, instance{id, namespace, node, cluster, version, sidecar, leaving}`; `ev/12` CASE 9: 253-char id accepted, 254 → 400 `instance.id: size must be between 0 and 253` logged as permanent; `ev/10`: instances carry `sidecar: 1.0.0-sc1` | |
| F-76 | PASS | `ev/10` STEP E: `docker stop` returns in 0.12 s, exit 0, `leaving report sent`; `ev/11` STEP 7: 0.19 s, last request `leaving: true` / `instance shutting down`; `ev/04`: unreachable endpoint → `leaving report failed` WARN and a clean stop | |
| F-77 | PASS | `ev/11` STEPs 2–4: the target switches within one interval + retry (≈ 2 s) each time its port disappears; `ev/10` STEP C: back on the same port → `health target found` within 2 s | |
| F-78 | PASS | `ev/12` CASE 10: `/healthz` 200 `text/plain` `ok`, `/status` 200 JSON, unknown path 404, POST 405; `ev/10`, `ev/42`: `/status` keys `version, service, tenant, instance, target, lastTarget, upSeen, lastReport, reportsSent, sendError`, `sendError` reflects a failed send (`ev/11`, `ev/13`) | |
| F-79 | PASS | `ev/13`: no CA → `x509: certificate signed by unknown authority`, sent=0; `CS_CA_FILE` (read-only mount) → accepted; `CS_INSECURE_SKIP_VERIFY` → accepted; CASE 4b/5b: a dead `HTTP(S)_PROXY` breaks reports to a non-loopback endpoint (`proxyconnect …`), `NO_PROXY` restores them, localhost probes unaffected; `report/client.go:65` `MinVersion: TLS12`, `:84` `ProxyFromEnvironment`; `ev/04`: bad CA file → exit 2 | cases 4/5 with a loopback endpoint prove nothing (Go never proxies loopback); 4b/5b do |
| F-80 | PARTIAL | `ev/03`: builds from the repo Dockerfile with substituted bases, `User=1001`, `9465/tcp`, OCI title/description/source labels, 16.2 MB, binary 6.7 MB `-trimpath` `CGO_ENABLED=0` go1.24.13, CA bundle 150 certs; `ev/30`: root-owned 0755 files only, 0 setuid; `ev/40`: zero third-party modules | UBI `go-toolset`/`ubi-micro` unreachable (403) → the shipped base, its size ("about 10 MB") and its CA bundle are not verified; no version label (GAP-sidecar-3); toolchain line (GAP-sidecar-2) |
| F-81 | PASS | `ev/30`: UIDs 1001 (image default), 4242, 65534, 1000660000, 1000700123, gid 0 and gid 1000660000, `--read-only` (no tmpfs), `--cap-drop ALL`, `no-new-privileges`, default seccomp → runs, `/healthz` 200; `CapInh/Prm/Eff/Bnd/Amb = 0`, `NoNewPrivs 1`, `Seccomp 2`, rootfs `ro`, 6 fds (stdio pipes, `/dev/null`, epoll, eventfd, the listening socket), RSS 7.3–7.7 MB; `--network none` still serves; `ev/10`: the whole lifecycle ran as 1000660000:0 | real SCC admission not available |
| F-82 | PARTIAL | `ev/20` §1: `kustomize build example` → `payments-api` + `health-sidecar`, ConfigMap without hash suffix, envFrom + 5 Downward API vars, `imagePullPolicy: IfNotPresent`; `ev/21` §2'': README `images:` override rewrites only the sidecar image; `ev/42`: the sidecar derives the service from `POD_NAME` when `CS_SERVICE` is empty | a fieldRef to a missing label yielding an empty value is kubelet behaviour not exercisable here |
| F-83 | PASS (iteration 0: FAIL) | `ev/20` §3: testdata Deployment (`db-migrate`) and StatefulSet (`fetch-config`) through `component-native` keep both init containers and gain `health-sidecar` (`restartPolicy: Always`); `ev/21` §2': example switched to the native component renders one init container + ConfigMap; kubeconform 1.29.0 valid; `component/add-native-sidecar.yaml` gone; `deploy_test.go` ×4 pass | the sidecar is inserted *before* existing init containers (O-2); 1.27.0 rejects `restartPolicy` as expected |
| F-84 | PASS | `ev/20` §4: `helm lint` 0 failures, the library alone is not installable (by design); consuming chart via `file://`: `.container` and `.initContainer` (`restartPolicy: Always`) render with the documented env/securityContext; `ev/21`, `ev/41`: missing endpoint → `csHealthSidecar.endpoint is required`, missing tenant → `csHealthSidecar.tenant is required`; kubeconform 1.29.0 valid | |
| F-85 | PASS | `ev/20` §5, §8: manual YAML renders ConfigMap + container, kubeconform 1.29.0/1.27.0 valid; container block identical to both components (differing keys: none — iteration-0 drift closed) | |
| F-86 | PARTIAL | `ev/20` §6, `ev/21`: kubeconform `-strict` 1.29.0 valid for classic, native, native-with-init, classic-with-init, helm-classic, helm-native, manual; 1.27.0 valid for every non-native form; §7: no `runAsUser`/`privileged`/`hostNetwork`/`hostPath`, every form has allowPrivilegeEscalation false, readOnlyRootFilesystem, runAsNonRoot, drop ALL, seccomp RuntimeDefault | no `oc --dry-run=server` (no cluster) |
| F-87 | PASS | `ev/31`: three sidecars at 1 s probes / 2 s heartbeats for 7.7–11.3 min (309 / 209 / 209 reports): RSS 7.4 MB → plateau 11.8–12.3 MB after ~5 min (VmHWM 12.1 MB) with the HTTP probe, 10.0 MB with the TCP probe; gctrace live heap 0 MB after every GC (3 GCs in 6 min, 4 MB goal); fds constant 7, threads 9, CPU 0.10–0.18 % of a core (≈ 1–2 millicores at 15× the default rate) vs 50m / 32Mi limits and 10m / 16Mi requests; 0 WARN/ERROR; every snippet has the `/healthz` liveness probe every 30 s and no readiness/startup probe | the RSS growth is the Go runtime reaching steady state (live heap flat, fds/threads constant), not a leak; readiness/startup probes are not needed: the sidecar is no Service endpoint and the native form orders start-up by `restartPolicy: Always`, not by probes; a soak at the default 15 s cadence was not run |
| F-88 | PASS (iteration 0: FAIL) | `ev/10` STEP B: app container stopped while namespace and sidecar stay → DOWN after 4 s (`GET …: connection refused`), then `app is not listening (last target http://127.0.0.1:8080/actuator/health)` on every tick with `target` empty and `lastTarget` kept, OUTAGE `sc1-app is down` in the feed after 12 s (second DOWN report); STEP C: app back → UP in 2 s, notice `RETIRED`, feed empty after 9 s; STEP D: sidecar SIGKILL + restart → UP in 2 s, same instance, no notice; STEP F: never-UP / pinned pods stay UNKNOWN; `ev/11` STEP 5: backend 5xx → backoff, accepted again at the next heartbeat | G-1-2 closed; GAP-sidecar-4 on the first message |
| F-89 | PASS | `ev/10` STEP G: 14/14 lines JSON (`time, level, msg, …`): `health sidecar starting` (version/service/tenant/instance/endpoint/probe), `health target found`, `reported`, `health target gone; will rediscover`, `report failed; will retry` (with `in`), `report rejected`, `leaving report sent`, `health sidecar stopped`; no secret-looking strings; `ev/12`/`ev/13` logs for the error paths | |

## 4. Gaps

| ID | Severity | Feature IDs | Root cause (file:line) | How reproduced | Suggested fix | Test that should have caught it |
|---|---|---|---|---|---|---|
| GAP-sidecar-1 | minor (test health) | F-83, F-86 | `sidecar/deploy/deploy_test.go:18-20` `t.Skip("kustomize not on PATH")`; `:35-37` kubeconform absent → `t.Log` only | `PATH` without the tools (`ev/01`, last run): 3 of 4 deploy tests SKIP and the 4th passes without schema validation — in a CI image without kustomize the G-1-18 guard is silent | fail instead of skip when `CI` is set (or install both tools in the CI job and assert their presence) | the test itself: it should refuse to pass vacuously in CI |
| GAP-sidecar-2 | low (security hygiene; no finding known) | F-80 | `sidecar/Dockerfile:6` `go-toolset:1.24`, `go.mod:3` `go 1.24`; the image binary is go1.24.13 | `ev/40`: `govulncheck@latest` refuses Go 1.24 (`requires go >= 1.26.0`); `ev/41`: `@v1.1.4` runs but `vuln.go.dev` is 403 here → stdlib vulnerabilities fixed after the 1.24 line cannot be excluded in this sandbox | run `govulncheck ./...` in CI where the database is reachable; move to `go-toolset:1.25`/`1.26` when the platform offers it | a CI govulncheck step (none exists) |
| GAP-sidecar-3 | nit (ops) | F-80, F-89 | `sidecar/Dockerfile:19-22`: labels title/description/source only; `VERSION` reaches only `main.version` | `ev/41`: `docker inspect` labels have no `org.opencontainers.image.version`/`revision`, so registry UIs and scanners cannot tell builds apart | `LABEL org.opencontainers.image.version=${VERSION}` (+ `revision` from a build arg) | none (image metadata) |
| GAP-sidecar-4 | nit (docs) | F-88 | `sidecar/README.md:115-117` promises `app is not listening (last target …)` "on every probe"; `agent.go:150-170` (`observe`) reports the first failure as `GET …: connection refused` and only the next tick's `discover()` (`:181-203`) produces the documented message | `ev/10` STEP B: +4 s `DOWN … connection refused`, +7 s `app is not listening …` | say "from the next probe on", or let `observe()` emit the not-listening message when the port is already gone | `TestAppThatStopsListeningStaysDownUntilItIsBack` could assert the first message too |

Observations (not defects of the sidecar, recorded for the auditor and the other verifiers):

- **O-1 (backend/E2E, F-48):** a pod whose only reports were UNKNOWN (starting) and that vanishes without a leaving
  report is declared `DOWN (1 pod has not reported since …)` and opens an OUTAGE after the staleness window (`ev/14`
  F-48: `sc1-never-up` and `sc1-pinned` after their sidecars were SIGKILLed). This is the silence rule working as
  specified; whether a never-ready pod that disappears should alarm is a product decision for the backend owners.
- **O-2 (F-83):** the strategic-merge component inserts `health-sidecar` *first* in `initContainers` (before the app's
  own `db-migrate`). That is the "starts before the app" promise and harmless, but teams whose init containers must run
  before anything else should know; Helm consumers choose the position themselves (`ev/20` §4: after `db-migrate`).
- **O-3 (F-74):** heartbeats are evaluated on the probe tick, so the cadence is `CS_HEARTBEAT` rounded up to the next
  `CS_INTERVAL` (6.4–6.8 s for 6 s / 2 s). With the defaults (15 s / 30 s) the second DOWN report — the one that opens
  the notice — follows the first by 30 s, i.e. an app that dies in place is an OUTAGE about 30–45 s after the crash.
- **O-4 (hygiene):** `ev/scripts/variants.sh` CASE 8/9, inherited from iteration 0, posted a handful of reports to the
  **shared** backend `:8080` under tenants `sc-warn`/`sc-len` (iteration 0's own tenants); every other scenario used the
  private backend `:19300`. Nothing was stopped or deleted on the shared stack.

## 5. Not exercisable in this sandbox

- A real pod: kind cannot start (nested runc), so pods are Docker shared-network-namespace emulations; no kubelet
  (native-sidecar start/stop ordering, liveness restarts), no SCC admission (`restricted-v2` is emulated with
  `--user/--read-only/--cap-drop ALL/no-new-privileges` + default seccomp), no `oc apply --dry-run=server`.
- The UBI base images (`registry.access.redhat.com` 403): the shipped image size, the UBI CA bundle and the exact
  Red Hat Go build are unverified; the image was built with `local/go-toolset:1.24` and `gcr.io/distroless/static`.
- `govulncheck`: `vuln.go.dev` is 403 and the current tool needs Go ≥ 1.26 (`ev/40`, `ev/41`).
- Downward API semantics for a `fieldRef` to a missing label (F-82); the sidecar's fallback is verified on the host.
- A soak at the default cadence: the soak ran at 15× the default probe rate for ~9 minutes instead (`ev/31`).
