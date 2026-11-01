package agent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/config"
	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/probe"
	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/report"
)

// fakeApp is the application container: its health answer can be changed between ticks.
type fakeApp struct {
	mu     sync.Mutex
	status string
	srv    *httptest.Server
	port   int
}

func newFakeApp(t *testing.T, status string) *fakeApp {
	t.Helper()
	app := &fakeApp{status: status}
	app.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != probe.ActuatorPath {
			http.NotFound(w, r)
			return
		}
		app.mu.Lock()
		status := app.status
		app.mu.Unlock()
		if status != "UP" {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		fmt.Fprintf(w, `{"status":%q,"components":{"db":{"status":%q}}}`, status, status)
	}))
	t.Cleanup(app.srv.Close)
	_, portStr, _ := net.SplitHostPort(app.srv.Listener.Addr().String())
	app.port, _ = strconv.Atoi(portStr)
	return app
}

func (a *fakeApp) set(status string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.status = status
}

// fakeSender records reports and can be told to fail.
type fakeSender struct {
	mu      sync.Mutex
	reports []report.Report
	fail    error
}

func (s *fakeSender) Send(_ context.Context, r report.Report) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail != nil {
		return s.fail
	}
	s.reports = append(s.reports, r)
	return nil
}

func (s *fakeSender) all() []report.Report {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]report.Report(nil), s.reports...)
}

func (s *fakeSender) last() report.Report {
	all := s.all()
	return all[len(all)-1]
}

