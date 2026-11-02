#!/bin/bash
# F-82..F-87, G-3-10: render every deploy form, validate with kubeconform -strict (1.27.0 and 1.29.0), check the
# sidecar's securityContext against the restricted profile, and paste the README's Helm lines verbatim.
. /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar3/scripts/lib.sh
export PATH=$S/tools:$PATH
D=$R/sidecar/deploy; K=$W/work/kust; HM=$W/work/helm; OUT=$W/work/rendered; mkdir -p $OUT
export HELM_CACHE_HOME=$HM/.cache HELM_CONFIG_HOME=$HM/.config HELM_DATA_HOME=$HM/.data
CHK="python3 -I $W/scripts/manicheck.py"
kc(){ # $1 file, $2 version
  local o; o=$(kubeconform -strict -summary -kubernetes-version $2 $1 2>&1); local c=$?
  echo "  kubeconform -strict $2 $(basename $1): exit=$c | $(echo "$o" | tail -1)"; [ $c -ne 0 ] && echo "$o" | grep -v Summary | head -4 | sed "s|$OUT/||; s/^/      /" | cut -c1-330; return 0
}
sec(){ echo; echo "### $*"; }
sec "1. Kustomize classic: repo example (components: [../component])"
kustomize build $D/kustomize/example > $OUT/kust-example.yaml; echo "  kustomize build example: exit=$?"
$CHK $OUT/kust-example.yaml kust-example
sec "2. Kustomize native: repo testdata (native component on a Deployment + StatefulSet that already have init containers)"
kustomize build $D/testdata/native-with-init > $OUT/kust-native-with-init.yaml; echo "  exit=$?"
$CHK $OUT/kust-native-with-init.yaml native-with-init
mkdir -p $K/example-native $K/classic-with-init $K/images-override
cp $D/kustomize/example/deployment.yaml $K/example-native/; cp $D/testdata/native-with-init/workloads.yaml $K/classic-with-init/; cp $D/kustomize/example/deployment.yaml $K/images-override/
cat > $K/example-native/kustomization.yaml <<Y
# the repo example switched to ../component-native, as its own comment says
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources: [deployment.yaml]
components: [$(realpath --relative-to=$K/example-native $D/kustomize/component-native)]
configMapGenerator:
  - name: cs-health-sidecar
    options: {disableNameSuffixHash: true}
    literals: [CS_ENDPOINT=https://communication.apps.example.com, CS_TENANT=retail, CS_CLUSTER=ocp-east]
Y
cat > $K/classic-with-init/kustomization.yaml <<Y
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources: [workloads.yaml]
components: [$(realpath --relative-to=$K/classic-with-init $D/kustomize/component)]
configMapGenerator:
  - name: cs-health-sidecar
    options: {disableNameSuffixHash: true}
    literals: [CS_ENDPOINT=https://communication.apps.example.com, CS_TENANT=retail]
Y
cat > $K/images-override/kustomization.yaml <<Y
# README "Image": images: override next to components:
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources: [deployment.yaml]
components: [$(realpath --relative-to=$K/images-override $D/kustomize/component)]
images:
  - name: registry.example.com/platform/health-sidecar
    newName: registry.apps.example.com/platform/health-sidecar
    newTag: "1.0.0"
configMapGenerator:
  - name: cs-health-sidecar
    options: {disableNameSuffixHash: true}
    literals: [CS_ENDPOINT=https://communication.apps.example.com, CS_TENANT=retail]
Y
for v in example-native classic-with-init images-override; do kustomize build $K/$v > $OUT/kust-$v.yaml; echo "  kustomize build $v: exit=$?"; $CHK $OUT/kust-$v.yaml $v; done
echo "  images-override: app image $(grep -c 'registry.example.com/retail/payments-api:1.4.2' $OUT/kust-images-override.yaml) x unchanged; sidecar image -> $(grep -o 'registry.apps.example.com/platform/health-sidecar:1.0.0' $OUT/kust-images-override.yaml | head -1)"
sec "3. Helm library chart: lint, template alone, consuming chart from the README's pieces (G-3-10)"
helm lint $D/helm/cs-health-sidecar 2>&1 | tail -2 | sed 's/^/  /'
helm template x $D/helm/cs-health-sidecar > $W/work/lib-alone.txt 2>&1; c=$?; echo "  helm template the library alone: $(tail -1 $W/work/lib-alone.txt) (exit $c)"
# the README's three pieces, verbatim except the dependency's repository (file:// to the repo chart)
mk_chart(){ # $1 dir, $2 template body file
  rm -rf $1; mkdir -p $1/templates
  cat > $1/Chart.yaml <<Y
apiVersion: v2
name: my-app
version: 0.1.0
dependencies:
  - name: cs-health-sidecar
    version: 1.0.0
    repository: file://$D/helm/cs-health-sidecar
Y
  printf 'csHealthSidecar:\n  endpoint: https://communication.apps.example.com\n  tenant: retail\n' > $1/values.yaml
  cp $2 $1/templates/deployment.yaml
}
HEAD='apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  labels:
    app.kubernetes.io/name: my-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: my-app
  template:
    metadata:
      labels:
        app.kubernetes.io/name: my-app
        app.kubernetes.io/version: "1.4.2"
    spec:'
# containers form: README lines 45-48 verbatim
{ echo "$HEAD"; sed -n '45,48p' $R/sidecar/README.md; } > $HM/tpl-containers.yaml
# initContainers form: README lines 84-85 verbatim, then the app's own containers
{ echo "$HEAD"; sed -n '84,85p' $R/sidecar/README.md; printf '      containers:\n        - name: my-app\n          image: registry.example.com/my-team/my-app:1.4.2\n'; } > $HM/tpl-init.yaml
echo "  README containers lines pasted:"; sed -n '45,48p' $R/sidecar/README.md | sed 's/^/    | /'
echo "  README initContainers lines pasted:"; sed -n '84,85p' $R/sidecar/README.md | sed 's/^/    | /'
# the claim at README 56-61: an include without | nindent 8, on its own line
{ echo "$HEAD"; printf '      containers:\n        - name: my-app\n          image: registry.example.com/my-team/my-app:1.4.2\n        {{ include "cs-health-sidecar.container" . }}\n'; } > $HM/tpl-no-nindent.yaml
for f in containers init no-nindent; do
  mk_chart $HM/my-app-$f $HM/tpl-$f.yaml
  helm dependency update $HM/my-app-$f > /dev/null 2>&1; echo "  [$f] helm dependency update: exit=$?"
  helm lint $HM/my-app-$f > $W/work/lint.txt 2>&1; c=$?; echo "  [$f] helm lint: $(grep -E 'linted|ERROR|WARNING' $W/work/lint.txt | tr '\n' ' ') (exit $c)"
  helm template my-app $HM/my-app-$f > $OUT/helm-$f.yaml 2> $W/work/helm-$f.err; echo "  [$f] helm template: exit=$? $(head -c 200 $W/work/helm-$f.err)"
  [ $f != no-nindent ] && $CHK $OUT/helm-$f.yaml helm-$f
done
echo "  [no-nindent] rendered sidecar lines: $(grep -n 'name: health-sidecar\|^  image: registry.example.com/platform\|^  env:' $OUT/helm-no-nindent.yaml | head -3 | tr '\n' ' ')"
sec "4. Helm values: pinned port/path, extraEnv, literal service, clientId, cluster, image override; missing required values"
mk_chart $HM/my-app-pinned $HM/tpl-containers.yaml
cat > $HM/my-app-pinned/values.yaml <<Y
csHealthSidecar:
  endpoint: https://communication.apps.example.com
  tenant: retail
  cluster: ocp-east
  clientId: my-app-repo
  service: my-app-svc
  port: 8080
  path: /health
  image: {repository: registry.apps.example.com/platform/health-sidecar, tag: "1.0.0"}
  extraEnv:
    - {name: CS_CA_FILE, value: /etc/cs-ca/ca.pem}
    - {name: CS_LOG_LEVEL, value: debug}
Y
helm dependency update $HM/my-app-pinned >/dev/null 2>&1; helm template my-app $HM/my-app-pinned > $OUT/helm-pinned.yaml; echo "  [pinned] helm template: exit=$?"; $CHK $OUT/helm-pinned.yaml helm-pinned
for miss in endpoint tenant; do
  mk_chart $HM/my-app-miss-$miss $HM/tpl-containers.yaml
  grep -v "  $miss:" $HM/my-app-miss-$miss/values.yaml > $HM/v.tmp; mv $HM/v.tmp $HM/my-app-miss-$miss/values.yaml
  helm dependency update $HM/my-app-miss-$miss >/dev/null 2>&1
  helm template my-app $HM/my-app-miss-$miss > $W/work/miss.txt 2>&1; c=$?; echo "  [missing $miss] helm template: exit $c: $(grep -o 'csHealthSidecar[^\"]*is required' $W/work/miss.txt | head -1) | $(head -1 $W/work/miss.txt | cut -c1-160)"
done
sec "5. Plain YAML (deploy/manual/deployment.yaml)"
cp $D/manual/deployment.yaml $OUT/manual.yaml; $CHK $OUT/manual.yaml manual
sec "6. kubeconform -strict, Kubernetes 1.27.0 and 1.29.0 (native forms are expected to fail on 1.27.0: restartPolicy on a container is 1.28+)"
for f in kust-example kust-native-with-init kust-example-native kust-classic-with-init kust-images-override helm-containers helm-init helm-pinned helm-no-nindent manual; do
  for v in 1.27.0 1.29.0; do kc $OUT/$f.yaml $v; done
done
sec "7. the sidecar container block is the same in the three paths (Kustomize classic vs manual vs Helm), env aside"
python3 -I - $OUT/kust-example.yaml $OUT/manual.yaml $OUT/helm-containers.yaml <<'PY'
import sys, yaml, json
def side(p):
    for d in yaml.safe_load_all(open(p)):
        if d and d.get("kind") == "Deployment":
            for c in d["spec"]["template"]["spec"]["containers"]:
                if c["name"] == "health-sidecar": return c
k, m, h = (side(p) for p in sys.argv[1:])
for name, o in (("manual", m), ("helm", h)):
    diff = sorted(x for x in set(k) | set(o) if json.dumps(k.get(x), sort_keys=True) != json.dumps(o.get(x), sort_keys=True))
    print("  kustomize vs %s: differing keys %s" % (name, diff))
print("  helm env names:", [e["name"] for e in h["env"]])
PY
sec "8. no readiness/startup probe, no preStop, no terminationGracePeriodSeconds in any snippet source"
grep -rn "readinessProbe\|startupProbe\|preStop\|terminationGracePeriodSeconds\|runAsUser\|privileged\|hostNetwork\|hostPath" $D --include=*.yaml --include=*.tpl | grep -v testdata | grep -v "payments-api\|readiness$" || echo "  none in the sidecar snippets (the example app's own readinessProbe aside)"
grep -n "readinessProbe" $D/kustomize/example/deployment.yaml | sed 's/^/  example app (team-owned): /'
