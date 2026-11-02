#!/bin/bash
# vs2: render every manifest form, validate with kubeconform (1.29 / 1.27), restricted-v2 facts, drift between forms, Helm required values, README images: override
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; W=$S/sidecar2; R=/home/claude/communication-service
export PATH=$S/tools:$PATH; O=$W/rendered; mkdir -p $O; cd $R/sidecar/deploy
echo "== $(date -u +%FT%TZ) head $(git -C $R rev-parse --short HEAD) | $(kustomize version) | $(helm version --short) | kubeconform $(kubeconform -v)"
kc(){ kubeconform -strict -summary -kubernetes-version $2 $1 2>&1 | tr '\n' ' '; echo "(exit=${PIPESTATUS[0]})"; }
echo "## 1. kustomize build (relative paths, from sidecar/deploy)"
for d in kustomize/example testdata/native-with-init; do kustomize build $d > $O/$(basename $d).yaml; echo "  $d -> exit=$? docs=$(grep -c '^kind:' $O/$(basename $d).yaml) kinds=$(grep '^kind:' $O/$(basename $d).yaml | tr '\n' ' ')"; done
for d in kustomize/example-native kustomize/images-override testdata/classic-with-init; do (cd $W/kz/deploy && kustomize build $d > $O/$(basename $d).yaml); echo "  (scratch copy of sidecar/deploy, relative component paths) $d -> exit=$? docs=$(grep -c '^kind:' $O/$(basename $d).yaml)"; done
echo "## 2. containers / initContainers per rendered workload"
python3 - $O/example.yaml $O/native-with-init.yaml $O/example-native.yaml $O/classic-with-init.yaml <<'PY'
import sys, yaml
for p in sys.argv[1:]:
    for d in yaml.safe_load_all(open(p)):
        if d and d.get("kind") in ("Deployment","StatefulSet"):
            s=d["spec"]["template"]["spec"]
            print("  %-22s %s/%s: initContainers=%s containers=%s" % (p.split("/")[-1], d["kind"], d["metadata"]["name"], [(c["name"], c.get("restartPolicy")) for c in s.get("initContainers") or []], [c["name"] for c in s["containers"]]))
        elif d and d.get("kind")=="ConfigMap": print("  %-22s ConfigMap/%s data=%s" % (p.split("/")[-1], d["metadata"]["name"], sorted(d.get("data",{}))))
PY
echo "## 3. Helm: lint the library, lint + template through the consumer chart (file:// dependency)"
helm lint $R/sidecar/deploy/helm/cs-health-sidecar 2>&1 | tail -3
(cd $W/helm/my-app && helm dependency update . 2>&1 | tail -2 && ls charts/)
helm lint $W/helm/my-app --set csHealthSidecar.endpoint=https://cs.example.com --set csHealthSidecar.tenant=retail 2>&1 | tail -2
echo "  helm template on the library alone:"; helm template x $R/sidecar/deploy/helm/cs-health-sidecar 2>&1 | head -2
echo "  consumer, classic:"; helm template my-app $W/helm/my-app --set csHealthSidecar.endpoint=https://cs.example.com --set csHealthSidecar.tenant=retail > $O/helm-classic.yaml; echo "   exit=$? docs=$(grep -c '^kind:' $O/helm-classic.yaml)"
echo "  consumer, native:"; helm template my-app $W/helm/my-app --set native=true --set csHealthSidecar.endpoint=https://cs.example.com --set csHealthSidecar.tenant=retail > $O/helm-native.yaml; echo "   exit=$? docs=$(grep -c '^kind:' $O/helm-native.yaml)"
echo "  consumer, pinned port + extraEnv + cluster + clientId + service literal:"; helm template my-app $W/helm/my-app --set csHealthSidecar.endpoint=https://cs.example.com --set csHealthSidecar.tenant=retail --set csHealthSidecar.port=8080 --set csHealthSidecar.path=/health --set csHealthSidecar.cluster=ocp-east --set csHealthSidecar.clientId=payments-repo --set csHealthSidecar.service=payments --set 'csHealthSidecar.extraEnv[0].name=CS_CA_FILE' --set 'csHealthSidecar.extraEnv[0].value=/certs/ca.pem' > $O/helm-pinned.yaml; echo "   exit=$?"; grep -nE 'CS_PORT|CS_PATH|CS_CLUSTER|CS_CLIENT_ID|CS_CA_FILE|CS_SERVICE' -A1 $O/helm-pinned.yaml | grep -vE '^--' | sed 's/^/     /' | head -14
echo "  missing endpoint:"; helm template my-app $W/helm/my-app --set csHealthSidecar.tenant=retail 2>&1 | head -2; echo "   exit=${PIPESTATUS[0]}"
echo "  missing tenant:"; helm template my-app $W/helm/my-app --set csHealthSidecar.endpoint=https://cs.example.com 2>&1 | head -2; echo "   exit=${PIPESTATUS[0]}"
python3 - $O/helm-classic.yaml $O/helm-native.yaml <<'PY'
import sys, yaml
for p in sys.argv[1:]:
    for d in yaml.safe_load_all(open(p)):
        if d and d.get("kind")=="Deployment":
            s=d["spec"]["template"]["spec"]; print("  %-18s initContainers=%s containers=%s" % (p.split("/")[-1], [(c["name"], c.get("restartPolicy")) for c in s.get("initContainers") or []], [c["name"] for c in s["containers"]]))
