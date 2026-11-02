# Frontend verifier: automated browser checks, aggregated per feature (iter-0)

| file | passed | failed |
|---|---|---|
| t1-shell-theme-form.json | 55 | 0 |
| t2-publish-errors.json | 28 | 0 |
| t3-feed.json | 36 | 3 |
| t4-reconnect.json | 9 | 2 |
| t4b-reconnect-timeline.json | 2 | 2 |
| t4c-reconnect-route.json | 0 | 0 |
| t4d-reconnect-sigkill.json | 1 | 4 |
| t4e-eventsource-gives-up.json | 3 | 2 |
| t4f-offline-reconnect.json | 3 | 4 |
| t4g-reconnect-prodshape.json | 3 | 5 |
| t5-a11y.json | 11 | 7 |
| t6-xorigin.json | 2 | 0 |

| feature | checks passed | checks failed | failed checks |
|---|---|---|---|
| F-01 | 1 | 0 | - |
| F-02 | 5 | 0 | - |
| F-06 | 2 | 1 | t3-feed.json: retiring an EXPIRED item → 409 |
| F-07 | 2 | 0 | - |
| F-09 | 2 | 0 | - |
| F-14 | 2 | 0 | - |
| F-15 | 2 | 0 | - |
| F-16 | 1 | 1 | t3-feed.json: CONTRACT CHECK: a future-dated OUTAGE published while the feed is open — live frame vs GET /v1/feed visibility must agree |
| F-20 | 2 | 3 | t4d-reconnect-sigkill.json: resumed stream requests (Last-Event-ID) are answered 200, never 500<br>t4f-offline-reconnect.json: the service answers the resumed stream (Last-Event-ID) with 200 and replays<br>t4g-reconnect-prodshape.json: the service answers the resumed stream (Last-Event-ID) with 200 |
| F-52 | 13 | 0 | - |
| F-53 | 7 | 0 | - |
| F-54 | 21 | 0 | - |
| F-55 | 14 | 0 | - |
| F-56 | 10 | 0 | - |
| F-57 | 8 | 0 | - |
| F-58 | 7 | 1 | t3-feed.json: default filter Type=Outage: GET /v1/feed?tenantId&type=OUTAGE&page=0&size=100, two outages, CRITICAL before MAJOR |
| F-59 | 8 | 0 | - |
| F-60 | 7 | 0 | - |
| F-61 | 18 | 16 | t4-reconnect.json: indicator shows 'Reconnecting' when the stream drops<br>t4-reconnect.json: browser reconnects on its own and sends Last-Event-ID (the last id: seen)<br>t4b-reconnect-timeline.json: indicator shows 'Reconnecting' while the backend is down<br>t4b-reconnect-timeline.json: the browser retries the stream and sends Last-Event-ID<br>t4d-reconnect-sigkill.json: indicator shows 'Reconnecting' while the backend is down<br>t4d-reconnect-sigkill.json: the browser retries the stream on its own and sends Last-Event-ID<br>t4d-reconnect-sigkill.json: after the restart the new item appears without a manual refresh and the indicator is Live again<br>t4e-eventsource-gives-up.json: after a dropped stream the browser reconnects by itself and sends Last-Event-ID = last id seen (41)<br>t4e-eventsource-gives-up.json: after a non-200 answer to the reconnect the EventSource is CLOSED (readyState 2) and the UI shows Reconnecting<br>t4f-offline-reconnect.json: a dropped stream puts the EventSource into CONNECTING (readyState 0) and the UI shows 'Reconnecting'<br>t4f-offline-reconnect.json: the browser reconnects on its own and sends Last-Event-ID = the last id it saw<br>t4f-offline-reconnect.json: the UI retries by itself after the EventSource gave up (new stream request within 20 s)<br>t4g-reconnect-prodshape.json: when the stream drops the UI shows 'Reconnecting' (EventSource readyState 0)<br>t4g-reconnect-prodshape.json: the browser reconnects on its own and sends Last-Event-ID = the last id it saw<br>t4g-reconnect-prodshape.json: after the restart the UI is 'Live' again and the new item appears without a manual refresh<br>t4g-reconnect-prodshape.json: after the EventSource gave up, the UI opens a new stream by itself within 20 s |
| F-62 | 4 | 0 | - |
| F-63 | 3 | 0 | - |
| F-64 | 3 | 0 | - |
| F-65 | 11 | 7 | t5-a11y.json: axe feed tab (light): 2 violation rule(s), 1 serious/critical<br>t5-a11y.json: axe publish tab, timing open (light): 2 violation rule(s), 1 serious/critical<br>t5-a11y.json: axe publish tab with validation errors (light): 2 violation rule(s), 1 serious/critical<br>t5-a11y.json: axe feed tab (dark): 2 violation rule(s), 1 serious/critical<br>t5-a11y.json: axe publish tab, timing open (dark): 2 violation rule(s), 1 serious/critical<br>t5-a11y.json: axe publish tab with validation errors (dark): 2 violation rule(s), 1 serious/critical<br>t5-a11y.json: feed tab: filter controls have accessible names via label association or aria-label (not placeholder only) |
