#!/bin/bash
# 40b: proof that Trivy analysed the Go binary (gobinary target, stdlib version) in the image and alone; JSON, every severity.
W=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
TRIVY(){ flock $S/orch-trivy/.lock docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v $S/orch-trivy/cache/trivy:/root/.cache/trivy -v $W/work/scan:/work mirror.gcr.io/aquasec/trivy:0.58.1 "$@"; }
summ(){ python3 -I -c '
import json,sys
d=json.load(sys.stdin)
for r in d.get("Results",[]):
    pk=r.get("Packages") or []; v=r.get("Vulnerabilities") or []
    names=[(p.get("Name"),p.get("Version")) for p in pk if p.get("Name") in ("stdlib","github.com/gonzalomunoz1024/communication-service/sidecar")]
    sev={}
    for x in v: sev[x["Severity"]]=sev.get(x["Severity"],0)+1
    print("  target=%s class=%s type=%s packages=%d go-packages=%s vulnerabilities=%d %s" % (r.get("Target"), r.get("Class"), r.get("Type"), len(pk), names, len(v), sev))
'; }
for spec in "image health-sidecar:vs4" "rootfs /work/vs4" "rootfs /work/control"; do
  echo "\$ trivy $spec --skip-db-update --skip-java-db-update --scanners vuln --list-all-pkgs --format json"
  TRIVY $spec --skip-db-update --skip-java-db-update --scanners vuln --list-all-pkgs --format json --quiet > $W/work/trivy.json 2>$W/work/trivy.err; echo "exit=$?"
  summ < $W/work/trivy.json
done
