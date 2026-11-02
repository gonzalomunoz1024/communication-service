#!/usr/bin/env bash
# sidecar-manifests.sh — platform engineer renders every documented attach path from sidecar/README.md alone
export PATH=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/tools:$PATH
R=/home/claude/communication-service/sidecar; W=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/usability2/sidecar-work
rm -rf $W; mkdir -p $W; cp -r $R/deploy/kustomize $W/kz; cp -r $R/deploy/helm $W/helm
say(){ printf '\n### %s\n' "$*"; }
say "S1 Kustomize as shipped: kustomize build deploy/kustomize/example (classic component)"
kustomize build $W/kz/example > $W/kz-classic.yaml; echo "kustomize exit $?"
grep -n "^kind:\|  name: health-sidecar\|image: registry\|configMapRef\|CS_ENDPOINT\|runAsNonRoot\|containers:\|initContainers:" $W/kz-classic.yaml | head -20
kubeconform -strict -summary -kubernetes-version 1.29.0 $W/kz-classic.yaml
say "S2 native form: README says 'point components at ../component-native'"
mkdir -p $W/kz/example-native; cp $W/kz/example/deployment.yaml $W/kz/example-native/; sed 's#- \.\./component$#- ../component-native#' $W/kz/example/kustomization.yaml > $W/kz/example-native/kustomization.yaml
grep -n "component" $W/kz/example-native/kustomization.yaml
kustomize build $W/kz/example-native > $W/kz-native.yaml; echo "kustomize exit $?"
grep -n "initContainers:\|restartPolicy\|  name: health-sidecar\|containers:" $W/kz-native.yaml | head
kubeconform -strict -summary -kubernetes-version 1.29.0 $W/kz-native.yaml
say "S3 README 'Image' section: the images: override appended literally to the example kustomization"
cp -r $W/kz/example $W/kz/example-img; printf 'images:\n  - name: registry.example.com/platform/health-sidecar\n    newName: registry.apps.example.com/platform/health-sidecar\n    newTag: "1.0.0"\n' >> $W/kz/example-img/kustomization.yaml
kustomize build $W/kz/example-img | grep -n "image:"
say "S4 helm template on the library chart alone (README: fails by design)"
helm template x $W/helm/cs-health-sidecar 2>&1 | head -2
say "S5 consuming chart written from the README alone: dependency + include under containers + two values"
mkdir -p $W/my-app/templates $W/my-app/charts; cp -r $W/helm/cs-health-sidecar $W/my-app/charts/
printf 'apiVersion: v2\nname: my-app\nversion: 0.1.0\ndependencies:\n  - name: cs-health-sidecar\n    version: 1.0.0\n    repository: file://charts/cs-health-sidecar\n' > $W/my-app/Chart.yaml
printf 'csHealthSidecar:\n  endpoint: https://communication.apps.example.com\n  tenant: retail\n' > $W/my-app/values.yaml
cat > $W/my-app/templates/deployment.yaml <<'Y'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  selector:
    matchLabels: {app: my-app}
  template:
    metadata:
      labels: {app: my-app}
    spec:
      containers:
        - name: my-app
          image: registry.example.com/retail/my-app:1.0.0
        {{ include "cs-health-sidecar.container" . }}
Y
(cd $W/my-app && helm dependency build >/dev/null 2>&1; echo "helm dependency build exit $?")
echo "(a) the include pasted literally as the README prints it:"
helm template my-app $W/my-app > $W/helm-literal.yaml 2> $W/helm-literal.err; echo "   helm template exit $?"; head -c 400 $W/helm-literal.err; echo
[ -s $W/helm-literal.yaml ] && kubeconform -strict -summary -kubernetes-version 1.29.0 $W/helm-literal.yaml 2>&1 | tail -2
echo "(b) with '| nindent 8', as the template file's own comment shows:"
sed -i 's#{{ include "cs-health-sidecar.container" . }}#{{- include "cs-health-sidecar.container" . | nindent 8 }}#' $W/my-app/templates/deployment.yaml
helm template my-app $W/my-app > $W/helm-nindent.yaml 2> $W/helm-nindent.err; echo "   helm template exit $?"; head -c 300 $W/helm-nindent.err
grep -n "  name: health-sidecar\|CS_ENDPOINT\|CS_TENANT\|runAsNonRoot\|image: registry" -A1 $W/helm-nindent.yaml | grep -v "^--" | head -12
kubeconform -strict -summary -kubernetes-version 1.29.0 $W/helm-nindent.yaml 2>&1 | tail -1
helm lint $W/my-app 2>&1 | tail -2
echo "(c) tenant left empty -> what the engineer reads:"; helm template my-app $W/my-app --set csHealthSidecar.tenant= 2>&1 | head -2
echo "(d) the README's Helm image override values:"; helm template my-app $W/my-app --set csHealthSidecar.image.repository=registry.apps.example.com/platform/health-sidecar --set csHealthSidecar.image.tag=1.0.0 | grep -n "image:"
echo "(e) native form: include cs-health-sidecar.initContainer under initContainers"
cat > $W/my-app/templates/deployment.yaml <<'Y'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  selector:
    matchLabels: {app: my-app}
  template:
    metadata:
      labels: {app: my-app}
    spec:
      initContainers:
        {{- include "cs-health-sidecar.initContainer" . | nindent 8 }}
      containers:
        - name: my-app
          image: registry.example.com/retail/my-app:1.0.0
