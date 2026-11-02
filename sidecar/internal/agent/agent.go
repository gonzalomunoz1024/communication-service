// Package agent runs the sidecar's loop: find the app, probe it, smooth the result and report
// changes plus a heartbeat to the communication service.
package agent

import (
	"context"
	"encoding/json"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/config"
	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/discover"
	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/probe"
	"github.com/gonzalomunoz1024/communication-service/sidecar/internal/report"
)

// Backoff bounds for failed sends.
const (
	minBackoff = time.Second
	maxBackoff = 60 * time.Second
	// jitter is the share of an interval added at random so a fleet never ticks in lockstep.
	jitter = 0.2
)

// Sender posts a report (the report.Client in production).
type Sender interface {
	Send(ctx context.Context, r report.Report) error
}

// Agent owns the loop and the state /status exposes.
type Agent struct {
	cfg     config.Config
	prober  *probe.Prober
	sender  Sender
	log     *slog.Logger
	version string

	// Now and Sleep are replaceable for tests.
	Now   func() time.Time
	Sleep func(context.Context, time.Duration)
	// ProcRoot is where /proc/net/tcp is read from.
	ProcRoot string

	mu        sync.Mutex
	startedAt time.Time
	target    *probe.Target
	// lastTarget is the target most recently probed; it is kept when target is dropped for
	// rediscovery so a vanished app can be named in its DOWN report and on /status.
	lastTarget *probe.Target
	upSeen     bool
	last       report.Report
	lastSig    string
	lastSend   time.Time
	sendErr    string
	dirty      bool
	backoff    time.Duration
	nextSend   time.Time
	sent       int
}

// New wires an Agent.
func New(cfg config.Config, prober *probe.Prober, sender Sender, log *slog.Logger, version string) *Agent {
	a := &Agent{
		cfg:      cfg,
		prober:   prober,
		sender:   sender,
		log:      log,
		version:  version,
		Now:      time.Now,
		ProcRoot: "/proc",
	}
	a.Sleep = func(ctx context.Context, d time.Duration) {
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-ctx.Done():
		case <-t.C:
		}
	}
	if cfg.Fixed() {
		t := fixedTarget(cfg)
		a.target, a.lastTarget = &t, &t
	}
	return a
}

func fixedTarget(cfg config.Config) probe.Target {
	t := probe.Target{Mode: cfg.ProbeMode, Host: cfg.Hosts[0], Port: cfg.Port, Path: cfg.Path, Scheme: cfg.Scheme}
	if t.Scheme == "" {
		t.Scheme = "http"
	}
	switch t.Mode {
	case config.ModeTCP:
		t.Path = ""
	case config.ModeActuator:
		if t.Path == "" {
			t.Path = probe.ActuatorPath
		}
	case config.ModeHTTP:
		if t.Path == "" {
			t.Path = probe.RootPath
		}
	default: // auto with a pinned port: a path means http, no path means actuator-then-http
		if t.Path != "" {
			t.Mode = config.ModeHTTP
		} else {
			t.Mode = config.ModeActuator
			t.Path = probe.ActuatorPath
		}
	}
	return t
}

// Run ticks until ctx is cancelled, then sends a leaving report so the instance drops out of
// the service's rollup at once.
func (a *Agent) Run(ctx context.Context) {
	a.mu.Lock()
	a.startedAt = a.Now()
	a.mu.Unlock()
	a.log.Info("health sidecar starting", "version", a.version, "service", a.cfg.Service,
		"tenant", a.cfg.Tenant, "instance", a.cfg.Instance.ID, "endpoint", a.cfg.Endpoint,
		"probe", a.cfg.ProbeMode)
	for {
		a.Tick(ctx)
		wait := a.cfg.Interval + time.Duration(rand.Float64()*jitter*float64(a.cfg.Interval))
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			a.leave()
			return
		case <-timer.C:
		}
	}
}

// Tick runs one observe-compose-send cycle.
func (a *Agent) Tick(ctx context.Context) {
	now := a.Now()
	res, target := a.observe(ctx)
	rep := a.compose(res, target, now)
	a.send(ctx, rep, now)
}

func (a *Agent) observe(ctx context.Context) (probe.Result, *probe.Target) {
	a.mu.Lock()
	target := a.target
	a.mu.Unlock()

	if target == nil {
		return a.discover(ctx)
	}

	res := a.prober.Probe(ctx, *target)
	if res.Status != probe.UP && a.cfg.RetryDelay > 0 {
		a.Sleep(ctx, a.cfg.RetryDelay) // absorb a GC pause or a restart in progress
		res = a.prober.Probe(ctx, *target)
	}
	if res.Unreachable && !a.cfg.Fixed() {
		// The port may have moved (the app restarted on a different one): rediscover next tick
		// if nothing listens there any more.
		if ports, err := a.ports(); err == nil && !contains(ports, target.Port) {
			a.log.Info("health target gone; will rediscover", "target", target.String())
			a.mu.Lock()
			a.target = nil
			a.mu.Unlock()
		}
	}
	return res, target
}

