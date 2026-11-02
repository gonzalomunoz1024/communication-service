start 07:31:47.378
### E (started first, read at the end): scaled to zero, F-48: one pod reports UP, its sidecar gets SIGTERM, then 100 s
  [07:31:53.367] before:   zero-svc id=220860c9 url=None publisher=health-sidecar stale=90 last=UP summary='UP (1 of 1 pod UP)' unhealthy=0 healthy=1 notice=None
  [07:31:53.525] sidecar stopped (SIGTERM): leaving report sent
### A: README L286-289 build on this host (go1.24.7 + toolchain switch); -o into the scratch folder, not the repository
  go build exit 0
  $W/work/readme-build/health-sidecar: go1.25.0
### B: README L309-311 try-out (ports changed for this sandbox: backend A :19300 for :8081, app :19396 for :8080, CS_LISTEN 127.0.0.1:19397)
  /status: {"version":"1.0.0","service":"demo","tenant":"vs3-readme","instance":"vm","target":"http://127.0.0.1:19396/actuator/health","upSeen":true,"last":"UP","sidecar":"1.0.0","reportsSent":1}
  service:   demo id=5ded5b7e url=None publisher=health-sidecar stale=90 last=UP summary='UP (1 of 1 pod UP)' unhealthy=0 healthy=1 notice=None
  [07:31:57.356] app process killed (pinned CS_PORT: README L166-167 says the report keeps the probe's own error)
  [07:32:17.364] /status: {"target":"http://127.0.0.1:19396/actuator/health","lastTarget":"http://127.0.0.1:19396/actuator/health","last":"DOWN","message":"GET http://127.0.0.1:19396/actuator/health: connection refused"}
  after SIGTERM: {"msg":"leaving report sent","error":null} {"msg":"health sidecar stopped","error":null} "exit 0"
### C: README L120-121: default CS_IGNORE_PORTS 15000-15099 and the sidecar's own port are skipped
    (app1 = Actuator document on 15021: would win pass 1 if not skipped; app2 = /healthz on 16000; the sidecar's own :9465/healthz would win pass 2 if not skipped)
  /status target: http://127.0.0.1:16000/healthz
### D: README L170-172 retry classification, L263 lastSendAt/reportsSent, L201/L294 headers (stub service :19344, CS_INTERVAL=2s CS_HEARTBEAT=4s)
  [07:32:30.235] the service answers 429
  [07:32:39.240]   /status: {"tick":"07:32:29.255","reportsSent":2,"sendError":"post http://172.17.0.1:19344/v1/health/reports: HTTP 429 {\"stub\":\"answered 429\"}"}
  [07:32:39.267] the service answers 408
  [07:32:48.271]   /status: {"tick":"07:32:29.255","reportsSent":2,"sendError":"post http://172.17.0.1:19344/v1/health/reports: HTTP 408 {\"stub\":\"answered 408\"}"}
  [07:32:48.298] the service answers 409
  [07:32:57.303]   /status: {"tick":"07:32:29.255","reportsSent":2,"sendError":"post http://172.17.0.1:19344/v1/health/reports: HTTP 409 {\"stub\":\"answered 409\"}"}
  [07:32:57.325] the service answers 500
  [07:33:06.329]   /status: {"tick":"07:32:29.255","reportsSent":2,"sendError":"post http://172.17.0.1:19344/v1/health/reports: HTTP 409 {\"stub\":\"answered 409\"}"}
  [07:33:06.348] the service answers 400
  [07:33:15.352]   /status: {"tick":"07:33:10.981","reportsSent":2,"sendError":"report rejected: HTTP 400 {\"stub\":\"answered 400\"}"}
  [07:33:15.376] the service answers 401
  [07:33:24.381]   /status: {"tick":"07:33:24.269","reportsSent":2,"sendError":"report rejected: HTTP 401 {\"stub\":\"answered 401\"}"}
  [07:33:24.402] the service answers 202
  [07:33:33.406]   /status: {"tick":"07:33:32.519","reportsSent":4,"sendError":""}
  sidecar rc log (WARN = retried with backoff, ERROR = rejected, permanent):
      1 {"t":"07:32:24.998","level":"INFO","msg":"reported","error":"","in":null}
      1 {"t":"07:32:33.464","level":"WARN","msg":"report failed; will retry","error":"post http://172.17.0.1:19344/v1/health/reports: HTTP 429 {\"stub\":\"answered 429\"}","in":"1s"}
      1 {"t":"07:32:35.684","level":"WARN","msg":"report failed; will retry","error":"post http://172.17.0.1:19344/v1/health/reports: HTTP 429 {\"stub\":\"answered 429\"}","in":"2s"}
      1 {"t":"07:32:37.764","level":"WARN","msg":"report failed; will retry","error":"post http://172.17.0.1:19344/v1/health/reports: HTTP 429 {\"stub\":\"answered 429\"}","in":"4s"}
      1 {"t":"07:32:42.451","level":"WARN","msg":"report failed; will retry","error":"post http://172.17.0.1:19344/v1/health/reports: HTTP 408 {\"stub\":\"answered 408\"}","in":"8s"}
      1 {"t":"07:32:51.042","level":"WARN","msg":"report failed; will retry","error":"post http://172.17.0.1:19344/v1/health/reports: HTTP 409 {\"stub\":\"answered 409\"}","in":"16s"}
      3 {"t":"07:33:06.366","level":"ERROR","msg":"report rejected","error":"report rejected: HTTP 400 {\"stub\":\"answered 400\"}","in":null}
      2 {"t":"07:33:19.639","level":"ERROR","msg":"report rejected","error":"report rejected: HTTP 401 {\"stub\":\"answered 401\"}","in":null}
  answers per code seen by the stub (rc only): {"202":4,"400":3,"401":2,"408":1,"409":1,"429":3}
  headers of the first request of each sidecar:
{"service":"rc","h":{"X-Client-Id":"rc","User-Agent":"health-sidecar/1.0.0-vs3","Content-Type":"application/json","Accept":"application/json"}}
{"service":"rc2","h":{"X-Client-Id":"my-team/my-repo","User-Agent":"health-sidecar/1.0.0-vs3","Content-Type":"application/json","Accept":"application/json"}}
### F: docs parity
  env names config.go reads: 27; in the README table: 27; differences: 0
  /status names in the README table (L258-264): instance lastReport lastSendAt lastSendAt lastTarget reportsSent sendError service target target tenant upSeen version
  live keys (13b healthy and DOWN, 16 PART A failing): instance lastReport lastSendAt lastTarget reportsSent sendError service target tenant upSeen version
  anchor #what-it-reports-and-when: heading found
  anchor #debugging-my-service-does-not-show-up: heading found
  anchor #build: heading found
  anchor ../README.md#health-monitoring-automated-publishing: found
  link deploy/kustomize: exists
  link deploy/kustomize/example: exists
  link deploy/kustomize/component-native: exists
  link deploy/helm/cs-health-sidecar: exists
  link deploy/helm/cs-health-sidecar/templates/_container.tpl: exists
  link deploy/manual/deployment.yaml: exists
  proxy variables (HTTPS_PROXY / NO_PROXY) mentioned in the sidecar README: 0 (report client: http.ProxyFromEnvironment at internal/report/client.go:84; probes: probe.go:137)
  staleness relation: sidecar README L176-183, root README L268-270, application.yml L111-113:
    |   The window must stay well above the sidecar's heartbeat plus its retry cap (30 s + 30 s with the
    |   sidecar's defaults), so a short outage of the service itself never makes a healthy pod look
    |   silent; lower `instance-stale-after-seconds` only together with `CS_HEARTBEAT`;
    |       # for services that report per pod (the health sidecar): share of live pods that must be
    |       # UP for the service to count as UP, and the staleness window their monitors get; keep the
    |       # window well above the sidecar's CS_HEARTBEAT plus its 30 s retry cap (60 s at the defaults)
### G: README L155-156 arithmetic against the measured cadence at the defaults (15 s interval, up to 20 % jitter, 2 s retry probe for a non-UP status)
  healthy / never-UP: 1000 pods / 34.0 s = 29 req/s (README: about 33 = 1000/30)
  DOWN: 1000 / 18.5 s = 54 req/s; degraded by a component: 1000 / 16.5 s = 61 req/s (README: about 67 = 1000/15)
### E (read): scaled to zero, 100 s after the SIGTERM at 07:31:53.525
  [07:33:33.687]   zero-svc id=220860c9 url=None publisher=health-sidecar stale=90 last=UP summary='UNKNOWN (no live pod reports)' unhealthy=0 healthy=1 notice=None
  feed:   (feed empty)
  instances:   zero-svc-7f9c6d5b4-zz111 status=UP left=True lastSeen=07:31:53.445 msg='instance shutting down' comps=null ns=None node=None cluster=None version=None sidecar=1.0.0-vs3
### H: the shared pod after all of this (read only)
  127.0.0.1:19465/status: {"version":"ci-iter3","service":"fake-app","tenant":"podtest","last":"UP","reportsSent":107,"sendError":null}
  containers: sidecar=Up 58 minutes app=Up 58 minutes mongo7=Up 8 hours
end 07:33:34.443
