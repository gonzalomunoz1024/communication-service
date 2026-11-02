start 10:47:28.123
### E (started first, read at the end): scaled to zero, F-48: one pod reports UP, its sidecar gets SIGTERM, then 100 s
  [10:47:34.101] before:   zero-svc id=6db76d09 url=None publisher=health-sidecar stale=90 last=UP summary='UP (1 of 1 pod UP)' unhealthy=0 healthy=1 notice=None
  [10:47:34.257] sidecar stopped (SIGTERM): leaving report sent
### A: README L318-320 build with the HOST go 1.24.7 (GOTOOLCHAIN=auto switches to 1.27.3, README L334); -o into the scratch folder
    ok  	github.com/gonzalomunoz1024/communication-service/sidecar/cmd/health-sidecar	(cached)
    ok  	github.com/gonzalomunoz1024/communication-service/sidecar/deploy	0.004s
    ok  	github.com/gonzalomunoz1024/communication-service/sidecar/internal/agent	(cached)
    ok  	github.com/gonzalomunoz1024/communication-service/sidecar/internal/config	(cached)
    ok  	github.com/gonzalomunoz1024/communication-service/sidecar/internal/discover	(cached)
    ok  	github.com/gonzalomunoz1024/communication-service/sidecar/internal/probe	(cached)
    ok  	github.com/gonzalomunoz1024/communication-service/sidecar/internal/report	(cached)
  go test exit 0
  go build exit 0
  $W/work/readme-build/health-sidecar: go1.27.3
