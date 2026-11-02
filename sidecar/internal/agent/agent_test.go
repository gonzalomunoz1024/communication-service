package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
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
	h.agent.Sleep = sleep // Run waits between ticks with Sleep: the real wait, as in production
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

// G-1-2: an app that was UP and then stopped listening (crashed, crash-looping) must stay DOWN
// on every later tick, not drop to UNKNOWN (which the service ignores) because discovery finds
// nothing; when it listens again it is rediscovered and UP.
func TestAppThatStopsListeningStaysDownUntilItIsBack(t *testing.T) {
	app := newFakeApp(t, "UP")
	cfg := baseConfig()
	cfg.RetryDelay = 2 * time.Second
	h := newHarness(t, cfg, app.port)
	var slept []time.Duration
	h.agent.Sleep = func(_ context.Context, d time.Duration) { slept = append(slept, d) }
	ctx := context.Background()

	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "UP" {
		t.Fatalf("the app should be UP first: %+v", last)
	}
	target := h.agent.Status().Target

	// the app dies: its port is gone and stays gone
	app.srv.Close()
	h.agent.ProcRoot = procRoot(t)
	h.advance(15 * time.Second)
	h.agent.Tick(ctx) // notices the port vanished and drops the target (see the test above)
	if last := h.agent.Status().Last; last == nil || last.Status != "DOWN" ||
		!strings.Contains(last.Message, "not listening") || !strings.Contains(last.Message, target) {
		t.Errorf("the probe that finds the port gone should already say the app is not listening, got %+v", last)
	}
	for i := 1; i <= 3; i++ {
		h.advance(15 * time.Second)
		h.agent.Tick(ctx)
		last := h.agent.Status().Last
		if last == nil || last.Status != "DOWN" {
			t.Fatalf("tick %d after the app died: a dead app is DOWN, got %+v", i, last)
		}
		if !strings.Contains(last.Message, "not listening") || !strings.Contains(last.Message, target) {
			t.Errorf("tick %d: the DOWN report should name the vanished target, got %q", i, last.Message)
		}
	}
	if sent := h.sender.last(); sent.Status != "DOWN" {
		t.Errorf("the heartbeat while the app is dead should carry DOWN: %+v", sent)
	}
	if s := h.agent.Status(); s.Target != "" || s.LastTarget != target {
		t.Errorf("status while the app is dead should keep naming the last target: %+v", s)
	}
	// every miss after the first UP gets the same second look a non-UP answer gets
	if len(slept) != 4 {
		t.Errorf("expected one retry sleep per tick since the app died, got %v", slept)
	}
	for _, d := range slept {
		if d != cfg.RetryDelay {
			t.Errorf("slept %v, want the retry delay %v", d, cfg.RetryDelay)
		}
	}

	// the app comes back on another port: rediscovered and UP at once
	again := newFakeApp(t, "UP")
	h.agent.ProcRoot = procRoot(t, again.port)
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	if last := h.sender.last(); last.Status != "UP" {
		t.Fatalf("a restarted app is UP again: %+v", last)
	}
	if s := h.agent.Status(); !strings.Contains(s.Target, strconv.Itoa(again.port)) || s.LastTarget != s.Target {
		t.Errorf("status after the restart should show the new target: %+v", s)
	}
}

// Before the first UP a missing app is still "starting" (UNKNOWN), exactly as before.
func TestAppNeverSeenUpIsUnknownWhileNothingListens(t *testing.T) {
	cfg := baseConfig()
	cfg.RetryDelay = 2 * time.Second
	h := newHarness(t, cfg) // nothing listens
	slept := 0
	h.agent.Sleep = func(context.Context, time.Duration) { slept++ }
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		h.advance(15 * time.Second)
		h.agent.Tick(ctx)
		if last := h.sender.last(); last.Status != "UNKNOWN" || !strings.Contains(last.Message, "starting") {
			t.Fatalf("tick %d: no app yet should be UNKNOWN: %+v", i, last)
		}
	}
	if slept != 0 {
		t.Errorf("no retry delay is spent before the app was ever UP, slept %d times", slept)
	}
}

