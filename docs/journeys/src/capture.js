// Drives the real stack and records every journey step as a screenshot or a transcript.
// Output: <JR_OUT>/img/*.png and <JR_OUT>/manifest.json (JR_OUT defaults to docs/journeys), rendered into HTML by
// render_shots.py. The settings (JR_*) are listed in docs/journeys/README.md.
const { chromium } = require('playwright');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const UI = process.env.JR_UI || 'http://127.0.0.1:3000';
const API = process.env.JR_API || 'http://localhost:8080';
const TOOLS = process.env.JR_TOOLS || ''; // extra PATH entries (kustomize), when not installed system-wide
const APP_IMAGE = process.env.JR_APP_IMAGE || 'fakeapp:ci'; // built from e2e/fakeapp
const SIDECAR_IMAGE = process.env.JR_SIDECAR_IMAGE || 'health-sidecar:ci'; // built from sidecar/
const NETNS_IMAGE = process.env.JR_NETNS_IMAGE || 'golang:1.24'; // any image with `sleep`; holds the pod's network namespace
const REPO = path.join(__dirname, '..', '..', '..');
const OUT = process.env.JR_OUT || path.join(__dirname, '..');
const IMG = path.join(OUT, 'img');
const TENANT = 'journeys';
const SIDECAR_ENDPOINT = process.env.JR_SIDECAR_ENDPOINT || 'http://172.17.0.1:8080';
const MONGO = process.env.JR_MONGO || 'mongo7';
const RUN = Date.now().toString(36).slice(-4);
const manifest = { generatedAt: new Date().toISOString(), ui: UI, api: API, journeys: [] };
let current = null;
let shotNo = 0;

function journey(id, title, summary) { current = { id, title, summary, steps: [] }; manifest.journeys.push(current); return current; }
function step(s) { current.steps.push(s); return s; }
async function shot(page, who, text, opts = {}) {
  shotNo += 1;
  const file = `${current.id}-${String(shotNo).padStart(2, '0')}.png`;
  await page.waitForTimeout(opts.settle ?? 400);
  await page.screenshot({ path: path.join(IMG, file), fullPage: !!opts.fullPage });
  return step({ who, text, image: `img/${file}` });
}
function note(who, text) { return step({ who, text }); }
function transcript(who, text, body, lang = 'http') { return step({ who, text, transcript: body, lang }); }

async function call(method, p, { body, headers = {}, clientId = 'journeys-walkthrough', raw = false } = {}) {
  const h = { ...headers };
  if (clientId) h['X-Client-Id'] = clientId;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(API + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    text = await res.text();
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, text: String(e), lines: `${method} ${p}\n→ connection failed after ${Date.now() - t0} ms: ${e.message}` };
  }
  const ms = Date.now() - t0;
  let shown = text;
  try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch (_) {}
  if (shown.length > 1800 && !raw) shown = shown.slice(0, 1800) + '\n… (trimmed)';
  const hdr = Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n');
  const lines = `${method} ${p}\n${hdr}${body !== undefined ? '\n\n' + JSON.stringify(body, null, 2) : ''}\n\n→ ${res.status} ${res.statusText} (${ms} ms)${res.headers.get('location') ? '\nLocation: ' + res.headers.get('location') : ''}\n${shown}`;
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, ms, text, json, lines };
}
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout || 120000, env: { ...process.env, PATH: TOOLS ? `${TOOLS}:${process.env.PATH}` : process.env.PATH } });
  return ((r.stdout || '') + (r.stderr || '')).trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs, every = 1000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeoutMs) throw new Error('timeout after ' + timeoutMs + ' ms'); await sleep(every); }
}
async function openFeed(page, tenant = TENANT) {
  await page.goto(UI + '/#/feed');
  const box = page.getByRole('textbox', { name: 'Tenant', exact: true });
  await box.fill(tenant);
  // the feed opens on outages only (its default type filter); the walkthrough shows every type
  await page.locator('select[aria-label="Type"]').selectOption('');
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 15000 });
}
const card = (page, title) => page.locator('article', { hasText: title });
async function fillPublish(page, { title, details, services = 'orders-api, checkout-web', publisher = 'sam-oncall', type, severity, extRef, ticket, starts, ends, draft }) {
  await page.getByRole('tab', { name: 'Publish' }).click();
  if (type) await page.getByRole('radiogroup', { name: 'Type' }).getByRole('radio', { name: titleCase(type) }).click();
  if (severity) await page.getByRole('radiogroup', { name: 'Severity' }).getByRole('radio', { name: titleCase(severity) }).click();
  await page.getByLabel(/^Title\*$/).fill(title);
  if (details) await page.getByLabel('Details').fill(details);
  await page.getByLabel('Affected services').fill(services);
  await page.getByLabel(/^Publisher\*$/).fill(publisher);
  if (extRef !== undefined) await page.getByLabel(/^External reference/).fill(extRef);
  if (ticket !== undefined) await page.getByLabel(/^ServiceNow incident/).fill(ticket);
  if (starts || ends) {
    const sched = page.getByRole('button', { name: 'Schedule' });
    if (await sched.count()) await sched.click();
  }
  if (starts) await page.getByLabel(/^Starts/).fill(starts);
  if (ends) await page.getByLabel(/^Ends/).fill(ends);
  if (draft) await page.getByLabel('Save as draft').check();
}
const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();
function localIso(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
async function clickPublish(page) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')),
    page.getByRole('button', { name: /^Publish / }).click(),
  ]);
  return res;
}
async function cleanTenant(tenant) {
  for (const st of ['ACTIVE', 'SCHEDULED', 'DRAFT']) {
    const list = await call('GET', `/v1/admin/communications?tenantId=${tenant}&status=${st}&size=100`, { clientId: 'walkthrough-cleanup' });
    for (const it of (list.json && list.json.items) || []) await call('POST', `/v1/admin/communications/${it.id}/retire`, { body: { actor: 'walkthrough-cleanup', note: 'previous run' }, clientId: 'walkthrough-cleanup' });
  }
  const mons = await call('GET', `/v1/health/monitors?tenantId=${tenant}`, { clientId: 'walkthrough-cleanup' });
  for (const m of (mons.json || [])) await call('DELETE', `/v1/health/monitors/${m.id}`, { clientId: 'walkthrough-cleanup' });
}

