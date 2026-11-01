package report

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSendPostsReportWithClientId(t *testing.T) {
	var got Report
	var headers http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers = r.Header.Clone()
		if r.URL.Path != "/v1/health/reports" || r.Method != http.MethodPost {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	c, err := NewClient(srv.URL+"/", "payments-api", "1.0", time.Second, "", false)
	if err != nil {
		t.Fatal(err)
	}
	rep := Report{TenantID: "retail", Service: "payments-api", Status: "UP", ObservedAt: time.Now(),
		Instance: &Instance{ID: "pod-1", Node: "worker-3"}}
	if err := c.Send(context.Background(), rep); err != nil {
		t.Fatal(err)
	}
	if headers.Get("X-Client-Id") != "payments-api" || headers.Get("Content-Type") != "application/json" {
		t.Errorf("headers: %v", headers)
	}
	if got.Service != "payments-api" || got.Instance == nil || got.Instance.ID != "pod-1" || got.Instance.Leaving {
		t.Errorf("body: %+v", got)
	}
}

func TestSendClassifiesFailures(t *testing.T) {
	code := http.StatusBadRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(code)
		_, _ = w.Write([]byte(`{"error":"nope"}`))
	}))
	defer srv.Close()
	c, _ := NewClient(srv.URL, "x", "test", time.Second, "", false)

	err := c.Send(context.Background(), Report{})
	if !IsPermanent(err) {
		t.Errorf("400 should be permanent, got %v", err)
	}
	for _, code = range []int{http.StatusServiceUnavailable, http.StatusConflict, http.StatusTooManyRequests} {
		if err := c.Send(context.Background(), Report{}); err == nil || IsPermanent(err) {
			t.Errorf("%d should be retryable, got %v", code, err)
		}
	}
	srv.Close()
	if err := c.Send(context.Background(), Report{}); err == nil || IsPermanent(err) {
		t.Errorf("a connection failure should be retryable, got %v", err)
	}
}

func TestNewClientRejectsBadCAFile(t *testing.T) {
	if _, err := NewClient("https://x", "x", "test", time.Second, "/nonexistent.pem", false); err == nil {
		t.Error("missing CA file should fail fast")
	}
}
