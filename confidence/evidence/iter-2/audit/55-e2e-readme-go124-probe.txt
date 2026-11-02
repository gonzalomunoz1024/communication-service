# 55 - GAP-e2e2-4 replay: the e2e README's substitute builder GO_IMAGE=local/go-toolset:1.24 against sidecar/go.mod 'go 1.25' (Dockerfile sets GOTOOLCHAIN=local)
# e2e/README.md:37 and e2e/docker-compose.yml:54 name local/go-toolset:1.24; sidecar/go.mod:3 says go 1.25
/home/claude/communication-service/e2e/README.md:37:`GO_IMAGE=local/go-toolset:1.24 BASE_IMAGE=gcr.io/distroless/static-debian12:latest ./stack.sh up`
/home/claude/communication-service/e2e/docker-compose.yml:54:      # the UBI registry is unreachable: GO_IMAGE=local/go-toolset:1.24 BASE_IMAGE=gcr.io/distroless/static-debian12:latest
3:go 1.25
13:ENV GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-trimpath

START 2026-11-02T05:11:23Z
## docker build --no-cache -t au2-go124-probe --build-arg GO_IMAGE=local/go-toolset:1.24 --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:latest sidecar/  (the e2e README's substitute builder)
#1 DONE 0.0s
#2 DONE 0.0s
#3 DONE 0.0s
#4 DONE 0.0s
#6 DONE 0.0s
#8 DONE 0.0s
#9 DONE 0.0s
#10 DONE 0.0s
build exit 1
## local/go-toolset:1.24 go version: go version go1.24.13 linux/amd64
END 2026-11-02T05:11:25Z
## rerun 2026-11-02T05:11:53Z: exit 1; error lines:
#12 0.369 go: go.mod requires go >= 1.25 (running go 1.24.13; GOTOOLCHAIN=local)
#12 ERROR: process "/bin/sh -c go build -ldflags=\"-s -w -X main.version=${VERSION}\" -o /tmp/health-sidecar ./cmd/health-sidecar" did not complete successfully: exit code: 1
0.369 go: go.mod requires go >= 1.25 (running go 1.24.13; GOTOOLCHAIN=local)
ERROR: failed to build: failed to solve: process "/bin/sh -c go build -ldflags=\"-s -w -X main.version=${VERSION}\" -o /tmp/health-sidecar ./cmd/health-sidecar" did not complete successfully: exit code: 1