// ---------- pods (emulated with docker: a netns holder, the app, the sidecar) ----------
function podUp(name, { hostPortApp, hostPortStatus, service = 'orders-api', podName, interval = '5s', heartbeat = '15s', grace = '20s', startApp = true }) {
  sh('docker', ['rm', '-f', `${name}-sidecar`, `${name}-app`, `${name}-netns`]);
  sh('docker', ['run', '-d', '--name', `${name}-netns`, '-p', `127.0.0.1:${hostPortApp}:8080`, '-p', `127.0.0.1:${hostPortStatus}:9465`, NETNS_IMAGE, 'sleep', 'infinity']);
  if (startApp) sh('docker', ['run', '-d', '--name', `${name}-app`, '--network', `container:${name}-netns`, APP_IMAGE]);
  sh('docker', ['run', '-d', '--name', `${name}-sidecar`, '--network', `container:${name}-netns`, '--user', '1000660000:0', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '-e', `CS_ENDPOINT=${SIDECAR_ENDPOINT}`, '-e', `CS_TENANT=${TENANT}`, '-e', `CS_SERVICE=${service}`, '-e', `CS_CLIENT_ID=${service}`, '-e', `POD_NAME=${podName}`, '-e', 'POD_NAMESPACE=retail-orders', '-e', 'NODE_NAME=worker-2', '-e', 'CS_CLUSTER=ocp-east', '-e', 'CS_VERSION=1.4.2',
    '-e', `CS_INTERVAL=${interval}`, '-e', `CS_HEARTBEAT=${heartbeat}`, '-e', 'CS_RETRY_DELAY=1s', '-e', `CS_STARTUP_GRACE=${grace}`, SIDECAR_IMAGE]);
}
function podDown(name) { sh('docker', ['rm', '-f', `${name}-sidecar`, `${name}-app`, `${name}-netns`]); }
async function status(port) { try { const r = await fetch(`http://127.0.0.1:${port}/status`); return await r.json(); } catch (e) { return { error: String(e) }; } }
async function setApp(port, s, db) { try { const r = await fetch(`http://127.0.0.1:${port}/__set?status=${s}&db=${db}`, { method: 'POST' }); return await r.text(); } catch (e) { return String(e); } }
const pretty = (o) => JSON.stringify(o, null, 2);
function sidecarLog(name, since) { return sh('docker', ['logs', '--since', since, name]).split('\n').filter(Boolean).slice(-12).join('\n'); }

// ---------- journeys ----------
async function jPublish(browser) {
  journey('publish', 'Publish an outage and watch it land', 'Sam publishes an outage from the screen; a second screen sees it live; Sam resolves it and it leaves everywhere.');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(UI + '/');
  await shot(page, 'Outage screens', 'First visit: no tenant is pre-filled. The header asks for the tenant your consumers read.');
  const watcherCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const watcher = await watcherCtx.newPage();
  await openFeed(watcher);
  await shot(watcher, 'Dependent systems', `A second screen (Team B) already watches tenant ${TENANT}: the feed is empty and the badge says Live.`);
  await page.getByRole('textbox', { name: 'Tenant', exact: true }).fill(TENANT);
  await page.getByRole('tab', { name: 'Publish' }).click();
  await page.getByRole('button', { name: /^Publish / }).click();
  await shot(page, 'Outage screens', 'Pressing Publish with an empty form: the first invalid field gets focus and an error summary lists what is missing. Nothing was sent.');
  const title = `Card payments failing ${RUN}`;
  await fillPublish(page, { title, details: 'Card payments fail for about a third of requests; retries succeed. Next update in 30 minutes.' });
  await shot(page, 'Outage screens', 'Sam fills in the outage: tenant, title, details, affected services, publisher.');
  const res = await clickPublish(page);
  const created = await res.json();
  transcript('The service', `What the screen sent and what came back (${res.status()} in the browser's own request).`, `POST /v1/communications\nX-Client-Id: communication-frontend\n\n${pretty(res.request().postDataJSON())}\n\n→ ${res.status()} Created\n${pretty(created)}`);
  await page.getByRole('heading', { name: /published/ }).waitFor();
  await shot(page, 'Outage screens', 'Published: the confirmation offers View in feed and Publish another.');
  await card(watcher, title).waitFor({ timeout: 10000 });
  await shot(watcher, 'Dependent systems', 'Team B\'s screen shows the outage within a second, over the live stream, without reloading.');
  await page.getByRole('button', { name: 'View in feed' }).click();
  await card(page, title).waitFor();
  await shot(page, 'Outage screens', 'View in feed switches Sam to the feed of the tenant just published to, filtered to that type.');
  const mine = card(page, title);
  await mine.getByRole('button', { name: 'Resolve' }).click();
  await shot(page, 'Outage screens', 'Resolve asks for confirmation and says who acts and what consumers see; a note is optional.');
  await mine.getByPlaceholder('Resolution note (optional)').fill('Payment provider failover completed');
  const [retired] = await Promise.all([page.waitForResponse((r) => r.url().endsWith(`/v1/communications/${created.id}/retire`)), mine.getByRole('button', { name: 'Resolve' }).click()]);
  transcript('The service', 'The retire call the screen made.', `POST /v1/communications/${created.id}/retire\nX-Client-Id: communication-frontend\n\n${pretty(retired.request().postDataJSON())}\n\n→ ${retired.status()}\n${pretty(await retired.json())}`);
  await card(page, title).waitFor({ state: 'detached' });
  await shot(page, 'Outage screens', 'Resolved: the card leaves and a status message confirms it; focus stays on the list.');
  await card(watcher, title).waitFor({ state: 'detached', timeout: 10000 });
  await shot(watcher, 'Dependent systems', 'Team B\'s screen drops the card at the same moment.');
  const feed = await call('GET', `/v1/feed?tenantId=${TENANT}`);
  transcript('Dependent systems', 'A reload of the feed no longer lists it; the permalink still tells the story.', feed.lines + '\n\n' + (await call('GET', `/v1/communications/${created.id}`)).lines);
  await ctx.close(); await watcherCtx.close();
}

