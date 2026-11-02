// E2E Integration Verifier: UI flows on the private stack (Vite :3501 -> backend A :19501).
// Usage: node ui_flows.js ; prints "<F-id> PASS|FAIL <check> :: detail" lines; screenshots in ./shots.
const { chromium } = require('playwright');
const UI = 'http://127.0.0.1:3501';
const API = 'http://127.0.0.1:19501';
const CID = 'e2e1-verifier';
const RUN = Math.random().toString(16).slice(2, 8);
const results = [];
const check = (fid, name, ok, detail = '') => { results.push([fid, name, !!ok, String(detail)]); console.log(`${fid} ${ok ? 'PASS' : 'FAIL'} ${name} :: ${String(detail).slice(0, 400)}`); return !!ok; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { 'X-Client-Id': CID, 'Accept': 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { }
  return { status: res.status, body: json };
}
async function waitFor(fn, timeout = 10000, every = 150) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(every); }
  return last;
}
function track(page, label) {
  const console_errors = [], failed = [], requests = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console_errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', e => console_errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('request', r => { if (r.url().includes('/v1/')) requests.push({ method: r.method(), url: r.url().replace(UI, ''), clientId: r.headers()['x-client-id'] }); });
  return { label, console_errors, failed, requests };
}
async function openApp(ctx, tenant, hash) {
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem('comm-tenant', t); } catch { } }, tenant);
  const tr = track(page);
  await page.goto(`${UI}/${hash || '#/feed'}`, { waitUntil: 'networkidle' });
  return { page, tr };
}

