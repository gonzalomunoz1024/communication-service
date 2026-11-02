// Package deploy holds tests for the Kustomize snippets under deploy/kustomize, for the Helm
// include lines the README prints and for the image build files. The manifest tests need the
// kustomize and helm binaries and use kubeconform for schema validation. On a laptop a missing
// tool skips the check, so `go test ./...` stays green on a plain checkout; when CI is set
// (GitHub Actions sets CI=true) a missing tool fails the test naming it, so a CI image without
// the tools cannot pass these checks vacuously.
package deploy

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// requireTool finds a tool the test needs. Missing on a laptop it reports false so the caller
// can skip; missing when CI is set it fails the test, naming the tool to install.
func requireTool(t *testing.T, name string) (string, bool) {
	t.Helper()
	bin, err := exec.LookPath(name)
	if err == nil {
		return bin, true
	}
	if os.Getenv("CI") != "" {
		t.Fatalf("%s is not on PATH and CI is set: install %s in the CI image, the manifest tests must not skip there", name, name)
	}
	return "", false
}

// kustomizeBuild renders a kustomization directory, skipping the test when kustomize is absent
// (failing instead when CI is set, see requireTool).
func kustomizeBuild(t *testing.T, dir string) string {
	t.Helper()
	bin, ok := requireTool(t, "kustomize")
	if !ok {
		t.Skip("kustomize not on PATH")
	}
	var out, errb bytes.Buffer
	cmd := exec.Command(bin, "build", dir)
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		t.Fatalf("kustomize build %s: %v\n%s", dir, err, errb.String())
	}
	return out.String()
}

// kubeconform validates rendered manifests against the given Kubernetes version. On a laptop a
// missing tool only logs, because the structural assertions already ran; when CI is set it
// fails the test (see requireTool).
func kubeconform(t *testing.T, manifests, version string) {
	t.Helper()
	bin, ok := requireTool(t, "kubeconform")
	if !ok {
		t.Log("kubeconform not on PATH; schema validation skipped")
		return
	}
	var out bytes.Buffer
	cmd := exec.Command(bin, "-strict", "-summary", "-kubernetes-version", version)
	cmd.Stdin = strings.NewReader(manifests)
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Run(); err != nil {
		t.Fatalf("kubeconform (%s): %v\n%s", version, err, out.String())
	}
	t.Logf("kubeconform %s: %s", version, strings.TrimSpace(out.String()))
}

// documents splits a multi-document YAML stream.
func documents(stream string) []string {
	var docs []string
	for _, d := range strings.Split("\n"+stream, "\n---\n") {
		if strings.TrimSpace(d) != "" {
			docs = append(docs, d)
		}
	}
	return docs
}

// workload returns the document whose kind and metadata.name match.
func workload(t *testing.T, stream, kind, name string) string {
	t.Helper()
	for _, d := range documents(stream) {
		if strings.Contains(d, "\nkind: "+kind+"\n") && strings.Contains(d, "\n  name: "+name+"\n") {
			return d
		}
	}
	t.Fatalf("no %s named %s in:\n%s", kind, name, stream)
	return ""
}

// item is one entry of a container list in a YAML document. kustomize renders list items at the
// key's own indentation with sorted keys (so "name:" is not the first line of an item); the
// hand-written snippets indent items two spaces deeper, and both shapes are accepted.
type item struct {
	name string
	body string
}

// listItems extracts the items of the first `<key>:` list found in doc at any indentation.
func listItems(doc, key string) []item {
	lines := strings.Split(doc, "\n")
	var items []item
	keyIndent, itemIndent := -1, -1
	var current *strings.Builder
	flush := func() {
		if current != nil {
			body := current.String()
			items = append(items, item{name: fieldValue(body, "name"), body: body})
			current = nil
		}
	}
	for _, line := range lines {
		trimmed := strings.TrimLeft(line, " ")
		indent := len(line) - len(trimmed)
		if keyIndent < 0 {
			if trimmed == key+":" {
				keyIndent = indent
			}
			continue
		}
		if strings.TrimSpace(line) == "" {
			continue
		}
		if itemIndent < 0 {
			if indent < keyIndent || !strings.HasPrefix(trimmed, "- ") {
				return items // not a block list (empty, or a scalar)
			}
			itemIndent = indent
		}
		switch {
		case indent == itemIndent && strings.HasPrefix(trimmed, "- "):
			flush()
			current = &strings.Builder{}
			current.WriteString(strings.Repeat(" ", itemIndent+2) + trimmed[2:] + "\n")
		case indent > itemIndent && current != nil:
			current.WriteString(line + "\n")
		case indent >= itemIndent && strings.HasPrefix(trimmed, "#"):
			continue // a comment between items
		default: // back at or above the items' level: the list ended
			flush()
			return items
		}
	}
	flush()
	return items
}

// fieldValue returns the value of a top-level `field: value` line of an item body.
func fieldValue(body, field string) string {
	indent := -1
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimLeft(line, " ")
		if trimmed == "" {
			continue
		}
		if indent < 0 {
			indent = len(line) - len(trimmed)
		}
		if len(line)-len(trimmed) == indent && strings.HasPrefix(trimmed, field+":") {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, field+":"))
		}
	}
	return ""
}

func names(items []item) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, it.name)
	}
	return out
}