async function jMaintenance(browser) {
  journey('maintenance', 'Schedule a maintenance window', 'A maintenance window is published ahead of time, shows as Scheduled with a countdown, is turned active by the clock and closed at its end; another one is withdrawn before it starts.');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await openFeed(page);
  const starts = new Date(Date.now() + 75 * 1000), ends = new Date(Date.now() + 150 * 1000);
  const title = `Database maintenance ${RUN}`;
  await fillPublish(page, { title, type: 'MAINTENANCE', severity: 'MINOR', details: 'Primary database failover test. Expect 2 minutes of read-only mode.', starts: localIso(starts), ends: localIso(ends) });
  await shot(page, 'Outage screens', 'Maintenance needs a start and an end (here a short window so the whole life cycle fits in this walkthrough; normally days ahead).');
  const res = await clickPublish(page); const created = await res.json();
  transcript('The service', 'Stored as SCHEDULED, not live yet.', `POST /v1/communications → ${res.status()}\n${pretty(created)}`);
  await page.getByRole('button', { name: 'View in feed' }).click();
  await card(page, title).waitFor();
  await shot(page, 'Dependent systems', 'Upcoming maintenance within the 7-day window shows as Scheduled with a countdown and a Withdraw action.');
  const w2 = `Cache cluster upgrade ${RUN}`;
  await fillPublish(page, { title: w2, type: 'MAINTENANCE', severity: 'MINOR', starts: localIso(new Date(Date.now() + 3600 * 1000)), ends: localIso(new Date(Date.now() + 7200 * 1000)) });
  const r2 = await clickPublish(page); const c2 = await r2.json();
  await page.getByRole('button', { name: 'View in feed' }).click();
  const second = card(page, w2); await second.waitFor();
  await second.getByRole('button', { name: 'Withdraw' }).click();
  await shot(page, 'Outage screens', 'A window that has not started offers Withdraw instead of Resolve; the confirmation says consumers never see it.');
  await Promise.all([page.waitForResponse((r) => r.url().endsWith(`/v1/communications/${c2.id}/retire`)), second.getByRole('button', { name: 'Withdraw' }).click()]);
  await card(page, w2).waitFor({ state: 'detached' });
  note('The clock', 'Waiting for the first window to start (the clock checks every 30 seconds)…');
  await until(async () => (await call('GET', `/v1/communications/${created.id}`)).json?.status === 'ACTIVE', 150000, 3000);
  const active = await call('GET', `/v1/communications/${created.id}`);
  transcript('The clock', 'The clock moved it SCHEDULED → ACTIVE and wrote the history line; listeners got an `activated` frame.', active.lines);
  await shot(page, 'Dependent systems', 'The card turned active by itself (the screen also flips at the start time on its own).', { settle: 1500 });
  await until(async () => (await call('GET', `/v1/communications/${created.id}`)).json?.status === 'EXPIRED', 150000, 3000);
  const expired = await call('GET', `/v1/communications/${created.id}`);
  transcript('The clock', 'At the end time: ACTIVE → EXPIRED; retiring it now would answer 409 "already expired".', expired.lines + '\n\n' + (await call('POST', `/v1/communications/${created.id}/retire`, { body: { actor: 'sam-oncall', note: 'too late' } })).lines);
  await card(page, title).waitFor({ state: 'detached', timeout: 15000 });
  await shot(page, 'Dependent systems', 'The window left the feed when it ended.');
  await ctx.close();
}

async function jApiPublish(browser) {
  journey('api-publish', 'A system publishes through the API, safely twice', 'A deployment tool publishes with its own reference; a retry is answered with the same notice; a second notice under the same reference is refused with an explanation; an update names the version it edits.');
  const ref = `INC-${RUN}-1`;
  const body = { tenantId: TENANT, publisher: 'deploy-tool', type: 'INCIDENT', severity: 'MAJOR', title: `Deploy 2026.44 rolled back ${RUN}`, body: 'Elevated error rate after the 14:00 deploy; rolled back at 14:12.', affectedServices: ['orders-api'], externalRef: ref };
  const first = await call('POST', '/v1/communications', { body, clientId: 'deploy-tool' });
  transcript('A publishing system', 'First publish with reference ' + ref + '.', first.lines);
  const again = await call('POST', '/v1/communications', { body, clientId: 'deploy-tool' });
  transcript('The service', `The exact same request again (a retry): ${again.status}, the same notice id ${again.json?.id === first.json?.id ? '(identical)' : '(different!)'}; nothing duplicated.`, again.lines);
  const dup = await call('POST', '/v1/communications', { body: { ...body, title: 'Incident reopened' }, clientId: 'deploy-tool' });
  transcript('The service', 'A different notice under the same reference is refused (409), naming the holder and, in `suggestedExternalRef`, the first follow-up value still free.', dup.lines);
  const follow = await call('POST', '/v1/communications', { body: { ...body, externalRef: ref + '-2', title: `Deploy 2026.44 rolled back, second occurrence ${RUN}` }, clientId: 'deploy-tool' });
  transcript('A publishing system', 'The follow-up under the suggested reference.', follow.lines);
  const stale = await call('PUT', `/v1/communications/${first.json.id}`, { body: { expectedVersion: 7, title: body.title, body: 'Root cause: connection pool exhaustion.' }, clientId: 'deploy-tool' });
  transcript('The service', 'An update that names the wrong version is refused (409), so two editors cannot overwrite each other.', stale.lines);
  const ok = await call('PUT', `/v1/communications/${first.json.id}`, { body: { expectedVersion: first.json.version, title: body.title, body: 'Root cause: connection pool exhaustion. Fix deployed.' }, clientId: 'deploy-tool' });
  transcript('The service', 'With the current version the edit is applied and the version moves on.', ok.lines);
  // the same mistake from the screen
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  await openFeed(page);
  await fillPublish(page, { title: 'Follow-up from the screen', extRef: ref, publisher: 'sam-oncall' });
  await clickPublish(page);
  await page.getByRole('alert').waitFor();
  await shot(page, 'Outage screens', 'The same mistake from the screen: the banner explains that references are permanent and suggests the free value the service named.');
  await ctx.close();
  for (const id of [first.json.id, follow.json.id]) await call('POST', `/v1/communications/${id}/retire`, { body: { actor: 'deploy-tool', note: 'walkthrough' }, clientId: 'deploy-tool' });
}

