# End-to-end suite

The one place where the three parts of this repository are tested together: a real browser on the
frontend's production bundle, the backend in its container, and the health sidecar probing a fake
publisher app from inside that app's network namespace, the way the two containers share one in a
pod. Playwright drives the browser and the stack; `docker compose` runs the stack.

```
Chromium ──► Vite preview :28030 ──/v1──► e2e-backend :28080 ──► e2e-mongo
(Playwright)  (frontend/dist)              ▲
                                           │ POST /v1/health/reports
                                 ┌─────────┴────────────────────────────┐
                                 │ e2e-app :28090 ◄── probe ── e2e-sidecar │  one network namespace
                                 │ (fake app, /actuator/health, /__set)   │  (network_mode: service:app)
                                 └────────────────────────────────────────┘
```

## Run it locally

Needs Docker with compose v2, Java 21, Node 22 and curl. The images are built from artefacts you
build first, so nothing is downloaded inside `docker build` but the base images.

```sh
./gradlew bootJar                            # the jar the backend image copies (root Dockerfile)
( cd frontend && npm ci && npm run build )   # the bundle the suite serves
cd e2e
npm ci                                       # @playwright/test 1.63.0, pinned
npx playwright install chromium              # once per machine, unless a matching Chromium is installed already
./stack.sh up                                # builds the images, starts the stack, waits until the pod reports UP
npx playwright test                          # about a minute
./stack.sh down                              # removes containers, network and volumes
```

`npx playwright show-report` opens the HTML report; a failed test keeps its trace under `test-results/`
(`npx playwright show-trace <file>.zip`). `./stack.sh logs` prints every container's log.

The sidecar image names the commit under test: `stack.sh` passes `VERSION` (`git describe --tags
--always`) and `REVISION` (`git rev-parse HEAD`) to the sidecar's `Dockerfile`, which writes them into
the `org.opencontainers.image.version` and `.revision` labels and into the binary's version (set either
variable to override it). Where Red Hat's registry is unreachable, build the sidecar from substitutes: a
stand-in for `ubi9/go-toolset` at the Go release of `sidecar/go.mod` (1.25) that has the CA bundle at
the UBI path the `Dockerfile` copies from, and distroless instead of UBI micro. The variables reach the
`Dockerfile`'s build args; unset, its own defaults apply.

```sh
docker build -t go-toolset:e2e - <<'EOF'
FROM golang:1.25
RUN mkdir -p /etc/pki/ca-trust/extracted/pem \
 && cp /etc/ssl/certs/ca-certificates.crt /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem
EOF
GO_IMAGE=go-toolset:e2e BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot ./stack.sh up
```

`golang:1.25` by itself compiles the sidecar but fails the image build at that `COPY`;
`mirror.gcr.io/library/golang:1.25` is the same image when Docker Hub rate-limits.

## What each test proves

| File | Matrix rows | What passes means |
| --- | --- | --- |
| `tests/01-api-contract.spec.ts` | F-27, F-09, F-92 | against the containerised backend: a `/v1` call without `X-Client-Id` is a 401 with an `{error}` body; a reused `externalRef` is a 409 with an `{error}` body (the wording is not asserted); `/actuator/health/readiness` answers 200 without a client id |
| `tests/02-f90-publish-live-resolve.spec.ts` | F-90 | a person sets the tenant in the header, publishes an outage through the form (the UI sends `X-Client-Id: communication-frontend`, gets 201); a second tab that was already on the feed shows the card **over the stream**: it was not reloaded (a window marker survives) and did not fetch `/v1/feed` again; "View in feed" lands on the card; Resolve with a note sends the retire, the card leaves both tabs (the second one through the `retired` frame), the resolution is announced in a live region, `GET /v1/feed` no longer lists it and the permalink says RETIRED |
| `tests/03-f91-sidecar-auto-notice.spec.ts` | F-91 | the pod was auto-registered (push-only monitor, publisher `health-sidecar`); `stack.sh app-set DOWN DOWN` turns into an OUTAGE card ("fakeapp is down", MAJOR, service tag, publisher, the pod named in the body) in the open feed within 15 s, with the instance record DOWN; `app-set UP UP` retires it and the card leaves within 15 s; the monitor is UP again with nothing open and `/instances` lists `fakeapp-0` |
| `tests/04-f92-backend-restart.spec.ts` | F-92, F-61, F-20 | with the feed open, `stack.sh restart-backend` makes the badge say *Reconnecting*; a reopen request carries `?lastEventId=<last seq>`; a notice published over HTTP once the backend is ready appears without a reload while the page heals itself back to *Live*, and the notice from before the restart is still there |

The flows run one at a time, in file order (`workers: 1`), because they share one stack and the last
one restarts its backend. Every title carries its matrix id, so the HTML report reads like the matrix.

## The stack

`docker-compose.yml`, project and network `e2e`, everything on `127.0.0.1`:

| Container | Image | Port | Role |
| --- | --- | --- | --- |
| `e2e-mongo` | `mongo:7.0` | | database `e2e`; a `mongosh` healthcheck gates the backend's start |
| `e2e-backend` | `communication-service:e2e` (root `Dockerfile` over `build/libs/*.jar`) | 28080 → 8080 | the service, `SPRING_DATA_MONGODB_URI=mongodb://e2e-mongo:27017/e2e` |
| `e2e-app` | `fakeapp:e2e` (`fakeapp/`) | 28090 → 8080, 28091 → 9465 | the publisher team's app: `/actuator/health` says what `POST /__set?status=&db=` last set; 9465 is the sidecar's `/status`, reachable here because the sidecar lives in this container's network namespace |
| `e2e-sidecar` | `health-sidecar:e2e` (`../sidecar`) | | `network_mode: service:app`; arbitrary UID, read-only root filesystem, no capabilities, as under the `restricted-v2` SCC; `CS_TENANT=e2e`, `CS_SERVICE=fakeapp`, `POD_NAME=fakeapp-0` |

The UI is not a container: Playwright's `webServer` runs `npm run preview` in `../frontend` on
port 28030 with `COMM_BACKEND=http://127.0.0.1:28080`, so the browser gets the built bundle from one
origin and `/v1` through Vite's proxy, which is the same proxy (SSE drop handler included) the dev
server uses: when the backend dies mid-stream the browser's connection is ended, as a production
reverse proxy would end it, which is what F-92 depends on.

`stack.sh`:

| Command | Does |
| --- | --- |
| `build` | checks the jar exists, then `docker compose build` with `VERSION` and `REVISION` set as above |
| `up` | checks `frontend/dist` exists, `build`, starts the backend (and Mongo) first and waits for its readiness probe, then the pod, then waits until the fake app answers UP, the sidecar has sent a report and the backend lists monitor `e2e/fakeapp` as UP. Starting the backend first keeps the sidecar's first report from entering its send backoff |
| `down` | `docker compose down -v --remove-orphans` |
| `restart-backend` | `docker compose restart backend`, then waits for readiness again; the tests run it in the background so they can watch the page meanwhile |
| `app-set <status> <db>` | `POST /__set` on the fake app |
| `logs` | all container logs with timestamps |

Every wait gives up after `E2E_WAIT_SECONDS` (default 150) and prints `docker compose ps`.

## Settings and why

- **Sidecar cadence** `CS_INTERVAL=2s`, `CS_RETRY_DELAY=500ms`, `CS_HEARTBEAT=4s` (defaults 15 s / 2 s / 30 s).
  The service opens a notice after `failureThreshold` observations and the sidecar re-sends an
  unchanged status only at the heartbeat, so with the defaults a DOWN app becomes an OUTAGE about
  45 s after it fails. Here: a probe within 2 s, the second look 0.5 s later, the change report, the
  next heartbeat at the first 2 s tick 4 s on, the backend's 500 ms fan-out poll: a card in the feed
  within about 9 s (8.5 s measured), and recovery the same way (6.3 s measured). The tests allow 15 s.
- **Thresholds** `COMMUNICATION_HEALTH_DEFAULTS_FAILURETHRESHOLD=2`, `..._RECOVERYTHRESHOLD=2` on the
  backend: the service's own defaults, pinned because the 15 s budget is written for exactly two
  observations; a changed default would otherwise stretch the budget silently. F-91 asserts the
  monitor's policy carries them.
- **`CS_STARTUP_GRACE=30s`** (default 5 m): the sidecar reports UNKNOWN until the app has answered UP
  once; the fake app answers UP at once, so the grace is never used, and 30 s bounds a broken start.
- **`POD_NAME=fakeapp-0`, `POD_NAMESPACE=e2e`, `NODE_NAME=local`**: what the Downward API would set;
  F-91 looks for `fakeapp-0` in the notice body and in `/instances`.
- **Mongo healthcheck** every 2 s: the backend only starts once Mongo answers `ping`, so its readiness
  probe is UP as soon as the JVM is (about 12 s here).
- **Playwright** `workers: 1`, `retries: 0` (a flaky end-to-end test is a finding, not noise),
  `timeout: 120 s` per test (F-92 needs the restart plus up to one 30 s reopen backoff), `trace:
  retain-on-failure`, `screenshot: only-on-failure`, reporters `list` and `html` (never opened by
  itself). The suite identifies itself to the API as `X-Client-Id: e2e-suite`; the browser as
  `communication-frontend`, which F-90 checks.

## In CI

`.github/workflows/e2e.yml` runs on pushes to `main` and on pull requests (`permissions: contents:
read`, 30 minute timeout): Java 21 and Node 22, `./gradlew bootJar`, `npm ci && npm run build` in
`frontend/`, then in `e2e/` `./stack.sh build` (the sidecar's image labelled with the commit), `npm ci`,
the type-check, `npx playwright install --with-deps chromium`, `./stack.sh up`, `npx playwright test`,
and `./stack.sh down` whatever happened. On failure it prints the stack's logs and uploads
`playwright-report/` and `test-results/` (traces, screenshots) as the artifact `e2e-report`.
