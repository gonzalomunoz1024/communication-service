#!/bin/bash
# README line by line (iteration-4 README), the parts that need a live check: build + try-out commands (L317-320, L349-351),
# pinned target's own error (L166-167), default ignore range + own port (L120-121), retry classification / lastSendAt /
# reportsSent (L170-172, L290), headers (L201, L325-327), scaled to zero (F-48), docs parity (env table, /status table,
# anchors, relation texts, proxy).
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4/scripts/lib.sh
. $W/scripts/env.sh
R=/home/claude/communication-service/sidecar
N="vs4-z-pod vs4-z-app vs4-z-sc vs4-rd-pod vs4-rd-app1 vs4-rd-app2 vs4-rd-sc vs4-rc-pod vs4-rc-app vs4-rc-sc vs4-rc2-sc"
cleanup $N
echo "start $(ts)"
echo "### E (started first, read at the end): scaled to zero, F-48: one pod reports UP, its sidecar gets SIGTERM, then 100 s"
pod vs4-z-pod; app vs4-z-pod vs4-z-app -mode actuator -port 8080; sleep 0.3
sidecar vs4-z-pod vs4-z-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=vs4-zero -e CS_SERVICE=zero-svc -e POD_NAME=zero-svc-7f9c6d5b4-zz111 -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s
sleep 5; echo "  [$(ts)] before: $(mon vs4-zero)"
docker stop vs4-z-sc >/dev/null; ZT=$(ts); echo "  [$ZT] sidecar stopped (SIGTERM): $(docker logs vs4-z-sc 2>&1 | jq -r 'select(.msg=="leaving report sent" or .msg=="leaving report failed") | .msg')"
echo "### A: README L318-320 build with the HOST go 1.24.7 (GOTOOLCHAIN=auto switches to 1.27.3, README L334); -o into the scratch folder"
mkdir -p $W/work/readme-build
( cd $R && env -u GOROOT GOTOOLCHAIN=auto PATH=/usr/local/go/bin:/usr/bin:/bin go test ./... 2>&1 | tail -7 | sed "s/^/    /"; echo "  go test exit ${PIPESTATUS[0]}"; env -u GOROOT GOTOOLCHAIN=auto PATH=/usr/local/go/bin:/usr/bin:/bin go build -ldflags="-s -w -X main.version=1.0.0" -o $W/work/readme-build/health-sidecar ./cmd/health-sidecar ); echo "  go build exit $?"
echo "  $(go version -m $W/work/readme-build/health-sidecar | head -1 | sed "s|$W|\$W|")"
echo "### B: README L349-351 try-out (ports changed for this sandbox: backend A :19300 for :8081, app :19396 for :8080, CS_LISTEN 127.0.0.1:19397)"
$W/bin/stub -mode actuator -port 19396 > $W/work/tryout-app.txt 2>&1 & echo $! > $W/work/tryout-app.pid; sleep 0.3
( CS_ENDPOINT=http://localhost:19300 CS_TENANT=vs4-readme CS_SERVICE=demo CS_PORT=19396 CS_LISTEN=127.0.0.1:19397 $W/work/readme-build/health-sidecar > $W/work/tryout-sc.txt 2>&1; echo "exit $?" >> $W/work/tryout-sc.txt ) & sleep 3
echo "  /status: $(curl -s 127.0.0.1:19397/status | jq -c '{version,service,tenant,instance,target,upSeen,last:.lastReport.status,sidecar:.lastReport.instance.sidecar,reportsSent}')"
echo "  service: $(mon vs4-readme)"
kill $(cat $W/work/tryout-app.pid); echo "  [$(ts)] app process killed (pinned CS_PORT: README L166-167 says the report keeps the probe's own error)"
sleep 20; echo "  [$(ts)] /status: $(curl -s 127.0.0.1:19397/status | jq -c '{target,lastTarget,last:.lastReport.status,message:.lastReport.message}')"
SCP=$(ps -eo pid,args | awk -v b="$W/work/readme-build/health-sidecar" '$2==b{print $1}'); kill -TERM $SCP; sleep 1
echo "  after SIGTERM: $(tail -3 $W/work/tryout-sc.txt | jq -c -R 'fromjson? // . | if type=="object" then {msg,error} else . end' | paste -sd' ')"
echo "### C: README L120-121: default CS_IGNORE_PORTS 15000-15099 and the sidecar's own port are skipped"
echo "    (app1 = Actuator document on 15021: would win pass 1 if not skipped; app2 = /healthz on 16000; the sidecar's own :9465/healthz would win pass 2 if not skipped)"
pod vs4-rd-pod -p 127.0.0.1:19398:9465; app vs4-rd-pod vs4-rd-app1 -mode actuator -port 15021; app vs4-rd-pod vs4-rd-app2 -mode healthz -port 16000; sleep 0.3
sidecar vs4-rd-pod vs4-rd-sc -e CS_ENDPOINT=$BEC -e CS_TENANT=vs4-readme -e CS_SERVICE=ignore-default -e POD_NAME=ignore-default-0 -e CS_INTERVAL=2s -e CS_STARTUP_GRACE=0s
sleep 4; echo "  /status target: $(raw 19398 | jq -r .target)"
echo "### D: README L170-172 retry classification, L290 lastSendAt/reportsSent, L201/L325-327 headers (stub service :19344, CS_INTERVAL=2s CS_HEARTBEAT=4s)"
$W/bin/stub -mode backend -port 19344 -ctl 19345 > $W/work/stub-19344.txt 2>&1 & echo $! > $W/work/stub-19344.pid; sleep 0.4
pod vs4-rc-pod -p 127.0.0.1:19399:9465; app vs4-rc-pod vs4-rc-app -mode actuator -port 8080; sleep 0.3
sidecar vs4-rc-pod vs4-rc-sc -e CS_ENDPOINT=http://172.17.0.1:19344 -e CS_TENANT=vs4-rc -e CS_SERVICE=rc -e POD_NAME=rc-7f9c6d5b4-aa111 -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_STARTUP_GRACE=0s -e CS_LOG_LEVEL=debug
sidecar vs4-rc-pod vs4-rc2-sc -e CS_ENDPOINT=http://172.17.0.1:19344 -e CS_TENANT=vs4-rc -e CS_SERVICE=rc2 -e CS_CLIENT_ID=my-team/my-repo -e POD_NAME=rc2-7f9c6d5b4-bb222 -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_STARTUP_GRACE=0s -e CS_LISTEN=:9466
sleep 5
for c in 429 408 409 500 400 401 202; do
  curl -s "127.0.0.1:19344/__code?c=$c" >/dev/null; echo "  [$(ts)] the service answers $c"; sleep 9
  echo "  [$(ts)]   /status: $(raw 19399 | jq -c '{tick:((.lastSendAt // "")[11:23]), reportsSent, sendError:((.sendError // "")|.[0:120])}')"
done
echo "  sidecar rc log (WARN = retried with backoff, ERROR = rejected, permanent):"
docker logs vs4-rc-sc 2>&1 | jq -c 'select(.msg=="report failed; will retry" or .msg=="report rejected" or (.msg=="reported" and .level=="INFO")) | {t:.time[11:23],level,msg,error:((.error // "")|.[0:90]),in}' | uniq -c -f1 | head -40
echo "  answers per code seen by the stub (rc only): $(reqs 19345 | jq -c '[.[] | select(.body.service=="rc") | .answer] | group_by(.) | map({(.[0]|tostring): length}) | add')"
echo "  headers of the first request of each sidecar:"
reqs 19345 | jq -c '[.[] | select(.body.service=="rc")][0] | {service:.body.service, h:(.headers | {"X-Client-Id","User-Agent","Content-Type","Accept"})}'
reqs 19345 | jq -c '[.[] | select(.body.service=="rc2")][0] | {service:.body.service, h:(.headers | {"X-Client-Id","User-Agent","Content-Type","Accept"})}'
kill $(cat $W/work/stub-19344.pid)
echo "### F: docs parity"
echo "  env names config.go reads: $(grep -o '"CS_[A-Z_]*"\|"POD_[A-Z_]*"\|"NODE_NAME"' $R/internal/config/config.go | sort -u | wc -l); in the README table: $(grep -o '`CS_[A-Z_]*`\|`POD_[A-Z_]*`\|`NODE_NAME`' $R/README.md | sort -u | wc -l); differences: $(diff <(grep -o '"CS_[A-Z_]*"\|"POD_[A-Z_]*"\|"NODE_NAME"' $R/internal/config/config.go | tr -d '"' | sort -u) <(grep -o '`CS_[A-Z_]*`\|`POD_[A-Z_]*`\|`NODE_NAME`' $R/README.md | tr -d '`' | sort -u) | grep -c '^[<>]')"
echo "  /status names in the README table (L283-291): $(sed -n 283,291p $R/README.md | grep -o '`[a-zA-Z]*`' | tr -d '`' | sort | paste -sd' ')"
echo "  live keys (13b healthy and DOWN, 16 PART A failing): $( (grep -o '"keys[^]]*\]\|keys (healthy): \[[^]]*\]' $W/out/13b-own-endpoints.txt | grep -o '"[a-zA-Z]*"' ; echo '"sendError"') | tr -d '"' | sort -u | paste -sd' ')"
for a in what-it-reports-and-when debugging-my-service-does-not-show-up build; do echo "  anchor #$a: heading $(grep -ciE "^#+ .*" $R/README.md >/dev/null; python3 -I -c "
import re,sys
hs=[re.sub(r'[^a-z0-9 -]','',l.lstrip('#').strip().lower()).replace(' ','-') for l in open('$R/README.md') if l.startswith('#')]
print('found' if '$a' in hs else 'MISSING')")"; done
echo "  anchor ../README.md#health-monitoring-automated-publishing: $(python3 -I -c "
import re
hs=[re.sub(r'[^a-z0-9 -]','',l.lstrip('#').strip().lower()).replace(' ','-') for l in open('/home/claude/communication-service/README.md') if l.startswith('#')]
print('found' if 'health-monitoring-automated-publishing' in hs else 'MISSING')")"
for p in deploy/kustomize deploy/kustomize/example deploy/kustomize/component-native deploy/helm/cs-health-sidecar deploy/helm/cs-health-sidecar/templates/_container.tpl deploy/manual/deployment.yaml; do echo "  link $p: $([ -e $R/$p ] && echo exists || echo MISSING)"; done
echo "  proxy variables (HTTPS_PROXY / NO_PROXY) mentioned in the sidecar README: $(grep -c -E 'HTTPS?_PROXY|NO_PROXY' $R/README.md) (report client: http.ProxyFromEnvironment at internal/report/client.go:$(grep -n 'ProxyFromEnvironment' $R/internal/report/client.go | cut -d: -f1); probes: $(grep -n 'Proxy: *nil' $R/internal/probe/probe.go | cut -d: -f1 | sed 's/^/probe.go:/'))"
echo "  staleness relation: sidecar README L176-183; root README and application.yml lines that state it:"
grep -n -i "CS_HEARTBEAT" /home/claude/communication-service/README.md | cut -c1-260 | sed 's/^/    root README L/'; sed -n 134,138p /home/claude/communication-service/src/main/resources/application.yml | sed 's/^/    application.yml | /'
echo "### G: README L155-156 arithmetic against the cadence measured in 17c (defaults) and 12 (DOWN / degraded cadence)"
HB=$(python3 -I -c "
import re,datetime
t=[datetime.datetime.strptime(m.group(1),'%H:%M:%S.%f') for m in re.finditer(r'\{\"t\":\"(\d\d:\d\d:\d\d\.\d{3})\",\"msg\":\"reported\"', open('$W/out/17c-staleness.txt').read())]
g=[(b-a).total_seconds() for a,b in zip(t,t[1:])]
hb=[x for x in g if 25<x<40]
print('%.1f %.1f %.1f %d' % (min(hb), max(hb), sum(hb)/len(hb), len(hb)) if hb else '0 0 0 0')")
echo "  heartbeat gaps between accepted UP reports in 17c (25-40 s windows): min/max/mean/n = $HB"
python3 -I -c "
hb=float('$HB'.split()[2]) or 34.0
down=15*1.1+2.0      # interval + mean jitter + retry probe
deg=15*1.1           # UP with a failing component: no retry probe
print('  healthy / never-UP: 1000 pods / %.1f s = %.0f req/s (README: about 33 = 1000/30)' % (hb, 1000/hb))
print('  DOWN: 1000 / %.1f s = %.0f req/s; degraded by a component: 1000 / %.1f s = %.0f req/s (README: about 67 = 1000/15)' % (down, 1000/down, deg, 1000/deg))
"
echo "### E (read): scaled to zero, 100 s after the SIGTERM at $ZT"
while [ $(( $(date +%s) - $(date -d "$(date -u +%F) ${ZT%.*}" +%s) )) -lt 100 ]; do sleep 2; done
echo "  [$(ts)] $(mon vs4-zero)"; echo "  feed: $(feed vs4-zero)"; echo "  instances: $(inst vs4-zero zero-svc)"
cleanup $N
echo "### H: the shared pod after all of this (read only)"
echo "  127.0.0.1:19465/status: $(curl -s --max-time 2 127.0.0.1:19465/status | jq -c '{version,service,tenant,last:.lastReport.status,reportsSent,sendError}')"
echo "  containers: $(docker ps --format '{{.Names}}={{.Status}}' | grep -E '^(app|sidecar|mongo7)=' | paste -sd' ')"
echo "end $(ts)"
