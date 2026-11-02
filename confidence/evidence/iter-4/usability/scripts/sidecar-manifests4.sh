#!/usr/bin/env bash
# sidecar-manifests4.sh — a platform engineer renders every attach path from sidecar/README.md alone (iteration 4)
export PATH=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/tools:$PATH
R=/home/claude/communication-service/sidecar; W=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/usability/iter4/sidecar-work
rm -rf $W; mkdir -p $W; cp -r $R/deploy/kustomize $W/kz; cp -r $R/deploy/helm $W/helm
say(){ printf '\n### %s\n' "$*"; }
KC(){ kubeconform -strict -summary -kubernetes-version 1.29.0 "$@" 2>&1 | tail -3; }
say "S0 the README's attach table, as printed"
grep -n -E '^\| \*\*(Kustomize|Helm|Plain YAML)\*\*' $R/README.md | cut -c1-400
say "S1 Kustomize classic, the example as shipped"
kustomize build $W/kz/example > $W/kz-classic.yaml; echo "kustomize exit $?"; KC $W/kz-classic.yaml
grep -n -A4 '^kind: ConfigMap' $W/kz-classic.yaml | head -12
say "S2 native: the example pointed at ../component-native (README + the example's own comment)"
grep -n 'component' $W/kz/example/kustomization.yaml
mkdir -p $W/kz/example-native; cp $W/kz/example/deployment.yaml $W/kz/example-native/; sed 's#- \.\./component$#- ../component-native#' $W/kz/example/kustomization.yaml > $W/kz/example-native/kustomization.yaml
kustomize build $W/kz/example-native > $W/kz-native.yaml; echo "kustomize exit $?"; grep -n "initContainers:\|restartPolicy: Always\|  name: health-sidecar" $W/kz-native.yaml | head -3; KC $W/kz-native.yaml
say "S3 README 'Image' block appended to the example kustomization"
cp -r $W/kz/example $W/kz/example-img
python3 -I - $W/kz/example-img/kustomization.yaml <<'PY'
import re,sys
readme=open('/home/claude/communication-service/sidecar/README.md').read()
blk=re.search(r'```yaml\n# Kustomize: in the app.s kustomization.yaml, next to components:\n(.*?)```', readme, re.S).group(1)
open(sys.argv[1],'a').write(blk); print('README Image block appended:\n'+blk)
PY
kustomize build $W/kz/example-img | grep -n "image:"
say "S3b README Debugging: CS_LOG_LEVEL=debug added to the cs-health-sidecar ConfigMap (Kustomize)"
cp -r $W/kz/example $W/kz/example-debug; grep -n 'CS_' $W/kz/example-debug/kustomization.yaml
sed -i 's#      - CS_CLUSTER=ocp-east#      - CS_CLUSTER=ocp-east\n      - CS_LOG_LEVEL=debug#' $W/kz/example-debug/kustomization.yaml
kustomize build $W/kz/example-debug > $W/kz-debug.yaml; echo "kustomize exit $?"; grep -n "CS_LOG_LEVEL" $W/kz-debug.yaml | head -3; KC $W/kz-debug.yaml
say "S4 helm template on the library chart alone (README: fails by design)"
helm template x $W/helm/cs-health-sidecar 2>&1 | head -2
say "S5 consuming chart from the README's three pieces, pasted as printed (repository switched to the local copy)"
mkdir -p $W/my-app/templates $W/my-app/charts; cp -r $W/helm/cs-health-sidecar $W/my-app/charts/
printf 'apiVersion: v2\nname: my-app\nversion: 0.1.0\ndependencies:\n  - name: cs-health-sidecar\n    version: 1.0.0\n    repository: file://charts/cs-health-sidecar\n' > $W/my-app/Chart.yaml
python3 -I - "$W" <<'PY'
import re, sys
W = sys.argv[1]; readme = open('/home/claude/communication-service/sidecar/README.md').read()
blk = re.search(r'With Helm the consuming chart gets these three pieces.*?```yaml\n(.*?)```', readme, re.S).group(1)
dep = blk.split('# templates/deployment.yaml, under spec.template.spec.containers\n')[1].split('\n# values.yaml')[0].rstrip('\n')
vals = blk.split('# values.yaml\n')[1]
head = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\n  labels: {app.kubernetes.io/name: my-app}\nspec:\n  selector:\n    matchLabels: {app: my-app}\n  template:\n    metadata:\n      labels: {app: my-app, app.kubernetes.io/name: my-app}\n    spec:\n'
open(W + '/my-app/templates/deployment.yaml', 'w').write(head + dep + '\n')
open(W + '/my-app/values.yaml', 'w').write(vals)
print('README deployment lines pasted:\n' + dep); print('README values pasted:\n' + vals)
nat = re.search(r'# templates/deployment.yaml, under spec.template.spec.initContainers\n(.*?)```', readme, re.S).group(1).rstrip('\n')
open(W + '/native-snippet.txt', 'w').write(nat)
ee = re.search(r'```yaml\n(# values.yaml of the consuming chart, next to endpoint and tenant\n.*?)```', readme, re.S).group(1)
open(W + '/extraenv-readme.yaml', 'w').write(ee); print('README extraEnv snippet:\n' + ee)
PY
(cd $W/my-app && helm dependency build >/dev/null 2>&1; echo "helm dependency build exit $?")
echo "(a) as printed:"; helm template my-app $W/my-app > $W/helm-readme.yaml 2> $W/helm-readme.err; echo "   helm template exit $?"; head -c 300 $W/helm-readme.err
KC $W/helm-readme.yaml; helm lint $W/my-app 2>&1 | tail -1
cp $W/my-app/templates/deployment.yaml $W/deployment-readme.yaml
echo "(b) the README's warning case: the include without | nindent 8, on its own line at column 8"
sed 's#{{- include "cs-health-sidecar.container" . | nindent 8 }}#        {{ include "cs-health-sidecar.container" . }}#' $W/deployment-readme.yaml > $W/my-app/templates/deployment.yaml
helm template my-app $W/my-app > $W/helm-noindent.yaml 2>&1; echo "   helm template exit $?"; KC $W/helm-noindent.yaml; helm lint $W/my-app 2>&1 | tail -1
cp $W/deployment-readme.yaml $W/my-app/templates/deployment.yaml
echo "(c) tenant left empty:"; helm template my-app $W/my-app --set csHealthSidecar.tenant= 2>&1 | head -2
echo "(d) README image values:"
python3 -I - "$W" <<'PY'
import re,sys
readme=open('/home/claude/communication-service/sidecar/README.md').read()
blk=re.search(r"```yaml\n# Helm: in the consuming chart's values.yaml\n(.*?)```", readme, re.S).group(1)
open(sys.argv[1]+'/image-values.yaml','w').write(blk); print('README image values:\n'+blk)
PY
helm template my-app $W/my-app -f $W/image-values.yaml | grep -n "image:"
echo "(e) native: the README's initContainers lines"
python3 -I - "$W" <<'PY'
import sys; W = sys.argv[1]; d = open(W + '/deployment-readme.yaml').read(); nat = open(W + '/native-snippet.txt').read()
d = d.replace('    spec:\n', '    spec:\n' + nat + '\n', 1)
d = d.replace('        {{- include "cs-health-sidecar.container" . | nindent 8 }}\n', '')
open(W + '/my-app/templates/deployment.yaml', 'w').write(d)
PY
grep -n "initContainers\|include\|containers:" $W/my-app/templates/deployment.yaml
helm template my-app $W/my-app > $W/helm-native.yaml 2>&1; echo "   helm template exit $?"; grep -c "restartPolicy: Always" $W/helm-native.yaml; KC $W/helm-native.yaml
cp $W/deployment-readme.yaml $W/my-app/templates/deployment.yaml
echo "(f) README Debugging with Helm: the README's extraEnv snippet, as printed, as a values file"
helm template my-app $W/my-app -f $W/extraenv-readme.yaml > $W/helm-debug-list.yaml 2>&1; echo "   helm template exit $?"; grep -n "CS_LOG_LEVEL" -A1 $W/helm-debug-list.yaml; KC $W/helm-debug-list.yaml
echo "(f2) the same snippet merged into the consuming chart's values.yaml next to endpoint and tenant (as its comment says)"
cp $W/my-app/values.yaml $W/values-orig.yaml
python3 -I - "$W" <<'PY'
import sys; W=sys.argv[1]; v=open(W+'/values-orig.yaml').read(); e=open(W+'/extraenv-readme.yaml').read()
body=e.split('csHealthSidecar:\n',1)[1]
open(W+'/my-app/values.yaml','w').write(v.rstrip('\n')+'\n'+body); print(open(W+'/my-app/values.yaml').read())
PY
helm template my-app $W/my-app > $W/helm-debug-merged.yaml 2>&1; echo "   helm template exit $?"; grep -n "CS_LOG_LEVEL" -A1 $W/helm-debug-merged.yaml; KC $W/helm-debug-merged.yaml; helm lint $W/my-app 2>&1 | tail -1
cp $W/values-orig.yaml $W/my-app/values.yaml
echo "(g) the map form the README warns about (CS_LOG_LEVEL: debug)"
printf 'csHealthSidecar:\n  extraEnv:\n    CS_LOG_LEVEL: debug\n' > $W/debug-map.yaml
helm template my-app $W/my-app -f $W/debug-map.yaml > $W/helm-debug-map.yaml 2>&1; echo "   helm template exit $?"; head -c 400 $W/helm-debug-map.yaml; echo
say "S6 plain YAML: the file, its header, and the README row followed literally"
KC $R/deploy/manual/deployment.yaml
sed -n '1,16p' $R/deploy/manual/deployment.yaml
python3 -I - <<'PY'
manual=open('/home/claude/communication-service/sidecar/deploy/manual/deployment.yaml').read()
kz=open('/home/claude/communication-service/sidecar/deploy/kustomize/component/add-sidecar.yaml').read()
block=manual[manual.index('- name: health-sidecar'):]; kzblock=kz[kz.index('name: health-sidecar'):]
norm=lambda s: [l.strip() for l in s.splitlines() if l.strip() and not l.strip().startswith('#')]
a,b=norm(block),norm(kzblock); a[0]=a[0].lstrip('- ')
print('   container identical to the Kustomize patch (ignoring indentation):', a==b, '| lines', len(a), len(b))
if a!=b: print('   only in manual:', [x for x in a if x not in b][:6], '| only in kustomize:', [x for x in b if x not in a][:6])
PY
echo "   a team's own Deployment + the ConfigMap applied + the container block pasted (README row, literally):"
python3 -I - "$W" <<'PY'
import sys,re; W=sys.argv[1]
m=open('/home/claude/communication-service/sidecar/deploy/manual/deployment.yaml').read()
docs=m.split('\n---\n'); cm=[d for d in docs if 'kind: ConfigMap' in d][0]
blk=m[m.index('        - name: health-sidecar'):].rstrip('\n')
team='''apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: retail-orders
spec:
  replicas: 2
  selector:
    matchLabels: {app.kubernetes.io/name: orders-api}
  template:
    metadata:
      labels: {app.kubernetes.io/name: orders-api}
    spec:
      containers:
        - name: orders-api
          image: registry.example.com/retail/orders-api:2.3.1
          ports: [{containerPort: 8080}]
'''
open(W+'/team-plain.yaml','w').write(cm.strip()+'\n---\n'+team+blk+'\n')
print('   ConfigMap keys:', re.findall(r'^  (CS_[A-Z_]+):', cm, re.M), '| namespace in ConfigMap:', re.findall(r'namespace: (\S+)', cm))
PY
KC $W/team-plain.yaml
say "S7 the image with missing or wrong configuration (one container each, removed by docker --rm)"
run(){ local out; out=$(docker run --rm "$@" health-sidecar:ci 2>&1 | head -3 | cut -c1-900); echo "$out"; }
echo "(a) nothing set:"; docker run --rm health-sidecar:ci 2>&1 | head -2 | cut -c1-600; echo "   exit ${PIPESTATUS[0]}"
echo "(b) endpoint without scheme:"; docker run --rm -e CS_ENDPOINT=communication.apps.example.com -e CS_TENANT=retail health-sidecar:ci 2>&1 | head -2 | cut -c1-600; echo "   exit ${PIPESTATUS[0]}"
echo "(c) CS_LOG_LEVEL=verbose:"; docker run --rm -e CS_ENDPOINT=http://x -e CS_TENANT=retail -e CS_LOG_LEVEL=verbose health-sidecar:ci 2>&1 | head -2 | cut -c1-600; echo "   exit ${PIPESTATUS[0]}"
echo "(d) CS_REPORT_TIMEOUT=0s:"; docker run --rm -e CS_ENDPOINT=http://x -e CS_TENANT=retail -e CS_REPORT_TIMEOUT=0s health-sidecar:ci 2>&1 | head -2 | cut -c1-600; echo "   exit ${PIPESTATUS[0]}"
echo "(e) CS_PROBE_TIMEOUT=-1s CS_HEARTBEAT=0 CS_STARTUP_GRACE=-5m CS_RETRY_DELAY=-1s:"; docker run --rm -e CS_ENDPOINT=http://x -e CS_TENANT=retail -e CS_PROBE_TIMEOUT=-1s -e CS_HEARTBEAT=0 -e CS_STARTUP_GRACE=-5m -e CS_RETRY_DELAY=-1s health-sidecar:ci 2>&1 | head -2 | cut -c1-900; echo "   exit ${PIPESTATUS[0]}"
echo "(f) CS_INTERVAL=0s:"; docker run --rm -e CS_ENDPOINT=http://x -e CS_TENANT=retail -e CS_INTERVAL=0s health-sidecar:ci 2>&1 | head -2 | cut -c1-600; echo "   exit ${PIPESTATUS[0]}"
echo "(g) CS_INTERVAL=15 (no unit):"; docker run --rm -e CS_ENDPOINT=http://x -e CS_TENANT=retail -e CS_INTERVAL=15 health-sidecar:ci 2>&1 | head -2 | cut -c1-600; echo "   exit ${PIPESTATUS[0]}"
echo "(h) many at once:"; docker run --rm -e CS_ENDPOINT=x -e CS_PROBE=tcp -e CS_INTERVAL=fast -e CS_LOG_LEVEL=loud -e CS_INSECURE_SKIP_VERIFY=maybe -e CS_REPORT_TIMEOUT=0 health-sidecar:ci 2>&1 | head -2 | cut -c1-1200; echo "   exit ${PIPESTATUS[0]}"
echo "(i) CS_CA_FILE that does not exist:"; docker run --rm -e CS_ENDPOINT=https://x -e CS_TENANT=retail -e CS_CA_FILE=/etc/no/ca.pem health-sidecar:ci 2>&1 | head -2 | cut -c1-600; echo "   exit ${PIPESTATUS[0]}"
echo "(j) CS_RETRY_DELAY=0 and CS_STARTUP_GRACE=0 (README: valid) + CS_LOG_LEVEL=DEBUG (case):"; timeout 6 docker run --rm --name ux4-cfg-ok -e CS_ENDPOINT=http://127.0.0.1:9 -e CS_TENANT=retail -e CS_SERVICE=x -e CS_RETRY_DELAY=0 -e CS_STARTUP_GRACE=0 -e CS_LOG_LEVEL=DEBUG -e CS_PORT=1 health-sidecar:ci 2>&1 | head -3 | cut -c1-300; docker rm -f ux4-cfg-ok >/dev/null 2>&1; echo "   (stopped after 6 s)"
echo "shell in the image (README: none)?"; docker run --rm --entrypoint /bin/sh health-sidecar:ci -c 'echo shell' 2>&1 | head -1
say "S8 README 'Build' commands on this host (go.mod: $(grep '^go ' $R/go.mod); host go $(cd / && go version | awk '{print $3}'))"
cd $R && timeout 500 go test ./... 2>&1 | tail -9; echo "go test exit ${PIPESTATUS[0]}"
timeout 300 go build -ldflags="-s -w -X main.version=1.0.0" -o $W/health-sidecar ./cmd/health-sidecar 2>&1 | tail -3; echo "go build exit ${PIPESTATUS[0]}"; ls -la $W/health-sidecar | awk '{print "   binary:", $5, "bytes"}'
echo "README laptop command (endpoint = private backend A; nothing listens on the pinned port):"
CS_ENDPOINT=http://127.0.0.1:19600 CS_TENANT=ux4-laptop CS_SERVICE=demo CS_PORT=19699 CS_LISTEN=:19615 timeout 4 $W/health-sidecar 2>&1 | head -4 | cut -c1-300
say "S9 image labels and user"
docker inspect health-sidecar:ci --format 'user={{.Config.User}} exposed={{json .Config.ExposedPorts}} version={{index .Config.Labels "org.opencontainers.image.version"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} size={{.Size}}'
