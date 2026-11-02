// Package probe checks the application's health over localhost and finds where to check when
// nothing is configured.
package probe

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"syscall"
	"time"
)

// Canonical statuses. Anything else the app says (WARN, DEGRADED, ...) is passed through
// upper-cased; the communication service treats unknown words as DEGRADED.
const (
	UP      = "UP"
	DOWN    = "DOWN"
	UNKNOWN = "UNKNOWN"
)

// Modes a target can be probed in.
const (
	ModeActuator = "actuator"
	ModeHTTP     = "http"
	ModeTCP      = "tcp"
)

// Paths tried, in order, when discovering an HTTP health endpoint.
var (
	ActuatorPath = "/actuator/health"
	HealthPaths  = []string{"/health", "/healthz", "/readyz", "/ready", "/livez", "/q/health"}
	RootPath     = "/"
)

// maxBody caps how much of a health document is read, so a chatty indicator cannot bloat reports.
const maxBody = 64 * 1024

// Target is where and how the app is probed.
type Target struct {
	Mode   string
	Scheme string
	Host   string
	Port   int
	Path   string
}

// URL renders an HTTP target.
func (t Target) URL() string {
	return fmt.Sprintf("%s://%s%s", t.Scheme, net.JoinHostPort(t.Host, fmt.Sprint(t.Port)), t.Path)
}

func (t Target) String() string {
	if t.Mode == ModeTCP {
		return "tcp://" + net.JoinHostPort(t.Host, fmt.Sprint(t.Port))
	}
	return t.URL()
}

// Result is one observation.
type Result struct {
	Status string
	// Components is the raw components map of an Actuator-style document, if the app sent one.
	Components map[string]any
	Message    string
	HTTPStatus int
	// Document is true when the answer was a health document (a JSON object with a status).
	Document bool
	// Unreachable is true when nothing accepted the connection (refused, timeout, no route).
	Unreachable bool
	// TLSHint is true when a plain-HTTP probe hit a server that wants TLS.
	TLSHint bool
}

// Signature identifies what the result says, ignoring detail text: used to decide whether a
// change is worth reporting.
func (r Result) Signature() string {
	var parts []string
	leaves("", r.Components, func(path, status string) {
		if status != UP {
			parts = append(parts, path+"="+status)
		}
	})
	sort.Strings(parts)
	return r.Status + "|" + strings.Join(parts, ",")
}

// Failing reports whether a component, nested ones included, is neither UP nor UNKNOWN: the
// components the communication service counts as failing, one of which turns an UP report into
// DEGRADED there.
func Failing(components map[string]any) bool {
	failing := false
	leaves("", components, func(_, status string) {
		failing = failing || (status != UP && status != UNKNOWN)
	})
	return failing
}

// leaves calls fn with the dotted path and the normalised status of every component without
// components of its own; one that has them is represented by them, as on the service.
func leaves(prefix string, components map[string]any, fn func(path, status string)) {
	for name, raw := range components {
		node, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		path := name
		if prefix != "" {
			path = prefix + "." + name
		}
		if children, ok := node["components"].(map[string]any); ok && len(children) > 0 {
			leaves(path, children, fn)
			continue
		}
		if status, ok := node["status"].(string); ok {
			fn(path, Normalize(status))
		}
	}
}

// Prober performs probes with a fixed timeout.
type Prober struct {
	timeout time.Duration
	client  *http.Client
}

// New builds a Prober. TLS towards localhost is accepted without certificate checks: the
// connection never leaves the pod.
func New(timeout time.Duration) *Prober {
	transport := &http.Transport{
		Proxy:               nil, // never proxy a localhost probe
		DisableKeepAlives:   true,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // in-pod loopback
		TLSHandshakeTimeout: timeout,
		DialContext:         (&net.Dialer{Timeout: timeout}).DialContext,
	}
	return &Prober{
		timeout: timeout,
		client: &http.Client{
			Transport: transport,
			Timeout:   timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse // a redirect is an answer, not a path to follow
			},
		},
	}
}

// Probe observes one target.
func (p *Prober) Probe(ctx context.Context, t Target) Result {
	if t.Mode == ModeTCP {
		return p.tcp(ctx, t)
	}
	return p.http(ctx, t)
}

func (p *Prober) tcp(ctx context.Context, t Target) Result {
	d := net.Dialer{Timeout: p.timeout}
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(t.Host, fmt.Sprint(t.Port)))
	if err != nil {
		return Result{Status: DOWN, Message: "connect " + t.String() + ": " + rootCause(err), Unreachable: true}
	}
	conn.Close()
	return Result{Status: UP}
}

func (p *Prober) http(ctx context.Context, t Target) Result {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.URL(), nil)
	if err != nil {
		return Result{Status: UNKNOWN, Message: "bad target " + t.URL() + ": " + err.Error()}
	}
	req.Header.Set("Accept", "application/json, */*;q=0.5")
	req.Header.Set("User-Agent", "health-sidecar")
	resp, err := p.client.Do(req)
	if err != nil {
		return Result{Status: DOWN, Message: "GET " + t.URL() + ": " + rootCause(err), Unreachable: unreachable(err)}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	res := Result{HTTPStatus: resp.StatusCode}
	if doc, ok := parseDocument(body); ok {
		res.Document = true
		res.Status = Normalize(doc.status)
		res.Components = doc.components
		if res.Status == UNKNOWN {
			res.Status = byCode(resp.StatusCode, t)
		}
		if res.Status != UP && doc.status != "" {
			res.Message = "health document reports " + strings.ToUpper(doc.status)
		}
		return res
	}
	res.Status = byCode(resp.StatusCode, t)
	if resp.StatusCode == http.StatusBadRequest && t.Scheme == "http" &&
		strings.Contains(string(body), "HTTPS server") {
		res.TLSHint = true // Go servers answer plaintext on a TLS port with exactly this
		res.Status = UNKNOWN
	}
	switch {
	case res.TLSHint:
		res.Message = fmt.Sprintf("GET %s: the port speaks TLS; use CS_SCHEME=https", t.URL())
	case resp.StatusCode >= 500:
		res.Message = fmt.Sprintf("GET %s: HTTP %d", t.URL(), resp.StatusCode)
	case res.Status == UNKNOWN:
		res.Message = fmt.Sprintf("GET %s: HTTP %d (not a health answer; check CS_PATH)", t.URL(), resp.StatusCode)
	}
	return res
}