PY
echo "## 4. manual YAML"; cp manual/deployment.yaml $O/manual.yaml; echo "  docs=$(grep -c '^kind:' $O/manual.yaml)"
echo "## 5. kubeconform -strict"
for f in example native-with-init example-native classic-with-init images-override helm-classic helm-native helm-pinned manual; do printf "  %-18s 1.29.0: " $f; kc $O/$f.yaml 1.29.0; done
for f in example classic-with-init helm-classic helm-pinned manual; do printf "  %-18s 1.27.0: " $f; kc $O/$f.yaml 1.27.0; done
echo "  native forms against 1.27.0 (expected to be rejected: restartPolicy on init containers needs 1.29):"
for f in native-with-init helm-native; do printf "  %-18s 1.27.0: " $f; kc $O/$f.yaml 1.27.0; done
echo "## 6. restricted-v2 facts per rendered form (sidecar block only) and forbidden keys anywhere"
python3 - $O/example.yaml $O/native-with-init.yaml $O/helm-classic.yaml $O/helm-native.yaml $O/manual.yaml <<'PY'
import sys, yaml
want={"allowPrivilegeEscalation":False,"readOnlyRootFilesystem":True,"runAsNonRoot":True}
for p in sys.argv[1:]:
    raw=open(p).read()
    for d in yaml.safe_load_all(raw):
        if not d or d.get("kind") not in ("Deployment","StatefulSet"): continue
        s=d["spec"]["template"]["spec"]
        for lst in ("containers","initContainers"):
            for c in s.get(lst) or []:
                if c["name"]!="health-sidecar": continue
                sc=c.get("securityContext",{})
                ok=all(sc.get(k)==v for k,v in want.items()) and sc.get("capabilities",{}).get("drop")==["ALL"] and sc.get("seccompProfile",{}).get("type")=="RuntimeDefault"
                lp=c.get("livenessProbe",{}); res=c.get("resources",{})
                print("  %-20s %s/%s %s: securityContext %s %s | runAsUser=%s | liveness=%s every %ss | readiness=%s startup=%s | req=%s lim=%s | port=%s" % (p.split("/")[-1], d["kind"], d["metadata"]["name"], lst, "OK" if ok else "MISSING", sorted(sc), sc.get("runAsUser"), lp.get("httpGet"), lp.get("periodSeconds"), "readinessProbe" in c, "startupProbe" in c, res.get("requests"), res.get("limits"), c.get("ports")))
    for bad in ("runAsUser","privileged","hostNetwork","hostPID","hostIPC","hostPath","terminationGracePeriodSeconds","preStop"):
        if bad in raw: print("  %s: contains %s" % (p.split("/")[-1], bad))
PY
echo "## 7. drift between the forms (flattened sidecar block; restartPolicy ignored)"
python3 $W/blocks.py kustomize-classic=$O/example.yaml kustomize-native=$O/native-with-init.yaml manual=$O/manual.yaml helm-classic=$O/helm-classic.yaml helm-native=$O/helm-native.yaml
echo "## 8. README images: override rewrites only the sidecar image"; grep -n 'image:' $O/images-override.yaml
echo "## 9. the removed JSON-patch native file stays removed: $(ls kustomize/component/add-native-sidecar.yaml 2>&1)"
echo "## DONE"
