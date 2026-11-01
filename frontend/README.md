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

Start the service first (the [root README](../README.md) has the build command; Mongo on 27017).
The dev server proxies `/v1` so the browser never needs CORS. For a static build
(`npm run build` → `dist/`), serve it behind the same host as the API, or set
`VITE_API_BASE=https://comm.example.com` at build time.

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
