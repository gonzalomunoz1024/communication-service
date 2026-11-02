package deploy

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// goVersion is the oldest Go release the module may be built with: go.mod's go directive names
// it, so an older toolchain refuses the module instead of building it, and the Go image tag the
// Dockerfile builds with by default is its minor line, so a rebuild takes that line's later
// patch releases. 1.27.3 is the first release without the four HIGH standard-library
// vulnerabilities the go1.25.14 build carried (CVE-2026-111943, CVE-2026-78667, CVE-2026-78669,
// CVE-2026-97031). A toolchain move is one deliberate change to go.mod, the Dockerfile, the
// README and this constant rather than a drift between them.
const goVersion = "1.27.3"

// G-2-14: go.mod and the Dockerfile agree on the Go line. G-4-2: go.mod names the patch release,
// the build stage keeps GOTOOLCHAIN=local so a builder older than that release stops the build
// (go.mod requires go >= ...) instead of building a vulnerable binary or downloading a toolchain,
// and the README's Build section names both.
func TestGoModAndDockerfileAgreeOnTheGoLine(t *testing.T) {
	if got := goDirective(readFile(t, filepath.Join("..", "go.mod"))); got != goVersion {
		t.Errorf("go.mod says go %s, want %s", got, goVersion)
	}
	minor := goVersion[:strings.LastIndex(goVersion, ".")]
	df := parseDockerfile(t, filepath.Join("..", "Dockerfile"))
	// the upstream Go image: Red Hat had not published ubi9/go-toolset:1.27 (CI got "not found" on
	// 2026-11-02); the README names it as the override once it ships
	if got, want := df.args["GO_IMAGE"], "docker.io/library/golang:"+minor; got != want {
		t.Errorf("Dockerfile default GO_IMAGE = %q, want %s", got, want)
	}
	if got := df.stages[0].env["GOTOOLCHAIN"]; got != "local" {
		t.Errorf("the build stage sets GOTOOLCHAIN=%q, want local: an older builder must stop the build, not build or download", got)
	}
	build := section(readFile(t, filepath.Join("..", "README.md")), "## Build")
	for _, want := range []string{"Go " + goVersion, "`go " + goVersion + "`", "golang:" + minor, "go-toolset:" + minor} {
		if !strings.Contains(build, want) {
			t.Errorf("the README's Build section should name %s", want)
		}
	}
}

// The image runs on UBI micro by default, and the README's Build section names the exact base the
// Dockerfile uses. Red Hat stops rebuilding a RHEL minor's tag once the next minor ships (9.5 failed
// CI's image scan on 2026-11-02 with fixes only in 9.8), so moving the tag is one change to both.
func TestReadmeNamesTheBaseImage(t *testing.T) {
	base := parseDockerfile(t, filepath.Join("..", "Dockerfile")).args["BASE_IMAGE"]
	if !strings.HasPrefix(base, "registry.access.redhat.com/ubi9/ubi-micro") {
		t.Fatalf("Dockerfile default BASE_IMAGE = %q, want registry.access.redhat.com/ubi9/ubi-micro", base)
	}
	build := section(readFile(t, filepath.Join("..", "README.md")), "## Build")
	if !strings.Contains(build, "`"+base+"`") {
		t.Errorf("the README's Build section should name the base image %s", base)
	}
}

