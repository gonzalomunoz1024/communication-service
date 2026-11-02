plugins {
    java
    id("org.springframework.boot") version "3.4.1"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "com.atlas"
version = "0.0.1-SNAPSHOT"
description = "Shared customer communications platform: incidents, changes, outages, maintenance and health notices"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

val springdocVersion = "2.8.5"
val flapdoodleVersion = "4.20.0"

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webflux")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-data-mongodb-reactive")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310")
    implementation("org.springdoc:springdoc-openapi-starter-webflux-ui:$springdocVersion")

    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("io.projectreactor:reactor-test")
    testImplementation("de.flapdoodle.embed:de.flapdoodle.embed.mongo.spring3x:$flapdoodleVersion")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
}

tasks.withType<Test> {
    useJUnitPlatform()
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

// Unit tests (*Test) run in `test`; integration tests (*IT, embedded MongoDB) in `integrationTest`.
// `check` (and therefore `build`) runs both, mirroring the previous Maven surefire/failsafe split.
tasks.test {
    exclude("**/*IT.class")
}

val integrationTest by tasks.registering(Test::class) {
    description = "Runs integration tests (*IT) against embedded MongoDB."
    group = "verification"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    include("**/*IT.class")
    shouldRunAfter(tasks.test)
}

tasks.check {
    dependsOn(integrationTest)
}
