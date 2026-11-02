# health-sidecar

A container that publisher teams attach to their OpenShift pods so the communication service
learns about their outages with **no code change on their side**. It finds the app in the pod,
probes it over localhost every 15 seconds, and pushes the result to
`POST /v1/health/reports`, where the service rolls all pods of a service into one status,
debounces it and publishes OUTAGE / HEALTH notices exactly like human-published ones.

```
pod ─────────────────────────────────────────────────┐
│  app container          health-sidecar             │        communication service
│  :8080 /actuator/health ◄── probe (localhost) ──┐  │   ┌──────────────────────────────┐
│                                                 └──┼──►│ /v1/health/reports           │
│                         POD_NAME, NODE_NAME ...    │   │ per-pod record → rollup →    │
└────────────────────────────────────────────────────┘   │ debounce → OUTAGE / HEALTH   │
                                                         └──────────────────────────────┘
```

- about 10 MB image on UBI micro, 16 Mi memory request, runs under the `restricted-v2` SCC
- no Kubernetes API access, no RBAC, no secrets: identity comes from the Downward API
- the app's language does not matter; Spring Boot apps get dependency detail, anything with an
  HTTP endpoint gets UP / DOWN, anything else gets a TCP check

## Attach it

Pick one. The team's own manifests do not change in the first two.

| Path | What the team does |
| --- | --- |
| **Kustomize** ([deploy/kustomize](deploy/kustomize)) | adds `components: [<component path>]` to its kustomization and a `cs-health-sidecar` ConfigMap in the app's namespace with `CS_ENDPOINT`, `CS_TENANT` and, optionally, `CS_CLUSTER` ([example](deploy/kustomize/example)) |
| **Helm** ([deploy/helm/cs-health-sidecar](deploy/helm/cs-health-sidecar)) | adds the library chart as a dependency, `{{ include "cs-health-sidecar.container" . }}` under `containers`, and `csHealthSidecar.endpoint` / `.tenant` in values |
| **Plain YAML** ([deploy/manual/deployment.yaml](deploy/manual/deployment.yaml)) | pastes the container block |

Whichever path, the two values every team needs are `CS_ENDPOINT` (the communication service's
Route, e.g. `https://communication.apps.example.com`) and `CS_TENANT`: the tenant id the service
groups notices under, the same value the dependent systems pass as `/v1/feed?tenantId=`. Tenants
are assigned by the communication-service owners when a team is onboarded; ask them for yours
rather than inventing one, because a notice under an unknown tenant reaches nobody.

The chart is a Helm *library* chart: `helm template` on it alone fails by design ("library
charts are not installable"). Render it through the consuming chart (`helm template my-app ./my-app`
after adding the dependency and the `include`), which is also where `helm lint` runs.

On OpenShift 4.16+ (Kubernetes 1.29+) prefer the native sidecar form (an init container with
`restartPolicy: Always`): it starts before the app, stops after it, and never keeps a Job
alive. Both Kustomize and Helm offer it: the
[`deploy/kustomize/component-native`](deploy/kustomize/component-native) component (a
strategic-merge patch, so init containers the app already has are kept) and
`cs-health-sidecar.initContainer`.

A mutating admission webhook that injects the container on a single pod annotation is the
planned next step; the container and its configuration stay the same.

## Image

