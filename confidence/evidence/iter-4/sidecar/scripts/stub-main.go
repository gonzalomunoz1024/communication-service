// vs4 stub: test servers for the sidecar verification (written by the iteration-3 verifier, reused unchanged by vs4).
//
//	-mode hold      block forever (owns an emulated pod's network namespace)
//	-mode actuator  /actuator/health -> {"status":S,"components":{"db":{"status":D,...},"ping":UP}}
//	                (503 when S != UP); POST /__set?status=&db=; POST /__failnext?n=N;
//	                POST /__doc (body = the whole document served, ?code= its HTTP code; empty body resets)
//	-mode plain404 | healthz | root5xx | redirect | tcp   as named
//	-mode backend   records every request to /v1/health/reports (arrival time, headers, body) and
//	                answers -code; on the same port: /__code?c=, /__delay?ms=, /__reset, /__requests.
//	                With -ctl P a control server on P adds /__down (close the listener: connection
//	                refused) and /__up (listen again), and serves /__requests and /__reset too.
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
	Answer  int               `json:"answer"`
}

func main() {
	mode := flag.String("mode", "hold", "")
	port := flag.Int("port", 9000, "")
	ctl := flag.Int("ctl", 0, "control port (backend mode)")
	code := flag.Int("code", 202, "backend answer code")
	useTLS := flag.Bool("tls", false, "")
	cert := flag.String("cert", "", "")
	key := flag.String("key", "", "")
	to := flag.String("to", "", "proxy target host:port (-mode proxy)")
	flag.Parse()
	if *mode == "proxy" {
		runProxy(fmt.Sprintf(":%d", *port), *to, *ctl)
		return
	}
	addr := fmt.Sprintf(":%d", *port)
	var mu sync.Mutex
	status, db, failNext, answer, delay := "UP", "UP", 0, *code, 0
	doc, docCode := "", 200
	var reqs []recorded
	mux := http.NewServeMux()
	dump := func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if reqs == nil {
			w.Write([]byte("[]"))
			return
		}
		json.NewEncoder(w).Encode(reqs)
	}
	reset := func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		reqs = nil
		mu.Unlock()
		w.Write([]byte("ok"))
	}
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
			if c, err := ln.Accept(); err == nil {
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
		mux.HandleFunc("/__doc", func(w http.ResponseWriter, r *http.Request) {
			b, _ := io.ReadAll(r.Body)
			c, err := strconv.Atoi(r.URL.Query().Get("code"))
			if err != nil {
				c = 200
			}
			mu.Lock()
			doc, docCode = string(b), c
			mu.Unlock()
			w.Write([]byte("ok"))
		})
		mux.HandleFunc("/__left", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			fmt.Fprintf(w, "%d", failNext)
			mu.Unlock()
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
			s, d, dc, dcode := status, db, doc, docCode
			if failNext > 0 {
				failNext--
				s, d, dc = "DOWN", "DOWN", ""
			}
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			if dc != "" {
				w.WriteHeader(dcode)
				w.Write([]byte(dc))
				return
			}
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
		mux.HandleFunc("/__delay", func(w http.ResponseWriter, r *http.Request) {
			ms, _ := strconv.Atoi(r.URL.Query().Get("ms"))
			mu.Lock()
			delay = ms
			mu.Unlock()
			w.Write([]byte("ok"))
		})
		mux.HandleFunc("/__reset", reset)
		mux.HandleFunc("/__requests", dump)
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			at := time.Now().UTC()
			body, _ := io.ReadAll(r.Body)
			h := map[string]string{}
			for k := range r.Header {
				h[k] = r.Header.Get(k)
			}
			mu.Lock()
			if !json.Valid(body) {
				body, _ = json.Marshal(string(body))
			}
			c, d := answer, delay
			reqs = append(reqs, recorded{At: at, Method: r.Method, Path: r.URL.Path, Headers: h, Body: body, Answer: c})
			mu.Unlock()
			if d > 0 {
				time.Sleep(time.Duration(d) * time.Millisecond)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(c)
			fmt.Fprintf(w, `{"stub":"answered %d"}`, c)
		})
	default:
		fmt.Fprintln(os.Stderr, "unknown mode")
		os.Exit(2)
	}
	var srvMu sync.Mutex
	var srv *http.Server
	start := func() {
		srvMu.Lock()
		defer srvMu.Unlock()
		srv = &http.Server{Addr: addr, Handler: mux}
		s := srv
		go func() {
			var err error
			if *useTLS {
				err = s.ListenAndServeTLS(*cert, *key)
			} else {
				err = s.ListenAndServe()
			}
			if err != nil && err != http.ErrServerClosed {
				log.Fatal(err)
			}
		}()
		log.Printf("stub %s listening on %s", *mode, addr)
	}
	start()
	if *ctl != 0 {
		cm := http.NewServeMux()
		cm.HandleFunc("/__down", func(w http.ResponseWriter, r *http.Request) {
			srvMu.Lock()
			srv.Close()
			srvMu.Unlock()
			log.Printf("stub %s closed %s", *mode, addr)
			w.Write([]byte("down"))
		})
		cm.HandleFunc("/__up", func(w http.ResponseWriter, r *http.Request) {
			start()
			w.Write([]byte("up"))
		})
		cm.HandleFunc("/__requests", dump)
		cm.HandleFunc("/__reset", reset)
		go func() { log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", *ctl), cm)) }()
	}
	select {}
}

// runProxy forwards TCP connections on addr to target; the control port's /__down closes the listener
// and every open connection (clients then get "connection refused"), /__up listens again.
func runProxy(addr, target string, ctl int) {
	var mu sync.Mutex
	var ln net.Listener
	conns := map[net.Conn]struct{}{}
	track := func(c net.Conn, add bool) {
		mu.Lock()
		defer mu.Unlock()
		if add {
			conns[c] = struct{}{}
		} else {
			delete(conns, c)
		}
	}
	start := func() {
		l, err := net.Listen("tcp", addr)
		if err != nil {
			log.Printf("proxy listen: %v", err)
			return
		}
		mu.Lock()
		ln = l
		mu.Unlock()
		log.Printf("proxy %s -> %s up", addr, target)
		go func() {
			for {
				c, err := l.Accept()
				if err != nil {
					return
				}
				go func() {
					d, err := net.Dial("tcp", target)
					if err != nil {
						c.Close()
						return
					}
					track(c, true)
					track(d, true)
					go func() { io.Copy(d, c); d.Close() }()
					io.Copy(c, d)
					c.Close()
					track(c, false)
					track(d, false)
				}()
			}
		}()
	}
	start()
	cm := http.NewServeMux()
	cm.HandleFunc("/__down", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if ln != nil {
			ln.Close()
		}
		for c := range conns {
			c.Close()
		}
		mu.Unlock()
		log.Printf("proxy %s down", addr)
		w.Write([]byte("down"))
	})
	cm.HandleFunc("/__up", func(w http.ResponseWriter, r *http.Request) {
		start()
		w.Write([]byte("up"))
	})
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", ctl), cm))
}