async function jConsume() {
  journey('consume', 'A dependent system reads the feed and stays current', 'Team B\'s app loads the feed once, opens the live stream, and after a dropped line resumes from the last event id it saw.');
  const seed = await call('POST', '/v1/communications', { body: { tenantId: TENANT, publisher: 'sam-oncall', type: 'OUTAGE', severity: 'MAJOR', title: `Search index rebuild ${RUN}`, affectedServices: ['search-api'] } });
  const feed = await call('GET', `/v1/feed?tenantId=${TENANT}&service=search-api`, { clientId: 'team-b-app' });
  transcript('Dependent systems', 'The first page of what is live for the tenant, narrowed to one service.', feed.lines);
  // open the stream, publish while it is open, record frames
  const ctl = new AbortController();
  const frames = [];
  const streamP = (async () => {
    const r = await fetch(`${API}/v1/feed/stream?tenantId=${TENANT}&clientId=team-b-app`, { signal: ctl.signal, headers: { Accept: 'text/event-stream' } });
    const reader = r.body.getReader(); const dec = new TextDecoder();
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; frames.push(dec.decode(value)); } } catch (_) {}
  })();
  await sleep(1500);
  const live = await call('POST', '/v1/communications', { body: { tenantId: TENANT, publisher: 'sam-oncall', type: 'INCIDENT', severity: 'MINOR', title: `Slow checkout ${RUN}`, affectedServices: ['checkout-web'] } });
  await sleep(2500);
  await call('POST', `/v1/communications/${live.json.id}/retire`, { body: { actor: 'sam-oncall', note: 'resolved' } });
  await sleep(2500);
  ctl.abort(); await streamP;
  const raw = frames.join('');
  transcript('The service', 'The live line: `: connected` at once, a snapshot, then a `created` and a `retired` frame as they happened (keepalive comments every 15 s when quiet).', raw.length > 2500 ? raw.slice(0, 2500) + '\n… (trimmed)' : raw, 'sse');
  const ids = [...raw.matchAll(/^id: (\d+)/gm)].map((m) => +m[1]);
  const last = ids.length ? Math.max(...ids) : 0;
  const ctl2 = new AbortController(); let replay = '';
  const p2 = (async () => { const r = await fetch(`${API}/v1/feed/stream?tenantId=${TENANT}&clientId=team-b-app&lastEventId=${Math.max(0, last - 2)}`, { signal: ctl2.signal }); const rd = r.body.getReader(); const dec = new TextDecoder(); try { for (;;) { const { value, done } = await rd.read(); if (done) break; replay += dec.decode(value); } } catch (_) {} })();
  await sleep(2000); ctl2.abort(); await p2;
  transcript('The service', `Reopening with lastEventId=${Math.max(0, last - 2)} (what a client sends after a dropped line) replays the events after that id instead of starting over.`, replay.length > 2500 ? replay.slice(0, 2500) + '\n… (trimmed)' : replay, 'sse');
  note('The service', 'An id the log no longer holds (events are kept 24 hours) gets a fresh snapshot instead of a replay; this stack is younger than that, so it is not shown here.');
  await call('POST', `/v1/communications/${seed.json.id}/retire`, { body: { actor: 'sam-oncall', note: 'walkthrough' } });
}

async function jIdentity(browser) {
  journey('identity', 'A new system calls the API for the first time', 'Without a name the API answers 401 and says what is missing; with X-Client-Id the same call works and the name appears in the access log; the Swagger UI explorer uses the same header.');
  const no = await call('GET', `/v1/feed?tenantId=${TENANT}`, { clientId: null });
  transcript('A publishing system', 'No X-Client-Id header.', no.lines);
  const yes = await call('GET', `/v1/feed?tenantId=${TENANT}`, { clientId: 'billing-portal' });
  transcript('The service', 'With the repository name as X-Client-Id.', yes.lines);
  const logLines = sh('bash', ['-c', `grep -E "client=billing-portal|client=-|X-Client-Id" ${process.env.JR_BACKEND_LOG || '/dev/null'} | tail -3`]);
  if (logLines) transcript('Service operator (Alex)', 'The access log names the caller on every line.', logLines, 'log');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  await page.goto(API + '/swagger-ui.html'); await page.waitForTimeout(2500);
  await shot(page, 'Service operator (Alex)', 'The API explorer lists every route; Authorize takes the X-Client-Id value.');
  const auth = page.getByRole('button', { name: /Authorize/ }).first();
  if (await auth.count()) { await auth.click(); await page.waitForTimeout(800); await shot(page, 'Service operator (Alex)', 'Authorize: the X-Client-Id scheme is the only credential the API asks for today.'); }
  await ctx.close();
}

