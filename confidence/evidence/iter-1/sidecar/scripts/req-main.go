package main

import (
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	m := flag.String("X", "GET", "method")
	flag.Parse()
	c := &http.Client{Timeout: 5 * time.Second}
	r, err := http.NewRequest(*m, flag.Arg(0), strings.NewReader(""))
	if err != nil {
		fmt.Println("ERR", err)
		os.Exit(1)
	}
	resp, err := c.Do(r)
	if err != nil {
		fmt.Println("ERR", err)
		os.Exit(1)
	}
	b, _ := io.ReadAll(resp.Body)
	fmt.Printf("%d %s\n", resp.StatusCode, strings.TrimSpace(string(b)))
}
