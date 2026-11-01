// Package discover finds the ports the application listens on.
//
// Containers in a pod share one network namespace, and /proc/net/tcp reflects the namespace of
// the reading process, so the sidecar sees every listening socket in the pod from its own
// /proc, with no Kubernetes API access and no extra privileges.
package discover

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// listen is the socket state code for LISTEN in /proc/net/tcp.
const listen = "0A"

// ListeningPorts returns the TCP ports in LISTEN state, ascending and without duplicates,
// skipping those for which skip returns true. procRoot is normally "/proc".
func ListeningPorts(procRoot string, skip func(int) bool) ([]int, error) {
	seen := map[int]struct{}{}
	var found bool
	for _, name := range []string{"net/tcp", "net/tcp6"} {
		f, err := os.Open(filepath.Join(procRoot, name))
		if err != nil {
			continue // IPv6 may be disabled; one table is enough
		}
		err = Parse(f, seen)
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		found = true
	}
	if !found {
		return nil, fmt.Errorf("no readable TCP table under %s", procRoot)
	}
	ports := make([]int, 0, len(seen))
	for p := range seen {
		if skip == nil || !skip(p) {
			ports = append(ports, p)
		}
	}
	sort.Ints(ports)
	return ports, nil
}

// Parse reads one /proc/net/tcp-style table and adds its listening ports to out.
func Parse(r io.Reader, out map[int]struct{}) error {
	scanner := bufio.NewScanner(r)
	first := true
	for scanner.Scan() {
		line := scanner.Text()
		if first {
			first = false
			if strings.Contains(line, "local_address") {
				continue
			}
		}
		fields := strings.Fields(line)
		if len(fields) < 4 || fields[3] != listen {
			continue
		}
		local := fields[1]
		colon := strings.LastIndex(local, ":")
		if colon < 0 {
			continue
		}
		port, err := strconv.ParseUint(local[colon+1:], 16, 16)
		if err != nil {
			return fmt.Errorf("bad local address %q", local)
		}
		out[int(port)] = struct{}{}
	}
	return scanner.Err()
}
