# Go 1.27.3 from the module cache first on PATH, never switched; the manifest tools after it.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
export GOROOT=/root/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.3.linux-amd64
export PATH=$GOROOT/bin:$S/tools:$PATH GOTOOLCHAIN=local