// byCode classifies an answer without a health document. On a specific health path a 4xx is
// no information (wrong path, or the endpoint needs auth); on "/" any answer below 500 proves
// the server is up.
func byCode(code int, t Target) string {
	switch {
	case code >= 500:
		return DOWN
	case code < 400:
		return UP
	case t.Path == RootPath:
		return UP
	default:
		return UNKNOWN
	}
}

type document struct {
	status     string
	components map[string]any
}

// parseDocument accepts a JSON object with a string "status". Nested indicators come from
// "components" or, for older Actuator versions, status-bearing entries of "details".
func parseDocument(body []byte) (document, bool) {
	if len(body) == 0 || len(body) > maxBody {
		return document{}, false
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return document{}, false
	}
	status, ok := raw["status"].(string)
	if !ok {
		return document{}, false
	}
	doc := document{status: status}
	if components, ok := raw["components"].(map[string]any); ok && len(components) > 0 {
		doc.components = components
	} else if details, ok := raw["details"].(map[string]any); ok {
		nested := map[string]any{}
		for name, value := range details {
			if child, ok := value.(map[string]any); ok {
				if _, has := child["status"].(string); has {
					nested[name] = child
				}
			}
		}
		if len(nested) > 0 {
			doc.components = nested
		}
	}
	return doc, true
}

// Normalize maps the many spellings of "fine" and "broken" onto the canonical statuses and
// passes anything else through upper-cased (the service treats those as DEGRADED).
func Normalize(status string) string {
	s := strings.ToUpper(strings.TrimSpace(status))
	switch s {
	case "UP", "OK", "PASS", "HEALTHY", "GREEN", "SERVING":
		return UP
	case "DOWN", "FAIL", "FAILED", "ERROR", "UNHEALTHY", "OUT_OF_SERVICE", "FATAL", "RED", "NOT_SERVING":
		return DOWN
	case "", "UNKNOWN":
		return UNKNOWN
	}
	return s
}

// Detect finds a target among the given ports and hosts: an Actuator document on any port, then
// a common health path, then "/" answering at all, then a plain TCP connect to the lowest port.
// scheme pins http or https; empty tries http and falls back to https when the port speaks TLS.
func (p *Prober) Detect(ctx context.Context, ports []int, hosts []string, scheme string) (Target, Result, bool) {
	if len(ports) == 0 {
		return Target{}, Result{}, false
	}
	type pass struct {
		mode   string
		paths  []string
		accept func(Result) bool
	}
	passes := []pass{
		{ModeActuator, []string{ActuatorPath}, func(r Result) bool { return r.Document }},
		{ModeHTTP, HealthPaths, func(r Result) bool { return r.Document || r.Status == UP }},
		{ModeHTTP, []string{RootPath}, func(r Result) bool { return r.Status == UP || r.Status == DOWN }},
	}
	reachable := map[int]bool{}
	for _, ps := range passes {
		for _, port := range ports {
			for _, path := range ps.paths {
				for _, host := range hosts {
					if ctx.Err() != nil {
						return Target{}, Result{}, false
					}
					t, res, ok := p.tryHTTP(ctx, Target{Mode: ps.mode, Host: host, Port: port, Path: path}, scheme)
					if !ok {
						continue // this host did not accept the connection; try the next one
					}
					reachable[port] = true
					if ps.accept(res) {
						return t, res, true
					}
					break // answered but not with what this pass wants: next path
				}
			}
		}
	}
	for _, port := range ports {
		for _, host := range hosts {
			t := Target{Mode: ModeTCP, Host: host, Port: port}
			if res := p.tcp(ctx, t); res.Status == UP {
				return t, res, true
			}
		}
		if reachable[port] {
			t := Target{Mode: ModeTCP, Host: hosts[0], Port: port}
			return t, Result{Status: UP}, true
		}
	}
	return Target{}, Result{}, false
}

// tryHTTP probes with the given or guessed scheme; ok is false when the port is unreachable on
// that host.
func (p *Prober) tryHTTP(ctx context.Context, t Target, scheme string) (Target, Result, bool) {
	schemes := []string{"http", "https"}
	if scheme != "" {
		schemes = []string{scheme}
	}
	for _, s := range schemes {
		t.Scheme = s
		res := p.http(ctx, t)
		if res.Unreachable {
			return t, res, false
		}
		if res.HTTPStatus != 0 && !res.TLSHint {
			return t, res, true
		}
		// connected but no plain HTTP answer: probably the other scheme
	}
	return t, Result{Status: UNKNOWN}, false
}

func unreachable(err error) bool {
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	return errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.EHOSTUNREACH) ||
		errors.Is(err, syscall.ENETUNREACH)
}

func rootCause(err error) string {
	for {
		next := errors.Unwrap(err)
		if next == nil {
			return err.Error()
		}
		err = next
	}
}
