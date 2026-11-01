// Package report sends health reports to the communication service.
package report

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Report is the body of POST /v1/health/reports: Spring Actuator's vocabulary plus tenant,
// service and the reporting instance.
type Report struct {
	TenantID   string         `json:"tenantId"`
	Service    string         `json:"service"`
	Status     string         `json:"status"`
	Components map[string]any `json:"components,omitempty"`
	Message    string         `json:"message,omitempty"`
	ObservedAt time.Time      `json:"observedAt"`
	Publisher  string         `json:"publisher,omitempty"`
	Instance   *Instance      `json:"instance,omitempty"`
}

// Instance identifies the pod a report comes from. Leaving marks the instance's last report.
type Instance struct {
	ID        string `json:"id"`
	Namespace string `json:"namespace,omitempty"`
	Node      string `json:"node,omitempty"`
	Cluster   string `json:"cluster,omitempty"`
	Version   string `json:"version,omitempty"`
	Sidecar   string `json:"sidecar,omitempty"`
	Leaving   bool   `json:"leaving,omitempty"`
}

// PermanentError is a 4xx: the service rejected the report, and retrying the same body will
// not help.
type PermanentError struct {
	Status int
	Body   string
}

func (e *PermanentError) Error() string {
	return fmt.Sprintf("report rejected: HTTP %d %s", e.Status, e.Body)
}

// Client posts reports.
type Client struct {
	url       string
	clientID  string
	userAgent string
	http      *http.Client
}

// NewClient builds a Client for the service at endpoint. caFile adds a PEM bundle to the system
// roots; insecure disables verification altogether.
func NewClient(endpoint, clientID, version string, timeout time.Duration, caFile string, insecure bool) (*Client, error) {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if caFile != "" {
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("CS_CA_FILE: %w", err)
		}
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("CS_CA_FILE: no certificates found in %s", caFile)
		}
		tlsCfg.RootCAs = pool
	}
	if insecure {
		tlsCfg.InsecureSkipVerify = true //nolint:gosec // explicit opt-in for local experiments
	}
	transport := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		TLSClientConfig:     tlsCfg,
		TLSHandshakeTimeout: timeout,
		MaxIdleConns:        2,
		IdleConnTimeout:     90 * time.Second,
	}
	return &Client{
		url:       strings.TrimRight(endpoint, "/") + "/v1/health/reports",
		clientID:  clientID,
		userAgent: "health-sidecar/" + version,
		http:      &http.Client{Transport: transport, Timeout: timeout},
	}, nil
}

// Send posts one report. A 4xx answer is a *PermanentError; anything else that fails is
// worth retrying later.
func (c *Client) Send(ctx context.Context, r Report) error {
	body, err := json.Marshal(r)
	if err != nil {
		return fmt.Errorf("encode report: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Client-Id", c.clientID)
	req.Header.Set("User-Agent", c.userAgent)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("post %s: %w", c.url, err)
	}
	defer resp.Body.Close()
	answer, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case permanent(resp.StatusCode):
		return &PermanentError{Status: resp.StatusCode, Body: strings.TrimSpace(string(answer))}
	default:
		return fmt.Errorf("post %s: HTTP %d %s", c.url, resp.StatusCode, strings.TrimSpace(string(answer)))
	}
}

// permanent is a 4xx other than the ones that describe a passing condition (throttled, timed
// out, or a concurrent write the service asks us to retry).
func permanent(code int) bool {
	switch code {
	case http.StatusRequestTimeout, http.StatusConflict, http.StatusTooManyRequests:
		return false
	}
	return code >= 400 && code < 500
}

// IsPermanent reports whether err is a rejection that retrying cannot fix.
func IsPermanent(err error) bool {
	var p *PermanentError
	return errors.As(err, &p)
}