// When the port table itself cannot be read nothing can be said, so the report is UNKNOWN
// rather than a false DOWN, even after the app has been UP.
func TestUnreadablePortTableIsUnknownNotDown(t *testing.T) {
	app := newFakeApp(t, "UP")
	h := newHarness(t, baseConfig(), app.port)
	ctx := context.Background()
	h.agent.Tick(ctx)
	app.srv.Close()
	h.agent.ProcRoot = procRoot(t)
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)              // target dropped
	h.agent.ProcRoot = t.TempDir() // no net/tcp at all
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	if last := h.agent.Status().Last; last == nil || last.Status != "UNKNOWN" || !strings.Contains(last.Message, "listening ports") {
		t.Errorf("an unreadable port table should give UNKNOWN with the reason: %+v", last)
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

// G-2-15: /status is the first thing an operator reads when a service does not show up, so its
// JSON is a contract: exactly the fields the README's Debugging table documents, serialised
// under those names. Served in-process and decoded, after one accepted report and one failed
// send so that every field has a value.
func TestStatusJSONMatchesTheDocumentedContract(t *testing.T) {
	app := newFakeApp(t, "UP")
	h := newHarness(t, baseConfig(), app.port)
	ctx := context.Background()
	h.agent.Tick(ctx) // accepted: target, lastReport, lastSendAt, reportsSent
	sentAt := h.clock
	h.sender.fail = errors.New("dial tcp 10.0.0.1:443: connection refused")
	h.advance(30 * time.Second)
	h.agent.Tick(ctx) // the heartbeat fails: sendError

	srv := httptest.NewServer(h.agent.Handler())
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/status")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("GET /status: %d %s %s", resp.StatusCode, resp.Header.Get("Content-Type"), body)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("/status is not a JSON object: %v\n%s", err, body)
	}
	documented := documentedStatusFields(t)
	for name := range documented {
		if _, ok := raw[name]; !ok {
			t.Errorf("the README documents /status field %q but the body has no such key:\n%s", name, body)
		}
	}
	for name := range raw {
		if !documented[name] {
			t.Errorf("/status key %q is not in the README's /status table", name)
		}
	}

	var s struct {
		Version     string         `json:"version"`
		Service     string         `json:"service"`
		Tenant      string         `json:"tenant"`
		Instance    string         `json:"instance"`
		Target      string         `json:"target"`
		LastTarget  string         `json:"lastTarget"`
		UpSeen      bool           `json:"upSeen"`
		LastReport  *report.Report `json:"lastReport"`
		LastSendAt  time.Time      `json:"lastSendAt"`
		ReportsSent int            `json:"reportsSent"`
		SendError   string         `json:"sendError"`
	}
	if err := json.Unmarshal(body, &s); err != nil {
		t.Fatalf("decode /status: %v\n%s", err, body)
	}
	target := "http://127.0.0.1:" + strconv.Itoa(app.port) + probe.ActuatorPath
	if s.Version != "test" || s.Service != "payments-api" || s.Tenant != "retail" || s.Instance != "payments-api-7f9c6d5b4-x2k4q" {
		t.Errorf("identity fields: %+v", s)
	}
	if s.Target != target || s.LastTarget != target || !s.UpSeen {
		t.Errorf("target fields: target=%q lastTarget=%q upSeen=%v, want %q", s.Target, s.LastTarget, s.UpSeen, target)
	}
	if s.LastReport == nil || s.LastReport.Status != "UP" || s.LastReport.Instance == nil || s.LastReport.Instance.ID != s.Instance {
		t.Errorf("lastReport: %+v", s.LastReport)
	}
	if !s.LastSendAt.Equal(sentAt) || s.ReportsSent != 1 {
		t.Errorf("lastSendAt=%v reportsSent=%d, want %v and 1 (the failed heartbeat does not count)", s.LastSendAt, s.ReportsSent, sentAt)
	}
	if !strings.Contains(s.SendError, "connection refused") {
		t.Errorf("sendError = %q, want the failed send's error", s.SendError)
	}
}