(async () => {
  const browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const tenant = `e2e1-ui-${RUN}`;
  try {
    // ---------- F-90 / F-56 / F-64: publish in the UI with ticket + services, watched live from a second browser context
    const { page: watcher, tr: trW } = await openApp(ctxB, tenant, '#/feed');
    const tLoad = Date.now();
    const liveAtLoad = await waitFor(async () => watcher.getByText('Live', { exact: true }).isVisible().catch(() => false), 5000, 50);
    const liveAfter = Date.now() - tLoad;
    check('F-60', 'watcher: indicator reaches Live within 2 s on an empty tenant (G-1-4, ":connected")', liveAtLoad && liveAfter < 2000, `live=${liveAtLoad} ${liveAfter} ms after the page settled`);
    const allClear = await watcher.getByText('All clear').isVisible().catch(() => false);
    check('F-59', 'watcher: empty tenant shows the "All clear" empty state', allClear);
    await watcher.screenshot({ path: 'shots/f90-watcher-empty.png' });

    const { page: pub, tr: trP } = await openApp(ctxA, tenant, '#/publish');
    await pub.getByLabel(/^Title\*?$/).fill(`UI outage ${RUN}`);
    await pub.getByLabel('Details').fill('Card payments fail for 30% of requests.');
    await pub.getByLabel('Affected services').fill('payments-api, checkout-web');
    await pub.getByLabel('ServiceNow incident').fill('inc0012345');
    await pub.getByLabel(/^Publisher\*?$/).fill('e2e-oncall');
    const tenantField = await pub.getByLabel(/^Tenant\*$/).inputValue().catch(() => null);
    check('F-52', 'publish form picks up the header tenant', tenantField === tenant, `form tenant=${tenantField}`);
    await pub.screenshot({ path: 'shots/f90-publish-filled.png', fullPage: true });
    const t0 = Date.now();
    const [resp] = await Promise.all([
      pub.waitForResponse(r => r.url().includes('/v1/communications') && r.request().method() === 'POST', { timeout: 10000 }),
      pub.getByRole('button', { name: /^Publish outage$/ }).click(),
    ]);
    const created = await resp.json().catch(() => ({}));
    check('F-56', 'UI POST /v1/communications -> 201 with X-Client-Id communication-frontend', resp.status() === 201 && resp.request().headers()['x-client-id'] === 'communication-frontend', `status=${resp.status()} x-client-id=${resp.request().headers()['x-client-id']} id=${created.id}`);
    check('F-09', 'ticket typed lower-case is stored upper-cased and becomes externalRef', created.ticket?.number === 'INC0012345' && created.externalRef === 'INC0012345', JSON.stringify(created.ticket) + ' ref=' + created.externalRef);
    const doneCard = await pub.getByText('Outage published').isVisible({ timeout: 5000 }).catch(() => false);
    const idTag = await pub.getByText(created.id || '∅').isVisible().catch(() => false);
    const chip = await pub.getByText('INC0012345').isVisible().catch(() => false);
    check('F-56', 'confirmation card: "Outage published", id tag, ticket chip, Publish another + View in feed', doneCard && idTag && chip && await pub.getByRole('button', { name: 'Publish another' }).isVisible() && await pub.getByRole('button', { name: 'View in feed' }).isVisible(), `done=${doneCard} id=${idTag} chip=${chip}`);
    await pub.screenshot({ path: 'shots/f90-publish-done.png' });
    const stored = await pub.evaluate(() => localStorage.getItem('comm-publisher'));
    check('F-56', 'publisher remembered in localStorage comm-publisher', stored === 'e2e-oncall', stored);

    // watcher receives it live (no reload)
    const cardSeen = await waitFor(async () => watcher.getByRole('heading', { name: `UI outage ${RUN}` }).isVisible().catch(() => false), 8000);
    const dt = Date.now() - t0;
    check('F-90', 'second browser context sees the new card live without refresh', cardSeen, `after ${dt} ms`);
    const article = watcher.locator('article', { hasText: `UI outage ${RUN}` }).first();
    const chipLink = article.locator('a', { hasText: 'INC0012345' });
    const chipTxt = await article.getByText('INC0012345').isVisible().catch(() => false);
    check('F-09', 'feed card shows the ticket chip (link only when the service knows the ServiceNow instance; unset here)', chipTxt, `chip visible=${chipTxt} isLink=${await chipLink.count() > 0}`);
    const svcTags = await article.getByText('payments-api').isVisible() && await article.getByText('checkout-web').isVisible();
    const state = await article.getByText('Active', { exact: true }).isVisible().catch(() => false);
    check('F-63', 'card shows Active state, severity, services, publisher', svcTags && state && await article.getByText('e2e-oncall').isVisible(), `services=${svcTags} active=${state}`);
    const activeHdr = await watcher.getByRole('heading', { name: /Active now/ }).textContent().catch(() => '');
    check('F-58', '"Active now" section with count 1', /Active now\s*1/.test((activeHdr || '').replace(/\s+/g, ' ')), activeHdr);
    const tabBadge = await watcher.getByRole('tab', { name: /Feed/ }).textContent().catch(() => '');
    check('F-52', 'Feed tab badge shows the active count', /1/.test(tabBadge || ''), tabBadge);
    await watcher.screenshot({ path: 'shots/f90-watcher-live.png' });
    // consumer API with service filter sees it
    const feed = await api('GET', `/v1/feed?tenantId=${tenant}&service=checkout-web`);
    check('F-90', 'GET /v1/feed?service=checkout-web lists it for a consumer', feed.status === 200 && feed.body.items.some(i => i.id === created.id), `status=${feed.status} n=${feed.body?.items?.length}`);

    // View in feed switches tab
    await pub.getByRole('button', { name: 'View in feed' }).click();
    await pub.waitForURL(/#\/feed/);
    const inOwnFeed = await waitFor(async () => pub.getByRole('heading', { name: `UI outage ${RUN}` }).isVisible().catch(() => false), 5000);
    check('F-56', '"View in feed" switches to the feed tab showing the item', inOwnFeed, pub.url());

    // ---------- F-62: resolve from the watcher's feed with a note
    await article.getByRole('button', { name: 'Resolve' }).click();
    const confirmTxt = await article.getByText(/Resolving retires it/).isVisible();
    await article.getByPlaceholder('Resolution note (optional)').fill('fixed by e2e');
    const [retireResp] = await Promise.all([
      watcher.waitForResponse(r => r.url().includes('/retire') && r.request().method() === 'POST', { timeout: 10000 }),
      article.getByRole('button', { name: 'Resolve' }).last().click(),
    ]);
    let retireBody = null; try { retireBody = retireResp.request().postDataJSON(); } catch {}
    check('F-62', 'Resolve -> inline confirm, POST /retire 200 with the note (actor = publisher when known)', confirmTxt && retireResp.status() === 200 && retireBody?.note === 'fixed by e2e', `status=${retireResp.status()} body=${JSON.stringify(retireBody)}`);
    const goneW = await waitFor(async () => !(await watcher.getByRole('heading', { name: `UI outage ${RUN}` }).isVisible().catch(() => false)), 5000);
    const goneP = await waitFor(async () => !(await pub.getByRole('heading', { name: `UI outage ${RUN}` }).isVisible().catch(() => false)), 8000);
    check('F-90', 'card disappears in both contexts (local removal + retired event)', goneW && goneP, `watcher=${goneW} publisher-tab=${goneP}`);
    const perm = await api('GET', `/v1/feed/${created.id}`);
    const full = await api('GET', `/v1/communications/${created.id}`);
    const lastHist = full.body?.history?.slice(-1)[0];
    check('F-90', 'permalink 200 RETIRED; history has the resolution note', perm.status === 200 && perm.body.status === 'RETIRED' && /fixed by e2e/.test(lastHist?.action || ''), `${perm.status}/${perm.body?.status} last=${JSON.stringify(lastHist)}`);
    check('F-62', 'resolver identity: actor recorded', !!lastHist?.actor, `actor=${lastHist?.actor}`);
    const announced = await watcher.getByRole('status').first().textContent().catch(() => '');
    check('F-62', 'resolution announced in a role=status live region (G-1-15)', /resolved|retired|withdrawn/i.test(announced || ''), `status="${(announced || '').slice(0, 120)}"`);
    await watcher.screenshot({ path: 'shots/f90-watcher-after-resolve.png' });

    // ---------- F-60: live created/updated/retired + Live switch
    const c2 = await api('POST', '/v1/communications', { tenantId: tenant, publisher: 'curl', type: 'OUTAGE', severity: 'CRITICAL', title: `curl outage ${RUN}`, affectedServices: ['db'] });
    const seen2 = await waitFor(async () => watcher.getByRole('heading', { name: `curl outage ${RUN}` }).isVisible().catch(() => false), 6000);
    check('F-60', 'curl-published outage appears live', seen2, `id=${c2.body?.id}`);
    const upd = await api('PUT', `/v1/communications/${c2.body.id}`, { expectedVersion: c2.body.version, title: `curl outage ${RUN} edited` });
    const seenEdit = await waitFor(async () => watcher.getByRole('heading', { name: `curl outage ${RUN} edited` }).isVisible().catch(() => false), 6000);
    check('F-60', 'PUT title change arrives as updated frame and the card text changes', upd.status === 200 && seenEdit, `put=${upd.status}`);
    // Live switch off -> Paused, no updates
    await watcher.getByRole('switch', { name: 'Live updates' }).click().catch(async () => watcher.getByText('Live updates').click());
    const paused = await waitFor(async () => (await watcher.getByText('Paused', { exact: true }).isVisible().catch(() => false)), 3000);
    const c3 = await api('POST', '/v1/communications', { tenantId: tenant, publisher: 'curl', type: 'OUTAGE', severity: 'MAJOR', title: `while paused ${RUN}` });
    await sleep(2500);
    const notShown = !(await watcher.getByRole('heading', { name: `while paused ${RUN}` }).isVisible().catch(() => false));
    check('F-60', 'Live switch off -> indicator Paused and no live updates', paused && notShown, `paused=${paused} hidden=${notShown}`);
    await watcher.getByRole('switch', { name: 'Live updates' }).click().catch(async () => watcher.getByText('Live updates').click());
    const liveAgain = await waitFor(async () => (await watcher.getByText('Live', { exact: true }).isVisible().catch(() => false)), 20000);
    const shownNow = await waitFor(async () => watcher.getByRole('heading', { name: `while paused ${RUN}` }).isVisible().catch(() => false), 20000);
    check('F-60', 'Live switch on -> Live again and the missed item arrives via snapshot', liveAgain && shownNow, `live=${liveAgain} shown=${shownNow}`);
    await api('POST', `/v1/communications/${c3.body.id}/retire`, { note: 'x' });
    const gone3 = await waitFor(async () => !(await watcher.getByRole('heading', { name: `while paused ${RUN}` }).isVisible().catch(() => false)), 6000);
    check('F-60', 'curl retire removes the card live', gone3);

    // ---------- F-58: filters drive the query string; type default Outage; All types; min severity
    const reqsBefore = trW.requests.length;
    await watcher.getByRole('combobox', { name: 'Type' }).selectOption('').catch(async () => watcher.getByLabel('Type').selectOption(''));
    await sleep(800);
    const m1 = await api('POST', '/v1/communications', { tenantId: tenant, publisher: 'curl', type: 'MAINTENANCE', severity: 'INFO', title: `maint tomorrow ${RUN}`, startsAt: new Date(Date.now() + 86400e3).toISOString(), endsAt: new Date(Date.now() + 90000e3).toISOString() });
    const upcomingSeen = await waitFor(async () => watcher.getByRole('heading', { name: `maint tomorrow ${RUN}` }).isVisible().catch(() => false), 6000);
    const upHdr = await watcher.getByRole('heading', { name: /Upcoming/ }).textContent().catch(() => '');
    const startsIn = await watcher.locator('article', { hasText: `maint tomorrow ${RUN}` }).getByText(/^Starts in/).first().isVisible().catch(() => false);
    check('F-16', 'All types: future MAINTENANCE listed under Upcoming with "Starts in …"', upcomingSeen && /Upcoming/.test(upHdr || '') && startsIn, `hdr=${upHdr} startsIn=${startsIn}`);
    const withdraw = await watcher.locator('article', { hasText: `maint tomorrow ${RUN}` }).getByRole('button', { name: 'Withdraw' }).isVisible().catch(() => false);
    const noResolve = !(await watcher.locator('article', { hasText: `maint tomorrow ${RUN}` }).getByRole('button', { name: 'Resolve' }).isVisible().catch(() => false));
    check('F-16', 'a notice that has not started offers Withdraw instead of Resolve (G-1-16)', withdraw && noResolve, `withdraw=${withdraw} resolveHidden=${noResolve}`);
    await watcher.getByRole('combobox', { name: 'Minimum severity' }).selectOption('CRITICAL').catch(async () => watcher.getByLabel('Minimum severity').selectOption('CRITICAL'));
    await sleep(1000);
    const q = trW.requests.filter(r => r.url.startsWith('/v1/feed?')).slice(-1)[0]?.url || '';
    const onlyCritical = await watcher.getByRole('heading', { name: `curl outage ${RUN} edited` }).isVisible() && !(await watcher.getByRole('heading', { name: `maint tomorrow ${RUN}` }).isVisible().catch(() => false));
    check('F-58', 'Minimum severity CRITICAL -> query carries severity=CRITICAL and only the critical card remains', /severity=CRITICAL/.test(q) && onlyCritical, `last feed GET: ${q}`);
    await watcher.getByPlaceholder('Any service').fill('db');
    await sleep(1000);
    const q2 = trW.requests.filter(r => r.url.startsWith('/v1/feed?')).slice(-1)[0]?.url || '';
    check('F-58', 'Service filter -> service=db in the query', /service=db/.test(q2), q2);
    await watcher.getByPlaceholder('Any service').fill('nothing-here');
    const allClear2 = await waitFor(async () => watcher.getByText('All clear').isVisible().catch(() => false), 5000);
    check('F-59', 'no match -> "All clear" empty state names tenant and service', allClear2 && await watcher.getByText(new RegExp(`for ${tenant} on nothing-here`)).isVisible().catch(() => false));
    await watcher.screenshot({ path: 'shots/f58-filters.png' });
    const feedReqs = trW.requests.filter(r => r.url.startsWith('/v1/feed?'));
    check('F-64', 'every feed GET carried X-Client-Id communication-frontend; stream uses ?clientId=', feedReqs.length > 0 && feedReqs.every(r => r.clientId === 'communication-frontend') && trW.requests.some(r => /\/v1\/feed\/stream\?.*clientId=communication-frontend/.test(r.url)), `feedGETs=${feedReqs.length} streams=${trW.requests.filter(r => r.url.includes('/stream')).length}`);

    // ---------- F-57: server error surfacing (duplicate externalRef) + F-55 client-side validation
    await pub.goto(`${UI}/#/publish`, { waitUntil: 'networkidle' });
    await pub.getByRole('button', { name: /^Publish outage$/ }).click();
    // G-1-12 renders the message twice (error summary + the field's own note), so count instead of a strict single match
    const reqCount = await pub.getByText('Title is required').count();
    const postsBefore = trP.requests.filter(r => r.method === 'POST').length;
    await sleep(300);
    check('F-55', 'empty submit: "Title is required" shown (summary + inline) and nothing sent', reqCount >= 1 && trP.requests.filter(r => r.method === 'POST').length === postsBefore, `matches=${reqCount} POSTs before/after=${postsBefore}/${trP.requests.filter(r => r.method === 'POST').length}`);
    const focused = await pub.evaluate(() => ({ id: document.activeElement?.id || '', tag: document.activeElement?.tagName, invalid: document.activeElement?.getAttribute('aria-invalid'), describedBy: document.activeElement?.getAttribute('aria-describedby') }));
    const summary = await pub.getByRole('alert').first().textContent().catch(() => '');
    check('F-55', 'focus moves to the first invalid field (aria-invalid, aria-describedby) and an error summary alert lists it (G-1-12)', /title/i.test(focused.id) && focused.invalid === 'true' && !!focused.describedBy && /Title/.test(summary || ''), `focus=${JSON.stringify(focused)} summary="${(summary || '').slice(0, 140)}"`);
    await pub.getByLabel(/^Title\*?$/).fill(`dup ${RUN}`);
    await pub.getByLabel(/^Publisher\*?$/).fill('e2e-oncall');
    await pub.getByLabel('External reference').fill('INC0012345');
    const [dupResp] = await Promise.all([
      pub.waitForResponse(r => r.url().includes('/v1/communications') && r.request().method() === 'POST', { timeout: 10000 }),
      pub.getByRole('button', { name: /^Publish outage$/ }).click(),
    ]);
    const alert = await waitFor(async () => (await pub.getByRole('alert').textContent().catch(() => '')) || '', 5000);
    check('F-57', 'reused reference -> 409 explained in a role=alert banner naming the incident and the tenant (G-1-16), form stays editable', dupResp.status() === 409 && /The service rejected this/.test(alert) && /already exists for tenant/.test(alert) && /INC0012345/.test(alert) && new RegExp(tenant).test(alert) && await pub.getByLabel(/^Title\*?$/).isEditable(), `status=${dupResp.status()} alert="${alert.slice(0, 220)}"`);
    await pub.screenshot({ path: 'shots/f57-server-error.png' });
    await pub.getByLabel('ServiceNow incident').fill('ABC');
    await pub.getByRole('button', { name: /^Publish outage$/ }).click();
    const tErr = await pub.getByText(/incident number/i).first().isVisible().catch(() => false);
    check('F-55', 'bad ticket number rejected inline before sending', tErr);
    await pub.getByLabel('ServiceNow incident').fill('');
    await pub.getByLabel('External reference').fill('');
    // Maintenance without end
    await pub.getByRole('radio', { name: 'Maintenance' }).click().catch(async () => pub.getByText('Maintenance', { exact: true }).click());
    await pub.getByRole('button', { name: /^Publish maintenance$/ }).click();
    const endsErr = await waitFor(async () => pub.getByText(/Ends|end/i).locator('xpath=..').getByText(/required|needs|Maintenance/).first().isVisible().catch(() => false), 3000);
    const timingOpen = await pub.getByLabel(/^Ends/).isVisible().catch(() => false);
    check('F-55', 'Maintenance without Ends -> timing section opens with an inline error', timingOpen, `timingOpen=${timingOpen} err=${endsErr}`);
    await pub.screenshot({ path: 'shots/f55-maintenance-ends.png', fullPage: true });

    // ---------- F-02 draft via UI
    await pub.getByRole('radio', { name: 'Outage' }).click().catch(async () => pub.getByText('Outage', { exact: true }).first().click());
    await pub.getByLabel(/^Title\*?$/).fill(`draft ${RUN}`);
    await pub.getByRole('switch', { name: 'Save as draft' }).click().catch(async () => pub.getByText('Save as draft').first().click());
    const [draftResp] = await Promise.all([
      pub.waitForResponse(r => r.url().includes('/v1/communications') && r.request().method() === 'POST', { timeout: 10000 }),
      pub.getByRole('button', { name: /^Save draft$/ }).click(),
    ]);
    const draft = await draftResp.json().catch(() => ({}));
    const draftCard = await pub.getByText('Draft saved').isVisible({ timeout: 5000 }).catch(() => false);
    const noView = !(await pub.getByRole('button', { name: 'View in feed' }).isVisible().catch(() => false));
    await sleep(1500);
    const draftHidden = !(await watcher.getByRole('heading', { name: `draft ${RUN}` }).isVisible().catch(() => false));
    check('F-02', 'Save as draft -> 201 DRAFT, "Draft saved" card without View in feed, invisible in the watcher feed', draftResp.status() === 201 && draft.status === 'DRAFT' && draftCard && noView && draftHidden, `status=${draftResp.status()}/${draft.status} card=${draftCard} noView=${noView} hidden=${draftHidden}`);

    // ---------- console errors
    // Chromium itself logs "Failed to load resource: ... status of 409" for the deliberate 409 above, and reports
    // net::ERR_ABORTED when the page closes its own EventSource on a filter change; neither is an application error.
    const benign = (m) => /status of 409/.test(m) || /net::ERR_ABORTED/.test(m);
    const unexpectedP = trP.console_errors.filter(m => !benign(m)), unexpectedW = trW.console_errors.filter(m => !benign(m));
    check('F-65', 'no unexpected console / page errors in the publisher context (the deliberate 409 line excluded)', unexpectedP.length === 0, `unexpected=${unexpectedP.slice(0, 5).join(' | ')} all=${trP.console_errors.length}`);
    check('F-65', 'no unexpected console / page errors in the watcher context', unexpectedW.length === 0, `unexpected=${unexpectedW.slice(0, 5).join(' | ')} all=${trW.console_errors.length}`);
    const failedReal = [...trP.failed, ...trW.failed].filter(f => !(/feed\/stream/.test(f) && /ERR_ABORTED/.test(f)));
    check('F-64', 'no failed network requests (streams the page closed itself excluded)', failedReal.length === 0, `${failedReal.slice(0, 5).join(' | ')} (aborted streams: ${[...trP.failed, ...trW.failed].length - failedReal.length})`);
  } catch (e) {
    check('ERR', 'ui_flows exception', false, e.stack?.slice(0, 600));
  } finally {
    await browser.close();
  }
  const fails = results.filter(r => !r[2]);
  console.log(`\nSUMMARY: ${results.length} checks, ${results.length - fails.length} pass, ${fails.length} fail`);
  fails.forEach(f => console.log('  FAIL', f[0], f[1], '::', f[3].slice(0, 300)));
  process.exit(Math.min(fails.length, 100));
})();
