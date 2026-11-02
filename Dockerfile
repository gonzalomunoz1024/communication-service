# Backend image: the Spring Boot jar on a distroless Java 21 runtime, running as a non-root user.
#
#   ./gradlew bootJar
#   docker build -t communication-service:local .
#   docker run --rm -p 8080:8080 \
#     -e SPRING_DATA_MONGODB_URI=mongodb://host.docker.internal:27017/communication communication-service:local
#
# The jar is built outside the image: Gradle needs a JDK and the network, the image needs neither,
# and the same artefact then runs locally, in CI and in the e2e stack (e2e/docker-compose.yml).
# .dockerignore keeps everything but that jar out of the build context.
ARG BASE_IMAGE=gcr.io/distroless/java21-debian12:nonroot

FROM ${BASE_IMAGE}
LABEL org.opencontainers.image.title="communication-service" \
      org.opencontainers.image.description="Shared customer communications platform: incidents, changes, outages, maintenance and health notices" \
      org.opencontainers.image.source="https://github.com/gonzalomunoz1024/communication-service"
# exactly one jar matches: bootJar's (the -plain.jar that `./gradlew build` also produces is excluded by .dockerignore)
COPY --chown=65532:65532 build/libs/communication-service-*.jar /app/app.jar
# distroless' nonroot user
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
