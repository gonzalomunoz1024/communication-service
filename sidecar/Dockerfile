# Health sidecar image: a static Go binary on UBI micro, about 10 MB, runs as any UID under
# OpenShift's restricted-v2 SCC (no root, no capabilities, read-only root filesystem).
#
#   podman build -t registry.example.com/platform/health-sidecar:1.0.0 \
#     --build-arg VERSION=1.0.0 --build-arg REVISION=$(git rev-parse HEAD) .
#
# GO_IMAGE is on the minor line of the module's Go release (go.mod: go 1.27.3, the first release
# without the HIGH standard-library vulnerabilities of the 1.25 build). It is the upstream Go image
# because Red Hat has not published ubi9/go-toolset:1.27 (the first CI run, on 2026-11-02, got "not
# found"); only the static binary and the CA bundle leave the build stage, and the image itself is UBI
# micro. Once Red Hat ships Go 1.27.3 or later, --build-arg
# GO_IMAGE=registry.access.redhat.com/ubi9/go-toolset:1.27 builds with it unchanged. GOTOOLCHAIN=local
# below makes a builder with an older Go stop the build ("go.mod requires go >= 1.27.3") instead of
# building a vulnerable binary or downloading another toolchain. deploy/dockerfile_test.go keeps
# go.mod, this tag, GOTOOLCHAIN and the README in step.
#
# BASE_IMAGE is UBI micro on the newest RHEL 9 minor. Red Hat stops rebuilding a minor's tag once
# the next minor ships, so later fixes never reach it: 9.5, the default until 2026-11-02, failed CI's
# image scan with eight HIGH findings in libacl, libcap and pcre2 that 9.8 fixes. Move the tag when
# RHEL 9.9 ships; deploy/dockerfile_test.go keeps it and the README in step.
ARG GO_IMAGE=docker.io/library/golang:1.27
ARG BASE_IMAGE=registry.access.redhat.com/ubi9/ubi-micro:9.8

FROM ${GO_IMAGE} AS build
ARG VERSION=dev
ENV GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-trimpath
WORKDIR /opt/app-root/src
COPY --chown=1001:0 go.mod ./
COPY --chown=1001:0 cmd ./cmd
COPY --chown=1001:0 internal ./internal
RUN go build -ldflags="-s -w -X main.version=${VERSION}" -o /tmp/health-sidecar ./cmd/health-sidecar
# The builder's CA bundle, from where its distribution keeps it: Debian's path, then UBI's.
RUN for f in /etc/ssl/certs/ca-certificates.crt /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem; do \
      if [ -s "$f" ]; then cp "$f" /tmp/ca-bundle.crt; break; fi; \
    done; \
    test -s /tmp/ca-bundle.crt

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
COPY --from=build /tmp/ca-bundle.crt /etc/pki/tls/certs/ca-bundle.crt
COPY --from=build /tmp/health-sidecar /usr/local/bin/health-sidecar
USER 1001
EXPOSE 9465
ENTRYPOINT ["/usr/local/bin/health-sidecar"]
