// vs4 v6app: an app that listens on exactly one address (argv[1], e.g. [::1]:8080) and serves an
// Actuator-shaped /actuator/health, to check which CS_HOST addresses the sidecar probes.
package main

import (
	"log"
	"net"
	"net/http"
	"os"
)

func main() {
	ln, err := net.Listen("tcp", os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("listening on %s", ln.Addr())
	mux := http.NewServeMux()
	mux.HandleFunc("/actuator/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"UP","components":{"ping":{"status":"UP"}}}`))
	})
	log.Fatal(http.Serve(ln, mux))
}
