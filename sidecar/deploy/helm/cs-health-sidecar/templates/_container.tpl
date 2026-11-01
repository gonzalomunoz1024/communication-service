{{/*
Renders the health sidecar container. In the consuming chart:

  # Chart.yaml
  dependencies:
    - name: cs-health-sidecar
      version: 1.0.0
      repository: https://charts.example.com/platform

  # templates/deployment.yaml, under spec.template.spec.containers
  {{- include "cs-health-sidecar.container" . | nindent 8 }}

  # values.yaml
  csHealthSidecar:
    endpoint: https://communication.apps.example.com
    tenant: retail

For a native sidecar (OpenShift 4.16+), include "cs-health-sidecar.initContainer" under
initContainers instead.
*/}}
{{- define "cs-health-sidecar.spec" -}}
{{- $v := .Values.csHealthSidecar | default dict -}}
{{- $image := $v.image | default dict -}}
name: health-sidecar
image: {{ $image.repository | default "registry.example.com/platform/health-sidecar" }}:{{ $image.tag | default "1.0.0" }}
imagePullPolicy: {{ $image.pullPolicy | default "IfNotPresent" }}
env:
  - name: CS_ENDPOINT
    value: {{ required "csHealthSidecar.endpoint is required" $v.endpoint | quote }}
  - name: CS_TENANT
    value: {{ required "csHealthSidecar.tenant is required" $v.tenant | quote }}
  {{- with $v.cluster }}
  - name: CS_CLUSTER
    value: {{ . | quote }}
  {{- end }}
  {{- with $v.clientId }}
  - name: CS_CLIENT_ID
    value: {{ . | quote }}
  {{- end }}
  {{- with $v.probe }}
  - name: CS_PROBE
    value: {{ . | quote }}
  {{- end }}
  {{- with $v.port }}
  - name: CS_PORT
    value: {{ . | quote }}
  {{- end }}
  {{- with $v.path }}
  - name: CS_PATH
    value: {{ . | quote }}
  {{- end }}
  {{- with $v.scheme }}
  - name: CS_SCHEME
    value: {{ . | quote }}
  {{- end }}
  - name: CS_INTERVAL
    value: {{ $v.interval | default "15s" | quote }}
  - name: CS_HEARTBEAT
    value: {{ $v.heartbeat | default "30s" | quote }}
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: POD_NAMESPACE
    valueFrom:
      fieldRef:
        fieldPath: metadata.namespace
  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
  - name: CS_SERVICE
    {{- if $v.service }}
    value: {{ $v.service | quote }}
    {{- else }}
    valueFrom:
      fieldRef:
        fieldPath: metadata.labels['app.kubernetes.io/name']
    {{- end }}
  - name: CS_VERSION
    valueFrom:
      fieldRef:
        fieldPath: metadata.labels['app.kubernetes.io/version']
  {{- with $v.extraEnv }}
  {{- toYaml . | nindent 2 }}
  {{- end }}
ports:
  - name: cs-status
    containerPort: 9465
    protocol: TCP
livenessProbe:
  httpGet:
    path: /healthz
    port: cs-status
  periodSeconds: 30
resources:
  {{- toYaml ($v.resources | default (dict "requests" (dict "cpu" "10m" "memory" "16Mi") "limits" (dict "cpu" "50m" "memory" "32Mi"))) | nindent 2 }}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault
{{- end -}}

{{- define "cs-health-sidecar.container" -}}
- {{ include "cs-health-sidecar.spec" . | nindent 2 | trim }}
{{- end -}}

{{- define "cs-health-sidecar.initContainer" -}}
- restartPolicy: Always
  {{ include "cs-health-sidecar.spec" . | nindent 2 | trim }}
{{- end -}}
