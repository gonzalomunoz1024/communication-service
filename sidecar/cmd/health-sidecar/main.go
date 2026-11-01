// Command health-sidecar probes the application in its pod and reports its health to the
// communication service. See sidecar/README.md.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/agent"
	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/config"
	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/probe"
	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/report"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.FromEnv(os.Getenv)
	if err != nil {
		log.Error("invalid configuration", "error", err)
		os.Exit(2)
	}
	client, err := report.NewClient(cfg.Endpoint, cfg.ClientID, version, cfg.ReportTimeout,
		cfg.CAFile, cfg.InsecureSkipVerify)
	if err != nil {
		log.Error("cannot build report client", "error", err)
		os.Exit(2)
	}
	a := agent.New(cfg, probe.New(cfg.ProbeTimeout), client, log, version)

	server := &http.Server{Addr: cfg.Listen, Handler: a.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("status server failed", "addr", cfg.Listen, "error", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	a.Run(ctx)

	shutdown, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	log.Info("health sidecar stopped")
}