async function jTicket(browser) {
  journey('ticket', 'Tie a notice to its ServiceNow incident', 'The incident number typed on the screen is tidied, linked when the service knows the ServiceNow address, shown as a chip, and doubles as the notice\'s reference.');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  await openFeed(page);
  const title = `Login failures after certificate rotation ${RUN}`;
  await fillPublish(page, { title, ticket: 'inc0012345', details: 'SSO logins fail with a certificate error; rotation in progress.', services: 'sso-gateway' });
  await shot(page, 'Outage screens', 'The optional ServiceNow incident field, typed in lower case on purpose.');
  const res = await clickPublish(page); const created = await res.json();
  transcript('The service', 'Stored upper-cased, with the deep link when `communication.servicenow.instance-url` is configured; the number became the externalRef.', `POST /v1/communications → ${res.status()}\n${pretty(created)}`);
  await page.getByRole('heading', { name: /published/ }).waitFor();
  await shot(page, 'Outage screens', 'The confirmation shows the ticket chip.');
  await page.getByRole('button', { name: 'View in feed' }).click(); await card(page, title).waitFor();
  await shot(page, 'Dependent systems', 'Consumers see the chip on the card; it opens the incident when linked.');
  await ctx.close();
  await call('POST', `/v1/communications/${created.id}/retire`, { body: { actor: 'sam-oncall', note: 'walkthrough' } });
}

async function jSidecar(browser) {
  journey('sidecar-outage', 'The sidecar notices the team\'s app is down', 'A pod starts with the sidecar beside the app; the app\'s database fails; the service opens an outage with the detail and closes it when the app recovers. Settings here are shortened (probe every 5 s) so the walkthrough fits in minutes.');
  podUp('jr', { hostPortApp: 18180, hostPortStatus: 18181, podName: 'orders-api-6c9f7d8b4-ab12c', startApp: false });
  await sleep(3500);
  transcript('Health sidecar', 'The sidecar started before the app (as a native sidecar does): no target yet, reports UNKNOWN during the startup grace.', pretty(await status(18181)), 'json');
  sh('docker', ['run', '-d', '--name', 'jr-app', '--network', 'container:jr-netns', APP_IMAGE]);
  await until(async () => (await status(18181)).upSeen === true, 60000, 1000);
  transcript('Health sidecar', 'The app is up: discovered on :8080 /actuator/health, UP reported.', pretty(await status(18181)), 'json');
  const mons = await until(async () => { const r = await call('GET', `/v1/health/monitors?tenantId=${TENANT}`); return (r.json || []).find((m) => m.service === 'orders-api') ? r : null; }, 30000, 1000);
  transcript('Health desk', 'The first report registered the service automatically (push-only monitor, publisher health-sidecar).', mons.lines);
  const mon = mons.json.find((m) => m.service === 'orders-api');
  transcript('Health desk', 'Every pod that reported, with its node, cluster and version.', (await call('GET', `/v1/health/monitors/${mon.id}/instances`)).lines);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  await openFeed(page);
  const since = new Date().toISOString();
  await setApp(18180, 'DOWN', 'DOWN');
  transcript('The team\'s app', 'The app\'s database fails; its health page now answers 503 with the failing component.', sh('curl', ['-s', '-i', 'http://127.0.0.1:18180/actuator/health']), 'http');
  await card(page, 'orders-api').waitFor({ timeout: 90000 });
  await shot(page, 'Dependent systems', 'The outage opened by itself: "orders-api is down", publisher health-sidecar, the failing component named.');
  transcript('Health sidecar', 'The sidecar\'s log for the episode: the DOWN transition at INFO, a report after every probe while down.', sidecarLog('jr-sidecar', since), 'log');
  transcript('Health desk', 'The monitor now holds the open notice and the streak.', (await call('GET', `/v1/health/monitors/${mon.id}`)).lines);
  // operator retire
  const open = (await call('GET', `/v1/health/monitors/${mon.id}`)).json;
  const noticeId = open.state && open.state.openCommunicationId;
  if (noticeId) {
    journey('operator-retire', 'Alex resolves an automatic outage by hand', 'Alex retires the automatic outage while the app is still failing; the service respects it, keeps counting and reopens a new outage when the failures continue.');
    const ret = await call('POST', `/v1/communications/${noticeId}/retire`, { body: { actor: 'alex', note: 'read replica only, customers unaffected' }, clientId: 'alex-cli' });
    transcript('Service operator (Alex)', 'Retiring the automatic notice with a note.', ret.lines);
    await card(page, 'orders-api').waitFor({ state: 'detached', timeout: 15000 });
    await shot(page, 'Dependent systems', 'The outage left the feed.');
    await card(page, 'orders-api').waitFor({ timeout: 90000 });
    await shot(page, 'Dependent systems', 'The app kept failing, so after the threshold a new outage opened (a new card, the old one stays retired).');
    transcript('Health desk', 'The monitor: a fresh notice id, streak counted again from the observation that noticed the retire.', (await call('GET', `/v1/health/monitors/${mon.id}`)).lines);
    current = manifest.journeys.find((j) => j.id === 'sidecar-outage');
  }
  await setApp(18180, 'UP', 'UP');
  await card(page, 'orders-api').waitFor({ state: 'detached', timeout: 90000 });
  await shot(page, 'Dependent systems', 'The database is back: after two healthy reports the service closed the outage by itself.');
  transcript('Health desk', 'Monitor back to UP, nothing open.', (await call('GET', `/v1/health/monitors/${mon.id}`)).lines);
  // crash
  journey('sidecar-crash', 'The app crashes, or the pod disappears', 'The app process stops listening; the sidecar says so at once and an outage opens; a clean pod shutdown sends a leaving report instead.');
  const since2 = new Date().toISOString();
  sh('docker', ['stop', 'jr-app']);
  await until(async () => (await status(18181)).lastReport?.status === 'DOWN', 30000, 1000);
  transcript('Health sidecar', 'The app process is gone: "app is not listening (last target …)" from the first failed probe; `lastTarget` keeps where it was.', pretty(await status(18181)), 'json');
  await card(page, 'orders-api').waitFor({ timeout: 90000 });
  await shot(page, 'Dependent systems', 'The outage for a crashed app, with the reason.');
  sh('docker', ['start', 'jr-app']);
  await card(page, 'orders-api').waitFor({ state: 'detached', timeout: 90000 });
  await shot(page, 'Dependent systems', 'The app is back (rediscovered on the same port) and the outage closed.');
  transcript('Health sidecar', 'The sidecar log across crash and recovery.', sidecarLog('jr-sidecar', since2), 'log');
  // rollout: a second pod
  journey('rollout', 'Several pods and a rolling deploy', 'A second pod of the same service joins; one unhealthy pod of two keeps the service healthy (50 % threshold); both unhealthy opens the outage; a pod that leaves cleanly is dropped from the count at once.');
  podUp('jr2', { hostPortApp: 18190, hostPortStatus: 18191, podName: 'orders-api-6c9f7d8b4-zz9yk' });
  await until(async () => (await status(18191)).upSeen === true, 60000, 1000);
  await sleep(3000);
  transcript('Health desk', 'Two pods under one monitor.', (await call('GET', `/v1/health/monitors/${mon.id}/instances`)).lines);
  await setApp(18190, 'DOWN', 'DOWN');
  await sleep(25000);
  transcript('Health desk', 'One of two pods DOWN for 25 s: the rollup stays UP (1 of 2 = 50 %), no notice.', (await call('GET', `/v1/health/monitors/${mon.id}`)).lines);
  await shot(page, 'Dependent systems', 'Nothing on the feed with one pod down.');
  await setApp(18180, 'DOWN', 'DOWN');
  await card(page, 'orders-api').waitFor({ timeout: 90000 });
  await shot(page, 'Dependent systems', 'Both pods down: the outage opens and names the pods.');
  await setApp(18180, 'UP', 'UP'); await setApp(18190, 'UP', 'UP');
  await card(page, 'orders-api').waitFor({ state: 'detached', timeout: 90000 });
  const since3 = new Date().toISOString();
  sh('docker', ['stop', 'jr2-sidecar']);
  await sleep(2000);
  transcript('Health sidecar', 'SIGTERM to the second pod\'s sidecar: one last report with `leaving: true`.', sidecarLog('jr2-sidecar', since3), 'log');
  transcript('Health desk', 'The pod is marked left at once; it no longer counts.', (await call('GET', `/v1/health/monitors/${mon.id}/instances`)).lines);
  podDown('jr2');
  await ctx.close();
  // onboarding transcripts
  journey('onboard', 'A team attaches the sidecar to its app', 'What the team adds to its manifests, and what it reads when the service does not show up.');
  transcript('Publisher team (Priya)', 'The Kustomize example rendered: the component adds the container and nothing else changes in the Deployment.', sh('bash', ['-c', `cd '${path.join(REPO, 'sidecar', 'deploy', 'kustomize', 'example')}' && kustomize build . | head -120`]), 'yaml');
  transcript('Health sidecar', '"My service does not show up": the sidecar\'s own status page answers first.', pretty(await status(18181)), 'json');
  transcript('Health desk', 'On the service side: the monitor for the tenant, then its pods.', (await call('GET', `/v1/health/monitors?tenantId=${TENANT}`)).lines);
}

