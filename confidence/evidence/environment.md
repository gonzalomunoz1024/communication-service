# Verification environment (sandbox facts, 2026-11-01)

Everything below was set up by the orchestrator before any verifier ran. Verifiers cite this file
for environment constraints; nothing here changes repository code.

## What exists here
- Ubuntu 24.04 cloud container, 4 CPU, 15 GB RAM, root. Java 21 (`/usr/bin/java`), Go 1.24.7, Node 22.23 / npm 10.9, Playwright CLI + Chromium at `/opt/pw-browsers`.
- Docker 29.9 daemon started by hand (`dockerd` in the background). Image pulls work for docker.io (rate-limited: 429 seen on `python:3.12-alpine`), gcr.io, ghcr.io. **Blocked by the egress policy (CONNECT 403):** registry.access.redhat.com, quay.io, registry.k8s.io, fastdl.mongodb.org, repo.mongodb.org, downloads.mongodb.com, get.helm.sh, kubernetesjsonschema.dev, github.com release downloads.
- Tools installed under `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/tools`: kubectl v1.37.2 (dl.k8s.io), kind v0.30.0, kustomize v5.5.0, helm v3.16.3, kubeconform v0.6.7 (all via `go install`).
- **kind does not work here**: `kind create cluster` hangs at "Starting control-plane"; the node's containerd cannot start any pod sandbox (`runc create failed: can't get final child's PID from pipe: EOF`, see `kind-create.log` and the kubelet journal). Nested containers are not supported by this VM. There is no OpenShift cluster either. Consequence: no `oc apply --dry-run=server`, no real Pod. Pod behaviour is emulated with Docker: an app container and the sidecar container joined to its network namespace (`--network container:app`), the sidecar running as an arbitrary UID with `--read-only --cap-drop ALL --security-opt no-new-privileges`.
- Maven Central (`repo.maven.apache.org`) answers HTTP 429 through the proxy, so `~/.gradle/init.d/central-mirror.gradle` prepends Google's Maven Central mirror for this sandbox only (not committed). `~/.gradle/gradle.properties` adds retry settings. Gradle runs with `--max-workers=2 --no-daemon`.
- Embedded MongoDB for `*IT` tests: flapdoodle wants `https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-7.0.14.tgz` (blocked). The `mongod` binary (7.0.45, Ubuntu 22.04 build, runs natively on this host) was copied out of the `mongo:7.0` Docker image and packed into flapdoodle's download cache at
  `~/.embedmongo/archives/https-fastdl-mongodb-org/.../archive.tgz`, so the integration tests run **unchanged** against a real mongod 7.0.45 instead of 7.0.14. No test or build file was modified for this.

## Running stack (shared by all verifiers; do not stop it)
| Piece | Where | How it was started |
|---|---|---|
| MongoDB 7.0 | container `mongo7`, host port 27017 | `docker run -d --name mongo7 -p 27017:27017 mongo:7.0` |
| Backend | http://localhost:8080 (Swagger UI /swagger-ui.html, OpenAPI /v3/api-docs) | `./gradlew bootJar` then `java -jar build/libs/communication-service-0.0.1-SNAPSHOT.jar` (copy at `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service.jar`, log `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/logs/backend.log`), default `application.yml` |
| Frontend dev server | http://127.0.0.1:3000 (proxies /v1 to :8080) | `cd frontend && npm ci && npm run dev -- --host 127.0.0.1` (log `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/logs/frontend-dev.log`) |
| Fake app ("main container") | container `app`, image `fakeapp:ci` (Go, distroless, UID 1001), host port 127.0.0.1:18080 → 8080 | serves `/actuator/health` (503 + status when not UP), `/`; `POST /__set?status=DOWN&db=DOWN` flips its health |
| Sidecar | container `sidecar`, image `health-sidecar:ci`, shares `app`'s network namespace, `--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges` | env: CS_ENDPOINT=http://172.17.0.1:8080 (the Docker bridge gateway = this host), CS_TENANT=podtest, CS_SERVICE=fake-app, CS_CLIENT_ID=fakeapp-repo, POD_NAME=fake-app-7f9c6d5b4-x2k4q, POD_NAMESPACE=podtest-ns, NODE_NAME=worker-1, CS_CLUSTER=sandbox, CS_VERSION=1.0.0 |

The sidecar image was built with the repository's own `sidecar/Dockerfile` and two build args because the UBI registry is blocked: `GO_IMAGE=local/go-toolset:1.24` (golang:1.24 plus the UBI CA bundle path, Dockerfile in `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/gotoolset`) and `BASE_IMAGE=gcr.io/distroless/static-debian12:latest`. `USER 1001`, entrypoint and `EXPOSE 9465` come from the repository Dockerfile unchanged. Verifiers should state that the UBI base itself was not exercised.

## Baseline the orchestrator observed before verification (not scores)
- `./gradlew test`: 164 tests, 0 failures (`/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/logs/gradle-unit-test-1.log`, `build/test-results/test`).
- `./gradlew integrationTest --tests '*MongoHealthInstanceRepositoryAdapterIT'`: passes with the seeded mongod (`/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/logs/gradle-it-probe3.log`).
- frontend: `npm run typecheck`, `npm run build`, `npm test` (23 tests) all exit 0 (`/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/logs/frontend-baseline.log`).
- sidecar: `go vet ./...` and `go test ./...` pass (`confidence/evidence/phase0-sidecar-go-test.txt`).
- sidecar in the emulated pod: discovered `http://127.0.0.1:8080/actuator/health`, reported UP, backend auto-registered monitor (podtest, fake-app).

Scratchpad root for logs: `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/logs`.

