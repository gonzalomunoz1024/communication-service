package probe

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func serve(t *testing.T, handler http.HandlerFunc) (host string, port int, srv *httptest.Server) {
	t.Helper()
	srv = httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	host, portStr, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ = strconv.Atoi(portStr)
	return host, port, srv
}

func actuator(status string, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != ActuatorPath {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.spring-boot.actuator.v3+json")
		if status != "UP" {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_, _ = w.Write([]byte(body))
	}
}

func TestProbeActuatorDocument(t *testing.T) {
	host, port, _ := serve(t, actuator("UP",
		`{"status":"UP","components":{"db":{"status":"UP"},"redis":{"status":"DOWN","details":{"error":"refused"}}}}`))
	res := New(time.Second).Probe(context.Background(), Target{Mode: ModeActuator, Scheme: "http", Host: host, Port: port, Path: ActuatorPath})
	if !res.Document || res.Status != UP || res.HTTPStatus != 200 {
		t.Fatalf("unexpected result: %+v", res)
	}
	if res.Components["redis"].(map[string]any)["status"] != "DOWN" {
		t.Errorf("components should be forwarded verbatim: %v", res.Components)
	}
	if sig := res.Signature(); sig != "UP|redis=DOWN" {
		t.Errorf("signature = %q", sig)
	}
}

func TestProbeDownDocumentAndOldActuatorShape(t *testing.T) {
	host, port, _ := serve(t, actuator("DOWN", `{"status":"DOWN","details":{"db":{"status":"DOWN"},"diskSpace":{"status":"UP"}}}`))
	res := New(time.Second).Probe(context.Background(), Target{Mode: ModeActuator, Scheme: "http", Host: host, Port: port, Path: ActuatorPath})
	if res.Status != DOWN || !res.Document || res.HTTPStatus != 503 {
		t.Fatalf("unexpected result: %+v", res)
	}
	if _, ok := res.Components["db"]; !ok || len(res.Components) != 2 {
		t.Errorf("status-bearing details should become components: %v", res.Components)
	}
	if res.Message == "" {
		t.Error("a DOWN document should carry a message")
	}
}

func TestProbePlainHTTPClassification(t *testing.T) {
	host, port, _ := serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			_, _ = w.Write([]byte("OK"))
		case "/broken":
			w.WriteHeader(http.StatusInternalServerError)
		case "/":
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	})
	p := New(time.Second)
	cases := []struct {
		path, want string
	}{
		{"/health", UP},
		{"/broken", DOWN},
		{"/", UP},          // a 404 on "/" still proves the server is up
		{"/nope", UNKNOWN}, // a 404 on a health path is no information
	}
	for _, c := range cases {
		res := p.Probe(context.Background(), Target{Mode: ModeHTTP, Scheme: "http", Host: host, Port: port, Path: c.path})
		if res.Status != c.want {
			t.Errorf("%s: got %s (%+v), want %s", c.path, res.Status, res, c.want)
		}
	}
}

func TestProbeUnreachableAndTCP(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close() // nothing listens any more

	p := New(500 * time.Millisecond)
	res := p.Probe(context.Background(), Target{Mode: ModeHTTP, Scheme: "http", Host: "127.0.0.1", Port: port, Path: "/"})
	if res.Status != DOWN || !res.Unreachable {
		t.Errorf("closed port should be DOWN and unreachable: %+v", res)
	}
	res = p.Probe(context.Background(), Target{Mode: ModeTCP, Host: "127.0.0.1", Port: port})
	if res.Status != DOWN || !res.Unreachable {
		t.Errorf("tcp to closed port should be DOWN: %+v", res)
	}

	host, open, _ := serve(t, func(w http.ResponseWriter, r *http.Request) {})
	if res := p.Probe(context.Background(), Target{Mode: ModeTCP, Host: host, Port: open}); res.Status != UP {
		t.Errorf("tcp to open port should be UP: %+v", res)
	}
}

