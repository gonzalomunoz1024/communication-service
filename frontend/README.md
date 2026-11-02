# Outage notifications UI

A single-page React app over communication-service: one tab to **publish** an outage
(or incident, maintenance window, change) and one tab to **view the feed** a tenant's
consumers see, kept live over the service's SSE stream.

Built in the style of the `infrastructure-automation` frontend: Vite + React 19 +
TypeScript + Tailwind 4, with the Atlas design tokens and a trimmed copy of its UI kit.

## Run

```sh
cd frontend
npm install
npm run dev          # http://localhost:3000, proxies /v1 to http://localhost:8080
COMM_BACKEND=http://localhost:18080 npm run dev   # a service elsewhere
```

Start the service first (`./gradlew bootRun` from the repository root, Mongo on 27017; the
[root README](../README.md) has the details).
The dev server proxies `/v1` so the browser never needs CORS. For a static build
(`npm run build` → `dist/`), serve it behind the same host as the API, or set
`VITE_API_BASE=https://comm.example.com` at build time.

Every request carries `X-Client-Id: communication-frontend`, which the service requires of every
caller; set `VITE_CLIENT_ID` at build time to identify a host app by its repository name instead.
The live stream passes the same id as `?clientId=`, because `EventSource` cannot set headers.

The browser keeps the stream open by itself and retries a dropped socket with `Last-Event-ID`,
but it gives up for good once a retry is answered with anything other than 200 (a restart or a
proxy error). When that happens the client reopens the stream itself, with exponential backoff
(1 s, 2 s, … 30 s, shown as **Reconnecting (n)** in the badge) and `?lastEventId=<last seq>` so
the service replays what was missed; after it is back, the list is reloaded once from `/v1/feed`
in case the replay did not cover the gap. **Try again** in the error state reopens it at once.

`npm test` runs the unit tests (validation, feed state, client); `npm run typecheck` type-checks.

## What it calls

| Action | Endpoint |
| --- | --- |
| Publish | `POST /v1/communications` (`CreateCommunicationCommand`) |
| Feed | `GET /v1/feed?tenantId=…&service=…&type=…&severity=…` (`Page<FeedItem>`) |
| Live updates | `GET /v1/feed/stream?tenantId=…` (SSE, `CommunicationEvent` frames) |
| Resolve | `POST /v1/communications/{id}/retire` (`RetireRequest`) |

The form enforces the same invariants as `Communication#validateInvariants` before sending
(severity floor for OUTAGE/INCIDENT, `endsAt` for MAINTENANCE, time ordering, length caps), and
shows the service's `{"error": …}` text when it rejects a request anyway.

An optional **ServiceNow incident** field ties a notice to the ticket behind it (`ticket.number`,
`INC0012345`). The service upper-cases the number and, when it knows the instance, adds a link;
the feed card shows the ticket as a chip that opens the incident.

## Porting to another UI

Everything specific to outages lives in `src/outages/` and depends only on React and
`src/ui/` (the kit subset). To lift it into another app:

1. Copy `src/outages/`. If the target app already has `@iaf/ui`, change the `'../ui'`
   imports to `'@iaf/ui'`; the component and prop names match. Otherwise copy `src/ui/`
   too (and import `ui/atlas.css` once).
2. Create a client and render the two components wherever they belong:

```tsx
import { createCommunicationClient, OutageFeed, PublishOutageForm } from './outages'

const client = createCommunicationClient('')   // '' = same origin

<OutageFeed client={client} tenantId="acme" actor="web-oncall" />
<PublishOutageForm client={client} tenantId="acme" publisher="web-oncall" onPublished={…} />
```

`src/App.tsx` is only the shell (header, tenant picker, tabs, theme toggle); nothing in
`src/outages/` imports from it.

| File | Role |
| --- | --- |
| `outages/types.ts` | Wire types mirroring the Java records |
| `outages/api.ts` | `createCommunicationClient()`: publish, feed, retire, SSE stream |
| `outages/validation.ts` | Form draft → request body, with the service's invariants |
| `outages/feed-state.ts` | Pure reducers: apply an SSE event, effective status, sort |
| `outages/useOutageFeed.ts` | Hook: GET once, then keep the list live |
| `outages/PublishOutageForm.tsx` | The publish tab |
| `outages/OutageFeed.tsx`, `OutageCard.tsx` | The feed tab and one item |
