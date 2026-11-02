# The e2e stack's fake publisher app (main.go): a static Go binary on distroless, non-root.
# Nothing is downloaded inside the build but the two base images; the app has no dependencies.
ARG GO_IMAGE=golang:1.24
ARG BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot

FROM ${GO_IMAGE} AS build
ENV GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-trimpath
WORKDIR /src
COPY go.mod main.go ./
RUN go build -ldflags="-s -w" -o /out/fakeapp .

FROM ${BASE_IMAGE}
COPY --from=build /out/fakeapp /fakeapp
# distroless' nonroot user
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/fakeapp"]
