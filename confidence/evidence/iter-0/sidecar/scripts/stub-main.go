// stub: configurable test servers for the sidecar verification.
//   -mode hold      block forever (a pause container that owns a pod's network namespace)
//   -mode plain404  answer 404 text on every path
//   -mode healthz   /healthz -> 200 "ok", everything else 404
//   -mode actuator  /actuator/health -> health document (status flips with POST /__set?status=&db=;
//                   POST /__failnext?n=N makes the next N health answers 503 DOWN documents)
//   -mode warn      /actuator/health -> {"status":"WARN"}
//   -mode root5xx   "/" -> 500 text
//   -mode redirect  /health -> 302 to /elsewhere, everything else 404
//   -mode tcp       raw TCP listener that accepts and closes
//   -mode backend   records POST /v1/health/reports (headers+body), answers -code (change with
//                   POST /__code?c=NNN); GET /__requests dumps them; -tls serves HTTPS with -cert/-key
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

type recorded struct {
	At      time.Time         `json:"at"`
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
}

func main() {
	mode := flag.String("mode", "hold", "")
	port := flag.Int("port", 9000, "")
	code := flag.Int("code", 202, "backend answer code")
	useTLS := flag.Bool("tls", false, "")
	cert := flag.String("cert", "", "")
	key := flag.String("key", "", "")
	flag.Parse()
	addr := fmt.Sprintf(":%d", *port)
	var mu sync.Mutex
	status, db, failNext, answer := "UP", "UP", 0, *code
	var reqs []recorded
	mux := http.NewServeMux()
	switch *mode {
	case "hold":
		for {
			time.Sleep(time.Hour)
		}
	case "tcp":
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("tcp listener on %s", addr)
		for {
			c, err := ln.Accept()
			if err == nil {
				c.Close()
			}
		}
	case "plain404":
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "nope", 404) })
	case "healthz":
		mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "nope", 404) })
	case "root5xx":
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "boom", 500) })
	case "redirect":
		mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/elsewhere", 302) })
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "nope", 404) })
	case "warn":
		mux.HandleFunc("/actuator/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"WARN","components":{"cache":{"status":"WARN"}}}`))
		})
	case "actuator":
		mux.HandleFunc("/__set", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			if v := r.URL.Query().Get("status"); v != "" {
				status = v
			}
			if v := r.URL.Query().Get("db"); v != "" {
				db = v
			}
			mu.Unlock()
			w.Write([]byte("ok"))
		})
		mux.HandleFunc("/__failnext", func(w http.ResponseWriter, r *http.Request) {
			n, _ := strconv.Atoi(r.URL.Query().Get("n"))
			mu.Lock()
			failNext = n
			mu.Unlock()
			w.Write([]byte("ok"))
		})
		mux.HandleFunc("/actuator/health", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			s, d := status, db
			if failNext > 0 {
				failNext--
				s, d = "DOWN", "DOWN"
			}
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			if s != "UP" {
				w.WriteHeader(503)
			}
			json.NewEncoder(w).Encode(map[string]any{"status": s, "components": map[string]any{
				"db": map[string]any{"status": d, "details": map[string]any{"database": "PostgreSQL"}}, "ping": map[string]any{"status": "UP"}}})
		})
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("app")) })
	case "backend":
		mux.HandleFunc("/__code", func(w http.ResponseWriter, r *http.Request) {
			c, _ := strconv.Atoi(r.URL.Query().Get("c"))
			mu.Lock()
			answer = c
			mu.Unlock()
			w.Write([]byte("ok"))
		})
		mux.HandleFunc("/__requests", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(reqs)
		})
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			h := map[string]string{}
			for k := range r.Header {
				h[k] = r.Header.Get(k)
			}
			mu.Lock()
			if !json.Valid(body) {
				body, _ = json.Marshal(string(body))
			}
			reqs = append(reqs, recorded{At: time.Now().UTC(), Method: r.Method, Path: r.URL.Path, Headers: h, Body: body})
			c := answer
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(c)
			fmt.Fprintf(w, `{"stub":"answered %d"}`, c)
		})
	default:
		fmt.Fprintln(os.Stderr, "unknown mode")
		os.Exit(2)
	}
	srv := &http.Server{Addr: addr, Handler: mux}
	log.Printf("stub %s on %s", *mode, addr)
	if *useTLS {
		log.Fatal(srv.ListenAndServeTLS(*cert, *key))
	}
	log.Fatal(srv.ListenAndServe())
}
