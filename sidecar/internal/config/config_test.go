package config

import (
	"strings"
	"testing"
	"time"
)

func env(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestDeriveService(t *testing.T) {
	cases := map[string]string{
		"payments-api-7f9c6d5b4-x2k4q": "payments-api", // Deployment pod
		"payments-api-v2-x2k4q":        "payments-api-v2",
		"node-exporter-x2k4q":          "node-exporter", // DaemonSet pod
		"kafka-0":                      "kafka",         // StatefulSet pod
		"kafka-12":                     "kafka",
		"myapp":                        "myapp",
		"":                             "",
	}
	for pod, want := range cases {
		if got := DeriveService(pod); got != want {
			t.Errorf("DeriveService(%q) = %q, want %q", pod, got, want)
		}
	}
}

func TestFromEnvDefaults(t *testing.T) {
	cfg, err := FromEnv(env(map[string]string{
		"CS_ENDPOINT":   "https://communication.apps.example.com/",
		"CS_TENANT":     "retail",
		"POD_NAME":      "payments-api-7f9c6d5b4-x2k4q",
		"POD_NAMESPACE": "retail-payments",
		"NODE_NAME":     "worker-3",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Endpoint != "https://communication.apps.example.com" {
		t.Errorf("endpoint not trimmed: %q", cfg.Endpoint)
	}
	if cfg.Service != "payments-api" || cfg.ClientID != "payments-api" {
		t.Errorf("service/client id not derived: %q %q", cfg.Service, cfg.ClientID)
	}
	if cfg.Instance.ID != "payments-api-7f9c6d5b4-x2k4q" || cfg.Instance.Namespace != "retail-payments" ||
		cfg.Instance.Node != "worker-3" {
		t.Errorf("instance not filled from downward API: %+v", cfg.Instance)
	}
	if cfg.ProbeMode != ModeAuto || cfg.Fixed() {
		t.Errorf("expected auto discovery, got %q fixed=%v", cfg.ProbeMode, cfg.Fixed())
	}
	if cfg.Interval != 15*time.Second || cfg.Heartbeat != 30*time.Second || cfg.StartupGrace != 5*time.Minute {
		t.Errorf("unexpected timing defaults: %+v", cfg)
	}
	if !cfg.Ignored(15021) || cfg.Ignored(8080) {
		t.Errorf("default ignore list should cover the mesh admin range only")
	}
	if len(cfg.Hosts) != 2 || cfg.Hosts[0] != "127.0.0.1" {
		t.Errorf("unexpected hosts: %v", cfg.Hosts)
	}
}

func TestFromEnvOverridesAndValidation(t *testing.T) {
	cfg, err := FromEnv(env(map[string]string{
		"CS_ENDPOINT":  "http://localhost:8080",
		"CS_TENANT":    "retail",
		"CS_SERVICE":   "orders",
		"CS_CLIENT_ID": "orders-repo",
		"CS_PROBE":     "http",
		"CS_PORT":      "9000",
		"CS_PATH":      "health",
		"CS_INTERVAL":  "10s",
		"CS_HEARTBEAT": "5s",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.ClientID != "orders-repo" || cfg.Path != "/health" || !cfg.Fixed() {
		t.Errorf("overrides not applied: %+v", cfg)
	}
	if cfg.Heartbeat != cfg.Interval {
		t.Errorf("heartbeat shorter than interval should be raised to it, got %v", cfg.Heartbeat)
	}

	_, err = FromEnv(env(map[string]string{"CS_PROBE": "tcp", "CS_INTERVAL": "soon"}))
	if err == nil {
		t.Fatal("expected errors")
	}
	for _, want := range []string{"CS_ENDPOINT is required", "CS_TENANT is required", "CS_PORT is required", "CS_INTERVAL"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q should mention %q", err, want)
		}
	}
}

// G-3-17: CS_INSECURE_SKIP_VERIFY takes the documented spellings of true and false in any case,
// empty keeps the default (false), and anything else is a named error joined with the others,
// so the process exits 2 instead of starting with verification on after a typo.
func TestInsecureSkipVerifyAcceptsTheDocumentedSpellingsOnly(t *testing.T) {
	for value, want := range map[string]bool{
		"": false, "1": true, "true": true, "TRUE": true, "Yes": true, "on": true, " true ": true,
		"0": false, "false": false, "False": false, "no": false, "OFF": false,
	} {
		cfg, err := FromEnv(env(map[string]string{
			"CS_ENDPOINT": "https://communication.apps.example.com", "CS_TENANT": "retail",
			"POD_NAME": "payments-api-7f9c6d5b4-x2k4q", "CS_INSECURE_SKIP_VERIFY": value,
		}))
		if err != nil {
			t.Errorf("CS_INSECURE_SKIP_VERIFY=%q: unexpected error %v", value, err)
		} else if cfg.InsecureSkipVerify != want {
			t.Errorf("CS_INSECURE_SKIP_VERIFY=%q: got %v, want %v", value, cfg.InsecureSkipVerify, want)
		}
	}
	for _, value := range []string{"maybe", "2", "t", "enabled"} {
		_, err := FromEnv(env(map[string]string{"CS_INSECURE_SKIP_VERIFY": value})) // CS_ENDPOINT and CS_TENANT missing too
		if err == nil {
			t.Errorf("CS_INSECURE_SKIP_VERIFY=%q: expected an error", value)
			continue
		}
		for _, want := range []string{`CS_INSECURE_SKIP_VERIFY must be true or false (got "` + value + `")`, "CS_ENDPOINT is required", "CS_TENANT is required"} {
			if !strings.Contains(err.Error(), want) {
				t.Errorf("CS_INSECURE_SKIP_VERIFY=%q: error %q should contain %q", value, err, want)
			}
		}
	}
}

func TestParsePortRanges(t *testing.T) {
	ranges, err := ParsePortRanges("80, 8000-8099")
	if err != nil || len(ranges) != 2 || !ranges[1].Contains(8050) || ranges[1].Contains(8100) {
		t.Fatalf("unexpected parse: %v %v", ranges, err)
	}
	if _, err := ParsePortRanges("9-1"); err == nil {
		t.Error("descending range should fail")
	}
}
