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
