# Iteration 1 — gap analysis

Consolidated from the iteration-0 verifier reports (`confidence/iter-0/verifier-*.md`, `usability.md`). Each row names
the verifier gap IDs it merges. Severity: blocker = a core purpose fails; major = a Feature Matrix row fails E2E or a
hard-gate / large score impact; minor = everything else. Priority order = blockers → hard-gate trips → score impact.

| Gap | Service | Feature IDs | Severity | Root cause (file:line) | Evidence | Merges |
|---|---|---|---|---|---|---|
| G-1-1 | BE | F-20, F-61, F-21, F-92 | **blocker** | `CommunicationEventMongoRepository.java:15` derived query with two `seq` criteria → every `Last-Event-ID` / `?lastEventId=` resume answers 500 | `evidence/iter-0/backend/20*`, `e2e/run1`, IT `CommunicationServiceE2EIT.reconnectingWithLastEventIdReplaysWhatWasMissed` fails 3×3 | GAP-backend-1, GAP-e2e-1, GAP-frontend-1 (backend half), UX-20 |
| G-1-2 | SC | F-88, F-72, F-77, F-91 | **blocker** | `sidecar/internal/agent/agent.go:148-176, 196-235`: after the first UP, a vanished target yields `UNKNOWN "no health target found yet"` forever; backend does not count UNKNOWN pods → a crashed app never opens an OUTAGE | `evidence/iter-0/sidecar/11*` STEP E, `e2e/pod-flow-silent-ordering-slow.txt` | GAP-sidecar-1, GAP-e2e-3 |
| G-1-3 | FE | F-61, F-60, F-92 | major (gate) | `frontend/src/outages/api.ts:104-118`: `onerror` only flips the badge; EventSource never re-created once CLOSED; no keepalive watchdog, so a dead stream behind a proxy shows "Live"; dev proxy (`vite.config.ts:14-20`) never ends the browser response when upstream dies | `frontend/scripts/t4g*`, `t4d*`, `e2e/browser-reconnect-probe.txt`, UX-6 | GAP-frontend-1, GAP-frontend-5, GAP-e2e-2, UX-6 |
| G-1-4 | BE | F-18, F-60, F-27 | major | `RestControllerFeedAdapter.java:163-187` / `FeedUseCase.stream`: nothing is written before the first frame; empty tenant gets headers after the 15 s keepalive ("Connecting" 15 s) | `e2e` `curl -w %{time_starttransfer}` 15.005 s vs 0.0066 s; `frontend/probe-live-latency` | GAP-e2e-5, GAP-frontend-6 |
| G-1-5 | BE | F-41 | major | `HealthObservationUseCase.observe:58-67`: NONE transition never re-reads the open notice, so a notice retired by an operator stays "open" in monitor state while the failing set is unchanged (README promises re-counting) | `backend/21*` B-41e/f | GAP-backend-2 |
| G-1-6 | BE | F-45, F-48 | major | `HealthSweepUseCase.staleAllowed:85-102` counts scaled-to-zero services (all pods `leaving`) as silent → pause valve trips and a genuinely silent service is never declared DOWN; also 1 silent of 3 = 33 % trips the 30 % valve on small fleets | `e2e/backendA-log-excerpts.txt`, `sidecar/31*` | GAP-e2e-4, sidecar note on the valve |
| G-1-7 | BE (+SC) | F-50, F-46 | major | `HealthMonitorUseCase.java:41,92-96`: 3 immediate optimistic-lock attempts, no backoff; 20 simultaneous pod reports → 11–14 × 409 (records saved, convergence delayed) | `backend/21*` B-50, `e2e` F-50, `sidecar/30*` | GAP-backend-6, GAP-e2e-6, GAP-sidecar-4 |
| G-1-8 | BE | F-30 | major (ops) | no Actuator: no `/actuator/health`, no liveness/readiness groups (`build.gradle.kts:22-37`) | `backend` A-30 → 404 | GAP-backend-3 |
| G-1-9 | BE | builds & static | major (gate: high findings) | Spring Boot 3.4.1 → Netty 4.1.116 (CVE-2025-24970/55163/58056 HIGH), Spring 6.2.1 (CVE-2025-41234), logback 1.5.12, swagger-ui 5.18.3; no scanner/linter | `backend/07-dependency-cve-review.txt` | GAP-backend-4 |
| G-1-10 | FE | F-65 | major (gate) | tokens `--text-tertiary` #86868b / #636366, tag tints, error text 11 px → axe serious color-contrast on every scan | `frontend/t5-a11y*`, `usability` contrast table | GAP-frontend-3, UX-5 |
| G-1-11 | FE | F-16, F-58 | major (gate) | `feed-state.ts:37-46` shows any SCHEDULED frame; server shows future items only for MAINTENANCE within the window → live list and reload disagree | `frontend/t3-feed` CONTRACT CHECK | GAP-frontend-2 |
| G-1-12 | FE | F-55 | major (usability) | first validation error renders above the viewport after Publish; focus stays on the button | `usability` UX-1 (+screenshot) | UX-1 |
| G-1-13 | FE | F-56, F-58, F-52 | major (usability) | "View in feed" keeps Type=Outage filter (Maintenance/Incident/Change hidden) and the header tenant (item published under another tenant absent) | `usability` UX-2, UX-3 | UX-2, UX-3 |
| G-1-14 | FE | F-57, F-59 | major (usability) | service unreachable → "The service rejected this. 502 Bad Gateway"; feed "Try again" does not restart the stream | `usability` UX-4 | UX-4 |
| G-1-15 | FE | F-62, F-65 | minor | no confirmation/announcement after Resolve; focus dropped to body after publish; no live region; "Service" filter has no accessible name; no `h1`; Type/Severity labels not tied to groups | `usability` UX-7, UX-14; `frontend` GAP-4 | UX-7, UX-14, GAP-frontend-4 |
| G-1-16 | FE | F-06, F-15, F-58 | minor | card lingers after `expiresAt` until the sweeper frame (still offers Resolve); 100-item cap silent (`hasNext` ignored); "Resolve" on upcoming maintenance; 409 text says externalRef while the field is "ServiceNow incident" | `frontend` GAP-7/8, UX-8, UX-9 | GAP-frontend-7, GAP-frontend-8 (FE half), UX-8, UX-9 |
| G-1-17 | FE | F-66 | minor (test health) | no lint config (react-hooks errors in `useOutageFeed.ts:33,49`), no component/DOM tests, no coverage | `frontend` GAP-9/10 | GAP-frontend-9, GAP-frontend-10 |
| G-1-18 | SC | F-83 | major (gate) | `add-native-sidecar.yaml:4-6` JSON-patch `add /spec/template/spec/initContainers []` replaces an existing init-container list | `sidecar/20*` §3, `21*` §3c | GAP-sidecar-2 |
| G-1-19 | SC | F-67, F-80, F-82, F-85 | minor (usability/docs) | README: `CS_PUBLISHER` missing, `CS_TENANT` meaning/who assigns it, no image/registry override story, debugging stops at `/status`, helm library note, boot-unhealthy invisible for the grace, ConfigMap namespace; manual YAML lacks `imagePullPolicy`/`protocol` | `usability` UX-30..34, `sidecar` GAP-3/5/6 | GAP-sidecar-3/5/6, UX-30..UX-34 |
| G-1-20 | BE | F-06, F-13 | minor | retire/update of an item past `expiresAt` but not yet swept → 200 (feed says EXPIRED; README says 409) | `backend` A-13c/A-15a, `frontend` GAP-8 | GAP-backend-5, GAP-frontend-8 (BE half) |
| G-1-21 | BE | F-07, F-28 | minor (usability) | JSON decode failures → "Failed to read HTTP message" (no field, no allowed values); >256 KB → 413 "unexpected error"; 404 "No static resource …", 415 "unexpected error" | `e2e` run1 F-07, `backend` §2 cmd 17, UX-22/25 | GAP-e2e-7, GAP-backend-9, UX-22, UX-25 |
| G-1-22 | BE | F-01, F-10, F-27, F-29 | minor (docs/usability) | README cookbook #1 fails as written (past `expiresAt`); `expectedVersion`/`<monitorId>` unexplained; client id logged only at DEBUG while README says per request; dead config keys; Swagger 401 "Undocumented" before Authorize | UX-21/23/24, GAP-backend-7/8 | UX-21, UX-23, UX-24, GAP-backend-7, GAP-backend-8 |
| G-1-23 | BE | F-30, F-61 | minor (ops) | graceful shutdown waits the full 30 s on open SSE streams ("Graceful shutdown aborted") | `e2e/backendA-log-excerpts.txt` | GAP-e2e-8 |
| G-1-24 | BE | F-36, F-38 | minor (doc) | push reports ignore a legacy top-level `details` map that the probe path understands | `backend` B-38c | GAP-backend-10 |

Not fixed in this loop, needs a human decision (carried to the final report): backend Dockerfile/manifests (Gonzalo
said deployment is "not an issue" on 2026-11-01), auth beyond `X-Client-Id`, cross-origin static frontend build (Q2),
the 30 % pause valve's product semantics beyond the minimal guard in G-1-6, a real OpenShift/SCC run (no cluster here).

## Fixer assignment (iteration 1)
| Fixer | Gaps | Worktree scope |
|---|---|---|
| BE-A events/SSE/publishing | G-1-1, G-1-4, G-1-20, G-1-23 | `common/adapters/outbound`, `feed/**`, `publishing/**`, `config/**` |
| BE-B health | G-1-5, G-1-6, G-1-7, G-1-24 | `health/**` |
| BE-C ops/contract/docs | G-1-8, G-1-9, G-1-21, G-1-22 | `build.gradle.kts`, `application.yml`, `config/**`, `README.md` |
| FE | G-1-3, G-1-10, G-1-11, G-1-12, G-1-13, G-1-14, G-1-15, G-1-16, G-1-17 | `frontend/**` |
| SC | G-1-2, G-1-18, G-1-19 | `sidecar/**` |