async function jPullMonitor(browser) {
  journey('pull-monitor', 'The service probes an app itself', 'Alex registers an app\'s health page; the service probes it, opens a health notice when it degrades, turns it into an outage when it is down, and closes it on recovery.');
  sh('docker', ['stop', 'jr-sidecar']); await sleep(1500);
  const reg = await call('POST', '/v1/health/monitors', { body: { tenantId: TENANT, service: 'legacy-api', url: 'http://127.0.0.1:18180/actuator/health', intervalSeconds: 5, timeoutMs: 2000 }, clientId: 'alex-cli' });
  transcript('Service operator (Alex)', 'Registering the health page (short interval for the walkthrough).', reg.lines);
  const id = reg.json?.id;
  transcript('Health desk', 'A probe on demand.', (await call('POST', `/v1/health/monitors/${id}/probe`, { clientId: 'alex-cli' })).lines);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  await openFeed(page);
  await setApp(18180, 'DEGRADED', 'UP');
  await card(page, 'legacy-api').waitFor({ timeout: 90000 });
  await shot(page, 'Dependent systems', 'Degraded twice in a row: a HEALTH notice (minor), not an outage.');
  await setApp(18180, 'DOWN', 'DOWN');
  await until(async () => { const r = await call('GET', `/v1/health/monitors/${id}`); return r.json?.state?.lastStatus === 'DOWN' && r.json?.state?.openStatus === 'DOWN' ? r : null; }, 90000, 2000);
  await sleep(3000);
  await shot(page, 'Dependent systems', 'Down twice: the health notice was retired ("reclassified as DOWN") and an outage (major) took its place.');
  transcript('Health desk', 'The monitor during the outage.', (await call('GET', `/v1/health/monitors/${id}`)).lines);
  await setApp(18180, 'UP', 'UP');
  await card(page, 'legacy-api').waitFor({ state: 'detached', timeout: 90000 });
  await shot(page, 'Dependent systems', 'Healthy twice: closed by itself.');
  await ctx.close();
  await call('DELETE', `/v1/health/monitors/${id}`, { clientId: 'alex-cli' });
  sh('docker', ['start', 'jr-sidecar']);
}