// G-2-14: the final stage labels the image with what it is and which build it is, so registry
// UIs and scanners can tell builds apart. The version and revision come from build args that
// the stage itself declares with a default: an ARG the stage does not declare expands to "".
func TestImageCarriesVersionAndRevisionLabels(t *testing.T) {
	df := parseDockerfile(t, filepath.Join("..", "Dockerfile"))
	final := df.stages[len(df.stages)-1]
	for key, want := range map[string]string{
		"org.opencontainers.image.title":  "health-sidecar",
		"org.opencontainers.image.source": "https://github.com/gonzalomunoz1024/communication-service",
	} {
		if got := final.labels[key]; got != want {
			t.Errorf("final stage LABEL %s = %q, want %q", key, got, want)
		}
	}
	for key, arg := range map[string]string{
		"org.opencontainers.image.version":  "VERSION",
		"org.opencontainers.image.revision": "REVISION",
	} {
		if got, ok := final.labels[key]; !ok || !expands(got, arg) {
			t.Errorf("final stage LABEL %s = %q, want it set from $%s", key, got, arg)
		}
		if def, ok := final.args[arg]; !ok || def == "" {
			t.Errorf("final stage must declare ARG %s with a default, otherwise the label is empty", arg)
		}
	}
	build := section(readFile(t, filepath.Join("..", "README.md")), "## Build")
	for _, want := range []string{"--build-arg VERSION=", "--build-arg REVISION=$(git rev-parse HEAD)"} {
		if !strings.Contains(build, want) {
			t.Errorf("the README build command should pass %s", want)
		}
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

var goDirectiveRe = regexp.MustCompile(`(?m)^go (\S+)$`)

func goDirective(gomod string) string {
	if m := goDirectiveRe.FindStringSubmatch(gomod); m != nil {
		return m[1]
	}
	return ""
}

// expands reports whether a Dockerfile value is the expansion of the build arg name.
func expands(value, name string) bool {
	return value == "$"+name || value == "${"+name+"}"
}

// section returns the README from the given heading to the next one of the same level.
func section(readme, heading string) string {
	start := strings.Index(readme, "\n"+heading+"\n")
	if start < 0 {
		return ""
	}
	rest := readme[start+1:]
	if end := strings.Index(rest[len(heading):], "\n## "); end >= 0 {
		return rest[:end+len(heading)]
	}
	return rest
}

// dockerfile is the small part of a Dockerfile these tests look at: the global ARG defaults
// and, per stage, its own ARG defaults, ENV values and LABELs.
type dockerfile struct {
	args   map[string]string
	stages []stage
}

type stage struct {
	args   map[string]string
	env    map[string]string
	labels map[string]string
}

// parseDockerfile joins continuation lines, drops comments and reads ARG, FROM, ENV and LABEL.
func parseDockerfile(t *testing.T, path string) dockerfile {
	t.Helper()
	df := dockerfile{args: map[string]string{}}
	var logical []string
	var pending string
	for _, line := range strings.Split(readFile(t, path), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.HasSuffix(trimmed, `\`) {
			pending += strings.TrimSuffix(trimmed, `\`) + " "
			continue
		}
		logical = append(logical, pending+trimmed)
		pending = ""
	}
	for _, line := range logical {
		instruction, rest, _ := strings.Cut(line, " ")
		switch strings.ToUpper(instruction) {
		case "FROM":
			df.stages = append(df.stages, stage{args: map[string]string{}, env: map[string]string{}, labels: map[string]string{}})
		case "ARG":
			target := df.args
			if n := len(df.stages); n > 0 {
				target = df.stages[n-1].args
			}
			for k, v := range pairs(rest) {
				target[k] = v
			}
		case "ENV":
			if n := len(df.stages); n > 0 {
				for k, v := range pairs(rest) {
					df.stages[n-1].env[k] = v
				}
			}
		case "LABEL":
			if n := len(df.stages); n > 0 {
				for k, v := range pairs(rest) {
					df.stages[n-1].labels[k] = v
				}
			}
		}
	}
	if len(df.stages) == 0 {
		t.Fatalf("%s has no FROM instruction", path)
	}
	return df
}

// pairs splits `key=value key2="quoted value"` into a map; a bare `key` maps to "".
func pairs(s string) map[string]string {
	out := map[string]string{}
	for _, field := range fields(s) {
		k, v, _ := strings.Cut(field, "=")
		out[k] = strings.Trim(v, `"'`)
	}
	return out
}

// fields splits on whitespace outside double quotes.
func fields(s string) []string {
	var out []string
	var cur strings.Builder
	quoted := false
	flush := func() {
		if cur.Len() > 0 {
			out = append(out, cur.String())
			cur.Reset()
		}
	}
	for _, r := range s {
		switch {
		case r == '"':
			quoted = !quoted
			cur.WriteRune(r)
		case !quoted && (r == ' ' || r == '\t'):
			flush()
		default:
			cur.WriteRune(r)
		}
	}
	flush()
	return out
}
