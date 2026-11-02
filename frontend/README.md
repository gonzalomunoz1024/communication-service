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

The page opens on the tenant named by `VITE_DEFAULT_TENANT` at build time; when that is unset
(the default) on the tenant used last in that browser (`localStorage`, saved on every change);
and on a first visit on none, with a prompt to enter the tenant the consumers read, which the
service owners assign. The feed and the form follow the header's tenant field once typing pauses
(400 ms), on Enter, or when the field loses focus, so a tenant name costs one feed request and
one stream subscription rather than one per keystroke.

The browser keeps the stream open by itself and retries a dropped socket with `Last-Event-ID`,
but it gives up for good once a retry is answered with anything other than 200 (a restart or a
proxy error). When that happens the client reopens the stream itself, with exponential backoff
(1 s, 2 s, 4 s, 8 s, then every 10 s, shown as **Reconnecting (n)** in the badge; the cap is how
long a page can take to notice that the service is back, and the backoff starts again from 1 s
after every successful open). Every attempt carries `?lastEventId=<last seq>`, failed ones
included, so the first one that reaches the service gets a replay of what was missed; an id the
service cannot resume from (too old, or never issued by its event log) is answered with a fresh
snapshot, never an error, so the client has nothing to drop. After the stream is back the list is
reloaded once from `/v1/feed` in case the replay did not cover the gap. **Try again** in the
error state reopens it at once. The badge is a polite live region of its own, so screen readers
hear Connecting, Live and Reconnecting (n) as they change; it reads **Paused** only when Live
updates is switched off and **Waiting for a tenant** while no tenant is entered.

`npm test` runs the unit and component tests (vitest; pure modules in Node, components in
jsdom with Testing Library), `npm run test:coverage` adds a V8 coverage report (`coverage/`),
`npm run typecheck` type-checks and `npm run lint` runs ESLint with the React Compiler-era hooks
rules. `npm run build` type-checks and bundles to `dist/`. `package.json` pins `minimatch` to a
fixed release through `overrides` (the ESLint toolchain's own range still resolves to a version
with a known ReDoS; development-only, the bundle does not contain it), so `npm audit` is clean;
drop the entry once ESLint and typescript-eslint require `minimatch` 11 themselves.

## What it calls

| Action | Endpoint |
| --- | --- |
| Publish | `POST /v1/communications` (`CreateCommunicationCommand`) |
| Feed | `GET /v1/feed?tenantId=…&service=…&type=…&severity=…` (`Page<FeedItem>`) |
| Live updates | `GET /v1/feed/stream?tenantId=…` (SSE, `CommunicationEvent` frames) |
| Resolve | `POST /v1/communications/{id}/retire` (`RetireRequest`) |

The feed lists what is live plus scheduled maintenance starting within the next 7 days
(`communication.feed.upcoming-window`); a scheduled outage, incident or change appears when it
starts. Stream frames are filtered by the same rule (`inFeed` in `feed-state.ts`), so the live
list never shows something a reload would not. Cards also move on their own at `startsAt` and
`expiresAt` (an upcoming maintenance turns active, an expired notice leaves) rather than waiting
for the service's sweeper frame. The list is the first page of 100; when the service has more it
says so under the list. A notice that has not started offers **Withdraw** instead of **Resolve**;
both retire it after a confirmation in the card: keyboard focus moves to its note field, inside a
group named by the question (so a screen reader reads it), back to the button on **Cancel** or a
refused call, and to the list when the card leaves.

The form enforces the same invariants as `Communication#validateInvariants` before sending
(severity floor for OUTAGE/INCIDENT, `endsAt` for MAINTENANCE, time ordering, length caps), and
shows the service's `{"error": …}` text when it rejects a request anyway. A 5xx is reported as a
failure of the service (with its reason when it gave one), not as a rejection. While the service
cannot reach its database it answers `503 {"error":"database unavailable"}`, and both tabs say
exactly that (the service is running and recovers by itself, so try again in a moment); the
connection badge keeps showing what the stream is doing, which stays open on keepalives meanwhile.
When the service cannot be reached at all (connection refused, or a 502/503/504 that a proxy in
front of it answers without the service's `{"error"}` body) both tabs say that it is unreachable
instead of quoting the status line, and the feed's **Try again** reopens the live stream as well
as reloading the list.

An optional **ServiceNow incident** field ties a notice to the ticket behind it (`ticket.number`,
`INC0012345`). The service upper-cases the number and, when it knows the instance, adds a link;
the feed card shows the ticket as a chip that opens the incident. The number also becomes the
notice's `externalRef` unless **External reference** is filled in, and that key is permanent per
tenant (a retired notice keeps it): a second notice for the same incident needs another External
reference, which is what the 409 banner says. The banner recognises that 409 by its status and the
word `externalRef`, names the field the reference came from and suggests a value (a follow-up's
number goes up: `INC0012345-2`, then `INC0012345-3`; any other reference gets `-2`); the service's
own sentence, which names the notice holding the reference by id, is folded under **What the
service said**.

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
`src/outages/` imports from it. `onViewFeed(communication)` is where the host switches to the
feed of the tenant that was just published to, filtered to that type, so the new notice is on
screen.

| File | Role |
| --- | --- |
| `outages/types.ts` | Wire types mirroring the Java records |
| `outages/api.ts` | `createCommunicationClient()`: publish, feed, retire, SSE stream |
| `outages/validation.ts` | Form draft → request body, with the service's invariants |
| `outages/feed-state.ts` | Pure reducers: apply an SSE event, effective status, sort |
| `outages/useOutageFeed.ts` | Hook: GET once, then keep the list live |
| `outages/PublishOutageForm.tsx` | The publish tab |
| `outages/OutageFeed.tsx`, `OutageCard.tsx` | The feed tab and one item |

Colour: text in a semantic hue uses the `text-*-fg` utilities (`text-critical-fg`,
`text-accent-fg`, `text-state-failed-fg`, …), which map to the `--color-*-text` tokens and reach
WCAG AA on the surfaces and on the matching `bg-*-tint`; the plain hue (`bg-critical`,
`text-accent`) is for fills, dots, rails and icons. `src/test/contrast.test.ts` computes the
ratios from `src/ui/atlas.css`, so a token change that drops below 4.5:1 fails the suite.
