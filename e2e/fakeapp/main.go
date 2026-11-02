// Command fakeapp stands in for a publisher team's application container in the e2e stack
// (e2e/docker-compose.yml): a Spring Actuator style health endpoint whose answer the tests flip
// at will, so the health sidecar next to it probes something real.
//
//	GET  /actuator/health            {"status": …, "components": {"db": …, "ping": …}}; 503 unless UP
//	GET  /actuator/health/readiness  the same document
//	POST /__set?status=DOWN&db=DOWN  changes the overall status and/or the db component; answers the new pair
//	GET  /                           "fake app"
//
// It listens on PORT (default 8080) and uses nothing outside the Go standard library.
package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"sync"
)

// health is what /actuator/health reports, guarded because flips and probes arrive concurrently.
type health struct {
	mu     sync.Mutex
	status string
	db     string
}

func newHealth() *health { return &health{status: "UP", db: "UP"} }

func (h *health) get() (status, db string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.status, h.db
}

// set changes whichever of the two values is non-empty and returns the resulting pair.
func (h *health) set(status, db string) (string, string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if status != "" {
		h.status = status
	}
	if db != "" {
		h.db = db
	}
	return h.status, h.db
}

// handler serves the endpoints above; it is separate from main so the test can run it with httptest.
func handler(h *health, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	actuator := func(w http.ResponseWriter, _ *http.Request) {
		status, db := h.get()
		code := http.StatusOK
		if status != "UP" {
			code = http.StatusServiceUnavailable
		}
		writeJSON(w, code, map[string]any{
			"status": status,
			"components": map[string]any{
				"db":   map[string]any{"status": db, "details": map[string]any{"database": "PostgreSQL"}},
				"ping": map[string]any{"status": "UP"},
			},
		}, log)
	}
	mux.HandleFunc("GET /actuator/health", actuator)
	mux.HandleFunc("GET /actuator/health/readiness", actuator)
	mux.HandleFunc("POST /__set", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		status, db := h.set(q.Get("status"), q.Get("db"))
		log.Info("health set", "status", status, "db", db)
		writeJSON(w, http.StatusOK, map[string]string{"status": status, "db": db}, log)
	})
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		if _, err := w.Write([]byte("fake app\n")); err != nil {
			log.Warn("write failed", "error", err)
		}
	})
	return mux
}

func writeJSON(w http.ResponseWriter, code int, body any, log *slog.Logger) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Warn("write failed", "error", err)
	}
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Info("fake app listening", "port", port)
	if err := http.ListenAndServe(":"+port, handler(newHealth(), log)); err != nil {
		log.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