// procRoot writes a /proc/net/tcp that lists the given ports as listening.
func procRoot(t *testing.T, ports ...int) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "net"), 0o755); err != nil {
		t.Fatal(err)
	}
	var sb strings.Builder
	sb.WriteString("  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n")
	for i, p := range ports {
		fmt.Fprintf(&sb, "   %d: 0100007F:%04X 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 %d 1 0000000000000000 100 0 0 10 0\n", i, p, 1000+i)
	}
	if err := os.WriteFile(filepath.Join(root, "net", "tcp"), []byte(sb.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

type harness struct {
	agent  *Agent
	sender *fakeSender
	clock  time.Time
}

func newHarness(t *testing.T, cfg config.Config, ports ...int) *harness {
	t.Helper()
	h := &harness{sender: &fakeSender{}, clock: time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)}
	h.agent = New(cfg, probe.New(time.Second), h.sender, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	h.agent.Now = func() time.Time { return h.clock }
	h.agent.Sleep = func(context.Context, time.Duration) {}
	h.agent.ProcRoot = procRoot(t, ports...)
	h.agent.startedAt = h.clock
	return h
}

func (h *harness) advance(d time.Duration) { h.clock = h.clock.Add(d) }

func baseConfig() config.Config {
	cfg, err := config.FromEnv(func(key string) string {
		return map[string]string{
			"CS_ENDPOINT":    "http://communication.test",
			"CS_TENANT":      "retail",
			"POD_NAME":       "payments-api-7f9c6d5b4-x2k4q",
			"POD_NAMESPACE":  "retail-payments",
			"NODE_NAME":      "worker-3",
			"CS_CLUSTER":     "ocp-east",
			"CS_HOST":        "127.0.0.1",
			"CS_RETRY_DELAY": "0s",
		}[key]
	})
	if err != nil {
		panic(err)
	}
	return cfg
}

func TestReportsChangesAndHeartbeats(t *testing.T) {
	app := newFakeApp(t, "UP")
	h := newHarness(t, baseConfig(), app.port)
	ctx := context.Background()

	h.agent.Tick(ctx)
	reports := h.sender.all()
	if len(reports) != 1 {
		t.Fatalf("first tick should report once, got %d", len(reports))
	}
	first := reports[0]
	if first.Status != "UP" || first.Service != "payments-api" || first.TenantID != "retail" ||
		first.Instance == nil || first.Instance.ID != "payments-api-7f9c6d5b4-x2k4q" ||
		first.Instance.Node != "worker-3" || first.Instance.Cluster != "ocp-east" || first.Instance.Sidecar != "test" {
		t.Errorf("unexpected first report: %+v instance=%+v", first, first.Instance)
	}
	if first.Components["db"] == nil {
		t.Error("components should be forwarded")
	}

	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	if n := len(h.sender.all()); n != 1 {
		t.Errorf("unchanged status inside the heartbeat window should not be sent, got %d", n)
	}

	h.advance(15 * time.Second) // 30s since the last send: heartbeat due
	h.agent.Tick(ctx)
	if n := len(h.sender.all()); n != 2 {
		t.Errorf("heartbeat should be sent, got %d reports", n)
	}

	app.set("DOWN")
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "DOWN" || len(h.sender.all()) != 3 {
		t.Errorf("a change should be reported at once: %+v (%d reports)", last, len(h.sender.all()))
	}
	if s := h.agent.Status(); s.Target == "" || !s.UpSeen || s.ReportsSent != 3 {
		t.Errorf("status snapshot: %+v", s)
	}
}

func TestStartupGraceReportsUnknownUntilFirstUp(t *testing.T) {
	app := newFakeApp(t, "DOWN")
	h := newHarness(t, baseConfig(), app.port)
	ctx := context.Background()

	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "UNKNOWN" || !strings.Contains(last.Message, "starting") {
		t.Fatalf("a DOWN answer during the grace period should be UNKNOWN: %+v", last)
	}

	h.advance(6 * time.Minute) // grace over, target was discovered: the real status now counts
	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "DOWN" {
		t.Errorf("after the grace period a discovered target's DOWN is reported: %+v", last)
	}

	app.set("UP")
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "UP" {
		t.Errorf("recovery should be reported: %+v", last)
	}
}

func TestNoListeningPortStaysUnknown(t *testing.T) {
	h := newHarness(t, baseConfig()) // nothing listens
	ctx := context.Background()
	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "UNKNOWN" || last.Instance == nil {
		t.Fatalf("no target yet should be UNKNOWN with the instance attached: %+v", last)
	}
	h.advance(6 * time.Minute)
	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "UNKNOWN" || !strings.Contains(last.Message, "CS_PORT") {
		t.Errorf("after the grace period the message should point at configuration: %+v", last)
	}
}

func TestPinnedTargetThatNeverAnswersUpStaysUnknown(t *testing.T) {
	app := newFakeApp(t, "DOWN")
	cfg := baseConfig()
	cfg.ProbeMode = config.ModeActuator
	cfg.Port = app.port
	h := newHarness(t, cfg, app.port)
	ctx := context.Background()
	h.advance(6 * time.Minute)
	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "UNKNOWN" || !strings.Contains(last.Message, "never answered UP") {
		t.Errorf("a pinned target that never answered UP is a configuration problem, not an outage: %+v", last)
	}
	app.set("UP")
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	app.set("DOWN")
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "DOWN" {
		t.Errorf("once UP was seen, DOWN is DOWN: %+v", last)
	}
}

func TestSendFailuresBackOffAndKeepLatest(t *testing.T) {
	app := newFakeApp(t, "UP")
	h := newHarness(t, baseConfig(), app.port)
	ctx := context.Background()
	h.sender.fail = errors.New("connection refused")

	h.agent.Tick(ctx)
	if len(h.sender.all()) != 0 || h.agent.Status().SendError == "" {
		t.Fatal("failed send should be recorded")
	}
	h.sender.fail = nil
	h.agent.Tick(ctx) // still inside the backoff: no attempt
	if len(h.sender.all()) != 0 {
		t.Fatal("should not retry before the backoff elapsed")
	}
	app.set("DOWN")
	h.advance(2 * time.Second)
	h.agent.Tick(ctx)
	reports := h.sender.all()
	if len(reports) != 1 || reports[0].Status != "DOWN" {
		t.Fatalf("after the backoff the latest state is sent, got %+v", reports)
	}

	h.sender.fail = &report.PermanentError{Status: 400, Body: "bad"}
	app.set("UP")
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	h.sender.fail = nil
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	if n := len(h.sender.all()); n != 1 {
		t.Errorf("a rejected report is not retried until the heartbeat is due, got %d", n)
	}
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	if n := len(h.sender.all()); n != 2 {
		t.Errorf("heartbeat after a rejection should send, got %d", n)
	}
}

func TestRunSendsLeavingReportOnShutdown(t *testing.T) {
	app := newFakeApp(t, "UP")
	h := newHarness(t, baseConfig(), app.port)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		h.agent.Run(ctx)
		close(done)
	}()
	deadline := time.Now().Add(5 * time.Second)
	for len(h.sender.all()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	cancel() // SIGTERM after the first report
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after cancellation")
	}
	reports := h.sender.all()
	if len(reports) != 2 {
		t.Fatalf("expected one report and one leaving report, got %d", len(reports))
	}
	if reports[1].Instance == nil || !reports[1].Instance.Leaving || reports[1].Status != "UP" {
		t.Errorf("leaving report: %+v instance=%+v", reports[1], reports[1].Instance)
	}
}

func TestRediscoversWhenPortDisappears(t *testing.T) {
	app := newFakeApp(t, "UP")
	h := newHarness(t, baseConfig(), app.port)
	ctx := context.Background()
	h.agent.Tick(ctx)
	if h.agent.Status().Target == "" {
		t.Fatal("target should be found")
	}
	app.srv.Close()
	h.agent.ProcRoot = procRoot(t) // nothing listens any more
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "DOWN" {
		t.Errorf("an app that stopped listening is DOWN: %+v", last)
	}
	if h.agent.Status().Target != "" {
		t.Error("target should be dropped so discovery runs again")
	}
}

func TestHandler(t *testing.T) {
	h := newHarness(t, baseConfig())
	srv := httptest.NewServer(h.agent.Handler())
	defer srv.Close()
	for _, path := range []string{"/healthz", "/status"} {
		resp, err := http.Get(srv.URL + path)
		if err != nil || resp.StatusCode != 200 {
			t.Errorf("%s: %v %v", path, err, resp)
		}
	}
}
