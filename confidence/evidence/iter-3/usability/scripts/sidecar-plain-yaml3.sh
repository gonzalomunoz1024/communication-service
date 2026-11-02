#!/usr/bin/env bash
# sidecar-plain-yaml3.sh — the plain-YAML row read literally: only the container block is pasted into a team's Deployment
export PATH=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/tools:$PATH
R=/home/claude/communication-service/sidecar; W=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/usability3/sidecar-work/plain
rm -rf $W; mkdir -p $W
echo "### what the README says per attach path (sidecar/README.md)"; grep -n -E '^\| \*\*(Kustomize|Plain YAML)\*\*|For plain YAML|With Kustomize or the plain YAML' $R/README.md | cut -c1-230
echo; echo "### the linked file: header comment, the ConfigMap, the container's envFrom (deploy/manual/deployment.yaml)"; grep -n -E '^#|^kind:|^  name:|envFrom|configMapRef|name: cs-health-sidecar|optional' $R/deploy/manual/deployment.yaml
echo; echo "### 'optional' anywhere in the manual or Kustomize manifests"; grep -rn 'optional' $R/deploy/manual $R/deploy/kustomize --include=*.yaml || echo "(none)"
echo; echo "### the debugging section names a missing ConfigMap / CreateContainerConfigError?"; grep -n -i -E 'configmap.*not found|CreateContainerConfigError|ContainerConfig' $R/README.md || echo "(no)"
echo; echo "### team pastes the container block only: the Deployment document without the ConfigMap"
awk 'BEGIN{d=0} /^---$/{d++; next} d==1' $R/deploy/manual/deployment.yaml > $W/deployment-only.yaml
grep -c . $W/deployment-only.yaml | sed 's/^/lines: /'
kubeconform -strict -summary -kubernetes-version 1.29.0 $W/deployment-only.yaml 2>&1 | tail -2; echo "kubeconform exit ${PIPESTATUS[0]}"
echo "(schema validation passes: nothing before the kubelet notices that cs-health-sidecar is missing; the kubelet's answer was not exercised here, no cluster)"
