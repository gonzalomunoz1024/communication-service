package deploy

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// includeLine matches an include of the library chart's two templates: the line a consuming
// chart pastes into its Deployment, as the README prints it and as the chart's comment shows it.
var includeLine = regexp.MustCompile(`\{\{-?\s*include "cs-health-sidecar\.(container|initContainer)" [^}]*\}\}`)

// includeLines returns the include lines in text by template name.
func includeLines(text string) map[string][]string {
	out := map[string][]string{}
	for _, m := range includeLine.FindAllStringSubmatch(text, -1) {
		out[m[1]] = append(out[m[1]], m[0])
	}
	return out
}

// G-3-10 (UX-46): the Helm lines the README tells a team to paste must render a valid pod.
// Without `| nindent 8` the include's second and later lines land at column 0, so helm template
// and helm lint accept the chart while the API server rejects the Deployment. Each include line
// the README prints must be the one the chart's own comment shows, and pasted under its list in
// a consuming chart's Deployment it must render the expected containers and pass
// kubeconform -strict.
func TestHelmIncludeLinesFromTheReadmeRenderAValidDeployment(t *testing.T) {
	helm, ok := requireTool(t, "helm")
	if !ok {
		t.Skip("helm not on PATH")
	}
	readme := includeLines(readFile(t, filepath.Join("..", "README.md")))
	chart := includeLines(readFile(t, filepath.Join("helm", "cs-health-sidecar", "templates", "_container.tpl")))
	for _, tc := range []struct {
		name, list string
		init, apps []string // the rendered initContainers and containers
		versions   []string // Kubernetes versions to validate against
	}{
		{"container", "containers", nil, []string{"payments-api", "health-sidecar"}, []string{"1.27.0", "1.29.0"}},
		{"initContainer", "initContainers", []string{"db-migrate", "health-sidecar"}, []string{"payments-api"}, []string{"1.29.0"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lines := readme[tc.name]
			if len(lines) == 0 {
				t.Fatalf("the README prints no include line for cs-health-sidecar.%s", tc.name)
			}
			for _, line := range lines {
				if !slices.Contains(chart[tc.name], line) {
					t.Errorf("the README prints %q; the chart's own comment shows %q", line, chart[tc.name])
				}
			}
			rendered := renderConsumingChart(t, helm, tc.list, lines[0])
			doc := workload(t, rendered, "Deployment", "payments-api")
			if got := names(listItems(doc, "initContainers")); !slices.Equal(got, tc.init) {
				t.Errorf("rendered initContainers %v, want %v", got, tc.init)
			}
			if got := names(listItems(doc, "containers")); !slices.Equal(got, tc.apps) {
				t.Errorf("rendered containers %v, want %v", got, tc.apps)
			}
			if tc.init != nil {
				if sc := find(listItems(doc, "initContainers"), "health-sidecar"); sc == nil || fieldValue(sc.body, "restartPolicy") != "Always" {
					t.Error("the native form must render a native sidecar (restartPolicy: Always)")
				}
			}
			for _, v := range tc.versions {
				kubeconform(t, rendered, v)
			}
		})
	}
}

// renderConsumingChart writes a team's chart that depends on the library chart (file://), pastes
// line under spec.template.spec.<list> of its Deployment, sets the two required values, and
// returns `helm template` of it. Helm's cache, configuration and data stay in the test's
// temporary directory.
func renderConsumingChart(t *testing.T, helm, list, line string) string {
	t.Helper()
	library, err := filepath.Abs(filepath.Join("helm", "cs-health-sidecar"))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	chart := filepath.Join(dir, "payments-api")
	files := map[string]string{
		"Chart.yaml":                fmt.Sprintf(consumingChart, library),
		"values.yaml":               consumingValues,
		"templates/deployment.yaml": fmt.Sprintf(consumingDeployment[list], line),
	}
	for name, content := range files {
		path := filepath.Join(chart, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	env := append(os.Environ(), "HELM_CACHE_HOME="+filepath.Join(dir, "cache"),
		"HELM_CONFIG_HOME="+filepath.Join(dir, "config"), "HELM_DATA_HOME="+filepath.Join(dir, "data"))
	run := func(args ...string) string {
		var out, errb bytes.Buffer
		cmd := exec.Command(helm, args...)
		cmd.Env, cmd.Stdout, cmd.Stderr = env, &out, &errb
		if err := cmd.Run(); err != nil {
			t.Fatalf("helm %s: %v\n%s", strings.Join(args, " "), err, errb.String())
		}
		return out.String()
	}
	run("dependency", "build", chart)
	return run("template", "payments-api", chart)
}

const consumingChart = `apiVersion: v2
name: payments-api
version: 0.1.0
dependencies:
  - name: cs-health-sidecar
    version: 1.0.0
    repository: file://%s
`

const consumingValues = `csHealthSidecar:
  endpoint: https://communication.apps.example.com
  tenant: retail
`

// consumingDeployment is a team's Deployment template with %s where the README's line goes, on
// its own line at the list items' indentation, as a person pastes it.
var consumingDeployment = map[string]string{
	"containers": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  labels:
    app.kubernetes.io/name: payments-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: payments-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payments-api
        app.kubernetes.io/version: "1.4.2"
    spec:
      containers:
        - name: payments-api
          image: registry.example.com/retail/payments-api:1.4.2
        %s
`,
	"initContainers": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  labels:
    app.kubernetes.io/name: payments-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: payments-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payments-api
        app.kubernetes.io/version: "1.4.2"
    spec:
      initContainers:
        - name: db-migrate
          image: registry.example.com/retail/payments-api:1.4.2
          command: ["/app/migrate"]
        %s
      containers:
        - name: payments-api
          image: registry.example.com/retail/payments-api:1.4.2
`,
}
