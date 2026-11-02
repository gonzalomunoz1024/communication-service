# Iteration 2 — second remediation round (code at `be19645`, 24 commits over the iteration-1 head `0e14838`)

Reports: `iter-2/gaps.md` (G-2-1 … G-2-17), `iter-2/fixes.md` (gap → commit → guarding test), `iter-2/verifier-backend.md`,
`verifier-frontend.md`, `verifier-sidecar.md`, `verifier-e2e.md`, `usability.md`, audit `iter-2/audit.md`.
Evidence: `evidence/iter-2/<area>/`, fixers' before/after logs `evidence/iter-2/fixers/`, audit `evidence/iter-2/audit/`.

## Scores (audited)

| Score | Iteration 1 (audited) | Verifier claimed | Auditor | Δ vs iteration 1 | Hard gate | Why the audit changed it |
|---|---|---|---|---|---|---|
| Backend | 88 | 94 | **94** | +6 | none | usability category = Usability Reviewer's API score 89 (93.9 rounds to 94) |
| Frontend | 91 | 97 | **96** | +5 | none | usability category = UI score 84 (96.4) |
| Sidecar | 89 | 90.5 | **91** | +2 | none | usability category = onboarding score 94 (90.9) |
| E2E system | 85 | 90 | **90** | +5 | none | usability category = UI score 84 (90.4) |
| **Overall (lowest)** | **85** | | **90** | **+5** | | |

Usability Reviewer: UI 84 (iteration 1: 74), API 89 (93), sidecar onboarding 94 (100); accepted by the audit. The API and
onboarding figures fell because this walk probed further (a misspelled field, a null inside an array, the Helm include pasted
literally, the DEBUG claim), not because something that worked before broke.

Audit sample: 75 of 363 claims re-run (seed 2), 74 reproduced, 1 partial, 0 contradicted; no veto; no score raised on judgment.
The partial is the E2E recovery timing of F-74 (next sidecar report accepted 5 s after a backend restart): on a loaded machine
the backend took 11.5–16.1 s to restart, the sidecar was in its 32 s backoff step, and in one of two runs the pod crossed the
90 s staleness window and a false OUTAGE stayed open for 13 s. The row stays PASS (specified behaviour), and the interaction is
carried into iteration 3 as G-3-29.

Test-weakening check over the 22 fix commits `b397f87..908598a` (against `0e14838` and against `191a0c5`): no test deleted or
renamed, no skip/disable marker added; 8 removed backend assertion lines (3 replaced by stronger ones, 5 encoded the G-2-6 defect
that was fixed), 4 frontend lines follow the G-2-11 reconnect cap and the G-2-9 wording, the sidecar's manifest-test skip now
fails under CI. `iter-2/fixes.md` names 20 of the 23 touched existing test files; the other 3 are explained in their commits.

## What changed
All 17 gaps closed, each in its own commit with a regression test or a build gate (`iter-2/fixes.md`). Headline: javac
`-Werror`, SpotBugs and a JaCoCo line gate (G-2-1, G-2-2); CI workflows for the three parts and the end-to-end suite (G-2-3,
G-2-17); Mongo unreachable → `503 {"error":"database unavailable"}` within 5 s, readiness down, liveness up, one WARN per failed
sweep (G-2-4); the staleness valve forgets monitors silent for over a day (G-2-5); operator-retired auto notices reopen on the
threshold-th failure (G-2-6); on-demand probes survive the scheduler race (G-2-7); snapshot frames carry the log head (G-2-8);
the duplicate-`externalRef` 409 says the key is permanent and how to follow up (G-2-9); UI focus management, reconnect within
10 s, no `acme` default (G-2-10 … G-2-13); sidecar on Go 1.25 with version/revision labels, manifest tests that fail in CI, a
pinned `/status` contract, every probe sent while not UP (G-2-14 … G-2-16); an in-repo Playwright suite over docker compose
(G-2-17).

## Verification results
Every Feature Matrix row passes end to end: backend 65/65, frontend 29/29, sidecar 28 PASS + 3 PARTIAL of 31 (F-80 UBI images,
F-82 and F-86 need a real cluster), cross-service 33/33. Suites: backend 208 unit + 42 integration tests, 3× with
`--rerun`, 0 failures, SpotBugs 0, JaCoCo line 0.955; frontend 141 tests (18 files) 3×, lines 93.99 %, `npm audit` 0; sidecar 42
tests in five modes incl. `-race` and `CI=true`; the in-repo e2e suite 18 of 18 over three runs (47–58 s). Journeys: Mongo
stopped → 503 in 5.0 s on both nodes, open streams survive, recovery without restart; SIGKILL of the backend → *Reconnecting*
→ Live 2.4 s after readiness with the meanwhile notice replayed once; dead app → first DOWN 3.0–4.2 s after the flip, OUTAGE
4.4 s later, card in the UI 7.9–8.8 s after the flip.

## What kept the scores under 95 (→ `iter-3/gaps.md`, 28 gaps, all minor)
Backend: a stream opened during a database outage logs ERROR stack traces; every node probes every due monitor; the publisher GET
shows ACTIVE after expiry; the coverage gate excludes `config/**`; the SBOM includes build tooling; Actuator/driver stack traces
during an outage; weak input wording (null/blank list entries, unknown fields accepted, dates without values). Frontend: the
service's own 503 is shown as "unreachable"; the 409 banner shows the API sentence; focus and live-region details; per-keystroke
tenant reloads. Sidecar: degraded-by-component reports wait for the heartbeat; UNKNOWN sent every probe; report timeout equal to
the service's database timeout; no log-level setting; silent boolean typos; a wall-clock test. E2E: the restart test cannot tell
replay from reload; failure paths beyond a restart only in verifier scripts; the e2e README's Go image; no lint for `e2e/`.
Environmental (not fixable here): no OpenShift cluster or SCC admission, no UBI registry, no vulnerability database, GitHub
Actions never run.
