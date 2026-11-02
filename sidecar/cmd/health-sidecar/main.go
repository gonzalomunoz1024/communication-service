// Command health-sidecar probes the application in its pod and reports its health to the
// communication service. See sidecar/README.md.
package main

import (
	"context"
	"errors"
	"io"
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
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	code := run(ctx, os.Getenv, os.Stdout)
	stop()
	os.Exit(code)
}

// run wires the sidecar from the environment and runs it until ctx is done, logging JSON lines
// to stdout at CS_LOG_LEVEL. It returns the process exit code: 2 when the configuration cannot
// be started with (the error names the variable), 0 after a clean stop with the leaving report
// sent.
func run(ctx context.Context, getenv func(string) string, stdout io.Writer) int {
	// The level comes with the configuration; until it is read, and when the configuration is
	// unusable, the handler logs at INFO, so the error that stops the process is always written.
	level := new(slog.LevelVar)
	log := slog.New(slog.NewJSONHandler(stdout, &slog.HandlerOptions{Level: level}))
	cfg, err := config.FromEnv(getenv)
	if err != nil {
		log.Error("invalid configuration", "error", err)
		return 2
	}
	level.Set(cfg.LogLevel)
	client, err := report.NewClient(cfg.Endpoint, cfg.ClientID, version, cfg.ReportTimeout,
		cfg.CAFile, cfg.InsecureSkipVerify)
	if err != nil {
		log.Error("cannot build report client", "error", err)
		return 2
	}
	a := agent.New(cfg, probe.New(cfg.ProbeTimeout), client, log, version)

	server := &http.Server{Addr: cfg.Listen, Handler: a.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("status server failed", "addr", cfg.Listen, "error", err)
		}
	}()

	a.Run(ctx)

	shutdown, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	log.Info("health sidecar stopped")
	return 0
}