// G-3-16: Failing names the components the communication service counts as failing (its
// HealthReport.failing: DOWN or DEGRADED after its own flattening), nested ones included, so
// the sidecar sends an UP report with one every probe, as the service classifies it DEGRADED.
// Signature, which shares the walk, keeps every component that is not UP under its dotted path.
func TestFailingCountsTheComponentsTheServiceCounts(t *testing.T) {
	for _, tc := range []struct {
		name, doc string
		failing   bool
		signature string
	}{
		{"none", `{}`, false, "UP|"},
		{"all UP", `{"db":{"status":"UP"},"ping":{"status":"UP"}}`, false, "UP|"},
		{"DOWN", `{"db":{"status":"DOWN"},"ping":{"status":"UP"}}`, true, "UP|db=DOWN"},
		{"OUT_OF_SERVICE", `{"db":{"status":"OUT_OF_SERVICE"}}`, true, "UP|db=DOWN"},
		{"an unrecognised word", `{"cache":{"status":"warn"}}`, true, "UP|cache=WARN"},
		{"nested DOWN under an UP parent", `{"db":{"status":"UP","components":{"primary":{"status":"UP"},"replica":{"status":"DOWN"}}}}`, true, "UP|db.replica=DOWN"},
		{"a parent is represented by its children", `{"db":{"status":"DOWN","components":{"primary":{"status":"UP"}}}}`, false, "UP|"},
		{"UNKNOWN is not failing, but is part of the signature", `{"discovery":{"status":"UNKNOWN"}}`, false, "UP|discovery=UNKNOWN"},
		{"no status, or not an object", `{"db":{},"note":"text"}`, false, "UP|"},
	} {
		var components map[string]any
		if err := json.Unmarshal([]byte(tc.doc), &components); err != nil {
			t.Fatal(err)
		}
		if got := Failing(components); got != tc.failing {
			t.Errorf("%s: Failing(%s) = %v, want %v", tc.name, tc.doc, got, tc.failing)
		}
		if got := (Result{Status: UP, Components: components}).Signature(); got != tc.signature {
			t.Errorf("%s: Signature = %q, want %q", tc.name, got, tc.signature)
		}
	}
}

func TestNormalize(t *testing.T) {
	cases := map[string]string{"up": UP, "pass": UP, "ok": UP, "fail": DOWN, "out_of_service": DOWN,
		"": UNKNOWN, "warn": "WARN", "Degraded": "DEGRADED"}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDetectPrefersActuatorOverAnyPort(t *testing.T) {
	_, plain, _ := serve(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("hello")) })
	host, act, _ := serve(t, actuator("UP", `{"status":"UP"}`))
	ports := []int{plain, act}
	if plain > act {
		ports = []int{act, plain}
	}
	target, res, ok := New(time.Second).Detect(context.Background(), ports, []string{host}, "")
	if !ok || target.Mode != ModeActuator || target.Port != act || res.Status != UP {
		t.Fatalf("expected the actuator port, got %+v %+v ok=%v", target, res, ok)
	}
}

func TestDetectFallsBackToRootThenTCP(t *testing.T) {
	host, plain, _ := serve(t, func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	target, _, ok := New(time.Second).Detect(context.Background(), []int{plain}, []string{host}, "")
	if !ok || target.Mode != ModeHTTP || target.Path != RootPath {
		t.Fatalf("a server answering 404 everywhere should be probed on /: %+v ok=%v", target, ok)
	}

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	go func() { // accept and hang: not HTTP at all
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func() { time.Sleep(2 * time.Second); c.Close() }()
		}
	}()
	raw := l.Addr().(*net.TCPAddr).Port
	target, res, ok := New(300*time.Millisecond).Detect(context.Background(), []int{raw}, []string{"127.0.0.1"}, "")
	if !ok || target.Mode != ModeTCP || res.Status != UP {
		t.Fatalf("a non-HTTP listener should end up as a tcp target: %+v %+v ok=%v", target, res, ok)
	}

	if _, _, ok := New(300*time.Millisecond).Detect(context.Background(), nil, []string{"127.0.0.1"}, ""); ok {
		t.Error("no ports means no target")
	}
}

func TestDetectSwitchesToHTTPS(t *testing.T) {
	srv := httptest.NewTLSServer(actuator("UP", `{"status":"UP"}`))
	defer srv.Close()
	host, portStr, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ := strconv.Atoi(portStr)
	target, res, ok := New(time.Second).Detect(context.Background(), []int{port}, []string{host}, "")
	if !ok || target.Scheme != "https" || res.Status != UP {
		t.Fatalf("expected an https actuator target, got %+v %+v ok=%v", target, res, ok)
	}
}
