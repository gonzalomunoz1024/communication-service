# Checks rendered manifests: lists containers/initContainers of each workload, and the health-sidecar
# container against the Kubernetes Pod Security "restricted" rules and the OpenShift restricted-v2 SCC
# expectations (no runAsUser, no privileged, no host namespaces/paths, drop ALL, RuntimeDefault, no escalation).
import sys, yaml, json
docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
label = sys.argv[2]
for d in docs:
    k = d.get("kind"); n = d.get("metadata", {}).get("name")
    if k not in ("Deployment", "StatefulSet", "DaemonSet"):
        extra = ""
        if k == "ConfigMap": extra = " data=" + json.dumps(d.get("data"))
        print(f"  [{label}] {k}/{n}{extra}"); continue
    spec = d["spec"]["template"]["spec"]
    inits = [c["name"] + ("(restartPolicy=%s)" % c["restartPolicy"] if c.get("restartPolicy") else "") for c in spec.get("initContainers") or []]
    apps = [c["name"] for c in spec.get("containers") or []]
    print(f"  [{label}] {k}/{n}: initContainers={inits} containers={apps}")
    pod_bad = [x for x in ("hostNetwork", "hostPID", "hostIPC") if spec.get(x)]
    pod_bad += ["hostPath volume " + v["name"] for v in spec.get("volumes") or [] if "hostPath" in v]
    if "terminationGracePeriodSeconds" in spec: pod_bad.append("terminationGracePeriodSeconds=%s" % spec["terminationGracePeriodSeconds"])
    for c in (spec.get("initContainers") or []) + (spec.get("containers") or []):
        if c["name"] != "health-sidecar": continue
        sc = c.get("securityContext") or {}
        checks = {
            "allowPrivilegeEscalation=false": sc.get("allowPrivilegeEscalation") is False,
            "readOnlyRootFilesystem=true": sc.get("readOnlyRootFilesystem") is True,
            "runAsNonRoot=true": sc.get("runAsNonRoot") is True,
            "capabilities.drop=[ALL]": (sc.get("capabilities") or {}).get("drop") == ["ALL"],
            "no capabilities.add": not (sc.get("capabilities") or {}).get("add"),
            "seccompProfile=RuntimeDefault": (sc.get("seccompProfile") or {}).get("type") == "RuntimeDefault",
            "no runAsUser/runAsGroup (arbitrary UID)": "runAsUser" not in sc and "runAsGroup" not in sc,
            "not privileged": not sc.get("privileged"),
            "no hostPort": all("hostPort" not in p for p in c.get("ports") or []),
            "no preStop": "preStop" not in (c.get("lifecycle") or {}),
        }
        failed = [k2 for k2, ok in checks.items() if not ok]
        env = {e["name"]: (e.get("value") if "value" in e else "fieldRef:" + e["valueFrom"]["fieldRef"]["fieldPath"]) for e in c.get("env") or []}
        print(f"    health-sidecar image={c.get('image')} pullPolicy={c.get('imagePullPolicy')} restartPolicy={c.get('restartPolicy')}")
        print(f"    envFrom={[x.get('configMapRef',{}).get('name') for x in c.get('envFrom') or []]} env={json.dumps(env)}")
        print(f"    ports={json.dumps(c.get('ports'))} liveness={json.dumps(c.get('livenessProbe'))} readiness={c.get('readinessProbe')} startup={c.get('startupProbe')}")
        print(f"    resources={json.dumps(c.get('resources'))}")
        print(f"    restricted checks: {len(checks)-len(failed)}/{len(checks)} pass" + (f" FAILED: {failed}" if failed else "") + (f"; pod-level: {pod_bad}" if pod_bad else "; pod-level: no host namespaces/hostPath/grace override"))
