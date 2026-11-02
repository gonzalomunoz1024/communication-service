# Health sidecar image: a static Go binary on UBI micro, about 10 MB, runs as any UID under
# OpenShift's restricted-v2 SCC (no root, no capabilities, read-only root filesystem).
#
#   podman build -t registry.example.com/platform/health-sidecar:1.0.0 \
#     --build-arg VERSION=1.0.0 --build-arg REVISION=$(git rev-parse HEAD) .
#
# GO_IMAGE's Go minor is the module's go line (go.mod); deploy/dockerfile_test.go keeps them equal.
ARG GO_IMAGE=registry.access.redhat.com/ubi9/go-toolset:1.25
ARG BASE_IMAGE=registry.access.redhat.com/ubi9/ubi-micro:9.5

FROM ${GO_IMAGE} AS build
ARG VERSION=dev
ENV GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-trimpath
WORKDIR /opt/app-root/src
COPY --chown=1001:0 go.mod ./
COPY --chown=1001:0 cmd ./cmd
COPY --chown=1001:0 internal ./internal
RUN go build -ldflags="-s -w -X main.version=${VERSION}" -o /tmp/health-sidecar ./cmd/health-sidecar

FROM ${BASE_IMAGE}
# The version and the commit it was built from, so registry UIs and scanners can tell builds apart.
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="health-sidecar" \
      org.opencontainers.image.description="Probes the app in its pod and reports health to the communication service" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/gonzalomunoz1024/communication-service"
# UBI micro has no CA store; take the builder's so HTTPS to the service Route verifies.
COPY --from=build /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem /etc/pki/tls/certs/ca-bundle.crt
COPY --from=build /tmp/health-sidecar /usr/local/bin/health-sidecar
USER 1001
EXPOSE 9465
ENTRYPOINT ["/usr/local/bin/health-sidecar"]
