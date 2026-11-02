// ux3-ui.js — SRE walk on the shared stack, iteration 3 (1280x800 + iPhone 14, keyboard, a11y tree, live regions, axe)
const { chromium, devices } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.UI_BASE || 'http://127.0.0.1:3000';
const API = process.env.API_BASE || 'http://localhost:8080';
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'shots'); const LOGS = path.join(ROOT, 'logs');
const T = process.env.UX_TENANT || 'ux3-sre';
const log = []; const consoleIssues = [];
function rec(step, data = {}) { const e = { step, at: new Date().toISOString(), ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data).slice(0, 600)); }
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); }
async function api(method, p, body) { const r = await fetch(API + p, { method, headers: { 'X-Client-Id': 'ux3-reviewer', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text }; }
const active = (page) => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return { tag: 'body' }; const cs = getComputedStyle(a); const r = a.getBoundingClientRect(); return { tag: a.tagName.toLowerCase(), role: a.getAttribute('role'), name: a.getAttribute('aria-label') || (a.labels && a.labels[0] && a.labels[0].textContent.trim()) || a.textContent.trim().slice(0, 80), id: a.id || null, placeholder: a.getAttribute('placeholder'), outline: cs.outlineStyle + ' ' + cs.outlineWidth, boxShadow: cs.boxShadow !== 'none', inViewport: r.top >= 0 && r.bottom <= innerHeight, top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
async function tabStops(page, n, key = 'Tab') { const stops = []; for (let i = 0; i < n; i++) { await page.keyboard.press(key); stops.push(await active(page)); } return stops; }
const fmt = (s) => `${s.tag}${s.role ? '[' + s.role + ']' : ''} "${(s.name || '').slice(0, 60)}"${s.placeholder ? ' ph=' + s.placeholder : ''} ring=${s.outline}|${s.boxShadow}`;
const box = async (loc) => { const b = await loc.boundingBox(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };
const mainText = (page) => page.locator('main').innerText().then((t) => t.replace(/\s+/g, ' ').trim());
async function axe(page, name) { try { const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); rec(`axe:${name}`, { violations: r.violations.length, ids: r.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), incomplete: r.incomplete.map((v) => v.id), passes: r.passes.length }); } catch (e) { rec(`axe:${name}`, { error: String(e) }); } }
function wire(page, tag) { page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleIssues.push({ tag, type: m.type(), text: m.text().slice(0, 200) }); }); page.on('pageerror', (e) => consoleIssues.push({ tag, type: 'pageerror', text: String(e).slice(0, 200) })); }
const localDT = (ms) => { const d = new Date(Date.now() + ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
// every text change of a live region (role=status|alert or aria-live): a stand-in for what a screen reader would be handed
const LIVE = () => { window.__ann = []; const t0 = performance.now(); const seen = new WeakMap(); const check = () => { document.querySelectorAll('[role=status],[role=alert],[aria-live]').forEach((el) => { const txt = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (seen.get(el) !== txt) { seen.set(el, txt); window.__ann.push({ t: Math.round(performance.now() - t0), role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: txt.slice(0, 220) }); } }); }; new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true }); };
const ann = async (page, clear = true) => { const a = await page.evaluate(() => window.__ann || []); if (clear) await page.evaluate(() => { window.__ann = []; }); return a; };
const L = {
  headerTenant: (p) => p.locator('header').getByLabel('Tenant'),
  tab: (p, name) => p.getByRole('tab', { name }),
  title: (p) => p.getByRole('textbox', { name: 'Title' }),
  details: (p) => p.getByRole('textbox', { name: 'Details' }),
  services: (p) => p.getByRole('textbox', { name: 'Affected services' }),
  ticket: (p) => p.getByRole('textbox', { name: 'ServiceNow incident' }),
  formTenant: (p) => p.locator('form').getByRole('textbox', { name: 'Tenant' }),
  publisher: (p) => p.getByRole('textbox', { name: 'Publisher' }),
  extRef: (p) => p.getByRole('textbox', { name: 'External reference' }),
  submit: (p) => p.locator('form button[type=submit]'),
  alerts: (p) => p.locator('form [role=alert]'),
  banner: (p) => p.locator('form [role=alert][tabindex="-1"]'),
  cards: (p) => p.locator('article'),
  typeFilter: (p) => p.getByLabel('Type', { exact: true }),
  badge: (p) => p.locator('main span[role=status][aria-live=polite]').first(),
  statuses: (p) => p.locator('main [role=status]'),
};
async function fillOutage(page, { title, body = 'Card payments fail for roughly 30% of requests. Retries succeed.', services = 'payments-api, checkout-web', ticket = '', publisher = 'ux3-oncall', extRef = '' }) {
  await L.title(page).fill(title); await L.details(page).fill(body); await L.services(page).fill(services);
  await L.ticket(page).fill(ticket); if (publisher) await L.publisher(page).fill(publisher); await L.extRef(page).fill(extRef);
}
async function step(name, fn) { try { await fn(); } catch (e) { rec(`${name}:ERROR`, { error: String(e).slice(0, 400) }); } }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  await ctx.addInitScript(LIVE);
  const page = await ctx.newPage(); wire(page, 'desktop');
  const feedReqs = []; page.on('request', (r) => { if (r.url().includes('/v1/feed')) feedReqs.push({ at: Date.now(), u: r.url().replace(/^.*\/v1/, '/v1') }); });

  await step('landing', async () => {
    await page.goto(BASE); await page.waitForLoadState('networkidle');
    rec('landing', { title: await page.title(), tenantValue: await L.headerTenant(page).inputValue(), placeholder: await L.headerTenant(page).getAttribute('placeholder'), prompt: await page.locator('main > p').first().innerText().catch(() => null), badge: await L.badge(page).innerText().catch(() => null), liveSwitch: await page.getByRole('switch', { name: 'Live updates' }).getAttribute('aria-checked'), statusRegions: await L.statuses(page).count(), mainText: await mainText(page), activeAtLoad: await active(page), feedRequests: feedReqs.length });
    rec('landing-tab-order', { stops: (await tabStops(page, 8)).map(fmt) });
    rec('landing-announcements', { ann: await ann(page) });
    fs.writeFileSync(path.join(LOGS, 'aria-landing.txt'), await page.locator('body').ariaSnapshot());
    await shot(page, '01-landing-first-visit');
    await axe(page, 'landing-light');
  });

  await step('type-tenant', async () => {
    feedReqs.length = 0; await ann(page);
    const samples = [];
    await L.headerTenant(page).click();
    for (const ch of T) { await page.keyboard.type(ch); await page.waitForTimeout(90); samples.push((await mainText(page)).slice(0, 60)); }
    const typedAt = Date.now();
    await page.waitForTimeout(1800);
    const reqs = feedReqs.map((r) => ({ ms: r.at - typedAt, u: r.u.slice(0, 90) }));
    rec('type-tenant', { feedGets: reqs.filter((r) => r.u.startsWith('/v1/feed?')).length, streams: reqs.filter((r) => r.u.startsWith('/v1/feed/stream')).length, reqs, mainDuringTyping: [...new Set(samples)], mainText: await mainText(page), badge: await L.badge(page).innerText().catch(() => null) });
    rec('type-tenant-announcements', { ann: await ann(page) });
    await shot(page, '02-feed-all-clear');
    // a fast typist who tabs straight on: blur commits at once
    feedReqs.length = 0;
    await L.headerTenant(page).fill(''); await page.waitForTimeout(150);
    rec('clear-tenant-150ms', { prompt: await page.locator('main > p').first().innerText().catch(() => null), main: (await mainText(page)).slice(0, 160), badge: await L.badge(page).innerText().catch(() => null) });
    await page.waitForTimeout(700);
    rec('clear-tenant-850ms', { main: (await mainText(page)).slice(0, 160), badge: await L.badge(page).innerText().catch(() => null) });
    feedReqs.length = 0; const t0 = Date.now();
    await L.headerTenant(page).click(); await page.keyboard.type(T, { delay: 30 }); await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    rec('type-then-tab', { firstFeedGetMs: (feedReqs.find((r) => r.u.startsWith('/v1/feed?')) || {}).at - t0, gets: feedReqs.filter((r) => r.u.startsWith('/v1/feed?')).length, active: fmt(await active(page)) });
    await page.waitForTimeout(800);
  });

  await step('publish-form', async () => {
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(300);
    const sw = page.getByRole('switch', { name: 'Save as draft' }); const row = page.locator('label', { has: sw });
    rec('publish-hints', { ticketHint: await page.getByText(/The INC tracking this/).innerText().catch(() => null), refHint: await page.getByText(/idempotency|permanent/).first().innerText().catch(() => null), formTenant: await L.formTenant(page).inputValue(), publisher: await L.publisher(page).inputValue(), submitLabel: await L.submit(page).innerText(), docTitle: await page.title() });
    rec('draft-switch', { switch: await box(sw), row: await box(row) });
    await L.submit(page).click(); await page.waitForTimeout(300);
    rec('submit-empty', { active: fmt(await active(page)), summary: await L.alerts(page).last().innerText().catch(() => null), alerts: await L.alerts(page).count() });
    await shot(page, '03-publish-empty-submit');
  });

  await step('publish-success', async () => {
    await fillOutage(page, { title: 'Payments API returning 503s', ticket: 'INC3000001' });
    await L.title(page).press('Enter'); await page.getByRole('heading', { name: /published|scheduled|saved/ }).waitFor({ timeout: 10000 });
    rec('publish-success', { active: fmt(await active(page)), text: await mainText(page) });
    await shot(page, '04-publish-success');
    await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForTimeout(200);
    rec('publish-another-focus', { active: fmt(await active(page)), tenant: await L.formTenant(page).inputValue(), publisher: await L.publisher(page).inputValue() });
  });

  await step('duplicate-409-ticket', async () => {
    await ann(page);
    await fillOutage(page, { title: 'Payments API returning 503s (second notice)', ticket: 'INC3000001' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await L.submit(page).click(); await page.waitForTimeout(1500);
    const b = L.banner(page);
    rec('duplicate-409', { text: await b.innerText().catch(() => null), active: fmt(await active(page)), bannerBox: await box(b), detailsOpen: await b.locator('details').evaluate((d) => d.open).catch(() => null), summary: await b.locator('summary').innerText().catch(() => null), saidHidden: await b.locator('details p').isVisible().catch(() => null) });
    rec('duplicate-409-announcements', { ann: await ann(page) });
    rec('duplicate-409-tab-from-banner', { stops: (await tabStops(page, 3)).map(fmt) });
    await shot(page, '05-409-banner-desktop');
    // open the details with the keyboard
    await b.locator('summary').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    rec('duplicate-409-details', { open: await b.locator('details').evaluate((d) => d.open), said: await b.locator('details p').innerText().catch(() => null) });
    fs.writeFileSync(path.join(LOGS, 'aria-409.txt'), await page.locator('form').ariaSnapshot());
    await shot(page, '05b-409-details-open');
    await axe(page, 'publish-409-light');
    // follow the advice: put the suggested value in External reference
    const suggested = ((await b.innerText()).match(/such as (\S+?)\.?$/m) || [])[1];
    await L.extRef(page).fill(suggested || 'INC3000001-2'); await L.submit(page).click(); await page.getByRole('heading', { name: /published/ }).waitFor({ timeout: 10000 });
    rec('duplicate-advice-works', { suggested, heading: await page.locator('main h2').first().innerText(), text: (await mainText(page)).slice(0, 300) });
    await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForTimeout(200);
  });

  await step('duplicate-409-extref', async () => {
    // the follow-up's own reference reused: the banner should name the External reference field and suggest -3
    await fillOutage(page, { title: 'Payments API: third notice', ticket: 'INC3000001', extRef: 'INC3000001-2' });
    await L.submit(page).click(); await page.waitForTimeout(1500);
    const b = L.banner(page); const t = await b.innerText().catch(() => null);
    rec('duplicate-409-extref', { text: t });
    const suggested = ((t || '').match(/such as (\S+?)\.?$/m) || [])[1];
    await L.extRef(page).fill(suggested || 'x'); await L.submit(page).click(); await page.getByRole('heading', { name: /published/ }).waitFor({ timeout: 10000 }).catch(() => {});
    rec('duplicate-extref-advice-works', { suggested, heading: await page.locator('main h2').first().innerText().catch(() => null) });
    await page.getByRole('button', { name: 'Publish another' }).click().catch(() => {}); await page.waitForTimeout(200);
    // lower-case ticket typed by a hurried person
    await fillOutage(page, { title: 'Lower-case ticket', ticket: 'inc3000001' }); await L.submit(page).click(); await page.waitForTimeout(1500);
    rec('duplicate-409-lowercase-ticket', { text: await L.banner(page).innerText().catch(() => null), alerts: await L.alerts(page).allInnerTexts() });
  });

  await step('view-in-feed', async () => {
    await L.title(page).fill('Feed check notice'); await L.ticket(page).fill(''); await L.extRef(page).fill('');
    await L.submit(page).click(); await page.getByRole('heading', { name: /published/ }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'View in feed' }).click(); await page.waitForTimeout(1500);
    rec('view-in-feed', { tenant: await L.headerTenant(page).inputValue(), type: await L.typeFilter(page).inputValue(), cards: await L.cards(page).count(), hash: await page.evaluate(() => location.hash), docTitle: await page.title(), badge: await L.badge(page).innerText().catch(() => null) });
    await shot(page, '06-feed-cards');
    const c = L.cards(page).filter({ hasText: 'Payments API returning 503s' }).first();
    rec('card-anatomy', { text: (await c.innerText()).replace(/\s+/g, ' '), chips: await c.locator('span.rounded-full, [class*=rounded]').allInnerTexts().then((a) => a.filter(Boolean).slice(0, 10)) });
  });

  await step('maintenance', async () => {
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
    await page.getByRole('radio', { name: 'Maintenance' }).click();
    await L.title(page).fill('Planned database upgrade'); await L.publisher(page).fill('ux3-oncall'); await L.ticket(page).fill(''); await L.extRef(page).fill('');
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByLabel('Starts').fill(localDT(3600e3)); await page.getByLabel(/^Ends/).fill(localDT(7200e3));
    await L.submit(page).click(); await page.getByRole('heading', { name: /scheduled/ }).waitFor({ timeout: 10000 });
    rec('maintenance-success', { text: (await mainText(page)).slice(0, 300) });
    await page.getByRole('button', { name: 'View in feed' }).click(); await page.waitForTimeout(1500);
    const m = L.cards(page).first(); const mt = (await m.innerText()).replace(/\s+/g, ' ');
    rec('maintenance-card', { type: await L.typeFilter(page).inputValue(), text: mt, startsIn: (mt.match(/Starts in/gi) || []).length });
    await shot(page, '07-maintenance-card');
  });

  await step('feed-all-types', async () => {
    await L.typeFilter(page).selectOption(''); await page.waitForTimeout(1500);
    const lbl = page.locator('label', { has: page.getByRole('switch', { name: 'Live updates' }) });
    rec('feed-all-types', { cards: await L.cards(page).count(), sections: await page.locator('main section h2').allInnerTexts(), badge: await L.badge(page).innerText().catch(() => null), tabBadge: await L.tab(page, 'Feed').innerText(), liveSwitch: await box(page.getByRole('switch', { name: 'Live updates' })), liveRow: await box(lbl) });
    await axe(page, 'feed-cards-light');
    fs.writeFileSync(path.join(LOGS, 'aria-feed.txt'), await page.locator('body').ariaSnapshot());
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    rec('feed-tab-order', { stops: (await tabStops(page, 22)).map(fmt) });
  });

  await step('resolve', async () => {
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); }); await ann(page);
    const resolveBtn = page.getByRole('button', { name: 'Resolve' }).first(); await resolveBtn.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    const grp = page.getByRole('group').filter({ hasText: /Resolve as|Resolve\?/ }).first();
    rec('resolve-confirm', { active: fmt(await active(page)), groupName: await grp.getAttribute('aria-labelledby').then((id) => page.locator(`[id="${id}"]`).innerText()).catch(() => null), announcements: await ann(page) });
    fs.writeFileSync(path.join(LOGS, 'aria-confirm.txt'), await page.locator('article').first().ariaSnapshot());
    await shot(page, '08-resolve-confirm');
    rec('resolve-confirm-tab', { stops: (await tabStops(page, 2)).map(fmt) });
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    rec('resolve-escape', { confirmOpen: await grp.count(), active: fmt(await active(page)) });
    // Cancel with the keyboard: focus should come back to the Resolve button
    if (await grp.count()) { await grp.getByRole('button', { name: 'Cancel' }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200); }
    rec('resolve-cancel', { active: fmt(await active(page)), confirmOpen: await grp.count() });
    // now resolve for real, keyboard only
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    await page.keyboard.type('Fixed by failover'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const onConfirm = fmt(await active(page)); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    rec('after-resolve', { pressedOn: onConfirm, active: fmt(await active(page)), cards: await L.cards(page).count(), announcements: await ann(page) });
    await shot(page, '09-after-resolve');
    const wd = page.getByRole('button', { name: 'Withdraw' }).first(); await wd.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    rec('withdraw-confirm', { active: fmt(await active(page)), text: await page.getByRole('group').first().innerText().catch(() => null) });
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    rec('after-withdraw', { active: fmt(await active(page)), cards: await L.cards(page).count(), announcements: await ann(page) });
  });

  await step('variants', async () => {
    const variants = [
      ['500-empty', { status: 500, body: '' }],
      ['500-json', { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected error' }) }],
      ['503-db', { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database unavailable' }) }],
      ['503-proxy-text', { status: 503, contentType: 'text/plain', body: 'Service Unavailable' }],
      ['502-html', { status: 502, contentType: 'text/html', body: '<html><body><h1>502 Bad Gateway</h1></body></html>' }],
      ['504-empty', { status: 504, body: '' }],
      ['abort', null],
    ];
    for (const [name, resp] of variants) {
      await page.route('**/v1/communications', (route) => (route.request().method() === 'POST' ? (resp ? route.fulfill(resp) : route.abort('connectionrefused')) : route.continue()));
      await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
      await fillOutage(page, { title: `Variant ${name}` });
      await L.submit(page).click(); await page.waitForTimeout(800);
      rec(`variant-${name}`, { text: await L.banner(page).innerText().catch(() => null), activeRole: (await active(page)).role, titleKept: await L.title(page).inputValue() });
      if (name === '503-db') await shot(page, '10-publish-db-unavailable');
      await page.unroute('**/v1/communications');
    }
    await L.tab(page, 'Feed').click(); await page.waitForTimeout(500);
    for (const [name, resp] of [['feed-503-db', { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database unavailable' }) }], ['feed-502-html', { status: 502, contentType: 'text/html', body: '<h1>502</h1>' }], ['feed-500-json', { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected error' }) }]]) {
      await page.route(/\/v1\/feed\?/, (route) => route.fulfill(resp));
      await page.getByRole('button', { name: 'Refresh' }).click(); await page.waitForTimeout(900);
      rec(name, { text: await mainText(page), badge: await L.badge(page).innerText().catch(() => null) });
      if (name === 'feed-503-db') await shot(page, '10b-feed-db-unavailable-mocked');
      await page.unroute(/\/v1\/feed\?/);
    }
    await page.getByRole('button', { name: 'Try again' }).click().catch(() => {}); await page.waitForTimeout(800);
  });

  await step('validation-extras', async () => {
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
    await fillOutage(page, { title: 'x', ticket: 'INC12' }); await L.submit(page).click(); await page.waitForTimeout(200);
    rec('bad-ticket', { error: await L.alerts(page).first().innerText(), active: fmt(await active(page)) });
    await L.ticket(page).fill(''); await page.getByRole('radio', { name: 'Info' }).click(); await L.submit(page).click(); await page.waitForTimeout(200);
    rec('severity-floor', { error: await L.alerts(page).first().innerText(), active: fmt(await active(page)) });
    await page.getByRole('radio', { name: 'Major' }).click(); await page.getByRole('radio', { name: 'Maintenance' }).click(); await L.submit(page).click(); await page.waitForTimeout(300);
    rec('maintenance-needs-end', { error: await L.alerts(page).first().innerText(), active: fmt(await active(page)) });
    await page.getByRole('radio', { name: 'Outage' }).click(); await L.title(page).fill('Draft notice'); await page.getByRole('switch', { name: 'Save as draft' }).click();
    await L.submit(page).click(); await page.getByRole('heading', { name: /Draft saved/ }).waitFor({ timeout: 10000 });
    rec('draft-saved', { text: (await mainText(page)).slice(0, 250) });
    await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForTimeout(200);
    await page.getByRole('switch', { name: 'Save as draft' }).click();
  });

  await step('keyboard-controls', async () => {
    await L.tab(page, 'Publish').focus(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300);
    rec('tabs-arrow', { feedSelected: await L.tab(page, 'Feed').getAttribute('aria-selected'), active: fmt(await active(page)) });
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
    const group = page.getByRole('radiogroup', { name: 'Type' }); await group.getByRole('radio', { checked: true }).focus(); await page.keyboard.press('ArrowRight');
    rec('segmented-arrow', { nowChecked: await group.getByRole('radio', { checked: true }).innerText(), active: fmt(await active(page)) });
    await page.keyboard.press('Home');
    fs.writeFileSync(path.join(LOGS, 'aria-publish.txt'), await page.locator('body').ariaSnapshot());
    await axe(page, 'publish-empty-light');
  });

  await step('dark', async () => {
    const tt = page.getByRole('button', { name: /Switch to (dark|light) mode/ });
    await tt.click(); await page.waitForTimeout(700);
    rec('theme-after', { name: await page.getByRole('button', { name: /Switch to/ }).getAttribute('aria-label'), stored: await page.evaluate(() => localStorage.getItem('atlas-theme')) });
    await fillOutage(page, { title: 'Dark 409', ticket: 'INC3000001' }); await L.submit(page).click(); await page.waitForTimeout(1200);
    rec('dark-409', { text: await L.banner(page).innerText().catch(() => null) });
    await shot(page, '11-publish-dark-409'); await axe(page, 'publish-409-dark');
    await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux3-oncall', type: 'OUTAGE', severity: 'CRITICAL', title: 'Checkout down in eu-west', body: 'All card payments fail. Next update 10:30 UTC.', affectedServices: ['checkout-web'], ticket: { number: 'INC3000002' }, audience: 'INTERNAL' });
    await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux3-oncall', type: 'INCIDENT', severity: 'MINOR', title: 'Slow search results', affectedServices: ['search-api'] });
    await L.tab(page, 'Feed').click(); await page.waitForTimeout(300); await L.typeFilter(page).selectOption(''); await page.waitForTimeout(1500);
    rec('feed-dark', { cards: await L.cards(page).count(), badge: await L.badge(page).innerText().catch(() => null) }); await shot(page, '12-feed-dark'); await axe(page, 'feed-cards-dark');
  });

  await step('live', async () => {
    const page2 = await ctx.newPage(); wire(page2, 'page2'); await page2.goto(BASE + '#/feed'); await page2.waitForTimeout(1500);
    await L.typeFilter(page2).selectOption(''); await page2.waitForTimeout(1200);
    const t0 = Date.now(); const pub = await api('POST', '/v1/communications', { tenantId: T, publisher: 'api-bot', type: 'OUTAGE', severity: 'MAJOR', title: 'Live push test', affectedServices: ['live-api'] });
    await page2.locator('article', { hasText: 'Live push test' }).waitFor({ timeout: 10000 }); const createdMs = Date.now() - t0;
    const t1 = Date.now(); await api('POST', `/v1/communications/${pub.json.id}/retire`, { actor: 'api-bot', note: 'done' });
    await page2.locator('article', { hasText: 'Live push test' }).waitFor({ state: 'detached', timeout: 10000 }); const retiredMs = Date.now() - t1;
    rec('live', { publishStatus: pub.status, createdMs, retiredMs, badge: await L.badge(page2).innerText().catch(() => null), announcements: (await ann(page2)).slice(-6) });
    await page2.close();
  });

  await step('empty-states', async () => {
    await L.headerTenant(page).fill('ux3-fresh-tenant'); await L.headerTenant(page).press('Enter'); await page.waitForTimeout(1500); rec('empty-fresh-all-types', { text: await mainText(page) });
    await page.getByLabel('Service').fill('no-such-service'); await page.waitForTimeout(1500); rec('empty-filter', { text: await mainText(page) });
    await page.getByLabel('Service').fill('');
    await L.headerTenant(page).fill('ux1-many'); await L.headerTenant(page).press('Enter'); await page.waitForTimeout(3000);
    rec('cap-notice', { text: await page.locator('main').getByText(/Showing the first/).innerText().catch(() => null), tabBadge: await L.tab(page, 'Feed').innerText(), cards: await L.cards(page).count() });
    await L.headerTenant(page).fill(''); await L.headerTenant(page).press('Enter'); await page.waitForTimeout(800);
    rec('empty-no-tenant', { text: await mainText(page), badge: await L.badge(page).innerText().catch(() => null) });
    await L.headerTenant(page).fill(T); await L.headerTenant(page).press('Enter'); await page.waitForTimeout(1000);
  });

  await step('phone', async () => {
    const phone = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'light' }); await phone.addInitScript(LIVE); const pp = await phone.newPage(); wire(pp, 'phone');
    await pp.goto(BASE); await pp.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux3-oncall'); localStorage.setItem('atlas-theme', 'light'); }, T); await pp.reload(); await pp.waitForTimeout(1500);
    await L.typeFilter(pp).selectOption(''); await pp.waitForTimeout(1500);
    const small = await pp.evaluate(() => [...document.querySelectorAll('button, a, input, select, textarea, summary, [role=switch], [role=radio], [role=tab]')].map((e) => { const r = e.getBoundingClientRect(); const lab = e.closest('label'); const lr = lab ? lab.getBoundingClientRect() : null; return { tag: e.tagName.toLowerCase(), name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), labelRow: lr ? `${Math.round(lr.width)}x${Math.round(lr.height)}` : null }; }).filter((e) => e.w > 0 && (e.w < 24 || e.h < 24)));
    rec('phone-feed', { viewport: pp.viewportSize(), scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), cards: await L.cards(pp).count(), smallTargets: small, badge: await L.badge(pp).innerText().catch(() => null) });
    await shot(pp, '13-phone-feed'); await axe(pp, 'phone-feed-light');
    await pp.getByRole('button', { name: 'Resolve' }).first().click(); await pp.waitForTimeout(300); await shot(pp, '14-phone-resolve-confirm');
    rec('phone-resolve-confirm', { scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), active: fmt(await active(pp)) });
    await pp.getByRole('button', { name: 'Cancel' }).click();
    await L.tab(pp, 'Publish').click(); await pp.waitForTimeout(300); await L.submit(pp).click(); await pp.waitForTimeout(300);
    rec('phone-submit-empty', { active: fmt(await active(pp)), summary: await L.alerts(pp).last().innerText().catch(() => null) });
    await shot(pp, '15-phone-publish-errors');
    await fillOutage(pp, { title: 'Phone 409', ticket: 'INC3000001' }); await pp.evaluate(() => window.scrollTo(0, 0)); await L.submit(pp).click(); await pp.waitForTimeout(1200);
    rec('phone-409', { active: fmt(await active(pp)), bannerBox: await box(L.banner(pp)), innerHeight: await pp.evaluate(() => innerHeight), scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), text: await L.banner(pp).innerText().catch(() => null) });
    await shot(pp, '16-phone-publish-409');
    await L.banner(pp).locator('summary').click().catch(() => {}); await pp.waitForTimeout(200);
    rec('phone-409-details', { scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), said: await L.banner(pp).locator('details p').innerText().catch(() => null), bannerBox: await box(L.banner(pp)) });
    await shot(pp, '16b-phone-409-details'); await axe(pp, 'phone-publish-409-light');
    await phone.close();
    const dark = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'dark' }); const dp = await dark.newPage(); wire(dp, 'phone-dark');
    await dp.goto(BASE); await dp.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('atlas-theme', 'dark'); }, T); await dp.reload(); await dp.waitForTimeout(1500); await L.typeFilter(dp).selectOption(''); await dp.waitForTimeout(1500);
    rec('phone-feed-dark', { scrollWidth: await dp.evaluate(() => document.documentElement.scrollWidth), cards: await L.cards(dp).count() }); await shot(dp, '17-phone-feed-dark'); await axe(dp, 'phone-feed-dark');
    await dark.close();
  });

  await step('cleanup', async () => {
    let n = 0;
    for (const status of ['ACTIVE', 'SCHEDULED']) { const l = await api('GET', `/v1/communications?tenantId=${T}&status=${status}&size=100`); for (const c of l.json?.items ?? []) { await api('POST', `/v1/communications/${c.id}/retire`, { actor: 'ux3-reviewer', note: 'review cleanup' }); n++; } }
    rec('cleanup', { retired: n });
  });
  rec('console', { issues: consoleIssues.length, sample: consoleIssues.slice(0, 10) });
  fs.writeFileSync(path.join(LOGS, 'ux3-ui-log.json'), JSON.stringify(log, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(path.join(LOGS, 'ux3-ui-log.json'), JSON.stringify(log, null, 2)); process.exit(1); });
