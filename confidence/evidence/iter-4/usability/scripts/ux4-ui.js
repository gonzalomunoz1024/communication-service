// ux4-ui.js — SRE walk on the shared stack, iteration 4 (1280x800 + iPhone 14 at 390 px, keyboard, a11y tree, live regions, axe)
const { chromium, devices } = require('playwright'); const fs = require('fs'); const path = require('path');
const C = require('./common'); const { L, rec: _r } = C;
const BASE = process.env.UI_BASE || 'http://127.0.0.1:3000'; const API = process.env.API_BASE || 'http://localhost:8080';
const T = process.env.UX_TENANT || 'ux4-sre'; const { rec, save } = C.recorder('ux4-ui-log'); const api = C.apiClient(API);
const consoleIssues = [];
function wire(page, tag) { page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleIssues.push({ tag, type: m.type(), text: m.text().slice(0, 200) }); }); page.on('pageerror', (e) => consoleIssues.push({ tag, type: 'pageerror', text: String(e).slice(0, 200) })); }
async function fillOutage(page, { title, body = 'Card payments fail for roughly 30% of requests. Retries succeed.', services = 'payments-api, checkout-web', ticket = '', publisher = 'ux4-oncall', extRef = '' }) {
  await L.title(page).fill(title); await L.details(page).fill(body); await L.services(page).fill(services);
  await L.ticket(page).fill(ticket); if (publisher) await L.publisher(page).fill(publisher); await L.extRef(page).fill(extRef);
}
async function step(name, fn) { try { await fn(); } catch (e) { rec(`${name}:ERROR`, { error: String(e).slice(0, 400) }); } }
async function badgeTimeline(page, ms, every = 250) { const tl = []; let last; const t0 = Date.now(); while (Date.now() - t0 < ms) { const b = await C.badgeText(page); if (b !== last) { tl.push(`${((Date.now() - t0) / 1000).toFixed(2)}s ${b}`); last = b; } await page.waitForTimeout(every); } return tl; }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  await ctx.addInitScript(C.LIVE);
  const page = await ctx.newPage(); wire(page, 'desktop');
  const feedReqs = []; page.on('request', (r) => { if (r.url().includes('/v1/feed')) feedReqs.push({ at: Date.now(), u: r.url().replace(/^.*\/v1/, '/v1') }); });

  await step('landing', async () => {
    await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForLoadState('networkidle');
    rec('landing', { title: await page.title(), tenantValue: await L.headerTenant(page).inputValue(), placeholder: await L.headerTenant(page).getAttribute('placeholder'), badge: await C.badgeText(page), liveSwitch: await page.getByRole('switch', { name: 'Live updates' }).getAttribute('aria-checked'), mainText: await C.mainText(page), activeAtLoad: await C.active(page), feedRequests: feedReqs.length });
    rec('landing-tab-order', { stops: (await C.tabStops(page, 8)).map(C.fmt) });
    fs.writeFileSync(path.join(C.LOGS, 'aria-landing.txt'), await page.locator('body').ariaSnapshot());
    await C.shot(page, '01-landing-first-visit'); await C.axe(page, 'landing-light', rec);
  });

  await step('type-tenant', async () => {
    feedReqs.length = 0; await C.ann(page);
    await L.headerTenant(page).click(); await page.keyboard.type(T, { delay: 90 });
    const typedAt = Date.now();
    const tl = await badgeTimeline(page, 9000);
    rec('type-tenant', { feedGets: feedReqs.filter((r) => r.u.startsWith('/v1/feed?')).length, streams: feedReqs.filter((r) => r.u.startsWith('/v1/feed/stream')).length, badgeTimelineAfterTyping: tl, mainText: await C.mainText(page) });
    rec('type-tenant-announcements', { ann: await C.ann(page) });
    await C.shot(page, '02-feed-all-clear');
    feedReqs.length = 0;
    await L.headerTenant(page).fill(''); await page.waitForTimeout(850);
    rec('clear-tenant-850ms', { main: (await C.mainText(page)).slice(0, 160), badge: await C.badgeText(page) });
    feedReqs.length = 0; const t0 = Date.now();
    await L.headerTenant(page).click(); await page.keyboard.type(T, { delay: 30 }); await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    rec('type-then-tab', { firstFeedGetMs: (feedReqs.find((r) => r.u.startsWith('/v1/feed?')) || {}).at - t0, gets: feedReqs.filter((r) => r.u.startsWith('/v1/feed?')).length, active: C.fmt(await C.active(page)) });
    await page.waitForTimeout(800);
  });

  await step('publish-form', async () => {
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(300);
    rec('publish-hints', { ticketHint: await page.getByText(/The INC tracking this/).innerText().catch(() => null), refHint: await page.getByText(/idempotency|permanent/).first().innerText().catch(() => null), formTenant: await L.formTenant(page).inputValue(), publisher: await L.publisher(page).inputValue(), submitLabel: await L.submit(page).innerText(), docTitle: await page.title() });
    await L.submit(page).click(); await page.waitForTimeout(300);
    rec('submit-empty', { active: C.fmt(await C.active(page)), summary: await L.alerts(page).last().innerText().catch(() => null), alerts: await L.alerts(page).count() });
    await C.shot(page, '03-publish-empty-submit');
  });

  await step('publish-success', async () => {
    await fillOutage(page, { title: 'Payments API returning 503s', ticket: 'INC4000001' });
    await L.title(page).press('Enter'); await page.getByRole('heading', { name: /published|scheduled|saved/ }).waitFor({ timeout: 10000 });
    rec('publish-success', { active: C.fmt(await C.active(page)), text: await C.mainText(page) });
    await C.shot(page, '04-publish-success');
    await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForTimeout(200);
    rec('publish-another-focus', { active: C.fmt(await C.active(page)), tenant: await L.formTenant(page).inputValue(), publisher: await L.publisher(page).inputValue() });
  });

  await step('duplicate-409-ticket', async () => {
    await C.ann(page);
    await fillOutage(page, { title: 'Payments API returning 503s (second notice)', ticket: 'INC4000001' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await L.submit(page).click(); await page.waitForTimeout(1500);
    const b = L.banner(page);
    rec('duplicate-409', { text: await b.innerText().catch(() => null), active: C.fmt(await C.active(page)), bannerBox: await C.box(b), detailsOpen: await b.locator('details').evaluate((d) => d.open).catch(() => null) });
    rec('duplicate-409-announcements', { ann: await C.ann(page) });
    await C.shot(page, '05-409-banner-desktop');
    await b.locator('summary').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    rec('duplicate-409-details', { open: await b.locator('details').evaluate((d) => d.open).catch(() => null), said: await b.locator('details p').innerText().catch(() => null) });
    fs.writeFileSync(path.join(C.LOGS, 'aria-409.txt'), await page.locator('form').ariaSnapshot());
    await C.shot(page, '05b-409-details-open'); await C.axe(page, 'publish-409-light', rec);
    const suggested = ((await b.innerText()).match(/such as (\S+?)\.?$/m) || [])[1];
    await L.extRef(page).fill(suggested || 'INC4000001-2'); await L.submit(page).click(); await page.getByRole('heading', { name: /published/ }).waitFor({ timeout: 10000 });
    rec('duplicate-advice-works', { suggested, heading: await page.locator('main h2').first().innerText() });
    await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForTimeout(200);
  });

  await step('duplicate-409-extref', async () => {
    await fillOutage(page, { title: 'Payments API: third notice', ticket: 'INC4000001', extRef: 'INC4000001-2' });
    await L.submit(page).click(); await page.waitForTimeout(1500);
    const t = await L.banner(page).innerText().catch(() => null);
    rec('duplicate-409-extref', { text: t });
    const suggested = ((t || '').match(/such as (\S+?)\.?$/m) || [])[1];
    await L.extRef(page).fill(suggested || 'x'); await L.submit(page).click(); await page.getByRole('heading', { name: /published/ }).waitFor({ timeout: 10000 }).catch(() => {});
    rec('duplicate-extref-advice-works', { suggested, heading: await page.locator('main h2').first().innerText().catch(() => null) });
    await page.getByRole('button', { name: 'Publish another' }).click().catch(() => {}); await page.waitForTimeout(200);
    await fillOutage(page, { title: 'Lower-case ticket', ticket: 'inc4000001' }); await L.submit(page).click(); await page.waitForTimeout(1500);
    rec('duplicate-409-lowercase-ticket', { text: await L.banner(page).innerText().catch(() => null) });
  });

  await step('view-in-feed', async () => {
    await L.title(page).fill('Feed check notice'); await L.ticket(page).fill(''); await L.extRef(page).fill('');
    await L.submit(page).click(); await page.getByRole('heading', { name: /published/ }).waitFor({ timeout: 10000 });
    await C.ann(page);
    await page.getByRole('button', { name: 'View in feed' }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    const focus = await C.active(page); const ax = await C.axFocus(page);
    rec('view-in-feed', { focus: C.fmt(focus), focusAx: ax, tenant: await L.headerTenant(page).inputValue(), type: await L.typeFilter(page).inputValue(), cards: await L.cards(page).count(), hash: await page.evaluate(() => location.hash), docTitle: await page.title(), badge: await C.badgeText(page), announced: await C.ann(page) });
    rec('view-in-feed-next-tabs', { stops: (await C.tabStops(page, 3)).map(C.fmt) });
    await C.shot(page, '06-feed-cards');
    const c = L.cards(page).filter({ hasText: 'Payments API returning 503s' }).first();
    rec('card-anatomy', { text: (await c.innerText()).replace(/\s+/g, ' ') });
  });

  await step('maintenance', async () => {
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
    await page.getByRole('radio', { name: 'Maintenance' }).click();
    await L.title(page).fill('Planned database upgrade'); await L.publisher(page).fill('ux4-oncall'); await L.ticket(page).fill(''); await L.extRef(page).fill('');
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByLabel('Starts').fill(C.localDT(3600e3)); await page.getByLabel(/^Ends/).fill(C.localDT(7200e3));
    await L.submit(page).click(); await page.getByRole('heading', { name: /scheduled/ }).waitFor({ timeout: 10000 });
    rec('maintenance-success', { text: (await C.mainText(page)).slice(0, 300) });
    await page.getByRole('button', { name: 'View in feed' }).click(); await page.waitForTimeout(1500);
    const m = L.cards(page).first(); const mt = (await m.innerText()).replace(/\s+/g, ' ');
    rec('maintenance-card', { type: await L.typeFilter(page).inputValue(), text: mt, focus: C.fmt(await C.active(page)) });
    await C.shot(page, '07-maintenance-card');
  });

  await step('feed-all-types', async () => {
    await L.typeFilter(page).selectOption(''); const tl = await badgeTimeline(page, 2500);
    rec('feed-all-types', { cards: await L.cards(page).count(), sections: await page.locator('main section h2').allInnerTexts(), badgeAfterFilterChange: tl, tabBadge: await L.tab(page, 'Feed').innerText() });
    await C.axe(page, 'feed-cards-light', rec);
    fs.writeFileSync(path.join(C.LOGS, 'aria-feed.txt'), await page.locator('body').ariaSnapshot());
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    rec('feed-tab-order', { stops: (await C.tabStops(page, 22)).map(C.fmt) });
  });

  await step('resolve', async () => {
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); }); await C.ann(page);
    const resolveBtn = page.getByRole('button', { name: 'Resolve' }).first(); await resolveBtn.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    const grp = page.getByRole('group').filter({ hasText: /Resolve as|Resolve\?/ }).first();
    rec('resolve-confirm', { active: C.fmt(await C.active(page)), groupName: await grp.getAttribute('aria-labelledby').then((id) => page.locator(`[id="${id}"]`).innerText()).catch(() => null), announcements: await C.ann(page) });
    fs.writeFileSync(path.join(C.LOGS, 'aria-confirm.txt'), await page.locator('article').first().ariaSnapshot());
    await C.shot(page, '08-resolve-confirm');
    // Escape from the note field (UX-55)
    await page.keyboard.type('half-typed note'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    rec('resolve-escape-from-note', { confirmOpen: await grp.count(), active: C.fmt(await C.active(page)), announcements: await C.ann(page) });
    // Escape from the confirm button
    await page.keyboard.press('Enter'); await page.waitForTimeout(200); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const onBtn = C.fmt(await C.active(page)); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    rec('resolve-escape-from-button', { from: onBtn, confirmOpen: await grp.count(), active: C.fmt(await C.active(page)) });
    // reopen: is the half-typed note kept or cleared?
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    rec('resolve-reopen-note', { noteValue: await page.locator('article [role=group] textarea, article [role=group] input').first().inputValue().catch(() => null) });
    if (await grp.count()) { await grp.getByRole('button', { name: 'Cancel' }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200); }
    rec('resolve-cancel', { active: C.fmt(await C.active(page)), confirmOpen: await grp.count() });
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    await page.keyboard.press('Control+a'); await page.keyboard.type('Fixed by failover'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const onConfirm = C.fmt(await C.active(page)); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    rec('after-resolve', { pressedOn: onConfirm, active: C.fmt(await C.active(page)), focusAx: await C.axFocus(page), cards: await L.cards(page).count(), announcements: await C.ann(page) });
    await C.shot(page, '09-after-resolve');
    const wd = page.getByRole('button', { name: 'Withdraw' }).first(); await wd.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    rec('withdraw-confirm', { active: C.fmt(await C.active(page)), text: await page.getByRole('group').first().innerText().catch(() => null) });
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    rec('withdraw-escape', { confirmOpen: await page.getByRole('group').filter({ hasText: /Withdraw/ }).count(), active: C.fmt(await C.active(page)) });
    await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    rec('after-withdraw', { active: C.fmt(await C.active(page)), cards: await L.cards(page).count(), announcements: await C.ann(page) });
  });

  await step('variants', async () => {
    const variants = [
      ['500-empty', { status: 500, body: '' }],
      ['500-json', { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected error' }) }],
      ['503-db', { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database unavailable' }) }],
      ['503-proxy-text', { status: 503, contentType: 'text/plain', body: 'Service Unavailable' }],
      ['502-html', { status: 502, contentType: 'text/html', body: '<html><body><h1>502 Bad Gateway</h1></body></html>' }],
      ['abort', null],
    ];
    for (const [name, resp] of variants) {
      await page.route('**/v1/communications', (route) => (route.request().method() === 'POST' ? (resp ? route.fulfill(resp) : route.abort('connectionrefused')) : route.continue()));
      await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
      await fillOutage(page, { title: `Variant ${name}` });
      await L.submit(page).click(); await page.waitForTimeout(800);
      rec(`variant-${name}`, { text: await L.banner(page).innerText().catch(() => null), activeRole: (await C.active(page)).role, titleKept: await L.title(page).inputValue() });
      if (name === '503-db') await C.shot(page, '10-publish-db-unavailable');
      await page.unroute('**/v1/communications');
    }
    await L.tab(page, 'Feed').click(); await page.waitForTimeout(800);
    for (const [name, resp] of [['feed-503-db', { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database unavailable' }) }], ['feed-502-html', { status: 502, contentType: 'text/html', body: '<h1>502</h1>' }], ['feed-500-json', { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected error' }) }]]) {
      await page.route(/\/v1\/feed\?/, (route) => route.fulfill(resp)); await C.ann(page);
      await page.getByRole('button', { name: 'Refresh' }).click(); await page.waitForTimeout(1000);
      rec(name, { text: await C.mainText(page), badge: await C.badgeText(page), alertText: await L.feedAlert(page).innerText().catch(() => null), alerts: await L.feedAlert(page).count(), announced: await C.ann(page), focus: C.fmt(await C.active(page)) });
      if (name === 'feed-503-db') { await C.shot(page, '10b-feed-db-unavailable-mocked'); fs.writeFileSync(path.join(C.LOGS, 'aria-feed-error.txt'), await page.locator('main').ariaSnapshot()); await C.axe(page, 'feed-error-light', rec); }
      await page.unroute(/\/v1\/feed\?/);
    }
    // Try again with the keyboard: where does focus go, and what is announced?
    await page.route(/\/v1\/feed\?/, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database unavailable' }) }));
    await page.getByRole('button', { name: 'Refresh' }).click(); await page.waitForTimeout(800); await C.ann(page);
    await page.getByRole('button', { name: 'Try again' }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(1000);
    rec('try-again-fails-again', { focus: C.fmt(await C.active(page)), announced: await C.ann(page), badge: await C.badgeText(page) });
    await page.unroute(/\/v1\/feed\?/);
    await page.getByRole('button', { name: 'Try again' }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
    rec('try-again-works', { focus: C.fmt(await C.active(page)), focusAx: await C.axFocus(page), announced: await C.ann(page), badge: await C.badgeText(page), cards: await L.cards(page).count() });
  });

  await step('validation-extras', async () => {
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
    await fillOutage(page, { title: 'x', ticket: 'INC12' }); await L.submit(page).click(); await page.waitForTimeout(200);
    rec('bad-ticket', { error: await L.alerts(page).first().innerText().catch(() => null), active: C.fmt(await C.active(page)) });
    await L.ticket(page).fill(''); await page.getByRole('radio', { name: 'Info' }).click(); await L.submit(page).click(); await page.waitForTimeout(200);
    rec('severity-floor', { error: await L.alerts(page).first().innerText().catch(() => null), active: C.fmt(await C.active(page)) });
    await page.getByRole('radio', { name: 'Major' }).click(); await page.getByRole('radio', { name: 'Maintenance' }).click(); await L.submit(page).click(); await page.waitForTimeout(300);
    rec('maintenance-needs-end', { error: await L.alerts(page).first().innerText().catch(() => null), active: C.fmt(await C.active(page)) });
    await page.getByRole('radio', { name: 'Outage' }).click(); await L.title(page).fill('Draft notice'); await page.getByRole('switch', { name: 'Save as draft' }).click();
    await L.submit(page).click(); await page.getByRole('heading', { name: /Draft saved/ }).waitFor({ timeout: 10000 });
    rec('draft-saved', { text: (await C.mainText(page)).slice(0, 250) });
    await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForTimeout(200);
    await page.getByRole('switch', { name: 'Save as draft' }).click();
  });

  await step('keyboard-controls', async () => {
    await L.tab(page, 'Publish').focus(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300);
    rec('tabs-arrow', { feedSelected: await L.tab(page, 'Feed').getAttribute('aria-selected'), active: C.fmt(await C.active(page)) });
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
    const group = page.getByRole('radiogroup', { name: 'Type' }); await group.getByRole('radio', { checked: true }).focus(); await page.keyboard.press('ArrowRight');
    rec('segmented-arrow', { nowChecked: await group.getByRole('radio', { checked: true }).innerText(), active: C.fmt(await C.active(page)) });
    await page.keyboard.press('Home');
    fs.writeFileSync(path.join(C.LOGS, 'aria-publish.txt'), await page.locator('body').ariaSnapshot());
    await C.axe(page, 'publish-empty-light', rec);
  });

  await step('dark', async () => {
    const tt = page.getByRole('button', { name: /Switch to (dark|light) mode/ });
    await tt.click(); await page.waitForTimeout(700);
    rec('theme-after', { name: await page.getByRole('button', { name: /Switch to/ }).getAttribute('aria-label'), stored: await page.evaluate(() => localStorage.getItem('atlas-theme')) });
    await fillOutage(page, { title: 'Dark 409', ticket: 'INC4000001' }); await L.submit(page).click(); await page.waitForTimeout(1200);
    rec('dark-409', { text: await L.banner(page).innerText().catch(() => null) });
    await C.shot(page, '11-publish-dark-409'); await C.axe(page, 'publish-409-dark', rec);
    await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'OUTAGE', severity: 'CRITICAL', title: 'Checkout down in eu-west', body: 'All card payments fail. Next update 10:30 UTC.', affectedServices: ['checkout-web'], ticket: { number: 'INC4000002' }, audience: 'INTERNAL' });
    await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'INCIDENT', severity: 'MINOR', title: 'Slow search results', affectedServices: ['search-api'] });
    await L.tab(page, 'Feed').click(); await page.waitForTimeout(300); await L.typeFilter(page).selectOption(''); await page.waitForTimeout(1500);
    rec('feed-dark', { cards: await L.cards(page).count(), badge: await C.badgeText(page) }); await C.shot(page, '12-feed-dark'); await C.axe(page, 'feed-cards-dark', rec);
  });

  await step('live', async () => {
    const page2 = await ctx.newPage(); wire(page2, 'page2'); await page2.goto(BASE + '#/feed'); await page2.waitForTimeout(1500);
    await L.typeFilter(page2).selectOption(''); await page2.waitForTimeout(1200);
    const t0 = Date.now(); const pub = await api('POST', '/v1/communications', { tenantId: T, publisher: 'api-bot', type: 'OUTAGE', severity: 'MAJOR', title: 'Live push test', affectedServices: ['live-api'] });
    await page2.locator('article', { hasText: 'Live push test' }).waitFor({ timeout: 10000 }); const createdMs = Date.now() - t0;
    const t1 = Date.now(); await api('POST', `/v1/communications/${pub.json.id}/retire`, { actor: 'api-bot', note: 'done' });
    await page2.locator('article', { hasText: 'Live push test' }).waitFor({ state: 'detached', timeout: 10000 }); const retiredMs = Date.now() - t1;
    rec('live', { publishStatus: pub.status, createdMs, retiredMs, badge: await C.badgeText(page2), announcements: (await C.ann(page2)).slice(-6) });
    await page2.close();
  });

  await step('empty-states', async () => {
    await L.headerTenant(page).fill('ux4-fresh-tenant'); await L.headerTenant(page).press('Enter'); const tl = await badgeTimeline(page, 8000);
    rec('empty-fresh-all-types', { text: await C.mainText(page), badgeTimeline: tl });
    await page.getByLabel('Service').fill('no-such-service'); await page.waitForTimeout(1500); rec('empty-filter', { text: await C.mainText(page) });
    await page.getByLabel('Service').fill('');
    await L.headerTenant(page).fill('ux1-many'); await L.headerTenant(page).press('Enter'); await page.waitForTimeout(3000);
    rec('cap-notice', { text: await page.locator('main').getByText(/Showing the first/).innerText().catch(() => null), tabBadge: await L.tab(page, 'Feed').innerText(), cards: await L.cards(page).count() });
    await L.headerTenant(page).fill(''); await L.headerTenant(page).press('Enter'); await page.waitForTimeout(800);
    rec('empty-no-tenant', { text: await C.mainText(page), badge: await C.badgeText(page) });
    await L.headerTenant(page).fill(T); await L.headerTenant(page).press('Enter'); await page.waitForTimeout(1000);
  });

  await step('phone', async () => {
    const phone = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'light' }); await phone.addInitScript(C.LIVE); const pp = await phone.newPage(); wire(pp, 'phone');
    await pp.goto(BASE); await pp.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux4-oncall'); localStorage.setItem('atlas-theme', 'light'); }, T); await pp.reload(); await pp.waitForTimeout(1500);
    await L.typeFilter(pp).selectOption(''); await pp.waitForTimeout(1500);
    const small = await pp.evaluate(() => [...document.querySelectorAll('button, a, input, select, textarea, summary, [role=switch], [role=radio], [role=tab]')].map((e) => { const r = e.getBoundingClientRect(); const lab = e.closest('label'); const lr = lab ? lab.getBoundingClientRect() : null; return { tag: e.tagName.toLowerCase(), name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), labelRow: lr ? `${Math.round(lr.width)}x${Math.round(lr.height)}` : null }; }).filter((e) => e.w > 0 && (e.w < 24 || e.h < 24)));
    rec('phone-feed', { viewport: pp.viewportSize(), scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), cards: await L.cards(pp).count(), smallTargets: small, badge: await C.badgeText(pp) });
    await C.shot(pp, '13-phone-feed'); await C.axe(pp, 'phone-feed-light', rec);
    await pp.getByRole('button', { name: 'Resolve' }).first().click(); await pp.waitForTimeout(300); await C.shot(pp, '14-phone-resolve-confirm');
    rec('phone-resolve-confirm', { scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), active: C.fmt(await C.active(pp)) });
    await pp.keyboard.press('Escape'); await pp.waitForTimeout(200);
    rec('phone-resolve-escape', { confirmOpen: await pp.getByRole('group').filter({ hasText: /Resolve/ }).count(), active: C.fmt(await C.active(pp)) });
    await L.tab(pp, 'Publish').click(); await pp.waitForTimeout(300); await L.submit(pp).click(); await pp.waitForTimeout(300);
    rec('phone-submit-empty', { active: C.fmt(await C.active(pp)), summary: await L.alerts(pp).last().innerText().catch(() => null) });
    await C.shot(pp, '15-phone-publish-errors');
    await fillOutage(pp, { title: 'Phone 409', ticket: 'INC4000001' }); await pp.evaluate(() => window.scrollTo(0, 0)); await L.submit(pp).click(); await pp.waitForTimeout(1200);
    rec('phone-409', { active: C.fmt(await C.active(pp)), bannerBox: await C.box(L.banner(pp)), innerHeight: await pp.evaluate(() => innerHeight), scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), text: await L.banner(pp).innerText().catch(() => null) });
    await C.shot(pp, '16-phone-publish-409');
    await L.banner(pp).locator('summary').click().catch(() => {}); await pp.waitForTimeout(200);
    rec('phone-409-details', { scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), said: await L.banner(pp).locator('details p').innerText().catch(() => null) });
    await C.shot(pp, '16b-phone-409-details'); await C.axe(pp, 'phone-publish-409-light', rec);
    // phone: the feed's load error (mocked 503) at 390 px
    await L.tab(pp, 'Feed').click(); await pp.waitForTimeout(800);
    await pp.route(/\/v1\/feed\?/, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database unavailable' }) }));
    await pp.getByRole('button', { name: 'Refresh' }).click(); await pp.waitForTimeout(1000);
    rec('phone-feed-error', { scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), badge: await C.badgeText(pp), alert: await L.feedAlert(pp).innerText().catch(() => null) });
    await C.shot(pp, '16c-phone-feed-error'); await pp.unroute(/\/v1\/feed\?/);
    await phone.close();
    const dark = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'dark' }); const dp = await dark.newPage(); wire(dp, 'phone-dark');
    await dp.goto(BASE); await dp.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('atlas-theme', 'dark'); }, T); await dp.reload(); await dp.waitForTimeout(1500); await L.typeFilter(dp).selectOption(''); await dp.waitForTimeout(1500);
    rec('phone-feed-dark', { scrollWidth: await dp.evaluate(() => document.documentElement.scrollWidth), cards: await L.cards(dp).count() }); await C.shot(dp, '17-phone-feed-dark'); await C.axe(dp, 'phone-feed-dark', rec);
    await dark.close();
  });

  await step('cleanup', async () => {
    let n = 0;
    for (const status of ['ACTIVE', 'SCHEDULED']) { const l = await api('GET', `/v1/communications?tenantId=${T}&status=${status}&size=100`); for (const c of l.json?.items ?? []) { await api('POST', `/v1/communications/${c.id}/retire`, { actor: 'ux4-reviewer', note: 'review cleanup' }); n++; } }
    rec('cleanup', { retired: n });
  });
  rec('console', { issues: consoleIssues.length, sample: consoleIssues.slice(0, 12) });
  save(); await browser.close();
})().catch((e) => { console.error('FATAL', e); save(); process.exit(1); });
