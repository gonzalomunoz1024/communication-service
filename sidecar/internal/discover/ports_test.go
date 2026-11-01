package discover

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const tcpTable = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345 1 0000000000000000 100 0 0 10 0
   1: 0100007F:1F91 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12346 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1F90 0100007F:C3A2 01 00000000:00000000 00:00000000 00000000  1000        0 12347 1 0000000000000000 100 0 0 10 0
`

const tcp6Table = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:24F9 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12348 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12349 1 0000000000000000 100 0 0 10 0
`

func TestParseKeepsOnlyListeningSockets(t *testing.T) {
	out := map[int]struct{}{}
	if err := Parse(strings.NewReader(tcpTable), out); err != nil {
		t.Fatal(err)
	}
	if _, ok := out[8080]; !ok {
		t.Error("8080 (0x1F90) should be listed")
	}
	if _, ok := out[8081]; !ok {
		t.Error("8081 bound to loopback should be listed")
	}
	if len(out) != 2 {
		t.Errorf("established connection should be skipped, got %v", out)
	}
}

func TestListeningPortsMergesTablesAndSkips(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "net"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "net", "tcp"), []byte(tcpTable), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "net", "tcp6"), []byte(tcp6Table), 0o644); err != nil {
		t.Fatal(err)
	}
	ports, err := ListeningPorts(root, func(p int) bool { return p == 8081 })
	if err != nil {
		t.Fatal(err)
	}
	want := []int{8080, 9465}
	if len(ports) != len(want) || ports[0] != want[0] || ports[1] != want[1] {
		t.Errorf("got %v, want %v", ports, want)
	}

	if _, err := ListeningPorts(filepath.Join(root, "missing"), nil); err == nil {
		t.Error("a missing /proc should be an error")
	}
}