// documentedStatusFields reads the field names of the README's "`/status` answers with:" table.
func documentedStatusFields(t *testing.T) map[string]bool {
	t.Helper()
	readme, err := os.ReadFile(filepath.Join("..", "..", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	_, table, found := strings.Cut(string(readme), "`/status` answers with:")
	if !found {
		t.Fatal("README.md has no '`/status` answers with:' table")
	}
	fields := map[string]bool{}
	rows := 0
	for _, line := range strings.Split(table, "\n") {
		if !strings.HasPrefix(line, "|") {
			if rows > 0 {
				break // the table ended
			}
			continue // text before it
		}
		rows++
		if rows <= 2 {
			continue // header and separator
		}
		first := strings.SplitN(line, "|", 3)[1]
		for _, m := range regexp.MustCompile("`([A-Za-z]+)`").FindAllStringSubmatch(first, -1) {
			fields[m[1]] = true
		}
	}
	if len(fields) < 7 {
		t.Fatalf("expected the README /status table to document at least 7 fields, found %v", fields)
	}
	return fields
}

// runOnTheClock drives the agent's real loop, Run, on the harness clock. Run waits between
// ticks through Sleep, which here checks the reports sent so far against want (the running
// count after each tick) and that the tick's reports carry its own clock (they were composed by
// that probe, not left over), checks the wait is the probe interval plus less than 20 % jitter,
// and moves the clock on by it. After the last tick it cancels instead, so Run sends the leaving
// report and returns. It returns the reports before the leaving one. Sleep is also the second
// look at a non-UP answer, so the config must keep CS_RETRY_DELAY at 0 (baseConfig does).
func runOnTheClock(t *testing.T, h *harness, want []int) []report.Report {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	interval := h.agent.cfg.Interval
	ticks, seen := 0, 0
	h.agent.Sleep = func(_ context.Context, d time.Duration) {
		if ticks == len(want) {
			t.Fatal("Run ticked again after its context was cancelled")
		}
		ticks++
		sent := h.sender.all()
		if len(sent) != want[ticks-1] {
			t.Fatalf("after tick %d: %d reports sent, want %d (running counts %v)", ticks, len(sent), want[ticks-1], want)
		}
		observed := h.clock.UTC().Truncate(time.Millisecond)
		for _, r := range sent[seen:] {
			if !r.ObservedAt.Equal(observed) {
				t.Errorf("tick %d sent a report observed at %v, want the tick's own clock %v", ticks, r.ObservedAt, observed)
			}
		}
		seen = len(sent)
		if d < interval || d >= interval+interval/5 {
			t.Errorf("Run waited %v after tick %d, want the %v interval plus less than 20 %% jitter", d, ticks, interval)
		}
		if ticks == len(want) {
			cancel() // SIGTERM: Run sends the leaving report and returns
			return
		}
		h.advance(d)
	}
	h.agent.Run(ctx)
	if ticks != len(want) {
		t.Fatalf("Run returned after waiting %d times, want a wait after each of its %d ticks", ticks, len(want))
	}
	sent := h.sender.all()
	if len(sent) != seen+1 || sent[seen].Instance == nil || !sent[seen].Instance.Leaving {
		t.Fatalf("after the %d reports Run should send exactly one leaving report, got %+v", seen, sent[seen:])
	}
	return sent[:seen]
}

// G-2-16: while the app is not UP every probe is sent, so the service reaches its failure
// threshold one probe interval after the first DOWN instead of one heartbeat later; an UP app
// sends its first report, nothing more inside the heartbeat window, then one report per
// heartbeat. G-3-19: driven through Run on the harness clock (15 s interval plus jitter, 30 s
// heartbeat, six ticks) instead of 300 ms of wall-clock time, with the exact count after every
// tick instead of a range.
func TestNotUpIsSentEveryProbeAndUpOnlyAtTheHeartbeat(t *testing.T) {
	for _, tc := range []struct {
		name, status string
		want         []int // reports sent after each tick
	}{
		{"DOWN app: one report per probe", "DOWN", []int{1, 2, 3, 4, 5, 6}},
		{"UP app: the first report, then one per heartbeat", "UP", []int{1, 1, 2, 2, 3, 3}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := newFakeApp(t, tc.status)
			cfg := baseConfig()
			cfg.StartupGrace = 0
			h := newHarness(t, cfg, app.port)
			for i, r := range runOnTheClock(t, h, tc.want) {
				if r.Status != tc.status {
					t.Errorf("report %d: status %s, want %s", i, r.Status, tc.status)
				}
			}
		})
	}
}

// G-2-16: the UP->DOWN and DOWN->UP transitions are logged at INFO with the message and the
// sends in between at DEBUG; and the probe that finds the port gone already says "app is not
// listening (last target ...)", the words every later probe carries, instead of its own
// connection error, so the log line of the transition is the one an operator can act on.
func TestTransitionsAreLoggedAtInfoAndRepeatedSendsAtDebug(t *testing.T) {
	app := newFakeApp(t, "UP")
	h := newHarness(t, baseConfig(), app.port)
	var logs bytes.Buffer
	h.agent.log = slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	ctx := context.Background()

	h.agent.Tick(ctx) // UP
	target := h.agent.Status().Target
	app.srv.Close()
	h.agent.ProcRoot = procRoot(t) // the app dies: its port is gone
	for i := 0; i < 3; i++ {
		h.advance(15 * time.Second)
		h.agent.Tick(ctx) // the first probe finds the port gone, the next two miss discovery
	}
	again := newFakeApp(t, "UP")
	h.agent.ProcRoot = procRoot(t, again.port)
	h.advance(15 * time.Second)
	h.agent.Tick(ctx) // UP again

	want := "app is not listening (last target " + target + ")"
	reports := h.sender.all()
	var statuses []string
	for _, r := range reports {
		statuses = append(statuses, r.Status)
	}
	if got := strings.Join(statuses, " "); got != "UP DOWN DOWN DOWN UP" {
		t.Errorf("sent %q, want every DOWN probe sent: \"UP DOWN DOWN DOWN UP\"", got)
	}
	for i, r := range reports[1 : len(reports)-1] {
		if r.Message != want {
			t.Errorf("DOWN report %d says %q, want %q", i+1, r.Message, want)
		}
	}

	var info, debug []string
	for _, line := range strings.Split(strings.TrimSpace(logs.String()), "\n") {
		var l struct {
			Level, Msg, Status, Message string
		}
		if err := json.Unmarshal([]byte(line), &l); err != nil {
			t.Fatalf("log line is not JSON: %q", line)
		}
		if l.Msg != "reported" {
			continue
		}
		switch l.Level {
		case "INFO":
			info = append(info, l.Status+": "+l.Message)
		case "DEBUG":
			debug = append(debug, l.Status+": "+l.Message)
		default:
			t.Errorf("unexpected level in %q", line)
		}
	}
	if wantInfo := []string{"UP: ", "DOWN: " + want, "UP: "}; !slices.Equal(info, wantInfo) {
		t.Errorf("INFO 'reported' lines %q, want the transitions only: %q", info, wantInfo)
	}
	if wantDebug := []string{"DOWN: " + want, "DOWN: " + want}; !slices.Equal(debug, wantDebug) {
		t.Errorf("DEBUG 'reported' lines %q, want the repeated DOWN sends: %q", debug, wantDebug)
	}
}

// A report the service rejected (4xx) is not re-sent every probe just because the status is
// DOWN: the same body cannot do better sooner, so it waits for a change or the heartbeat, and
// once a body is accepted again the every-probe cadence resumes.
func TestRejectedDownReportKeepsTheHeartbeatCadence(t *testing.T) {
	app := newFakeApp(t, "DOWN")
	cfg := baseConfig()
	cfg.StartupGrace = 0
	h := newHarness(t, cfg, app.port)
	ctx := context.Background()
	h.sender.fail = &report.PermanentError{Status: 400, Body: "instance.id: size must be between 0 and 253"}
	h.agent.Tick(ctx) // DOWN, rejected
	h.sender.fail = nil
	h.advance(15 * time.Second)
	h.agent.Tick(ctx)
	if n := len(h.sender.all()); n != 0 {
		t.Fatalf("a rejected body waits for the heartbeat, got %d sends after 15s", n)
	}
	h.advance(15 * time.Second)
	h.agent.Tick(ctx) // 30 s: the heartbeat retries it and it is accepted
	h.advance(15 * time.Second)
	h.agent.Tick(ctx) // accepted once and still DOWN: every probe again
	if n := len(h.sender.all()); n != 2 {
		t.Errorf("after the heartbeat is accepted every DOWN probe is sent again, got %d sends", n)
	}
}
