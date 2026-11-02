E2E verifier, iteration 3: scripts behind confidence/evidence/iter-3/e2e/ (run from the scratchpad folder e2e3/).
Adapted from the iteration-2 verifier's scripts (confidence/evidence/iter-2/e2e/scripts/) with the prefixes renamed
(e2e2 -> e2e3, ve2 -> ve3) and the checks changed where iteration 3 changed behaviour on purpose (fixes.md).

  suite-chain.sh          the repository's e2e suite, three fresh stacks, exactly as e2e/README.md says
  env.sh, stack-up.sh, start-backend.sh, stack-down.sh
                          the private stack: Mongo e2e3-mongo :19527 (db ve3_main), backends A :19501 / B :19502
                          (iteration-3 jar; sweep 2 s, health sweep 1 s, stale grace 0), vite preview :19530 -> A
                          (frontend/dist), pod e2e3-netns (+ e2e3-app fakeapp:e2e, e2e3-sidecar health-sidecar:e2e3 as
                          UID 1000660000, read-only, cap-drop ALL, no-new-privileges), pull target e2e3-stub :19551
  http_checks.py          HTTP/SSE contracts on A and B (phases core sse health fanout mongo_down mongo_back)
  ui_flows.js, ui_focus.js  browser flows on the production bundle (two contexts, CDP-free)
  pod_flows.js            sidecar <-> app <-> backend <-> UI flows (down degraded words unknownpod sigterm deadapp
                          ordering capture pull silence logs); capture.js is its recording stub backend
  failure_flows.js        kill (SIGKILL of A under a streaming page, CDP capture incl. wire headers, B watched for a
                          false OUTAGE) and mongo (database stopped under A and B)
  mut/replay-proxy.js, mut/pw-proxy.config.js
                          G-3-12 mutation check: the repository's spec 04, unchanged, behind a proxy that passes
                          everything (control) or strips lastEventId / Last-Event-ID (a backend that does not replay)
  mut/run-mutation.sh     the mutation run itself: fresh compose stack, spec 04 with the proxy in 'pass' then 'strip', stack down
  failure_flows.run2.js.txt
                          failure_flows.js as it ran in run 2; run 3 (mongo only) waits for the late page's Reconnecting
                          badge and its retry instead of checking at a fixed 30 s after the stop (the run-2 FAIL was the
                          script checking 1.4 s after the service ended the stream, before the browser's ~3 s retry was due)
  lint-probe.spec.ts.txt  the G-3-28 probe: a throwaway spec with a focused test, a skipped test, a fixed wait, a
                          conditional expect and an unawaited page.goto, linted with the suite's eslint config (never committed)
