package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// env is the getenv of a process with exactly these variables set.
func env(vars map[string]string) func(string) string {
	return func(key string) string { return vars[key] }
}

// logBuffer collects the JSON log lines; the agent and the status server write concurrently.
type logBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *logBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

// lines decodes every JSON line written so far.
func (b *logBuffer) lines(t *testing.T) []map[string]any {
	t.Helper()
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(b.buf.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("log line is not JSON: %q (%v)", line, err)
		}
		out = append(out, m)
	}
	return out
}

func find(lines []map[string]any, msg string) map[string]any {
	for _, l := range lines {
		if l["msg"] == msg {
			return l
		}
	}
	return nil
}

// G-2-15: the binary refuses to start without CS_ENDPOINT, says which variable is missing in
// one JSON ERROR line, and exits 2 (the code the README documents for configuration errors).
func TestRunRejectsMissingEndpointWithAClearError(t *testing.T) {
	var out logBuffer
	code := run(context.Background(), env(map[string]string{
		"CS_TENANT": "retail",
		"POD_NAME":  "payments-api-7f9c6d5b4-x2k4q",
	}), &out)
	if code != 2 {
		t.Fatalf("exit code %d, want 2", code)
	}
	lines := out.lines(t)
	line := find(lines, "invalid configuration")
	if line == nil || line["level"] != "ERROR" {
		t.Fatalf("expected one ERROR line 'invalid configuration', got %v", lines)
	}
	if errText, _ := line["error"].(string); !strings.Contains(errText, "CS_ENDPOINT is required") {
		t.Errorf("the error should name the missing variable, got %q", errText)
	}
	if len(lines) != 1 {
		t.Errorf("nothing else should be logged before exiting, got %v", lines)
	}
}

// A value the sidecar cannot use stops it before it runs: exit 2 and one ERROR line naming the
// variable and the value, never a sidecar running on a guess (G-3-17: a boolean typo used to
// start it with the default).
func TestRunRejectsAnUnusableValueWithExit2(t *testing.T) {
	for _, tc := range []struct{ key, value, want string }{
		{"CS_INSECURE_SKIP_VERIFY", "maybe", `CS_INSECURE_SKIP_VERIFY must be true or false (got "maybe")`},
		{"CS_LOG_LEVEL", "loud", `CS_LOG_LEVEL must be debug, info, warn or error (got "loud")`},
	} {
		t.Run(tc.key, func(t *testing.T) {
			// Bounded, local and blind: should the value be accepted, run stops after 2 s and
			// returns 0 instead of hanging, without probing this host's ports or the network.
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			var out logBuffer
			code := run(ctx, env(map[string]string{
				"CS_ENDPOINT":     "http://127.0.0.1:1",
				"CS_TENANT":       "retail",
				"POD_NAME":        "payments-api-7f9c6d5b4-x2k4q",
				"CS_LISTEN":       "127.0.0.1:0",
				"CS_IGNORE_PORTS": "1-65535",
				tc.key:            tc.value,
			}), &out)
			if code != 2 {
				t.Fatalf("%s=%s: exit code %d, want 2", tc.key, tc.value, code)
			}
			lines := out.lines(t)
			line := find(lines, "invalid configuration")
			if line == nil || line["level"] != "ERROR" || len(lines) != 1 {
				t.Fatalf("expected exactly one ERROR line 'invalid configuration', got %v", lines)
			}
			if errText, _ := line["error"].(string); !strings.Contains(errText, tc.want) {
				t.Errorf("the error should say %q, got %q", tc.want, errText)
			}
		})
	}
}

// A CA file that cannot be read is the other way the process stops before running: exit 2 with
// the cause, not a running sidecar that fails every send.
func TestRunRejectsAnUnreadableCAFile(t *testing.T) {
	var out logBuffer
	code := run(context.Background(), env(map[string]string{
		"CS_ENDPOINT": "https://communication.example.com",
		"CS_TENANT":   "retail",
		"POD_NAME":    "payments-api-7f9c6d5b4-x2k4q",
		"CS_CA_FILE":  t.TempDir() + "/missing.pem",
	}), &out)
	if code != 2 {
		t.Fatalf("exit code %d, want 2", code)
	}
	line := find(out.lines(t), "cannot build report client")
	if line == nil || line["level"] != "ERROR" {
		t.Fatalf("expected an ERROR line 'cannot build report client', got %v", out.lines(t))
	}
	if errText, _ := line["error"].(string); !strings.Contains(errText, "CS_CA_FILE") {
		t.Errorf("the error should name CS_CA_FILE, got %q", errText)
	}
}

