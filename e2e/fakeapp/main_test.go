package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler(newHealth(), slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(srv.Close)
	return srv
}

func TestHealthFlipsWithSetAndBack(t *testing.T) {
	srv := newTestServer(t)
	assertHealth(t, srv.URL, http.StatusOK, "UP", "UP")

	set(t, srv.URL, "status=DOWN&db=DOWN", "DOWN", "DOWN")
	assertHealth(t, srv.URL, http.StatusServiceUnavailable, "DOWN", "DOWN")

	// a partial change keeps the other value: overall UP with the db still DOWN is a 200
	set(t, srv.URL, "status=UP", "UP", "DOWN")
	assertHealth(t, srv.URL, http.StatusOK, "UP", "DOWN")

	set(t, srv.URL, "db=UP", "UP", "UP")
	assertHealth(t, srv.URL, http.StatusOK, "UP", "UP")
}

func TestSetRequiresPost(t *testing.T) {
	srv := newTestServer(t)
	res, err := http.Get(srv.URL + "/__set?status=DOWN")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("GET /__set: got %d, want 405", res.StatusCode)
	}
	assertHealth(t, srv.URL, http.StatusOK, "UP", "UP")
}

func TestRootAndUnknownPaths(t *testing.T) {
	srv := newTestServer(t)
	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || string(body) != "fake app\n" {
		t.Fatalf("GET /: got %d %q", res.StatusCode, body)
	}
	res, err = http.Get(srv.URL + "/nope")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("GET /nope: got %d, want 404", res.StatusCode)
	}
}

// set flips the health through POST /__set and checks the answered pair.
func set(t *testing.T, base, query, wantStatus, wantDB string) {
	t.Helper()
	res, err := http.Post(base+"/__set?"+query, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var got map[string]string
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatalf("POST /__set?%s: %v", query, err)
	}
	if res.StatusCode != http.StatusOK || got["status"] != wantStatus || got["db"] != wantDB {
		t.Fatalf("POST /__set?%s: got %d %v, want 200 %s/%s", query, res.StatusCode, got, wantStatus, wantDB)
	}
}

// assertHealth reads both health paths and checks the code, the overall status and the db component.
func assertHealth(t *testing.T, base string, wantCode int, wantStatus, wantDB string) {
	t.Helper()
	for _, path := range []string{"/actuator/health", "/actuator/health/readiness"} {
		res, err := http.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		var doc struct {
			Status     string `json:"status"`
			Components struct {
				DB struct {
					Status string `json:"status"`
				} `json:"db"`
			} `json:"components"`
		}
		err = json.NewDecoder(res.Body).Decode(&doc)
		res.Body.Close()
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		if ct := res.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("GET %s: content type %q", path, ct)
		}
		if res.StatusCode != wantCode || doc.Status != wantStatus || doc.Components.DB.Status != wantDB {
			t.Errorf("GET %s: got %d %s/db=%s, want %d %s/db=%s", path, res.StatusCode, doc.Status,
				doc.Components.DB.Status, wantCode, wantStatus, wantDB)
		}
	}
}
