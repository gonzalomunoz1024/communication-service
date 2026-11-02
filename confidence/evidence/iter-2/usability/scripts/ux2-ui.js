// ux2-ui.js — SRE walk on the shared stack, iteration 2 (1280x800 + 390 px phone, keyboard, a11y tree, axe)
const { chromium, devices } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.UI_BASE || 'http://127.0.0.1:3000';
const API = process.env.API_BASE || 'http://localhost:8080';
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'shots');
const LOGS = path.join(ROOT, 'logs');
const T = 'ux2-sre';
const log = [];
const consoleIssues = [];
function rec(step, data = {}) { const e = { step, at: new Date().toISOString(), ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data).slice(0, 500)); }
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); }
async function api(method, p, body) { const r = await fetch(API + p, { method, headers: { 'X-Client-Id': 'ux2-reviewer', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text }; }
const active = (page) => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return { tag: 'body' }; const cs = getComputedStyle(a); const r = a.getBoundingClientRect(); return { tag: a.tagName.toLowerCase(), role: a.getAttribute('role'), name: a.getAttribute('aria-label') || (a.labels && a.labels[0] && a.labels[0].textContent.trim()) || a.textContent.trim().slice(0, 80), type: a.getAttribute('type'), outline: cs.outlineStyle + ' ' + cs.outlineWidth, boxShadow: cs.boxShadow !== 'none', inViewport: r.top >= 0 && r.bottom <= innerHeight, top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
async function tabStops(page, n) { const stops = []; for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); stops.push(await active(page)); } return stops; }
const box = async (loc) => { const b = await loc.boundingBox(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };
const mainText = (page) => page.locator('main').innerText().then((t) => t.replace(/\s+/g, ' ').trim());
async function axe(page, name) { try { const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); rec(`axe:${name}`, { violations: r.violations.length, ids: r.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), incomplete: r.incomplete.map((v) => v.id), passes: r.passes.length }); } catch (e) { rec(`axe:${name}`, { error: String(e) }); } }
function wire(page, tag) { page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleIssues.push({ tag, type: m.type(), text: m.text().slice(0, 200) }); }); page.on('pageerror', (e) => consoleIssues.push({ tag, type: 'pageerror', text: String(e).slice(0, 200) })); }
const localDT = (ms) => { const d = new Date(Date.now() + ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

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
  status: (p) => p.locator('[role=status]').first(),
  cards: (p) => p.locator('article'),
  typeFilter: (p) => p.getByLabel('Type', { exact: true }),
  badge: (p) => p.locator('main').getByText(/^(Live|Reconnecting|Connecting|Paused)/).first(),
};
async function fillOutage(page, { title, body = 'Card payments fail for roughly 30% of requests. Retries succeed.', services = 'payments-api, checkout-web', ticket = '', publisher = 'ux2-oncall', extRef = '' }) {
  await L.title(page).fill(title); await L.details(page).fill(body); await L.services(page).fill(services);
  await L.ticket(page).fill(ticket); if (publisher) await L.publisher(page).fill(publisher); await L.extRef(page).fill(extRef);
}
async function step(name, fn) { try { await fn(); } catch (e) { rec(`${name}:ERROR`, { error: String(e).slice(0, 300) }); } }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  const page = await ctx.newPage(); wire(page, 'desktop');
  const feedReqs = []; page.on('request', (r) => { if (r.url().includes('/v1/feed')) feedReqs.push(r.url().replace(/^.*\/v1/, '/v1')); });

  await step('landing', async () => {
    await page.goto(BASE); await page.waitForLoadState('networkidle');
    rec('landing', { title: await page.title(), tenantValue: await L.headerTenant(page).inputValue(), placeholder: await L.headerTenant(page).getAttribute('placeholder'), tenantTitleAttr: await L.headerTenant(page).getAttribute('title'), prompt: await page.locator('main > p').first().innerText().catch(() => null), emptyTitle: await page.locator('main').getByText('Choose a tenant').count(), mainText: await mainText(page), activeAtLoad: await active(page), feedRequests: feedReqs.length });
    rec('landing-tab-order', { stops: (await tabStops(page, 7)).map((s) => `${s.tag}${s.role ? '[' + s.role + ']' : ''} "${s.name}" ring=${s.outline}`) });
    await shot(page, '01-landing-first-visit');
    await axe(page, 'landing-light');
  });

  await step('type-tenant', async () => {
    feedReqs.length = 0;
    await L.headerTenant(page).click(); await page.keyboard.type(T, { delay: 80 }); await page.waitForTimeout(1500);
    rec('type-tenant', { requests: feedReqs.length, feedGets: feedReqs.filter((u) => u.startsWith('/v1/feed?')).length, streams: feedReqs.filter((u) => u.startsWith('/v1/feed/stream')).length, sample: feedReqs.slice(0, 3), mainText: await mainText(page), badge: await L.badge(page).innerText().catch(() => null) });
    await shot(page, '02-feed-all-clear');
  });

  await step('publish-form', async () => {
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(300);
    const sw = page.getByRole('switch', { name: 'Save as draft' }); const row = page.locator('label', { has: sw });
    rec('publish-hints', { ticketHint: await page.getByText(/The INC tracking this/).innerText().catch(() => null), refHint: await page.getByText(/idempotency key/).innerText().catch(() => null), tenantHint: await page.getByText(/whose feed this lands in/).innerText().catch(() => null), formTenant: await L.formTenant(page).inputValue(), publisher: await L.publisher(page).inputValue(), submitLabel: await L.submit(page).innerText(), docTitle: await page.title() });
    rec('draft-switch', { switch: await box(sw), row: await box(row), rowText: await row.innerText() });
    await L.submit(page).click(); await page.waitForTimeout(300);
    rec('submit-empty', { active: await active(page), summary: await L.alerts(page).last().innerText().catch(() => null), alerts: await L.alerts(page).count() });
    await shot(page, '03-publish-empty-submit');
  });

  await step('publish-success', async () => {
    await fillOutage(page, { title: 'Payments API returning 503s', ticket: 'INC2000001' });
    await L.title(page).press('Enter'); await page.getByRole('heading', { name: /published|scheduled|saved/ }).waitFor({ timeout: 10000 });
    rec('publish-success', { active: await active(page), text: await mainText(page), ticketLink: await page.locator('main a').count() });
    await shot(page, '04-publish-success');
    await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForTimeout(200);
    rec('publish-another-focus', { active: await active(page), tenant: await L.formTenant(page).inputValue(), publisher: await L.publisher(page).inputValue(), type: await page.getByRole('radiogroup', { name: 'Type' }).getByRole('radio', { checked: true }).innerText() });
  });

  await step('duplicate-409', async () => {
    await fillOutage(page, { title: 'Payments API returning 503s (second notice)', ticket: 'INC2000001' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await L.submit(page).click(); await page.waitForTimeout(1500);
    rec('duplicate-409', { text: await L.banner(page).innerText().catch(() => null), active: await active(page), bannerBox: await box(L.banner(page)), submitBox: await box(L.submit(page)), scrollY: await page.evaluate(() => scrollY) });
    await shot(page, '05-409-banner-desktop');
    await axe(page, 'publish-409-light');
    await L.extRef(page).fill('INC2000001-2'); await L.submit(page).click(); await page.getByRole('heading', { name: /published/ }).waitFor({ timeout: 10000 });
    rec('duplicate-advice-works', { heading: await page.locator('main h2').innerText(), text: await mainText(page) });
    await page.getByRole('button', { name: 'View in feed' }).click(); await page.waitForTimeout(1500);
    rec('view-in-feed', { tenant: await L.headerTenant(page).inputValue(), type: await L.typeFilter(page).inputValue(), cards: await L.cards(page).count(), tabSelected: await L.tab(page, 'Feed').getAttribute('aria-selected'), hash: await page.evaluate(() => location.hash), docTitle: await page.title() });
    await shot(page, '06-feed-two-cards');
    const first = L.cards(page).first();
    rec('card-anatomy', { text: await first.innerText().then((t) => t.replace(/\s+/g, ' ')), stateTag: await first.locator('span.rounded-full').first().innerText(), stateTransform: await first.locator('span.rounded-full').first().evaluate((e) => getComputedStyle(e).textTransform), links: await first.locator('a').count(), buttons: await first.getByRole('button').allInnerTexts(), titleRole: await first.locator('h3').count() });
  });

  await step('maintenance', async () => {
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
    await page.getByRole('radio', { name: 'Maintenance' }).click();
    await L.title(page).fill('Planned database upgrade'); await L.publisher(page).fill('ux2-oncall');
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByLabel('Starts').fill(localDT(3600e3)); await page.getByLabel(/^Ends/).fill(localDT(7200e3));
    rec('timing-subtitle', { text: await page.getByText(/local time zone|Starts now and stays up/).innerText().catch(() => null) });
    await L.submit(page).click(); await page.getByRole('heading', { name: /scheduled/ }).waitFor({ timeout: 10000 });
    rec('maintenance-success', { text: await mainText(page) });
    await page.getByRole('button', { name: 'View in feed' }).click(); await page.waitForTimeout(1500);
    const mcard = L.cards(page).first(); const mtext = await mcard.innerText().then((t) => t.replace(/\s+/g, ' '));
    rec('maintenance-card', { type: await L.typeFilter(page).inputValue(), text: mtext, startsInCount: (mtext.match(/Starts in/gi) || []).length, stateTag: await mcard.locator('span.rounded-full').first().innerText(), transform: await mcard.locator('span.rounded-full').first().evaluate((e) => getComputedStyle(e).textTransform), sections: await page.locator('main section h2').allInnerTexts() });
    await shot(page, '07-maintenance-card');
  });

  await step('feed-all-types', async () => {
    await L.typeFilter(page).selectOption(''); await page.waitForTimeout(1500);
    rec('feed-all-types', { cards: await L.cards(page).count(), sections: await page.locator('main section h2').allInnerTexts(), badge: await L.badge(page).innerText().catch(() => null), tabBadge: await L.tab(page, 'Feed').innerText() });
    await axe(page, 'feed-cards-light');
    fs.writeFileSync(path.join(LOGS, 'aria-feed.txt'), await page.locator('body').ariaSnapshot());
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    rec('feed-tab-order', { stops: (await tabStops(page, 24)).map((s) => `${s.tag}${s.role ? '[' + s.role + ']' : ''} "${s.name}" ring=${s.outline}|${s.boxShadow}`) });
  });

  await step('resolve', async () => {
    const resolveBtn = page.getByRole('button', { name: 'Resolve' }).first(); await resolveBtn.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    rec('resolve-confirm', { text: await page.locator('article p', { hasText: /\?/ }).first().innerText(), active: await active(page) });
    await shot(page, '08-resolve-confirm');
    rec('resolve-confirm-tab', { stops: (await tabStops(page, 3)).map((s) => `${s.tag} "${s.name}"`) });
    await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    rec('after-resolve', { status: await L.status(page).innerText().catch(() => null), active: await active(page), cards: await L.cards(page).count() });
    await shot(page, '09-after-resolve');
    const wd = page.getByRole('button', { name: 'Withdraw' }).first(); await wd.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    rec('withdraw-confirm', { text: await page.locator('article p', { hasText: /\?/ }).first().innerText() });
    await page.getByRole('button', { name: 'Withdraw' }).last().click(); await page.waitForTimeout(1500);
    rec('after-withdraw', { status: await L.status(page).innerText().catch(() => null), cards: await L.cards(page).count() });
    await page.getByRole('button', { name: 'Resolve' }).first().click(); await page.getByRole('button', { name: 'Resolve' }).last().click(); await page.waitForTimeout(1500);
    rec('resolve-last', { status: await L.status(page).innerText().catch(() => null), active: await active(page), empty: await page.locator('main').getByText('All clear').count(), mainText: await mainText(page) });
  });

  await step('variants', async () => {
    const variants = [
      ['500-empty', { status: 500, body: '' }],
      ['500-json', { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected error' }) }],
      ['503-db', { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database unavailable' }) }],
      ['502-html', { status: 502, contentType: 'text/html', body: '<html><body><h1>502 Bad Gateway</h1></body></html>' }],
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
      await L.tab(page, 'Feed').click(); await page.waitForTimeout(300);
    }
    for (const [name, resp] of [['feed-503-db', { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database unavailable' }) }], ['feed-500-json', { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected error' }) }]]) {
      await page.route(/\/v1\/feed\?/, (route) => route.fulfill(resp));
      await page.getByRole('button', { name: 'Refresh' }).click(); await page.waitForTimeout(800);
      rec(name, { text: await mainText(page), badge: await L.badge(page).innerText().catch(() => null) });
      if (name === 'feed-503-db') await shot(page, '10b-feed-db-unavailable');
      await page.unroute(/\/v1\/feed\?/);
    }
    await page.getByRole('button', { name: 'Try again' }).click().catch(() => {}); await page.waitForTimeout(800);
  });

  await step('validation-extras', async () => {
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
    await fillOutage(page, { title: 'x', ticket: 'INC12' }); await L.submit(page).click(); await page.waitForTimeout(200);
    rec('bad-ticket', { error: await L.alerts(page).first().innerText(), active: await active(page) });
    await L.ticket(page).fill(''); await page.getByRole('radio', { name: 'Info' }).click(); await L.submit(page).click(); await page.waitForTimeout(200);
    rec('severity-floor', { error: await L.alerts(page).first().innerText(), active: await active(page) });
    await page.getByRole('radio', { name: 'Major' }).click(); await page.getByRole('radio', { name: 'Maintenance' }).click(); await L.submit(page).click(); await page.waitForTimeout(300);
    rec('maintenance-needs-end', { error: await L.alerts(page).first().innerText(), active: await active(page), timingOpen: await page.getByLabel(/^Ends/).count() });
    await page.getByRole('radio', { name: 'Outage' }).click(); await L.title(page).fill('Draft notice'); await page.getByRole('switch', { name: 'Save as draft' }).click();
    rec('draft-button', { label: await L.submit(page).innerText(), checked: await page.getByRole('switch', { name: 'Save as draft' }).getAttribute('aria-checked') });
    await L.submit(page).click(); await page.getByRole('heading', { name: /Draft saved/ }).waitFor({ timeout: 10000 });
    rec('draft-saved', { text: await mainText(page), viewInFeed: await page.getByRole('button', { name: 'View in feed' }).count() });
    await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForTimeout(200);
  });

  await step('keyboard-controls', async () => {
    await L.tab(page, 'Publish').focus(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300);
    rec('tabs-arrow', { feedSelected: await L.tab(page, 'Feed').getAttribute('aria-selected'), active: await active(page) });
    await L.tab(page, 'Publish').click(); await page.waitForTimeout(200);
    const group = page.getByRole('radiogroup', { name: 'Type' }); await group.getByRole('radio', { checked: true }).focus(); await page.keyboard.press('ArrowRight');
    rec('segmented-arrow', { nowChecked: await group.getByRole('radio', { checked: true }).innerText(), active: await active(page) });
    await page.keyboard.press('Home');
    fs.writeFileSync(path.join(LOGS, 'aria-publish.txt'), await page.locator('body').ariaSnapshot());
    await axe(page, 'publish-empty-light');
  });

  await step('dark', async () => {
    const tt = page.getByRole('button', { name: /Switch to (dark|light) mode/ }); rec('theme-toggle', { name: await tt.getAttribute('aria-label') });
    await tt.click(); await page.waitForTimeout(700); rec('theme-after', { name: await page.getByRole('button', { name: /Switch to/ }).getAttribute('aria-label'), stored: await page.evaluate(() => localStorage.getItem('atlas-theme')), scheme: await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme) });
    await fillOutage(page, { title: 'Dark 409', ticket: 'INC2000001' }); await L.submit(page).click(); await page.waitForTimeout(1200);
    rec('dark-409', { text: await L.banner(page).innerText().catch(() => null) });
    await shot(page, '11-publish-dark-409'); await axe(page, 'publish-409-dark');
    await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux2-oncall', type: 'OUTAGE', severity: 'CRITICAL', title: 'Checkout down in eu-west', body: 'All card payments fail. Next update 10:30 UTC.', affectedServices: ['checkout-web'], ticket: { number: 'INC2000002' }, audience: 'INTERNAL' });
    await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux2-oncall', type: 'INCIDENT', severity: 'MINOR', title: 'Slow search results', affectedServices: ['search-api'] });
    await L.tab(page, 'Feed').click(); await page.waitForTimeout(300); await L.typeFilter(page).selectOption(''); await page.waitForTimeout(1500);
    rec('feed-dark', { cards: await L.cards(page).count(), badge: await L.badge(page).innerText().catch(() => null) }); await shot(page, '12-feed-dark'); await axe(page, 'feed-cards-dark');
  });

  await step('live', async () => {
    const page2 = await ctx.newPage(); wire(page2, 'page2'); await page2.goto(BASE + '#/feed'); await page2.waitForTimeout(1500);
    await L.typeFilter(page2).selectOption(''); await page2.waitForTimeout(1200);
    const before = await L.cards(page2).count();
    const t0 = Date.now(); const pub = await api('POST', '/v1/communications', { tenantId: T, publisher: 'api-bot', type: 'OUTAGE', severity: 'MAJOR', title: 'Live push test', affectedServices: ['live-api'] });
    await page2.locator('article', { hasText: 'Live push test' }).waitFor({ timeout: 10000 }); const createdMs = Date.now() - t0;
    const t1 = Date.now(); await api('POST', `/v1/communications/${pub.json.id}/retire`, { actor: 'api-bot', note: 'done' });
    await page2.locator('article', { hasText: 'Live push test' }).waitFor({ state: 'detached', timeout: 10000 }); const retiredMs = Date.now() - t1;
    rec('live', { before, publishStatus: pub.status, createdMs, retiredMs, badge: await L.badge(page2).innerText().catch(() => null) });
    await page2.close();
  });

  await step('empty-states', async () => {
    await L.headerTenant(page).fill('ux2-fresh-tenant'); await page.waitForTimeout(1500); rec('empty-fresh-all-types', { text: await mainText(page) });
    await page.getByLabel('Service').fill('no-such-service'); await page.waitForTimeout(1500); rec('empty-filter', { text: await mainText(page) });
    await page.getByLabel('Service').fill('');
    await L.headerTenant(page).fill('ux1-many'); await page.waitForTimeout(3000);
    rec('cap-notice', { text: await page.locator('main').getByText(/Showing the first/).innerText().catch(() => null), tabBadge: await L.tab(page, 'Feed').innerText(), cards: await L.cards(page).count() });
    await L.headerTenant(page).fill(''); await page.waitForTimeout(800); rec('empty-no-tenant', { text: await mainText(page), prompt: await page.locator('main > p').first().innerText().catch(() => null) });
    await L.headerTenant(page).fill(T); await page.waitForTimeout(1000);
  });

  await step('phone', async () => {
    const phone = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'light' }); const pp = await phone.newPage(); wire(pp, 'phone');
    await pp.goto(BASE); await pp.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux2-oncall'); localStorage.setItem('atlas-theme', 'light'); }, T); await pp.reload(); await pp.waitForTimeout(1500);
    await L.typeFilter(pp).selectOption(''); await pp.waitForTimeout(1500);
    const small = await pp.evaluate(() => [...document.querySelectorAll('button, a, input, select, textarea, [role=switch], [role=radio], [role=tab]')].map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((e) => e.w > 0 && (e.w < 24 || e.h < 24)));
    rec('phone-feed', { viewport: pp.viewportSize(), scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), cards: await L.cards(pp).count(), smallTargets: small, h1Visible: await pp.locator('h1').isVisible(), tenantBox: await box(L.headerTenant(pp)), badge: await L.badge(pp).innerText().catch(() => null) });
    await shot(pp, '13-phone-feed'); await axe(pp, 'phone-feed-light');
    await pp.getByRole('button', { name: 'Resolve' }).first().click(); await pp.waitForTimeout(300); await shot(pp, '14-phone-resolve-confirm');
    rec('phone-resolve-confirm', { scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), confirmText: await pp.locator('article p', { hasText: /\?/ }).first().innerText(), buttons: await pp.getByRole('button', { name: /^(Cancel|Resolve)$/ }).count() });
    await pp.getByRole('button', { name: 'Cancel' }).click();
    await L.tab(pp, 'Publish').click(); await pp.waitForTimeout(300); await L.submit(pp).click(); await pp.waitForTimeout(300);
    rec('phone-submit-empty', { active: await active(pp), summary: await L.alerts(pp).last().innerText().catch(() => null) });
    await shot(pp, '15-phone-publish-errors');
    await fillOutage(pp, { title: 'Phone 409', ticket: 'INC2000001' }); await pp.evaluate(() => window.scrollTo(0, 0)); await L.submit(pp).click(); await pp.waitForTimeout(1200);
    rec('phone-409', { active: await active(pp), bannerBox: await box(L.banner(pp)), innerHeight: await pp.evaluate(() => innerHeight), scrollWidth: await pp.evaluate(() => document.documentElement.scrollWidth), text: await L.banner(pp).innerText().catch(() => null) });
    await shot(pp, '16-phone-publish-409'); await axe(pp, 'phone-publish-409-light');
    await phone.close();
    const dark = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'dark' }); const dp = await dark.newPage(); wire(dp, 'phone-dark');
    await dp.goto(BASE); await dp.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('atlas-theme', 'dark'); }, T); await dp.reload(); await dp.waitForTimeout(1500); await L.typeFilter(dp).selectOption(''); await dp.waitForTimeout(1500);
    rec('phone-feed-dark', { scrollWidth: await dp.evaluate(() => document.documentElement.scrollWidth), cards: await L.cards(dp).count() }); await shot(dp, '17-phone-feed-dark'); await axe(dp, 'phone-feed-dark');
    await dark.close();
  });

  await step('cleanup', async () => {
    for (const status of ['ACTIVE', 'SCHEDULED']) {
      const l = await api('GET', `/v1/communications?tenantId=${T}&status=${status}&size=100`);
      for (const c of l.json?.items ?? []) await api('POST', `/v1/communications/${c.id}/retire`, { actor: 'ux2-reviewer', note: 'review cleanup' });
    }
    rec('cleanup', { done: true });
  });

  rec('console', { issues: consoleIssues.length, sample: consoleIssues.slice(0, 8) });
  fs.writeFileSync(path.join(LOGS, 'ux2-ui-log.json'), JSON.stringify(log, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(path.join(LOGS, 'ux2-ui-log.json'), JSON.stringify(log, null, 2)); process.exit(1); });
