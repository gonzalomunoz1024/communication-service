// Package config reads the sidecar's settings from environment variables.
//
// Everything has a default except CS_ENDPOINT and CS_TENANT. The pod's own identity comes from
// the Downward API variables the deploy snippets set (POD_NAME, POD_NAMESPACE, NODE_NAME).
package config

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Config is the fully resolved sidecar configuration.
type Config struct {
	// Endpoint is the communication service base URL, e.g. https://communication.apps.example.com.
	Endpoint string
	// ClientID goes into X-Client-Id on every call (the caller's repository name).
	ClientID string
	Tenant   string
	Service  string
	// Publisher is the publisher name auto-registered monitors get.
	Publisher string

	// ProbeMode is auto, actuator, http or tcp.
	ProbeMode string
	// Port, Path and Scheme pin the probe target; zero values mean "discover".
	Port   int
	Path   string
	Scheme string
	// Hosts are the addresses tried for the app, in order.
	Hosts []string
	// IgnorePorts are listening ports discovery skips (service-mesh admin ports by default).
	IgnorePorts []PortRange

	Interval      time.Duration
	Heartbeat     time.Duration
	ProbeTimeout  time.Duration
	ReportTimeout time.Duration
	StartupGrace  time.Duration
	RetryDelay    time.Duration

	// Listen is the sidecar's own address for /healthz and /status.
	Listen string
	// CAFile adds a PEM bundle (an internal CA) for the connection to the endpoint.
	CAFile string
	// InsecureSkipVerify disables TLS verification towards the endpoint (local experiments only).
	InsecureSkipVerify bool

	Instance Instance
}

// Instance identifies this pod in reports.
type Instance struct {
	ID        string
	Namespace string
	Node      string
	Cluster   string
	Version   string
}

// PortRange is an inclusive range of ports.
type PortRange struct {
	From, To int
}

// Contains reports whether p is inside the range.
func (r PortRange) Contains(p int) bool { return p >= r.From && p <= r.To }

// Modes a probe can run in.
const (
	ModeAuto     = "auto"
	ModeActuator = "actuator"
	ModeHTTP     = "http"
	ModeTCP      = "tcp"
)

// FromEnv builds a Config from the given lookup (normally os.Getenv).
func FromEnv(get func(string) string) (Config, error) {
	var errs []error
	str := func(key, def string) string {
		if v := strings.TrimSpace(get(key)); v != "" {
			return v
		}
		return def
	}
	dur := func(key string, def time.Duration) time.Duration {
		v := strings.TrimSpace(get(key))
		if v == "" {
			return def
		}
		d, err := time.ParseDuration(v)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", key, err))
			return def
		}
		return d
	}
	num := func(key string, def int) int {
		v := strings.TrimSpace(get(key))
		if v == "" {
			return def
		}
		n, err := strconv.Atoi(v)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", key, err))
			return def
		}
		return n
	}
	// boolean takes true/false, 1/0, yes/no and on/off in any case; anything else is an error
	// rather than a guess, so a typo stops the sidecar like every other unusable value.
	boolean := func(key string, def bool) bool {
		v := strings.TrimSpace(get(key))
		switch strings.ToLower(v) {
		case "":
			return def
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
		errs = append(errs, fmt.Errorf("%s must be true or false (got %q)", key, v))
		return def
	}

	podName := str("POD_NAME", "")
	if podName == "" {
		podName, _ = os.Hostname()
	}
	service := str("CS_SERVICE", DeriveService(podName))

	cfg := Config{
		Endpoint:           strings.TrimRight(str("CS_ENDPOINT", ""), "/"),
		Tenant:             str("CS_TENANT", ""),
		Service:            service,
		ClientID:           str("CS_CLIENT_ID", service),
		Publisher:          str("CS_PUBLISHER", "health-sidecar"),
		ProbeMode:          strings.ToLower(str("CS_PROBE", ModeAuto)),
		Port:               num("CS_PORT", 0),
		Path:               str("CS_PATH", ""),
		Scheme:             strings.ToLower(str("CS_SCHEME", "")),
		Hosts:              splitList(str("CS_HOST", "127.0.0.1,::1")),
		Interval:           dur("CS_INTERVAL", 15*time.Second),
		Heartbeat:          dur("CS_HEARTBEAT", 30*time.Second),
		ProbeTimeout:       dur("CS_PROBE_TIMEOUT", 3*time.Second),
		ReportTimeout:      dur("CS_REPORT_TIMEOUT", 10*time.Second),
		StartupGrace:       dur("CS_STARTUP_GRACE", 5*time.Minute),
		RetryDelay:         dur("CS_RETRY_DELAY", 2*time.Second),
		Listen:             str("CS_LISTEN", ":9465"),
		CAFile:             str("CS_CA_FILE", ""),
		InsecureSkipVerify: boolean("CS_INSECURE_SKIP_VERIFY", false),
		Instance: Instance{
			ID:        str("CS_INSTANCE_ID", podName),
			Namespace: str("POD_NAMESPACE", ""),
			Node:      str("NODE_NAME", ""),
			Cluster:   str("CS_CLUSTER", ""),
			Version:   str("CS_VERSION", ""),
		},
	}

	ranges, err := ParsePortRanges(str("CS_IGNORE_PORTS", "15000-15099"))
	if err != nil {
		errs = append(errs, fmt.Errorf("CS_IGNORE_PORTS: %w", err))
	}
	cfg.IgnorePorts = ranges

	if cfg.Endpoint == "" {
		errs = append(errs, errors.New("CS_ENDPOINT is required (the communication service base URL)"))
	} else if !strings.HasPrefix(cfg.Endpoint, "http://") && !strings.HasPrefix(cfg.Endpoint, "https://") {
		errs = append(errs, errors.New("CS_ENDPOINT must start with http:// or https://"))
	}
	if cfg.Tenant == "" {
		errs = append(errs, errors.New("CS_TENANT is required"))
	}
	if cfg.Service == "" {
		errs = append(errs, errors.New("CS_SERVICE is required when it cannot be derived from POD_NAME"))
	}
	switch cfg.ProbeMode {
	case ModeAuto, ModeActuator, ModeHTTP, ModeTCP:
	default:
		errs = append(errs, fmt.Errorf("CS_PROBE must be auto, actuator, http or tcp (got %q)", cfg.ProbeMode))
	}
	if cfg.Port < 0 || cfg.Port > 65535 {
		errs = append(errs, fmt.Errorf("CS_PORT out of range: %d", cfg.Port))
	}
	if cfg.ProbeMode != ModeAuto && cfg.Port == 0 {
		errs = append(errs, fmt.Errorf("CS_PORT is required when CS_PROBE=%s", cfg.ProbeMode))
	}
	if cfg.Scheme != "" && cfg.Scheme != "http" && cfg.Scheme != "https" {
		errs = append(errs, fmt.Errorf("CS_SCHEME must be http or https (got %q)", cfg.Scheme))
	}
	if cfg.Path != "" && !strings.HasPrefix(cfg.Path, "/") {
		cfg.Path = "/" + cfg.Path
	}
	if cfg.Interval < time.Second {
		errs = append(errs, errors.New("CS_INTERVAL must be at least 1s"))
	}
	if cfg.Heartbeat < cfg.Interval {
		cfg.Heartbeat = cfg.Interval
	}
	if len(errs) > 0 {
		return cfg, errors.Join(errs...)
	}
	return cfg, nil
}