func find(items []item, name string) *item {
	for i := range items {
		if items[i].name == name {
			return &items[i]
		}
	}
	return nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// G-1-18: the native component must keep the init containers an app already declares. The
// earlier JSON-patch form replaced the whole list (RFC 6902 "add" on an existing member).
func TestNativeComponentKeepsExistingInitContainers(t *testing.T) {
	rendered := kustomizeBuild(t, filepath.Join("testdata", "native-with-init"))
	for _, tc := range []struct{ kind, name, existing, app string }{
		{"Deployment", "payments-api", "db-migrate", "payments-api"},
		{"StatefulSet", "ledger", "fetch-config", "ledger"},
	} {
		doc := workload(t, rendered, tc.kind, tc.name)
		init := listItems(doc, "initContainers")
		got := names(init)
		if !contains(got, tc.existing) || !contains(got, "health-sidecar") || len(init) != 2 {
			t.Errorf("%s %s: initContainers = %v, want %s and health-sidecar", tc.kind, tc.name, got, tc.existing)
		}
		if sc := find(init, "health-sidecar"); sc == nil || fieldValue(sc.body, "restartPolicy") != "Always" {
			t.Errorf("%s %s: the health sidecar must be a native sidecar (restartPolicy: Always)", tc.kind, tc.name)
		}
		if ex := find(init, tc.existing); ex == nil || !strings.Contains(ex.body, "command:") {
			t.Errorf("%s %s: the app's own init container lost its spec", tc.kind, tc.name)
		}
		if got := names(listItems(doc, "containers")); len(got) != 1 || got[0] != tc.app {
			t.Errorf("%s %s: the native form must not touch containers, got %v", tc.kind, tc.name, got)
		}
	}
	kubeconform(t, rendered, "1.29.0")
}

// The classic component appends the sidecar container and leaves everything else alone.
func TestClassicComponentAppendsTheContainer(t *testing.T) {
	rendered := kustomizeBuild(t, filepath.Join("kustomize", "example"))
	doc := workload(t, rendered, "Deployment", "payments-api")
	got := names(listItems(doc, "containers"))
	if len(got) != 2 || got[0] != "payments-api" || got[1] != "health-sidecar" {
		t.Errorf("containers = %v, want [payments-api health-sidecar]", got)
	}
	if init := listItems(doc, "initContainers"); len(init) != 0 {
		t.Errorf("the classic form must not add init containers, got %v", names(init))
	}
	kubeconform(t, rendered, "1.27.0")
	kubeconform(t, rendered, "1.29.0")
}

// Both snippets carry the same restricted-v2 security context and probe/resource settings.
func TestBothComponentsShareTheContainerContract(t *testing.T) {
	native := kustomizeBuild(t, filepath.Join("testdata", "native-with-init"))
	classic := kustomizeBuild(t, filepath.Join("kustomize", "example"))
	sidecar := find(listItems(workload(t, native, "Deployment", "payments-api"), "initContainers"), "health-sidecar")
	container := find(listItems(workload(t, classic, "Deployment", "payments-api"), "containers"), "health-sidecar")
	if sidecar == nil || container == nil {
		t.Fatal("health-sidecar missing from a rendered form")
	}
	for _, want := range containerContract {
		if !strings.Contains(sidecar.body, want) {
			t.Errorf("native sidecar lacks %q", want)
		}
		if !strings.Contains(container.body, want) {
			t.Errorf("classic sidecar lacks %q", want)
		}
	}
	if !dropsAllCapabilities(sidecar.body) || !dropsAllCapabilities(container.body) {
		t.Error("both forms must drop ALL capabilities")
	}
	if strings.Contains(sidecar.body, "runAsUser") || strings.Contains(container.body, "runAsUser") {
		t.Error("snippets must not pin runAsUser: restricted-v2 assigns an arbitrary UID")
	}
	if _, err := os.Stat(filepath.Join("kustomize", "component", "add-native-sidecar.yaml")); err == nil {
		t.Error("the JSON-patch native form must stay removed: it replaced existing init containers")
	}
}

// G-1-19: the plain-YAML snippet is "the same container block" as the components, so it must
// carry the same image policy, port and security settings.
func TestManualSnippetSharesTheContainerContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("manual", "deployment.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	manual := string(raw)
	sidecar := find(listItems(workload(t, manual, "Deployment", "payments-api"), "containers"), "health-sidecar")
	if sidecar == nil {
		t.Fatal("health-sidecar missing from deploy/manual/deployment.yaml")
	}
	for _, want := range append([]string{"imagePullPolicy: IfNotPresent", "protocol: TCP", "containerPort: 9465"}, containerContract...) {
		if !strings.Contains(sidecar.body, want) {
			t.Errorf("manual snippet lacks %q", want)
		}
	}
	if !dropsAllCapabilities(sidecar.body) {
		t.Error("the manual snippet must drop ALL capabilities")
	}
	if strings.Contains(sidecar.body, "runAsUser") {
		t.Error("the manual snippet must not pin runAsUser: restricted-v2 assigns an arbitrary UID")
	}
	kubeconform(t, manual, "1.27.0")
}

// containerContract is what every form of the sidecar container must carry.
var containerContract = []string{
	"allowPrivilegeEscalation: false", "readOnlyRootFilesystem: true", "runAsNonRoot: true",
	"type: RuntimeDefault", "path: /healthz", "memory: 16Mi", "memory: 32Mi",
	"name: cs-health-sidecar", "fieldPath: metadata.labels['app.kubernetes.io/name']",
}

// dropsAllCapabilities accepts the block form kustomize renders and the flow form of the
// hand-written snippet.
func dropsAllCapabilities(body string) bool {
	return strings.Contains(body, "- ALL") || strings.Contains(body, `drop: ["ALL"]`) || strings.Contains(body, "drop: [ALL]")
}