## Iteration 1 stack (from 2026-11-02 01:05Z)
The shared stack now runs the fixed code: backend jar built from the merged branch (Spring Boot 3.5.16, Actuator
probes at `/actuator/health/{liveness,readiness}`), frontend dev server restarted on the fixed `frontend/` (new
`vite.config.ts` proxy drop handler), sidecar image `health-sidecar:ci` rebuilt (`version=ci-iter1`) and the pod
`app`+`sidecar` recreated. Same ports and container names as before. Jar copy: `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter1.jar`.

## E2E verifier private stack (iteration 1, 2026-11-02 01:30–02:02Z, torn down afterwards)
Backend A `:19501` and B `:19502` from `scratchpad/communication-service-iter1.jar` on Mongo db `e2e1` (sweep 2 s,
health sweep 1 s, stale grace 0), Vite `:3501` → A, emulated pod `e2e1-netns` (host 19601→8080, 19602→9465) +
`e2e1-app` (`fakeapp:ci`) + `e2e1-sidecar` (`health-sidecar:ci` = `ci-iter1`, UID 1000660000, read-only, cap-drop ALL,
`CS_INTERVAL=3s CS_HEARTBEAT=10s CS_RETRY_DELAY=1s CS_STARTUP_GRACE=30s`, `POD_NAME=e2e1-app-6d4f8b7c9-ab12c`).
Temporary: `e2e1-pod2/app2/sidecar2` (19611–19613), `e2e1-sidecar3` (capture) and a stub on `:19620`. Scripts and
outputs: `confidence/evidence/iter-1/e2e/`.

## Iteration 2 stack (from 2026-11-02 03:52Z)
Code at `908598a` (24 iteration-2 fix commits merged). Backend jar rebuilt from the merged branch and started on :8080
(copy `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter2.jar`,
log `.../scratchpad/logs/backend-iter2.log`); frontend `npm ci` on the merged `frontend/` (minimatch override) and the dev
server restarted on :3000 (log `.../logs/frontend-dev-iter2.log`); sidecar image `health-sidecar:ci` rebuilt
(`version=ci-iter2`, `revision=6fd1088`, built with `GO_IMAGE=local/go-toolset:1.25` because the sidecar now needs Go 1.25);
pod `app` (+ host port 127.0.0.1:19465 → the sidecar's :9465) and `sidecar` recreated with the same env as before.
New in the repository: `Dockerfile` (backend image from the prebuilt jar), `e2e/` (docker compose project `e2e` on ports
28030/28080/28090/28091 and a Playwright 1.63 suite), `.github/workflows/{ci,e2e}.yml`. The host `go` is 1.24.7; `go.mod`
selects go1.25 through the module proxy automatically.

## Iteration 3 stack (from 2026-11-02 06:35Z)
Code at `4a0e84e` (37 iteration-3 commits merged; `6079180` adds only `iter-3/fixes.md` and the fixers' evidence). Backend jar
built from that code (copy `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter3.jar`,
log `.../scratchpad/logs/backend-iter3.log`) and started on :8080; the frontend dev server on :3000 serves the merged
`frontend/` (no dependency change, so no `npm ci`); sidecar image `health-sidecar:ci` rebuilt (`version=ci-iter3`,
`revision=4a0e84e`, `GO_IMAGE=local/go-toolset:1.25`, `BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot`); pod `app`
(+ 127.0.0.1:19465 → the sidecar's :9465) and `sidecar` recreated with the same environment as before. The e2e suite's
images build with `GO_IMAGE=go-toolset:e2e` (a local golang:1.25 with the CA bundle at the UBI path; recipe in `e2e/README.md`)
and `BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot`; the suite's jar is `build/libs/*.jar` (copy the iteration-3 jar
there if `build/libs/` is empty) and its bundle `frontend/dist` (`npm run build`).

## Iteration 4 stack (from 2026-11-02 10:05Z)
Code at `1cd3f13` (37 iteration-4 commits; `ec4cfcb` adds only `iter-4/fixes.md` and the gate evidence). Backend jar built from
that code with Spring Boot 4.0.9 (copy `/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter4.jar`,
sha256 `64e07ece…`, the same bytes as `build/libs/communication-service-0.0.1-SNAPSHOT.jar`; log `.../scratchpad/logs/backend-iter4.log`)
started on :8080 against `mongo7` (database `communication`; `--spring.data.mongodb.uri=` still works, and Boot 4's own key is
`spring.mongodb.uri`); the frontend dev server on :3000 serves the merged `frontend/` (no dependency change); `frontend/dist`
rebuilt from it. Sidecar image `health-sidecar:ci` rebuilt (`version=ci-iter4`, `revision=ec4cfcb`,
`GO_IMAGE=local/go-toolset:1.27` (golang:1.27.3 with the CA bundle at the UBI path, recipe in `e2e/README.md`),
`BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot`); pod `app` (+ 127.0.0.1:19465 → the sidecar's :9465) and `sidecar`
recreated with the same environment as before. At 10:14:47Z the orchestrator's mistaken `docker exec sidecar health-sidecar
-version` (the binary has no such flag and started a second agent) sent one extra report and, when stopped, a leaving report for
`fake-app-7f9c6d5b4-x2k4q`; the pod's next heartbeat at 10:15:01Z made it present and UP again. Do not exec the sidecar binary
in the shared pod. Trivy's database for everybody: `.../scratchpad/orch-trivy/cache/trivy` (mount it at `/root/.cache/trivy`,
`--skip-db-update`, under `flock .../scratchpad/orch-trivy/.lock`; database of 2026-11-02 01:14Z).