// Fixed reports whether the probe target is pinned by configuration rather than discovered.
func (c Config) Fixed() bool { return c.Port != 0 }

// Ignored reports whether discovery should skip a port.
func (c Config) Ignored(port int) bool {
	for _, r := range c.IgnorePorts {
		if r.Contains(port) {
			return true
		}
	}
	return false
}

var (
	// Kubernetes generates pod and ReplicaSet suffixes from this alphabet.
	k8sSuffix = regexp.MustCompile(`^[bcdfghjklmnpqrstvwxz2456789]+$`)
	numeric   = regexp.MustCompile(`^[0-9]+$`)
)

// DeriveService guesses the workload name from a pod name: Deployment pods are
// <name>-<template hash>-<5 chars>, bare ReplicaSet and DaemonSet pods are <name>-<5 chars>,
// StatefulSet pods are <name>-<ordinal>. Anything else is returned as is.
func DeriveService(pod string) string {
	parts := strings.Split(pod, "-")
	n := len(parts)
	if n >= 3 && isSuffix(parts[n-1], 5, 5) && isSuffix(parts[n-2], 6, 10) {
		return strings.Join(parts[:n-2], "-")
	}
	if n >= 2 && isSuffix(parts[n-1], 5, 5) {
		return strings.Join(parts[:n-1], "-")
	}
	if n >= 2 && numeric.MatchString(parts[n-1]) {
		return strings.Join(parts[:n-1], "-")
	}
	return pod
}

func isSuffix(s string, min, max int) bool {
	return len(s) >= min && len(s) <= max && k8sSuffix.MatchString(s)
}

// ParsePortRanges reads "80,8000-8099" style lists.
func ParsePortRanges(s string) ([]PortRange, error) {
	var out []PortRange
	for _, item := range splitList(s) {
		from, to, found := strings.Cut(item, "-")
		if !found {
			to = from
		}
		a, err := strconv.Atoi(strings.TrimSpace(from))
		if err != nil {
			return nil, fmt.Errorf("bad port %q", item)
		}
		b, err := strconv.Atoi(strings.TrimSpace(to))
		if err != nil || b < a {
			return nil, fmt.Errorf("bad port range %q", item)
		}
		out = append(out, PortRange{From: a, To: b})
	}
	return out, nil
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