Y
helm template my-app $W/my-app > $W/helm-native.yaml 2>&1; echo "   helm template exit $?"; grep -n "initContainers:\|restartPolicy\|  name: health-sidecar" $W/helm-native.yaml | head -4
kubeconform -strict -summary -kubernetes-version 1.29.0 $W/helm-native.yaml 2>&1 | tail -1
say "S6 plain YAML snippet: kubeconform, and is its container block the Kustomize one?"
kubeconform -strict -summary -kubernetes-version 1.29.0 $R/deploy/manual/deployment.yaml
python3 -I - <<'PY'
import re
manual=open('/home/claude/communication-service/sidecar/deploy/manual/deployment.yaml').read()
kz=open('/home/claude/communication-service/sidecar/deploy/kustomize/component/add-sidecar.yaml').read()
block=manual[manual.index('- name: health-sidecar'):]
kzblock=kz[kz.index('name: health-sidecar'):]
norm=lambda s: [l.strip() for l in s.splitlines() if l.strip() and not l.strip().startswith('#')]
a,b=norm(block),norm(kzblock); a[0]=a[0].lstrip('- ')
print('   identical settings (ignoring indentation):', a==b, '| lines', len(a), len(b))
if a!=b: print('   differences:', [x for x in a if x not in b], [x for x in b if x not in a])
PY
say "S7 the image with missing or wrong configuration (README: CS_ENDPOINT and CS_TENANT required)"
docker run --rm health-sidecar:ci 2>&1 | head -5; echo "exit ${PIPESTATUS[0]}"
docker run --rm -e CS_ENDPOINT=communication.apps.example.com -e CS_TENANT=retail health-sidecar:ci 2>&1 | head -3; echo "exit ${PIPESTATUS[0]}"
docker run --rm -e CS_ENDPOINT=http://x -e CS_TENANT=retail -e CS_PROBE=tcp health-sidecar:ci 2>&1 | head -3; echo "exit ${PIPESTATUS[0]}"
docker run --rm -e CS_ENDPOINT=http://x -e CS_TENANT=retail -e CS_INTERVAL=fast health-sidecar:ci 2>&1 | head -3; echo "exit ${PIPESTATUS[0]}"
echo "shell in the image (README: none)?"; docker run --rm --entrypoint /bin/sh health-sidecar:ci -c 'echo shell' 2>&1 | head -2
say "S8 README 'Build' commands on this host (go $(go version | awk '{print $3}'), go.mod wants 1.25)"
cd $R && grep -n "^go \|^toolchain" go.mod
timeout 400 go vet ./... 2>&1 | tail -3; echo "go vet exit ${PIPESTATUS[0]}"
timeout 400 go build -ldflags="-s -w -X main.version=1.0.0" -o $W/health-sidecar ./cmd/health-sidecar 2>&1 | tail -3; echo "go build exit ${PIPESTATUS[0]}"; ls -la $W/health-sidecar 2>/dev/null | awk '{print "   binary:", $5, "bytes"}'
echo "README laptop command (wrong port on purpose, 4 s):"; CS_ENDPOINT=http://127.0.0.1:19600 CS_TENANT=ux2-laptop CS_SERVICE=demo CS_PORT=8089 CS_LISTEN=:19614 timeout 4 $W/health-sidecar 2>&1 | head -4
say "S9 image labels/user of the ci build (README: version + revision labels)"
docker inspect health-sidecar:ci --format 'user={{.Config.User}} exposed={{json .Config.ExposedPorts}} version={{index .Config.Labels "org.opencontainers.image.version"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} size={{.Size}}'
