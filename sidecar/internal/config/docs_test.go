package config

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// envName matches the environment variables config.go reads.
var envName = regexp.MustCompile(`"(CS_[A-Z0-9_]+|POD_[A-Z_]+|NODE_NAME)"`)

// G-1-19: every variable config.go reads is documented in the README's configuration table, and
// every variable the table documents is read, so the two cannot drift apart again.
func TestEveryEnvironmentVariableIsDocumented(t *testing.T) {
	src, err := os.ReadFile("config.go")
	if err != nil {
		t.Fatal(err)
	}
	readme, err := os.ReadFile("../../README.md")
	if err != nil {
		t.Fatal(err)
	}
	section := configurationSection(string(readme))
	if section == "" {
		t.Fatal("README.md has no '## Configuration' section")
	}

	read := map[string]bool{}
	for _, m := range envName.FindAllStringSubmatch(string(src), -1) {
		read[m[1]] = true
	}
	documented := map[string]bool{}
	for _, m := range regexp.MustCompile("`(CS_[A-Z0-9_]+|POD_[A-Z_]+|NODE_NAME)`").FindAllStringSubmatch(section, -1) {
		documented[m[1]] = true
	}
	if len(read) < 10 {
		t.Fatalf("expected config.go to read at least 10 variables, found %v", keys(read))
	}
	for _, name := range keys(read) {
		if !documented[name] {
			t.Errorf("%s is read by config.go but missing from the README configuration table", name)
		}
	}
	for _, name := range keys(documented) {
		if !read[name] {
			t.Errorf("%s is in the README configuration table but config.go does not read it", name)
		}
	}
}

// G-4-24 (GAP-sidecar3-4): the report client takes its proxy from the usual environment variables
// (http.ProxyFromEnvironment) and the probes never use one. The configuration table says so, so a
// cluster-wide proxy injected into the pod is a documented cause of failing sends. Both facts are
// read from the source, as the variables above are from config.go.
func TestProxyVariablesAreDocumented(t *testing.T) {
	readme, err := os.ReadFile("../../README.md")
	if err != nil {
		t.Fatal(err)
	}
	row := ""
	for _, line := range strings.Split(configurationSection(string(readme)), "\n") {
		if strings.HasPrefix(line, "| ") && strings.Contains(line, "`NO_PROXY`") {
			row = line
		}
	}
	for _, want := range []string{"`HTTPS_PROXY`", "`HTTP_PROXY`", "`NO_PROXY`", "probes"} {
		if !strings.Contains(row, want) {
			t.Errorf("the README configuration table needs a row for the proxy variables the reports honour and the probes ignore; its row %q lacks %s", row, want)
		}
	}
	for file, want := range map[string]*regexp.Regexp{
		"../report/client.go": regexp.MustCompile(`Proxy:\s+http\.ProxyFromEnvironment`),
		"../probe/probe.go":   regexp.MustCompile(`Proxy:\s+nil`),
	} {
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if !want.Match(src) {
			t.Errorf("%s no longer matches %s, which the README's proxy row describes", file, want)
		}
	}
}

func configurationSection(readme string) string {
	start := strings.Index(readme, "\n## Configuration")
	if start < 0 {
		return ""
	}
	rest := readme[start+1:]
	if end := strings.Index(rest[3:], "\n## "); end >= 0 {
		return rest[:end+3]
	}
	return rest
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