// discover looks for the app when no target is known. Before the app has ever answered UP a
// miss means "still starting" (UNKNOWN, which the service ignores). After it has, a miss means
// the app stopped listening: that is DOWN, named after the target that vanished, so a crashed or
// crash-looping app opens an outage instead of looking like a pod that is still starting.
func (a *Agent) discover(ctx context.Context) (probe.Result, *probe.Target) {
	t, res, found, err := a.detect(ctx)
	if err != nil {
		return probe.Result{Status: probe.UNKNOWN, Message: "cannot list listening ports: " + err.Error()}, nil
	}
	a.mu.Lock()
	upSeen, last := a.upSeen, a.lastTarget
	a.mu.Unlock()
	if !found && upSeen && a.cfg.RetryDelay > 0 {
		a.Sleep(ctx, a.cfg.RetryDelay) // the same second look a non-UP answer gets
		if t, res, found, err = a.detect(ctx); err != nil {
			return probe.Result{Status: probe.UNKNOWN, Message: "cannot list listening ports: " + err.Error()}, nil
		}
	}
	if !found {
		if !upSeen {
			return probe.Result{Status: probe.UNKNOWN, Message: "no health target found yet"}, nil
		}
		msg := "app is not listening"
		if last != nil {
			msg += " (last target " + last.String() + ")"
		}
		return probe.Result{Status: probe.DOWN, Message: msg, Unreachable: true}, nil
	}
	a.log.Info("health target found", "target", t.String(), "status", res.Status)
	a.mu.Lock()
	a.target, a.lastTarget = &t, &t
	a.mu.Unlock()
	return res, &t
}

// detect runs discovery over the pod's listening ports. found is false when no port answered;
// err is set when the port table itself could not be read, in which case nothing can be said.
func (a *Agent) detect(ctx context.Context) (probe.Target, probe.Result, bool, error) {
	ports, err := a.ports()
	if err != nil {
		a.log.Warn("cannot list listening ports", "error", err)
		return probe.Target{}, probe.Result{}, false, err
	}
	t, res, ok := a.prober.Detect(ctx, ports, a.cfg.Hosts, a.cfg.Scheme)
	return t, res, ok, nil
}

func (a *Agent) ports() ([]int, error) {
	own := listenPort(a.cfg.Listen)
	return discover.ListeningPorts(a.ProcRoot, func(p int) bool { return p == own || a.cfg.Ignored(p) })
}

// compose turns an observation into the report to send, applying the startup rule: until the
// app has answered UP once, and while the grace period runs, the instance is UNKNOWN, which
// the service ignores. A pinned target that never answers UP stays UNKNOWN after the grace,
// because that is far more often a wrong port than an outage. Once UP has been seen the
// observation passes through unchanged, including the DOWN discover() reports for an app that
// stopped listening.
func (a *Agent) compose(res probe.Result, target *probe.Target, now time.Time) report.Report {
	a.mu.Lock()
	defer a.mu.Unlock()
	if res.Status == probe.UP {
		a.upSeen = true
	}
	status, components, message := res.Status, res.Components, res.Message
	inGrace := now.Sub(a.startedAt) < a.cfg.StartupGrace
	switch {
	case a.upSeen:
	case target == nil && inGrace:
		status, components, message = probe.UNKNOWN, nil, "starting: waiting for the app to listen"
	case target == nil:
		status, components = probe.UNKNOWN, nil
		message = "no health target found after " + a.cfg.StartupGrace.String() +
			": no listening port answered; set CS_PORT and CS_PATH"
	case inGrace && status != probe.UP:
		status, components = probe.UNKNOWN, nil
		message = "starting: waiting for the first healthy answer from " + target.String()
	case a.cfg.Fixed() && status != probe.UP:
		status, components = probe.UNKNOWN, nil
		message = "health target " + target.String() + " never answered UP since start; check CS_PORT, CS_PATH and CS_SCHEME"
	}
	rep := report.Report{
		TenantID:   a.cfg.Tenant,
		Service:    a.cfg.Service,
		Status:     status,
		Components: components,
		Message:    message,
		ObservedAt: now.UTC().Truncate(time.Millisecond),
		Publisher:  a.cfg.Publisher,
		Instance:   a.instance(false),
	}
	a.last = rep
	return rep
}

