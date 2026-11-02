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
npx playwright test                          # under two minutes
./stack.sh down                              # removes containers, network and volumes
```

`npx playwright show-report` opens the HTML report; a failed test keeps its trace under `test-results/`
(`npx playwright show-trace <file>.zip`). `./stack.sh logs` prints every container's log.
`npm run typecheck` and `npm run lint` are the suite's static checks: the lint is ESLint with the
frontend's base (the recommended JavaScript and typescript-eslint rules) plus eslint-plugin-playwright's
recommended set (unawaited calls, conditional or standalone expects, focused or skipped tests, fixed
waits), and a warning fails it like an error (`eslint.config.mjs`).

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
| `tests/04-f92-backend-restart.spec.ts` | F-92, F-61, F-20 | with the feed open, `stack.sh restart-backend` makes the badge say *Reconnecting*; a reopen request carries `?lastEventId=<last seq>`; the test holds the page's next reopen until a notice published over HTTP once the backend is ready has been fanned out (a stream the test reads itself received it live), so the page can only get it from the replay of the event log: one `created` frame, numbered after that seq, on the stream resumed with `?lastEventId=`, which sends no snapshot frame (the test reads the page's frames over the DevTools protocol and waits up to 10 s for that one), with at most one `GET /v1/feed` (the page's own reload after a reconnect, which by itself would also show the card); the page heals itself back to *Live* without a reload, and the notice from before the restart is still there |
| `tests/05-f76-sidecar-sigterm.spec.ts` | F-76, F-48, F-91 | `stack.sh stop-sidecar` sends the sidecar SIGTERM, as the kubelet does on a pod deletion: it logs `leaving report sent` and exits 0; the backend keeps pod `fakeapp-0` under monitor `e2e/fakeapp` marked `left: true` with the message `instance shutting down`, and opens no notice, since a service whose pods all left cleanly was scaled down, not broken; `stack.sh start-sidecar` starts a new process and the pod is UP and no longer left |
| `tests/06-f39-pull-monitor.spec.ts` | F-31, F-37, F-39, F-40, F-41 | a pull monitor registered over HTTP (tenant `e2e-pull`, `url` the fake app's `/actuator/health` on the compose network, `intervalSeconds: 5`, thresholds 2 and 2) answers 201 with its `Location` and the default policy (publisher `health-monitor`, MAJOR / MINOR); the backend's scheduler probes it: `app-set UP DOWN` reads as DEGRADED (status UP, `db` DOWN), one probe publishes nothing, the second opens a HEALTH notice (MINOR, "… is degraded", the `db` component in the body, `externalRef` `health:<monitorId>:1`); `app-set DOWN DOWN` restarts the streak, the HEALTH notice stands after one DOWN probe and the second puts an OUTAGE (MAJOR, "… is down", `health:<monitorId>:2`) in its place and retires it; `app-set UP UP`: one UP probe keeps the OUTAGE, the second retires it. The monitor is deleted (204) at the end, and the test waits until the sidecar's own monitor, which saw the same flips, has nothing open |
| `tests/07-f92-database-down.spec.ts` | F-92, F-57 | with a page on the feed, `stack.sh stop-mongo`: `GET /v1/feed` answers 503 `{"error":"database unavailable"}` within 8 s (the service's 5 s database timeout); a page opened meanwhile shows *Couldn't load the feed* with that reason and *Try again*; the page that was open keeps its cards, says *Live* and neither reopened its stream nor fetched the list; the database stays stopped until the late page has requested its stream three times, and all that time the late page keeps the database reason on screen and its badge never says *Live*: a MutationObserver in that page records every change of the badge and of the error state from its first document on, so a state that showed for a moment counts, and the test prints the record; `stack.sh start-mongo`, with nobody restarting or clicking anything: the late page shows the feed and says *Live* by itself, in the same document, and the open page's stream, open all along, carries the next notice without a reload |

The flows run one at a time, in file order (`workers: 1`), because they share one stack and change
it on purpose: 03 and 06 flip the fake app's health (the sidecar watches it in both), 04 restarts the
backend, 05 stops the sidecar and 07 the database; each puts it back before it ends, also when it
fails. Every title carries its matrix id, so the HTML report reads like the matrix.

Timings here, over three runs of the whole suite (1.7 to 1.8 minutes each; the budget is 3), except
07's, which is from one run since it waits for the late page's retries (about 20 s more):

| Test | Took | Where the time goes |
| --- | --- | --- |
| 01, 02 | under 6 s | |
| 03 | 11 to 14 s | the sidecar cadence (below): the card 5 to 6.5 s after `app-set DOWN DOWN`, gone about 6 s after `app-set UP UP`; 15 s allowed for each |
| 04 | 22 to 27 s | the backend restart, 19 to 23 s; then the publish, the test's own stream seeing it fanned out (the fan-out polls every 500 ms) and the held reopen let in: the card 2 to 3 s after the backend is ready |
| 05 | 2 s | the sidecar exits 0.6 to 0.8 s after SIGTERM; the backend marks the pod left at once |
| 06 | 34 to 36 s | three flips, each confirmed by a second probe 5 s after the first: the HEALTH notice, the OUTAGE and the retirement each come about 10 s after their flip; 20 s allowed for each |
| 07 | about 45 s | the 503 waits for the 5 s database timeout, and so does the late page's own list request (its error state shows 10.5 to 11 s into the outage); the late page's third stream request comes about 13 s after it opened (each attempt waits for the service's answer, 5 s, then the page's 1 s and 2 s backoff steps); `start-mongo` takes about 10 s, so the backend is ready again about 30 s after the database stopped; the late page recovers at its next backoff step, up to about 12 s later, and the notice published then reaches the open page at once |

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
| `stop-mongo` | `docker compose stop mongo`; the backend keeps running and answers 503 until the database is back |
| `start-mongo` | `docker compose start mongo`, then waits for the backend's readiness probe |
| `stop-sidecar` | `docker compose stop -t 15 sidecar`: SIGTERM, as on a pod deletion (SIGKILL after 15 s); then prints the sidecar's exit code and what it logged meanwhile |
| `start-sidecar` | `docker compose start sidecar` (back in the app's network namespace), then waits until it has sent a report |
| `logs [service...]` | the named containers' logs, all of them by default, with timestamps |

Every wait gives up after `E2E_WAIT_SECONDS` (default 150) and prints `docker compose ps`.

## Settings and why

- **Sidecar cadence** `CS_INTERVAL=2s`, `CS_RETRY_DELAY=500ms`, `CS_HEARTBEAT=4s` (defaults 15 s / 2 s / 30 s).
  The service opens a notice after `failureThreshold` observations in a row and retires it after
  `recoveryThreshold`, two each here. The sidecar probes every interval (plus up to a fifth of it at
  random), probes once more `CS_RETRY_DELAY` after an answer that is not UP, sends a change at once,
  re-sends a DOWN or degraded report after every probe and an unchanged UP report only at the heartbeat
  ([What it reports and when](../sidecar/README.md#what-it-reports-and-when)): the second DOWN
  observation comes one probe after the first, the second UP one heartbeat after the first. With the
  defaults a DOWN app becomes an OUTAGE 19 to 34 s after it fails (40 s at most with the random part),
  and the notice retires 30 to 45 s after the app recovers (54 s at most). Here: a probe within 2.4 s
  and the second look 0.5 s later send the first DOWN report, the next probe the second, 2.5 to 2.9 s
  later (2.85 s measured), and the backend's 500 ms fan-out poll adds the rest: the card 5 to 6.5 s
  after `app-set DOWN DOWN`. After `app-set UP UP` the first UP report goes out within 2.4 s and the
  second at the heartbeat, 4 to 4.8 s later (4.5 s measured): the card is gone about 6 s after. The
  tests allow 15 s for each.
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
  `timeout: 120 s` per test (F-92 waits for a backend restart, 13 to 28 s here, plus at most one
  10 s reopen backoff), `trace: retain-on-failure`, `screenshot: only-on-failure`, reporters `list`
  and `html` (never opened by itself). The suite identifies itself to the API as `X-Client-Id:
  e2e-suite`; the browser as `communication-frontend`, which F-90 checks.

## In CI

`.github/workflows/e2e.yml` runs on pushes to `main` and on pull requests (`permissions: contents:
read`, 30 minute timeout): Java 21 and Node 22, `./gradlew bootJar`, `npm ci && npm run build` in
`frontend/`, then in `e2e/` `./stack.sh build` (the sidecar's image labelled with the commit), `npm ci`,
the type-check, the lint, `npx playwright install --with-deps chromium`, `./stack.sh up`, `npx playwright
test`, and `./stack.sh down` whatever happened. On failure it prints the stack's logs and uploads
`playwright-report/` and `test-results/` (traces, screenshots) as the artifact `e2e-report`.
