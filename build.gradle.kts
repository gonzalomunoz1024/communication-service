import com.github.spotbugs.snom.Confidence
import com.github.spotbugs.snom.Effort

plugins {
    java
    // line coverage of the unit and integration runs together: ./gradlew jacocoTestReport -> build/reports/jacoco/
    jacoco
    id("org.springframework.boot") version "3.5.16"
    id("io.spring.dependency-management") version "1.1.7"
    // software bill of materials for a dependency scanner: ./gradlew cyclonedxBom -> build/reports/cyclonedx/
    id("org.cyclonedx.bom") version "3.5.1"
    // static analysis of the main classes: ./gradlew spotbugsMain -> build/reports/spotbugs/
    id("com.github.spotbugs") version "6.5.13"
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

val springdocVersion = "2.8.17"
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
    // Deprecation, removal and unchecked warnings fail the build: an API marked for removal
    // (ensureIndex in Spring Data MongoDB 4.5) must be replaced before the next major upgrade.
    options.compilerArgs.addAll(listOf("-Xlint:deprecation", "-Xlint:removal", "-Xlint:unchecked", "-Werror"))
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

// Static analysis: every finding SpotBugs rates medium or higher in the main classes fails the
// build. Findings that are false by design are listed, each with its reason, in
// config/spotbugs/exclude.xml; test classes are not analysed.
spotbugs {
    effort = Effort.MAX
    reportLevel = Confidence.MEDIUM
    excludeFilter = file("config/spotbugs/exclude.xml")
}

// The Spring Boot BOM must not manage the tool's own classpath: the dependency-management plugin
// applies it to every configuration, and the BOM's commons-lang3 (3.17) predates the class
// SpotBugs' BCEL needs (NoClassDefFoundError: org.apache.commons.lang3.Strings). The tool never
// runs inside the application, so each of its dependencies keeps the version it asked for.
configurations.matching { it.name.startsWith("spotbugs") }.configureEach {
    resolutionStrategy.eachDependency {
        val asked = requested.version
        if (!asked.isNullOrEmpty()) {
            useVersion(asked)
        }
    }
}

tasks.spotbugsMain {
    reports.create("html") { required = true }
    reports.create("xml") { required = true }
}

tasks.spotbugsTest {
    enabled = false
}

// Coverage: one report over both test runs, so a class covered only by an *IT counts. Only the
// Spring wiring (the *Config classes and the *Properties records in config/) and the main class
// are left out of the ratio; everything else, the error handler, the client-id filter and the
// readiness indicator in config/ included, is production logic that a test is expected to reach.
val coverageExclusions = listOf(
    "com/atlas/communication/config/*Config*",
    "com/atlas/communication/config/*Properties*",
    "com/atlas/communication/*Application*",
)

fun JacocoReportBase.coverBothTestRuns() {
    dependsOn(tasks.test, integrationTest)
    executionData(tasks.test.get(), integrationTest.get())
    classDirectories.setFrom(files(classDirectories.files.map { fileTree(it) { exclude(coverageExclusions) } }))
}

tasks.jacocoTestReport {
    coverBothTestRuns()
    reports {
        xml.required = true
        html.required = true
        csv.required = false
    }
}

tasks.jacocoTestCoverageVerification {
    coverBothTestRuns()
    violationRules {
        rule {
            limit {
                counter = "LINE"
                value = "COVEREDRATIO"
                // set when 0.9553 of 1187 lines were covered; 0.9611 of 1414 on 2026-11-02, config/ counted
                minimum = "0.92".toBigDecimal()
            }
            limit {
                counter = "BRANCH"
                value = "COVEREDRATIO"
                minimum = "0.84".toBigDecimal() // measured 0.8435 (717 of 850 branches) on 2026-11-02
            }
        }
    }
}

// The SBOM describes what ships: the runtime classpath, nothing the build or the tests use. A tool
// listed in it would have its advisories fail the CI scan of an application it never runs in.
// cyclonedxBom (the file CI scans) aggregates this project's cyclonedxDirectBom.
tasks.named<org.cyclonedx.gradle.CyclonedxDirectTask>("cyclonedxDirectBom") {
    includeConfigs = listOf("runtimeClasspath")
}

// Reads the BOM CI scans and fails when a build or test tool is listed in it.
val verifySbomScope by tasks.registering {
    description = "Fails when the SBOM lists a build or test tool: it must describe the runtime classpath only."
    group = "verification"
    val bom = tasks.named<org.cyclonedx.gradle.CyclonedxAggregateTask>("cyclonedxBom").flatMap { it.jsonOutput }
    val tools = listOf("spotbugs", "bcel", "jacoco", "junit", "mockito", "assertj", "flapdoodle", "lombok")
    inputs.file(bom)
    doLast {
        val file = bom.get().asFile
        val purls = mutableListOf<String>()
        fun collect(components: Any?) {
            (components as? List<*>)?.forEach { component ->
                val fields = component as Map<*, *>
                (fields["purl"] as? String)?.let(purls::add)
                collect(fields["components"])
            }
        }
        collect((groovy.json.JsonSlurper().parse(file) as Map<*, *>)["components"])
        val listed = purls.filter { purl -> tools.any { purl.contains(it) } }.sorted()
        if (listed.isNotEmpty()) {
            throw GradleException("$file lists ${listed.size} build or test tool(s) among ${purls.size} components;"
                    + " the SBOM must describe the runtime classpath only:\n  " + listed.joinToString("\n  "))
        }
        logger.lifecycle("SBOM scope: ${purls.size} components, none of them a build or test tool")
    }
}

// `check` (and therefore `build`): compile with -Werror, unit and integration tests, SpotBugs,
// the coverage report and threshold, and the SBOM with its scope check.
tasks.check {
    dependsOn(integrationTest, tasks.jacocoTestReport, tasks.jacocoTestCoverageVerification,
            tasks.named("cyclonedxBom"), verifySbomScope)
}