// G-2-15: the wiring main does end to end: with a valid environment run probes the pinned app,
// posts to the service with the build version in the User-Agent and in instance.sidecar, logs
// the version at start, and on a cancelled context sends the leaving report, stops and returns 0.
func TestRunReportsWithTheBuildVersionAndStopsCleanly(t *testing.T) {
	previous := version
	version = "1.2.3-test"
	t.Cleanup(func() { version = previous })

	type received struct {
		userAgent string
		body      map[string]any
	}
	var mu sync.Mutex
	var got []received
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/health/reports" {
			http.NotFound(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		mu.Lock()
		got = append(got, received{userAgent: r.Header.Get("User-Agent"), body: body})
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer service.Close()
	count := func() int {
		mu.Lock()
		defer mu.Unlock()
		return len(got)
	}

	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"status":"UP"}`)
	}))
	defer app.Close()
	_, port, _ := strings.Cut(app.Listener.Addr().String(), ":")
	if _, err := strconv.Atoi(port); err != nil {
		t.Fatal("cannot read the app port from", app.Listener.Addr())
	}

	var out logBuffer
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan int, 1)
	go func() {
		done <- run(ctx, env(map[string]string{
			"CS_ENDPOINT":    service.URL,
			"CS_TENANT":      "retail",
			"CS_SERVICE":     "payments-api",
			"POD_NAME":       "payments-api-7f9c6d5b4-x2k4q",
			"CS_PORT":        port,
			"CS_HOST":        "127.0.0.1",
			"CS_LISTEN":      "127.0.0.1:0",
			"CS_INTERVAL":    "1s",
			"CS_RETRY_DELAY": "0s",
		}), &out)
	}()
	deadline := time.Now().Add(5 * time.Second)
	for count() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if count() == 0 {
		t.Fatalf("no report reached the service within 5s; log: %v", out.lines(t))
	}
	cancel()
	var code int
	select {
	case code = <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("run did not return after the context was cancelled")
	}
	if code != 0 {
		t.Errorf("exit code %d, want 0 after a clean stop", code)
	}

	mu.Lock()
	first, last := got[0], got[len(got)-1]
	mu.Unlock()
	if first.userAgent != "health-sidecar/1.2.3-test" {
		t.Errorf("User-Agent = %q, want the build version", first.userAgent)
	}
	if first.body["status"] != "UP" || first.body["tenantId"] != "retail" || first.body["service"] != "payments-api" {
		t.Errorf("first report: %v", first.body)
	}
	instance, _ := first.body["instance"].(map[string]any)
	if instance["sidecar"] != "1.2.3-test" || instance["id"] != "payments-api-7f9c6d5b4-x2k4q" {
		t.Errorf("first report instance: %v", instance)
	}
	if leaving, _ := last.body["instance"].(map[string]any); leaving["leaving"] != true {
		t.Errorf("the last report should be the leaving one, got %v", last.body)
	}

	lines := out.lines(t)
	if start := find(lines, "health sidecar starting"); start == nil || start["version"] != "1.2.3-test" || start["level"] != "INFO" {
		t.Errorf("start line should carry the version at INFO, got %v", start)
	}
	if stop := find(lines, "health sidecar stopped"); stop == nil {
		t.Errorf("no 'health sidecar stopped' line; log: %v", lines)
	}
	for _, l := range lines {
		if l["level"] == "ERROR" {
			t.Errorf("unexpected ERROR line: %v", l)
		}
	}
}

// G-3-14: run applies CS_LOG_LEVEL to its log handler. With the heartbeat at the probe interval
// the second report is a repeat, logged at DEBUG: at debug that line is written, at info it is
// not although the same reports reached the service, and at warn not even the INFO lines are.
func TestRunLogsAtTheConfiguredLevel(t *testing.T) {
	for _, tc := range []struct {
		level       string
		debug, info bool // whether DEBUG and INFO lines are written
	}{
		{"debug", true, true},
		{"info", false, true},
		{"warn", false, false},
	} {
		t.Run(tc.level, func(t *testing.T) {
			t.Parallel()
			service, sent := countingService(t)
			app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				fmt.Fprint(w, `{"status":"UP"}`)
			}))
			defer app.Close()
			_, port, _ := strings.Cut(app.Listener.Addr().String(), ":")

			var out logBuffer
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan int, 1)
			go func() {
				done <- run(ctx, env(map[string]string{
					"CS_ENDPOINT": service, "CS_TENANT": "retail", "CS_SERVICE": "payments-api",
					"POD_NAME": "payments-api-7f9c6d5b4-x2k4q", "CS_PORT": port, "CS_HOST": "127.0.0.1",
					"CS_LISTEN": "127.0.0.1:0", "CS_INTERVAL": "1s", "CS_HEARTBEAT": "1s",
					"CS_RETRY_DELAY": "0s", "CS_LOG_LEVEL": tc.level,
				}), &out)
			}()
			deadline := time.Now().Add(10 * time.Second)
			for sent() < 2 && time.Now().Before(deadline) {
				time.Sleep(20 * time.Millisecond)
			}
			cancel()
			select {
			case code := <-done:
				if code != 0 {
					t.Errorf("exit code %d, want 0", code)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("run did not return after the context was cancelled")
			}
			if n := sent(); n < 3 { // the first report, the heartbeat and the leaving report
				t.Fatalf("%d reports reached the service, want the first one, a heartbeat and the leaving one", n)
			}

			levels := map[string]int{}
			debugReported := false
			for _, l := range out.lines(t) {
				level, _ := l["level"].(string)
				levels[level]++
				debugReported = debugReported || (level == "DEBUG" && l["msg"] == "reported")
			}
			if debugReported != tc.debug || (levels["DEBUG"] > 0) != tc.debug {
				t.Errorf("CS_LOG_LEVEL=%s: DEBUG lines %d (a DEBUG 'reported' line: %v), want them: %v", tc.level, levels["DEBUG"], debugReported, tc.debug)
			}
			if (levels["INFO"] > 0) != tc.info {
				t.Errorf("CS_LOG_LEVEL=%s: INFO lines %d, want them: %v", tc.level, levels["INFO"], tc.info)
			}
		})
	}
}

// countingService is a communication service that accepts every report and counts them.
func countingService(t *testing.T) (url string, count func() int) {
	t.Helper()
	var mu sync.Mutex
	n := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/health/reports" {
			http.NotFound(w, r)
			return
		}
		mu.Lock()
		n++
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(srv.Close)
	return srv.URL, func() int {
		mu.Lock()
		defer mu.Unlock()
		return n
	}
}