func (a *Agent) instance(leaving bool) *report.Instance {
	return &report.Instance{
		ID:        a.cfg.Instance.ID,
		Namespace: a.cfg.Instance.Namespace,
		Node:      a.cfg.Instance.Node,
		Cluster:   a.cfg.Instance.Cluster,
		Version:   a.cfg.Instance.Version,
		Sidecar:   a.version,
		Leaving:   leaving,
	}
}

// send posts when the status changed, the heartbeat is due, or a failed send is being retried;
// failures back off exponentially up to a minute, keeping only the latest report.
func (a *Agent) send(ctx context.Context, rep report.Report, now time.Time) {
	a.mu.Lock()
	sig := signature(rep)
	if a.dirty && now.Before(a.nextSend) {
		a.mu.Unlock()
		return
	}
	due := a.dirty || sig != a.lastSig || now.Sub(a.lastSend) >= a.cfg.Heartbeat
	a.mu.Unlock()
	if !due {
		return
	}
	err := a.sender.Send(ctx, rep)
	a.mu.Lock()
	defer a.mu.Unlock()
	switch {
	case err == nil:
		if sig != a.lastSig {
			a.log.Info("reported", "status", rep.Status, "message", rep.Message)
		}
		a.lastSig, a.lastSend, a.sendErr = sig, now, ""
		a.dirty, a.backoff = false, 0
		a.sent++
	case report.IsPermanent(err):
		// The body is wrong for this service; say so, and try again at the heartbeat cadence.
		a.log.Error("report rejected", "error", err)
		a.lastSig, a.lastSend, a.sendErr = sig, now, err.Error()
		a.dirty, a.backoff = false, 0
	case ctx.Err() != nil:
		// Shutting down mid-tick: the leaving report follows and says everything needed.
	default:
		if a.backoff == 0 {
			a.backoff = minBackoff
		} else {
			a.backoff = min(a.backoff*2, maxBackoff)
		}
		a.dirty = true
		a.sendErr = err.Error()
		a.nextSend = now.Add(a.backoff + time.Duration(rand.Float64()*jitter*float64(a.backoff)))
		a.log.Warn("report failed; will retry", "error", err, "in", a.backoff.String())
	}
}

func (a *Agent) leave() {
	a.mu.Lock()
	rep := a.last
	a.mu.Unlock()
	if rep.Service == "" {
		return // never composed a report: nothing to retract
	}
	ctx, cancel := context.WithTimeout(context.Background(), a.cfg.ReportTimeout)
	defer cancel()
	rep.Instance = a.instance(true)
	rep.Message = "instance shutting down"
	rep.ObservedAt = a.Now().UTC().Truncate(time.Millisecond)
	if err := a.sender.Send(ctx, rep); err != nil {
		a.log.Warn("leaving report failed", "error", err)
		return
	}
	a.log.Info("leaving report sent")
}

// Snapshot is what /status returns.
type Snapshot struct {
	Version  string `json:"version"`
	Service  string `json:"service"`
	Tenant   string `json:"tenant"`
	Instance string `json:"instance"`
	Target   string `json:"target,omitempty"`
	// LastTarget is the target last probed; it stays set while Target is empty because the app
	// stopped listening and discovery is running again.
	LastTarget  string         `json:"lastTarget,omitempty"`
	UpSeen      bool           `json:"upSeen"`
	Last        *report.Report `json:"lastReport,omitempty"`
	LastSendAt  *time.Time     `json:"lastSendAt,omitempty"`
	SendError   string         `json:"sendError,omitempty"`
	ReportsSent int            `json:"reportsSent"`
}

// Status returns the current state.
func (a *Agent) Status() Snapshot {
	a.mu.Lock()
	defer a.mu.Unlock()
	s := Snapshot{
		Version: a.version, Service: a.cfg.Service, Tenant: a.cfg.Tenant,
		Instance: a.cfg.Instance.ID, UpSeen: a.upSeen, SendError: a.sendErr, ReportsSent: a.sent,
	}
	if a.target != nil {
		s.Target = a.target.String()
	}
	if a.lastTarget != nil {
		s.LastTarget = a.lastTarget.String()
	}
	if a.last.Service != "" {
		last := a.last
		s.Last = &last
	}
	if !a.lastSend.IsZero() {
		t := a.lastSend
		s.LastSendAt = &t
	}
	return s
}

// Handler serves /healthz (the sidecar itself is alive) and /status (what it last saw and sent).
func (a *Agent) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(a.Status())
	})
	return mux
}

func signature(r report.Report) string {
	return probe.Result{Status: r.Status, Components: r.Components}.Signature()
}

func contains(ports []int, p int) bool {
	for _, x := range ports {
		if x == p {
			return true
		}
	}
	return false
}

// listenPort extracts the port of a listen address such as ":9465" or "0.0.0.0:9465".
func listenPort(addr string) int {
	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return 0
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return 0
	}
	return port
}
