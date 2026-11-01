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
| **Kustomize** ([deploy/kustomize](deploy/kustomize)) | adds `components: [<component path>]` to its kustomization and a `cs-health-sidecar` ConfigMap with `CS_ENDPOINT`, `CS_TENANT`, `CS_CLUSTER` |
| **Helm** ([deploy/helm/cs-health-sidecar](deploy/helm/cs-health-sidecar)) | adds the library chart as a dependency, `{{ include "cs-health-sidecar.container" . }}` under `containers`, and `csHealthSidecar.endpoint` / `.tenant` in values |
| **Plain YAML** ([deploy/manual/deployment.yaml](deploy/manual/deployment.yaml)) | pastes the container block |

On OpenShift 4.16+ (Kubernetes 1.29+) prefer the native sidecar form (an init container with
`restartPolicy: Always`): it starts before the app, stops after it, and never keeps a Job
alive. Both Kustomize and Helm offer it (`add-native-sidecar.yaml`,
`cs-health-sidecar.initContainer`).

A mutating admission webhook that injects the container on a single pod annotation is the
planned next step; the container and its configuration stay the same.

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
- It sends a report when the status (or the set of failing components) changes, and a
  heartbeat every 30 s (`CS_HEARTBEAT`) otherwise. 1,000 pods are about 33 requests/s.
- Until the app has answered UP once, and for at most 5 minutes (`CS_STARTUP_GRACE`), it
  reports UNKNOWN, which the service ignores: slow starts and rolling deploys never open notices.
  A pinned target (`CS_PORT`) that never answers UP stays UNKNOWN after that, with a message
  pointing at the configuration, because a wrong port is far more likely than an outage.
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
| `CS_ENDPOINT` | required | communication service base URL |
| `CS_TENANT` | required | tenant the service belongs to |
| `CS_SERVICE` | `app.kubernetes.io/name` label (set by the snippets), else derived from the pod name | service name in reports |
| `CS_CLIENT_ID` | `CS_SERVICE` | `X-Client-Id` header (the repository name) |
| `CS_CLUSTER` | empty | cluster name in the instance |
| `CS_PROBE` | `auto` | `auto`, `actuator`, `http` or `tcp` |
| `CS_PORT`, `CS_PATH`, `CS_SCHEME` | discovered | pin the target; `CS_PORT` is required for a non-auto mode |
| `CS_HOST` | `127.0.0.1,::1` | addresses tried for the app |
| `CS_IGNORE_PORTS` | `15000-15099` | ports discovery skips, e.g. `15000-15099,9090` |
| `CS_INTERVAL` / `CS_HEARTBEAT` | `15s` / `30s` | probe cadence / resend cadence while nothing changes |
| `CS_PROBE_TIMEOUT` / `CS_REPORT_TIMEOUT` | `3s` / `5s` | per probe / per report |
| `CS_STARTUP_GRACE` | `5m` | UNKNOWN until the first UP, at most this long |
| `CS_RETRY_DELAY` | `2s` | second probe before a non-UP answer counts |
| `CS_LISTEN` | `:9465` | the sidecar's own `/healthz` and `/status` |
| `CS_CA_FILE` | empty | extra PEM CA bundle for the endpoint (an internal CA); the image carries the UBI bundle |
| `CS_INSECURE_SKIP_VERIFY` | `false` | skip TLS verification to the endpoint (local experiments only) |
| `POD_NAME`, `POD_NAMESPACE`, `NODE_NAME`, `CS_VERSION`, `CS_INSTANCE_ID` | Downward API | instance identity |

`GET :9465/status` shows the discovered target, the last probe result, the last report sent and
the last send error, which is the first place to look when a service does not show up.

## Build

```bash
cd sidecar
go test ./...
go build -ldflags="-s -w -X main.version=1.0.0" -o health-sidecar ./cmd/health-sidecar
podman build -t registry.example.com/platform/health-sidecar:1.0.0 --build-arg VERSION=1.0.0 .
```

No dependencies outside the Go standard library. To try it on a laptop against a local
communication service and a local app on port 8080:

```bash
CS_ENDPOINT=http://localhost:8081 CS_TENANT=retail CS_SERVICE=demo CS_PORT=8080 ./health-sidecar
```
