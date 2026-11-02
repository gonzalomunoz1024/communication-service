# G-3-13: the e2e README's substitute builder, built from the README's own Dockerfile text (extracted verbatim, tag e2e3-go-toolset:readme), then the sidecar image built with it, no cache
$ docker build -t e2e3-go-toolset:readme - < (README lines 50-54)
    | FROM golang:1.25
    | RUN mkdir -p /etc/pki/ca-trust/extracted/pem \
    |  && cp /etc/ssl/certs/ca-certificates.crt /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem
sha256:62428dfe52bc8bde8849f1d6aaab593d5430776a42ccd2516cdad5ac068683b1
exit=0 (1 s)
go version go1.25.14 linux/amd64
$ docker build --no-cache --build-arg GO_IMAGE=e2e3-go-toolset:readme --build-arg BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot --build-arg VERSION=e2e3-readme --build-arg REVISION=$(git rev-parse HEAD) -t e2e3-sidecar:readme-probe sidecar
#10 DONE 0.0s
#11 DONE 0.0s
#12 [build 6/6] RUN go build -ldflags="-s -w -X main.version=e2e3-readme" -o /tmp/health-sidecar ./cmd/health-sidecar
#12 DONE 16.0s
#13 DONE 0.0s
#14 DONE 0.0s
#15 naming to docker.io/library/e2e3-sidecar:readme-probe done
#15 DONE 0.6s
exit=0 (17 s)
labels version=e2e3-readme revision=e3968c4067e44ac0362f33418940ba8fe473dfae user=1001
{"time":"2026-11-02T07:08:19.048556358Z","level":"ERROR","msg":"invalid configuration","error":"CS_ENDPOINT is required (the communication service base URL)\nCS_TENANT is required"}
(exit 2 expected: no CS_ENDPOINT/CS_TENANT; the binary runs and names its version)

# the suite's own build in run 1 (stack.sh build -> compose build with VERSION/REVISION):
06:50:05 stack: building the images (sidecar version e3968c4, revision e3968c4067e44ac0362f33418940ba8fe473dfae)

# references to a Go builder in the suite's files (no local/go-toolset:1.24 left):
e2e/README.md:45:stand-in for `ubi9/go-toolset` at the Go release of `sidecar/go.mod` (1.25) that has the CA bundle at
e2e/README.md:50:docker build -t go-toolset:e2e - <<'EOF'
e2e/README.md:55:GO_IMAGE=go-toolset:e2e BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot ./stack.sh up
e2e/docker-compose.yml:55:      # labels name the commit under test. Where the UBI registry is unreachable, GO_IMAGE=go-toolset:e2e
no 'go-toolset:1.24' in e2e/