async function jRestart(browser) {
  journey('restart', 'The service restarts while screens are open', 'The service is stopped and started again while a feed is open: the badge says Reconnecting, the cards stay, a notice published meanwhile arrives through replay, and the badge is Live again without a reload.');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  const reqs = [];
  page.on('request', (r) => { if (/feed\/stream/.test(r.url())) reqs.push(`${new Date().toISOString().slice(11, 23)} ${r.url().replace(UI, '')}`); });
  await openFeed(page);
  const seedTitle = `Before the restart ${RUN}`;
  const seed = await call('POST', '/v1/communications', { body: { tenantId: TENANT, publisher: 'sam-oncall', type: 'OUTAGE', severity: 'MAJOR', title: seedTitle, affectedServices: ['orders-api'] } });
  await card(page, seedTitle).waitFor();
  await shot(page, 'Outage screens', 'Before: the feed is Live with one card.');
  const restart = process.env.JR_RESTART_BACKEND; // any value runs the restart; JR_STOP_BACKEND and JR_START_BACKEND do it
  if (!restart) { note('The service', 'JR_RESTART_BACKEND not set: restart skipped.'); await ctx.close(); return; }
  const stop = process.env.JR_STOP_BACKEND, start = process.env.JR_START_BACKEND;
  sh('bash', ['-c', stop]);
  await page.getByText(/Reconnecting/).waitFor({ timeout: 20000 });
  await shot(page, 'Outage screens', 'The service is down: the badge says Reconnecting (n) and the card stays on screen.');
  sh('bash', ['-c', start]);
  await until(async () => (await call('GET', '/actuator/health/readiness', { clientId: null })).status === 200, 90000, 1000);
  const duringTitle = `Published while the screen was reconnecting ${RUN}`;
  const during = await call('POST', '/v1/communications', { body: { tenantId: TENANT, publisher: 'deploy-tool', type: 'INCIDENT', severity: 'MINOR', title: duringTitle, affectedServices: ['checkout-web'] }, clientId: 'deploy-tool' });
  await card(page, duringTitle).waitFor({ timeout: 30000 });
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 30000 });
  await shot(page, 'Outage screens', 'Back: the new notice arrived (replayed from the log) and the badge is Live again; nothing was reloaded.');
  transcript('Outage screens', 'The stream requests the screen made: the first open, then reopen attempts carrying lastEventId.', reqs.join('\n'), 'log');
  await ctx.close();
  for (const id of [seed.json.id, during.json.id]) await call('POST', `/v1/communications/${id}/retire`, { body: { actor: 'sam-oncall', note: 'walkthrough' } });
}

async function jMongoDown(browser) {
  journey('mongo-down', 'The record book is unreachable', 'The database goes away twice. Stopped (connections refused): the API answers 503 "database unavailable" within seconds, a feed opened meanwhile says Service degraded, readiness turns 503 while liveness stays 200, and everything resumes by itself. Frozen (connections hang): the open gap GAP-backend4-1, shown as it happens.');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  await openFeed(page);
  const t0 = new Date().toISOString();
  sh('docker', ['stop', MONGO]);
  note('The record book', `The database container is stopped (${MONGO}): connections are refused.`);
  const t = await call('GET', `/v1/feed?tenantId=${TENANT}`);
  transcript('The service', `A request while the database refuses connections: ${t.status} after ${t.ms} ms, with a plain message.`, t.lines);
  const ready = await call('GET', '/actuator/health/readiness', { clientId: null });
  const live = await call('GET', '/actuator/health/liveness', { clientId: null });
  transcript('The cluster', `Readiness says not ready in ${ready.ms} ms (take the pod out of traffic); liveness says alive (do not restart it).`, ready.lines + '\n\n' + live.lines);
  await fillPublish(page, { title: 'Will not get through', publisher: 'sam-oncall' });
  await clickPublish(page).catch(() => {});
  await page.getByRole('alert').waitFor({ timeout: 30000 });
  await shot(page, 'Outage screens', 'Publishing now: the banner says the service cannot reach its database and recovers on its own; it took focus.');
  const page2 = await ctx.newPage();
  await page2.goto(UI + '/#/feed');
  await page2.getByRole('textbox', { name: 'Tenant', exact: true }).fill(TENANT);
  await page2.getByText('Service degraded', { exact: true }).waitFor({ timeout: 45000 }).catch(() => {});
  await shot(page2, 'Outage screens', 'A feed opened during the outage: the badge says Service degraded (not Live) and the load error is announced as an alert.');
  const logLines = sh('bash', ['-c', `grep -E "database unavailable|readiness DOWN|event log" ${process.env.JR_BACKEND_LOG || '/dev/null'} | tail -5`]);
  if (logLines) transcript('Service operator (Alex)', 'The log: one WARN line per failed request, per skipped sweep and for the readiness change; no stack traces.', logLines, 'log');
  sh('docker', ['start', MONGO]);
  const back = await until(async () => { const r = await call('GET', '/actuator/health/readiness', { clientId: null }); return r.status === 200 ? r : null; }, 90000, 1000);
  transcript('The service', 'The database is back: ready again, nothing restarted.', back.lines);
  await page2.getByRole('button', { name: 'Try again' }).first().click().catch(() => {});
  await page2.getByText('Live', { exact: true }).waitFor({ timeout: 45000 }).catch(() => {});
  await shot(page2, 'Outage screens', 'After Try again the list loads and the badge goes back to Live.');
  // the frozen database: what GAP-backend4-1 looks like
  sh('docker', ['pause', MONGO]);
  note('The record book', 'Now the database is frozen instead (docker pause): connections open but nothing answers.');
  const calls = await Promise.all([0, 1, 2].map(() => call('GET', `/v1/feed?tenantId=${TENANT}`)));
  await sleep(6000);
  const later = await Promise.all([0, 1, 2].map(() => call('GET', `/v1/feed?tenantId=${TENANT}`)));
  const codes = [...calls, ...later].map((c) => `${c.status} after ${c.ms} ms`).join(', ');
  const worst = [...calls, ...later].find((c) => c.status === 500) || later[later.length - 1];
  transcript('The service', `Six requests while the database hangs: ${codes}. A 500 here is the open gap GAP-backend4-1: the driver pauses its connection pool and the error handler does not recognise that error, so the answer carries the driver's message, database address included.`, worst.lines);
  const sweepLines = sh('bash', ['-c', `awk -v t="${t0.slice(0, 19)}" '$0 >= t' ${process.env.JR_BACKEND_LOG || '/dev/null'} | grep -E "ERROR|pool|paused" | tail -4`]);
  if (sweepLines) transcript('Service operator (Alex)', 'The log during the freeze.', sweepLines, 'log');
  sh('docker', ['unpause', MONGO]);
  const back2 = await until(async () => { const r = await call('GET', '/actuator/health/readiness', { clientId: null }); return r.status === 200 ? r : null; }, 90000, 1000);
  transcript('The service', 'Unfrozen: ready again by itself.', back2.lines);
  await ctx.close();
}