### B: README L349-351 try-out (ports changed for this sandbox: backend A :19300 for :8081, app :19396 for :8080, CS_LISTEN 127.0.0.1:19397)
  /status: {"version":"1.0.0","service":"demo","tenant":"vs4-readme","instance":"vm","target":"http://127.0.0.1:19396/actuator/health","upSeen":true,"last":"UP","sidecar":"1.0.0","reportsSent":1}
  service:   demo id=b81e7ffc url=None publisher=health-sidecar stale=90 last=UP summary='UP (1 of 1 pod UP)' unhealthy=0 healthy=1 notice=None
  [10:47:38.437] app process killed (pinned CS_PORT: README L166-167 says the report keeps the probe's own error)
  [10:47:58.442] /status: {"target":"http://127.0.0.1:19396/actuator/health","lastTarget":"http://127.0.0.1:19396/actuator/health","last":"DOWN","message":"GET http://127.0.0.1:19396/actuator/health: connection refused"}
  after SIGTERM: {"msg":"leaving report sent","error":null} {"msg":"health sidecar stopped","error":null} "exit 0"
### C: README L120-121: default CS_IGNORE_PORTS 15000-15099 and the sidecar's own port are skipped
    (app1 = Actuator document on 15021: would win pass 1 if not skipped; app2 = /healthz on 16000; the sidecar's own :9465/healthz would win pass 2 if not skipped)
  /status target: http://127.0.0.1:16000/healthz
### D: README L170-172 retry classification, L290 lastSendAt/reportsSent, L201/L325-327 headers (stub service :19344, CS_INTERVAL=2s CS_HEARTBEAT=4s)
  [10:48:11.430] the service answers 429
  [10:48:20.437]   /status: {"tick":"10:48:10.808","reportsSent":2,"sendError":"post http://172.17.0.1:19344/v1/health/reports: HTTP 429 {\"stub\":\"answered 429\"}"}
  [10:48:20.462] the service answers 408
  [10:48:29.466]   /status: {"tick":"10:48:10.808","reportsSent":2,"sendError":"post http://172.17.0.1:19344/v1/health/reports: HTTP 408 {\"stub\":\"answered 408\"}"}
  [10:48:29.488] the service answers 409
  [10:48:38.496]   /status: {"tick":"10:48:10.808","reportsSent":2,"sendError":"post http://172.17.0.1:19344/v1/health/reports: HTTP 409 {\"stub\":\"answered 409\"}"}
  [10:48:38.514] the service answers 500
  [10:48:47.519]   /status: {"tick":"10:48:10.808","reportsSent":2,"sendError":"post http://172.17.0.1:19344/v1/health/reports: HTTP 409 {\"stub\":\"answered 409\"}"}
  [10:48:47.539] the service answers 400
  [10:48:56.544]   /status: {"tick":"10:48:52.701","reportsSent":2,"sendError":"report rejected: HTTP 400 {\"stub\":\"answered 400\"}"}
  [10:48:56.564] the service answers 401
  [10:49:05.569]   /status: {"tick":"10:49:01.505","reportsSent":2,"sendError":"report rejected: HTTP 401 {\"stub\":\"answered 401\"}"}
  [10:49:05.598] the service answers 202
  [10:49:14.602]   /status: {"tick":"10:49:14.349","reportsSent":5,"sendError":""}
  sidecar rc log (WARN = retried with backoff, ERROR = rejected, permanent):
      1 {"t":"10:48:06.216","level":"INFO","msg":"reported","error":"","in":null}
      1 {"t":"10:48:15.165","level":"WARN","msg":"report failed; will retry","error":"post http://172.17.0.1:19344/v1/health/reports: HTTP 429 {\"stub\":\"answered 429\"}","in":"1s"}
      1 {"t":"10:48:17.524","level":"WARN","msg":"report failed; will retry","error":"post http://172.17.0.1:19344/v1/health/reports: HTTP 429 {\"stub\":\"answered 429\"}","in":"2s"}
      1 {"t":"10:48:19.583","level":"WARN","msg":"report failed; will retry","error":"post http://172.17.0.1:19344/v1/health/reports: HTTP 429 {\"stub\":\"answered 429\"}","in":"4s"}
      1 {"t":"10:48:24.183","level":"WARN","msg":"report failed; will retry","error":"post http://172.17.0.1:19344/v1/health/reports: HTTP 408 {\"stub\":\"answered 408\"}","in":"8s"}
      1 {"t":"10:48:33.184","level":"WARN","msg":"report failed; will retry","error":"post http://172.17.0.1:19344/v1/health/reports: HTTP 409 {\"stub\":\"answered 409\"}","in":"16s"}
      2 {"t":"10:48:48.325","level":"ERROR","msg":"report rejected","error":"report rejected: HTTP 400 {\"stub\":\"answered 400\"}","in":null}
      2 {"t":"10:48:56.894","level":"ERROR","msg":"report rejected","error":"report rejected: HTTP 401 {\"stub\":\"answered 401\"}","in":null}
  answers per code seen by the stub (rc only): {"202":5,"400":2,"401":2,"408":1,"409":1,"429":3}
  headers of the first request of each sidecar:
{"service":"rc","h":{"X-Client-Id":"rc","User-Agent":"health-sidecar/1.0.0-vs4","Content-Type":"application/json","Accept":"application/json"}}
{"service":"rc2","h":{"X-Client-Id":"my-team/my-repo","User-Agent":"health-sidecar/1.0.0-vs4","Content-Type":"application/json","Accept":"application/json"}}
### F: docs parity
  env names config.go reads: 27; in the README table: 27; differences: 0
  /status names in the README table (L283-291): instance lastReport lastSendAt lastSendAt lastTarget reportsSent sendError service target target tenant upSeen version
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
  proxy variables (HTTPS_PROXY / NO_PROXY) mentioned in the sidecar README: 2 (report client: http.ProxyFromEnvironment at internal/report/client.go:84; probes: probe.go:137)
  staleness relation: sidecar README L176-183; root README and application.yml lines that state it:
    root README L315:  silent; lower `instance-stale-after-seconds` only together with `CS_HEARTBEAT`;
    application.yml |       # for services that report per pod (the health sidecar): share of live pods that must be
    application.yml |       # UP for the service to count as UP, and the staleness window their monitors get; keep the
    application.yml |       # window well above the sidecar's CS_HEARTBEAT plus its 30 s retry cap (60 s at the defaults)
    application.yml |       min-healthy-percent: 50
    application.yml |       instance-stale-after-seconds: 90
### G: README L155-156 arithmetic against the cadence measured in 17c (defaults) and 12 (DOWN / degraded cadence)
  heartbeat gaps between accepted UP reports in 17c (25-40 s windows): min/max/mean/n = 33.3 34.3 33.8 4
  healthy / never-UP: 1000 pods / 33.8 s = 30 req/s (README: about 33 = 1000/30)
  DOWN: 1000 / 18.5 s = 54 req/s; degraded by a component: 1000 / 16.5 s = 61 req/s (README: about 67 = 1000/15)
### E (read): scaled to zero, 100 s after the SIGTERM at 10:47:34.257
  [10:49:14.884]   zero-svc id=6db76d09 url=None publisher=health-sidecar stale=90 last=UP summary='UNKNOWN (no live pod reports)' unhealthy=0 healthy=1 notice=None
  feed:   (feed empty)
  instances:   zero-svc-7f9c6d5b4-zz111 status=UP left=True lastSeen=10:47:34.176 msg='instance shutting down' comps=null ns=None node=None cluster=None version=None sidecar=1.0.0-vs4
### H: the shared pod after all of this (read only)
  127.0.0.1:19465/status: {"version":"ci-iter4","service":"fake-app","tenant":"podtest","last":"UP","reportsSent":79,"sendError":null}
  containers: sidecar=Up 43 minutes app=Up 43 minutes mongo7=Up 12 hours
end 10:49:15.707
