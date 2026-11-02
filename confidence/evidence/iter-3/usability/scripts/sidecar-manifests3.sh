#!/usr/bin/env bash
# sidecar-manifests3.sh — a platform engineer renders every attach path from sidecar/README.md alone (iteration 3)
export PATH=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/tools:$PATH
R=/home/claude/communication-service/sidecar; W=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/usability3/sidecar-work
rm -rf $W; mkdir -p $W; cp -r $R/deploy/kustomize $W/kz; cp -r $R/deploy/helm $W/helm
say(){ printf '\n### %s\n' "$*"; }
KC(){ kubeconform -strict -summary -kubernetes-version 1.29.0 "$@" 2>&1 | tail -3; }
say "S1 Kustomize classic, the example as shipped"
kustomize build $W/kz/example > $W/kz-classic.yaml; echo "kustomize exit $?"; KC $W/kz-classic.yaml
say "S2 native: the example pointed at ../component-native (README + the example's own comment)"
mkdir -p $W/kz/example-native; cp $W/kz/example/deployment.yaml $W/kz/example-native/; sed 's#- \.\./component$#- ../component-native#' $W/kz/example/kustomization.yaml > $W/kz/example-native/kustomization.yaml
kustomize build $W/kz/example-native > $W/kz-native.yaml; echo "kustomize exit $?"; grep -n "initContainers:\|restartPolicy: Always\|  name: health-sidecar" $W/kz-native.yaml | head -3; KC $W/kz-native.yaml
say "S3 README 'Image' block appended to the example kustomization"
cp -r $W/kz/example $W/kz/example-img; printf 'images:\n  - name: registry.example.com/platform/health-sidecar\n    newName: registry.apps.example.com/platform/health-sidecar\n    newTag: "1.0.0"\n' >> $W/kz/example-img/kustomization.yaml
kustomize build $W/kz/example-img | grep -n "image:"
say "S3b README Debugging: CS_LOG_LEVEL=debug added to the cs-health-sidecar ConfigMap (Kustomize)"
cp -r $W/kz/example $W/kz/example-debug; sed -i 's#      - CS_CLUSTER=ocp-east#      - CS_CLUSTER=ocp-east\n      - CS_LOG_LEVEL=debug#' $W/kz/example-debug/kustomization.yaml
kustomize build $W/kz/example-debug > $W/kz-debug.yaml; echo "kustomize exit $?"; grep -n "CS_LOG_LEVEL\|configMapRef" -A1 $W/kz-debug.yaml | head -6; KC $W/kz-debug.yaml
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
PY
(cd $W/my-app && helm dependency build >/dev/null 2>&1; echo "helm dependency build exit $?")
echo "(a) as printed:"; helm template my-app $W/my-app > $W/helm-readme.yaml 2> $W/helm-readme.err; echo "   helm template exit $?"; head -c 300 $W/helm-readme.err
KC $W/helm-readme.yaml; helm lint $W/my-app 2>&1 | tail -1
cp $W/my-app/templates/deployment.yaml $W/deployment-readme.yaml
echo "(b) the README's warning case: the include without | nindent 8, on its own line"
sed 's#{{- include "cs-health-sidecar.container" . | nindent 8 }}#        {{ include "cs-health-sidecar.container" . }}#' $W/deployment-readme.yaml > $W/my-app/templates/deployment.yaml
helm template my-app $W/my-app > $W/helm-noindent.yaml 2>&1; echo "   helm template exit $?"; KC $W/helm-noindent.yaml; helm lint $W/my-app 2>&1 | tail -1
cp $W/deployment-readme.yaml $W/my-app/templates/deployment.yaml
echo "(c) tenant left empty:"; helm template my-app $W/my-app --set csHealthSidecar.tenant= 2>&1 | head -2
echo "(d) README image values:"; helm template my-app $W/my-app --set csHealthSidecar.image.repository=registry.apps.example.com/platform/health-sidecar --set csHealthSidecar.image.tag=1.0.0 | grep -n "image:"
echo "(e) native: the README's initContainers lines"
python3 -I - "$W" <<'PY'
import sys; W = sys.argv[1]; d = open(W + '/deployment-readme.yaml').read(); nat = open(W + '/native-snippet.txt').read()
d = d.replace('    spec:\n', '    spec:\n' + nat + '\n', 1); open(W + '/my-app/templates/deployment.yaml', 'w').write(d)
PY
grep -n "initContainers\|include" $W/my-app/templates/deployment.yaml
helm template my-app $W/my-app > $W/helm-native.yaml 2>&1; echo "   helm template exit $?"; grep -c "restartPolicy: Always" $W/helm-native.yaml; KC $W/helm-native.yaml
cp $W/deployment-readme.yaml $W/my-app/templates/deployment.yaml
echo "(f) README Debugging with Helm: CS_LOG_LEVEL in csHealthSidecar.extraEnv as a Kubernetes env list"
printf 'csHealthSidecar:\n  extraEnv:\n    - name: CS_LOG_LEVEL\n      value: debug\n' > $W/debug-list.yaml
helm template my-app $W/my-app -f $W/debug-list.yaml > $W/helm-debug-list.yaml 2>&1; echo "   helm template exit $?"; grep -n "CS_LOG_LEVEL" -A1 $W/helm-debug-list.yaml; KC $W/helm-debug-list.yaml
echo "(g) the same as a map (CS_LOG_LEVEL: debug), the other shape an engineer might guess from 'extraEnv'"
printf 'csHealthSidecar:\n  extraEnv:\n    CS_LOG_LEVEL: debug\n' > $W/debug-map.yaml
helm template my-app $W/my-app -f $W/debug-map.yaml > $W/helm-debug-map.yaml 2>&1; echo "   helm template exit $?"; grep -n "CS_LOG_LEVEL" -B1 -A1 $W/helm-debug-map.yaml | head -4; KC $W/helm-debug-map.yaml
cp $W/my-app/values.yaml $W/values-orig.yaml; cat $W/values-orig.yaml $W/debug-map.yaml | python3 -I -c "import sys;print(sys.stdin.read())" > /dev/null; printf 'csHealthSidecar:\n  endpoint: https://communication.apps.example.com\n  tenant: retail\n  extraEnv:\n    CS_LOG_LEVEL: debug\n' > $W/my-app/values.yaml; echo "   helm lint with the map in values.yaml:"; helm lint $W/my-app 2>&1 | tail -1; cp $W/values-orig.yaml $W/my-app/values.yaml
say "S6 plain YAML: valid? the same container as the Kustomize patch? CS_LOG_LEVEL in its ConfigMap"
KC $R/deploy/manual/deployment.yaml
python3 -I - <<'PY'
manual=open('/home/claude/communication-service/sidecar/deploy/manual/deployment.yaml').read()
kz=open('/home/claude/communication-service/sidecar/deploy/kustomize/component/add-sidecar.yaml').read()
block=manual[manual.index('- name: health-sidecar'):]; kzblock=kz[kz.index('name: health-sidecar'):]
norm=lambda s: [l.strip() for l in s.splitlines() if l.strip() and not l.strip().startswith('#')]
a,b=norm(block),norm(kzblock); a[0]=a[0].lstrip('- ')
print('   identical settings (ignoring indentation):', a==b, '| lines', len(a), len(b))
if a!=b: print('   only in manual:', [x for x in a if x not in b][:6], '| only in kustomize:', [x for x in b if x not in a][:6])
PY
sed -n '1,12p' $R/deploy/manual/deployment.yaml
say "S7 the image with missing or wrong configuration"
docker run --rm health-sidecar:ci 2>&1 | head -3; echo "exit ${PIPESTATUS[0]}"
docker run --rm -e CS_ENDPOINT=communication.apps.example.com -e CS_TENANT=retail health-sidecar:ci 2>&1 | head -2; echo "exit ${PIPESTATUS[0]}"
docker run --rm -e CS_ENDPOINT=http://x -e CS_TENANT=retail -e CS_LOG_LEVEL=verbose health-sidecar:ci 2>&1 | head -2; echo "exit ${PIPESTATUS[0]}"
docker run --rm -e CS_ENDPOINT=http://x -e CS_TENANT=retail -e CS_LOG_LEVEL=DEBUG -e CS_STARTUP_GRACE=1s timeout 3 2>/dev/null; timeout 4 docker run --rm --name ux3-cfg-debug -e CS_ENDPOINT=http://127.0.0.1:9 -e CS_TENANT=retail -e CS_SERVICE=x -e CS_LOG_LEVEL=DEBUG -e CS_PORT=1 health-sidecar:ci 2>&1 | head -3 | cut -c1-260; docker rm -f ux3-cfg-debug >/dev/null 2>&1
docker run --rm -e CS_ENDPOINT=http://x -e CS_TENANT=retail -e CS_INSECURE_SKIP_VERIFY=maybe health-sidecar:ci 2>&1 | head -2; echo "exit ${PIPESTATUS[0]}"
docker run --rm -e CS_ENDPOINT=x -e CS_PROBE=tcp -e CS_INTERVAL=fast -e CS_LOG_LEVEL=loud -e CS_INSECURE_SKIP_VERIFY=maybe health-sidecar:ci 2>&1 | head -2 | cut -c1-700; echo "exit ${PIPESTATUS[0]}"
echo "shell in the image (README: none)?"; docker run --rm --entrypoint /bin/sh health-sidecar:ci -c 'echo shell' 2>&1 | head -1
say "S8 README 'Build' commands on this host (go $(go version | awk '{print $3}'), go.mod: $(grep '^go ' $R/go.mod))"
cd $R && timeout 500 go test ./... 2>&1 | tail -8; echo "go test exit ${PIPESTATUS[0]}"
timeout 300 go build -ldflags="-s -w -X main.version=1.0.0" -o $W/health-sidecar ./cmd/health-sidecar 2>&1 | tail -3; echo "go build exit ${PIPESTATUS[0]}"; ls -la $W/health-sidecar | awk '{print "   binary:", $5, "bytes"}'
echo "README laptop command (endpoint = private backend A, nothing on 8080 in this namespace -> pinned port never answers):"
CS_ENDPOINT=http://127.0.0.1:19600 CS_TENANT=ux3-laptop CS_SERVICE=demo CS_PORT=19699 CS_LISTEN=:19615 timeout 4 $W/health-sidecar 2>&1 | head -4 | cut -c1-260
say "S9 image labels and user"
docker inspect health-sidecar:ci --format 'user={{.Config.User}} exposed={{json .Config.ExposedPorts}} version={{index .Config.Labels "org.opencontainers.image.version"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} size={{.Size}}'