async function jValve() {
  journey('valve', 'Many sidecars fall silent at once', 'Four services report once and then go silent together (a network cut): after the staleness window the service pauses the "no news is bad news" rule instead of declaring four outages, and says so in its log.');
  const ids = [];
  for (const svc of ['inventory-api', 'pricing-api', 'shipping-api', 'returns-api']) {
    const r = await call('POST', '/v1/health/reports', { body: { tenantId: `${TENANT}-valve`, service: svc, status: 'UP', observedAt: new Date().toISOString(), publisher: 'health-sidecar', instance: { id: `${svc}-0`, namespace: 'retail' } }, clientId: svc });
    if (r.json?.id) ids.push(r.json.id);
  }
  const mons = await call('GET', `/v1/health/monitors?tenantId=${TENANT}-valve`);
  transcript('Health desk', 'Four push-only monitors, each with one pod, all UP.', mons.lines);
  note('Health desk', 'Waiting 100 seconds without any report (the staleness window is 90 s)…');
  await sleep(100000);
  const after = await call('GET', `/v1/health/monitors?tenantId=${TENANT}-valve`);
  const downs = (after.json || []).filter((m) => m.state && m.state.lastStatus === 'DOWN').length;
  transcript('Health desk', downs === 0
    ? 'After the window: all four are silent, and none was declared DOWN. More than 30 % of the monitors that can go stale fell silent together, so the rule paused.'
    : `After the window: ${downs} of 4 were declared DOWN. The valve pauses only when more than 30 % of all stale-capable monitors are silent at once; this shared stack holds other monitors, so the share stayed below it.`, after.lines);
  const logLines = sh('bash', ['-c', `grep -i -E "stale|silent|pause" ${process.env.JR_BACKEND_LOG || '/dev/null'} | tail -3`]);
  if (logLines) transcript('Service operator (Alex)', 'The log line that explains the pause.', logLines, 'log');
  for (const m of (after.json || [])) await call('DELETE', `/v1/health/monitors/${m.id}`);
}

async function jAdmin() {
  journey('admin', 'Alex tidies up across tenants', 'Tenants and their counts, a search across tenants, retiring a notice on someone\'s behalf, and deleting one for good.');
  const left = await call('POST', '/v1/communications', { body: { tenantId: TENANT, publisher: 'demo-user', type: 'OUTAGE', severity: 'MINOR', title: `test please ignore ${RUN}`, affectedServices: ['demo'] }, clientId: 'demo' });
  transcript('Service operator (Alex)', 'Which tenants exist and how much each has published.', (await call('GET', '/v1/admin/tenants', { clientId: 'alex-cli' })).lines);
  transcript('Service operator (Alex)', 'A search across every tenant, here by publisher (tenant, status, type, publisher and a time range can be combined).', (await call('GET', '/v1/admin/communications?publisher=demo-user&status=ACTIVE', { clientId: 'alex-cli' })).lines);
  transcript('Service operator (Alex)', 'Retiring it on the publisher\'s behalf, with Alex as the actor.', (await call('POST', `/v1/admin/communications/${left.json.id}/retire`, { body: { actor: 'alex', note: 'left over from a demo' }, clientId: 'alex-cli' })).lines);
  transcript('Service operator (Alex)', 'Deleting it for good; the permalink answers 404 afterwards.', (await call('DELETE', `/v1/admin/communications/${left.json.id}`, { clientId: 'alex-cli' })).lines + '\n\n' + (await call('GET', `/v1/communications/${left.json.id}`)).lines);
}

(async () => {
  fs.mkdirSync(IMG, { recursive: true });
  const browser = await chromium.launch();
  for (const t of [TENANT, TENANT + '-valve']) await cleanTenant(t);
  const order = [jPublish, jMaintenance, jApiPublish, jConsume, jIdentity, jTicket, jSidecar, jPullMonitor, jRestart, jMongoDown, jValve, jAdmin];
  const only = process.env.JR_ONLY ? process.env.JR_ONLY.split(',') : null;
  for (const fn of order) {
    if (only && !only.includes(fn.name)) continue;
    try { await fn(browser); } catch (e) { console.error(fn.name, 'failed:', e.message); if (current) current.steps.push({ who: 'walkthrough', text: 'This journey stopped early: ' + e.message, error: true }); }
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  podDown('jr'); podDown('jr2');
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('journeys:', manifest.journeys.map((j) => `${j.id}:${j.steps.length}`).join(' '));
})();