`registry.example.com/platform/health-sidecar:1.0.0` in the snippets is a placeholder: there is no
public image. The platform team builds it once from this directory (see [Build](#build)) and pushes
it to the organisation's registry, and every team points the snippet at that image:

```yaml
# Kustomize: in the app's kustomization.yaml, next to components:
images:
  - name: registry.example.com/platform/health-sidecar
    newName: registry.apps.example.com/platform/health-sidecar
    newTag: "1.0.0"
```

```yaml
# Helm: in the consuming chart's values.yaml
csHealthSidecar:
  image:
    repository: registry.apps.example.com/platform/health-sidecar
    tag: "1.0.0"
```

For plain YAML, edit the `image:` line of the pasted container block. Pin a tag; the snippets use
`imagePullPolicy: IfNotPresent`.

## How it finds the app

With nothing configured (`CS_PROBE=auto`):

1. Lists the listening TCP ports in the pod from `/proc/net/tcp` (containers in a pod share
   one network namespace), skipping its own port and service-mesh admin ports (15000-15099).
2. Tries `GET /actuator/health` on each port, lowest first. A JSON document with a `status`
   is accepted whatever the status says, so a Spring app whose database is down is still found.
3. Tries `/health`, `/healthz`, `/readyz`, `/ready`, `/livez`, `/q/health`: a 2xx/3xx or a
   health document wins.
4. Tries `/`: any answer below 500 proves the server is up (a 404 counts).
5. Falls back to a TCP connect on the lowest port.

The first target that answers is kept. If its port disappears (the app restarted on another
one), discovery runs again. HTTPS is tried when a port wants TLS; localhost certificates are
not verified.

Spring Boot teams who want the dependency detail (which database or queue is down) in their
notices add one property, which is configuration, not code:

```yaml
management.endpoint.health.show-details: always
```

## What it reports and when

- Every 15 s (`CS_INTERVAL`) it probes; a non-UP answer is probed once more after 2 s before it
  counts, so a GC pause or a restart in progress is not an outage.
- What is sent when:
  - a change of the status, of the components that are not UP or of the message is sent at once;
  - while the service counts the report as DOWN or DEGRADED, it is sent after every probe: a
    status other than UP and UNKNOWN (DOWN, a degraded status), or UP with a failing component,
    nested ones included (DOWN, `OUT_OF_SERVICE` or another word such as `WARN`), which the
    service classifies as DEGRADED. Its `failureThreshold` of consecutive observations is then
    reached one probe interval after the first failure, not one heartbeat later;
  - an UP report whose components are all UP (or UNKNOWN), and an UNKNOWN report, are repeated
    only as a heartbeat every 30 s (`CS_HEARTBEAT`). The service ignores UNKNOWN, so a pod that
    never becomes UP costs no more requests than a healthy one.

  1,000 healthy pods, or 1,000 that never become UP, are about 33 requests/s; 1,000 failing
  ones about 67.
- Until the app has answered UP once, and for at most 5 minutes (`CS_STARTUP_GRACE`), it
  reports UNKNOWN, which the service ignores: slow starts and rolling deploys never open notices.
  The same applies to a service that boots unhealthy (its endpoint answers but never UP): it is
  invisible for the whole grace, then its real status flows. A pinned target (`CS_PORT`) that
  never answers UP stays UNKNOWN after that, with a message pointing at the configuration,
  because a wrong port is far more likely than an outage.
- Once the app has been UP, an app that stops listening (crashed, crash-looping, killed by its
  liveness probe) is DOWN, reported as `app is not listening (last target …)` from the probe
  that finds its port gone and on every probe after it, until it listens again; it is then
  rediscovered and reported UP. (A pinned `CS_PORT` is never dropped, so its report keeps the
  probe's own error, e.g. `connection refused`.)
- On SIGTERM it sends one last report with `instance.leaving: true`, so the pod drops out of
  the service's rollup at once instead of looking dead for the staleness window (90 s).
- If the communication service is unreachable it keeps only the latest status and retries
  with exponential backoff up to 60 s. The app never depends on the sidecar.

The report body is Actuator's vocabulary plus the instance:

```json
{
  "tenantId": "retail", "service": "payments-api", "status": "UP",
  "components": { "db": { "status": "UP" } },
  "observedAt": "2026-11-01T22:30:00Z", "publisher": "health-sidecar",
  "instance": { "id": "payments-api-7f9c6d5b4-x2k4q", "namespace": "retail-payments",
                "node": "worker-3", "cluster": "ocp-east", "version": "1.4.2", "sidecar": "1.0.0" }
}
```

`X-Client-Id` carries `CS_CLIENT_ID` (defaults to the service name).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CS_ENDPOINT` | required | communication service base URL (the Route), `http://` or `https://` |
| `CS_TENANT` | required | tenant id the notices are published under: the value dependent systems use on `/v1/feed?tenantId=`, assigned by the communication-service owners |
| `CS_SERVICE` | `app.kubernetes.io/name` label (set by the snippets), else derived from the pod name | service name in reports; one monitor per (tenant, service) |
| `CS_CLIENT_ID` | `CS_SERVICE` | `X-Client-Id` header (the repository name) |
| `CS_PUBLISHER` | `health-sidecar` | publisher name the auto-registered monitor and its notices carry |
| `CS_CLUSTER` | empty | cluster name in the instance (optional) |
| `CS_PROBE` | `auto` | `auto`, `actuator`, `http` or `tcp` |
| `CS_PORT`, `CS_PATH`, `CS_SCHEME` | discovered | pin the target; `CS_PORT` is required for a non-auto mode |
| `CS_HOST` | `127.0.0.1,::1` | addresses tried for the app |
| `CS_IGNORE_PORTS` | `15000-15099` | ports discovery skips, e.g. `15000-15099,9090` |
| `CS_INTERVAL` / `CS_HEARTBEAT` | `15s` / `30s` | probe cadence / resend cadence while nothing changes and the report is UP with no failing component, or UNKNOWN (a DOWN or degraded report is sent every probe, see [What it reports and when](#what-it-reports-and-when)) |
| `CS_PROBE_TIMEOUT` / `CS_REPORT_TIMEOUT` | `3s` / `5s` | per probe / per report |
| `CS_STARTUP_GRACE` | `5m` | UNKNOWN until the first UP, at most this long |
| `CS_RETRY_DELAY` | `2s` | second probe before a non-UP answer counts |
| `CS_LISTEN` | `:9465` | the sidecar's own `/healthz` and `/status` |
| `CS_CA_FILE` | empty | extra PEM CA bundle for the endpoint (an internal CA); the image carries the UBI bundle |
| `CS_INSECURE_SKIP_VERIFY` | `false` | skip TLS verification to the endpoint (local experiments only): `true` or `false`, also `1`/`0`, `yes`/`no`, `on`/`off` in any case |
| `POD_NAME`, `POD_NAMESPACE`, `NODE_NAME`, `CS_VERSION`, `CS_INSTANCE_ID` | Downward API | instance identity |

A value the sidecar cannot use (a required variable missing, an unknown mode or scheme, a
duration, port or boolean it cannot read) stops it at start with exit code 2 and one ERROR line,
`invalid configuration`, that names every such variable at once; a `CS_CA_FILE` it cannot read
stops it the same way, as `cannot build report client`.

`GET :9465/status` shows the discovered target, the last probe result, the last report sent and
the last send error, which is the first place to look when a service does not show up.

## Debugging: "my service does not show up"

The image has no shell or curl, so read the sidecar from outside the pod:

```bash
oc logs <pod> -c health-sidecar                 # JSON lines: target found, reported (each change), report failed
oc port-forward <pod> 9465:9465 &
curl -s localhost:9465/status | jq .
```

A `reported` line is logged at INFO when the status, the failing components or the message
change (UP → DOWN, DOWN → UP, a new cause); the sends in between (heartbeats, and the sends
repeated after every probe while the report is DOWN or degraded) are logged at DEBUG, below the
default level, so a dead app shows as one DOWN line and then its recovery.

`/status` answers with:

| Field | Meaning |
| --- | --- |
| `version`, `service`, `tenant`, `instance` | what this sidecar is: its build version and the service, tenant and pod name it reports under; the first check when reports land under the wrong name |
| `target` | where the app is probed; absent while discovery is still running |
| `lastTarget` | the last target probed; kept while `target` is absent because the app stopped listening |
| `upSeen` | whether the app has answered UP since the sidecar started (before that, reports are UNKNOWN) |
| `lastReport` | the last report composed (status, components, message, instance) |
| `lastSendAt`, `reportsSent` | when and how often a report reached the service (`lastSendAt` appears with the first accepted report) |
| `sendError` | why the last send failed (`connection refused`, TLS, 401, 400 …); absent while sends succeed |

These names are pinned by `TestStatusJSONMatchesTheDocumentedContract` in `internal/agent`.

On the service side, with the same tenant:

```bash
curl -s -H 'X-Client-Id: <your repo>' "$CS_ENDPOINT/v1/health/monitors?tenantId=<tenant>"   # the monitor, streaks, open notice
curl -s -H 'X-Client-Id: <your repo>' "$CS_ENDPOINT/v1/health/monitors/<monitorId>/instances" # every pod that reported
```

The usual causes, in order:

1. `sendError` is set: wrong `CS_ENDPOINT`, a Route that needs an internal CA (`CS_CA_FILE`), or an
   egress policy; the app is unaffected, the sidecar retries with backoff.
2. Reports arrive but under another tenant: `CS_TENANT` differs from the one the consumers read.
3. `upSeen` is false: the app has not answered UP yet; during `CS_STARTUP_GRACE` the service
   ignores the UNKNOWN reports (see the previous section). If `target` is empty after the grace,
   nothing in the pod answered any health path: set `CS_PORT` (and `CS_PATH`).

## Build

```bash
cd sidecar
go test ./...
go build -ldflags="-s -w -X main.version=1.0.0" -o health-sidecar ./cmd/health-sidecar
podman build -t registry.example.com/platform/health-sidecar:1.0.0 \
  --build-arg VERSION=1.0.0 --build-arg REVISION=$(git rev-parse HEAD) .
```

`VERSION` becomes the binary's version (the `sidecar` field of every report, the `User-Agent`,
`/status`) and the image's `org.opencontainers.image.version` label; `REVISION` becomes
`org.opencontainers.image.revision`, so a registry UI or a scanner can tell builds apart.

No dependencies outside the Go standard library. The module needs Go 1.25 (`go.mod`), the line
the default builder image `ubi9/go-toolset:1.25` ships; `go test ./...` on a laptop with an older
Go downloads that toolchain through the module proxy.

The tests under `deploy/` render the Kustomize snippets with `kustomize` and validate every form
with `kubeconform`. Without the two tools on `PATH` they skip on a laptop; when `CI` is set (as
GitHub Actions does) a missing tool fails the test naming it, so the CI image must install both.

To try it on a laptop against a local communication service and a local app on port 8080:

```bash
CS_ENDPOINT=http://localhost:8081 CS_TENANT=retail CS_SERVICE=demo CS_PORT=8080 ./health-sidecar
```
