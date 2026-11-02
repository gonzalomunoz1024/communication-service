// ux4-console-sweep.js — every console message and page error over one full user path, dev (:3600, StrictMode) and production bundle (:3602 preview)
// on private backends; the only 4xx/5xx the path provokes is one deliberate duplicate (409).
const { chromium, devices } = require('playwright'); const C = require('./common'); const { rec, save } = C.recorder('ux4-console-sweep'); const L = C.L;
const fill = async (page, title, ticket) => { await L.title(page).fill(title); await L.details(page).fill('Console sweep body.'); await L.services(page).fill('sweep-api'); await L.ticket(page).fill(ticket); await L.publisher(page).fill('ux4-oncall'); await L.extRef(page).fill(''); };
(async () => {
  const b = await chromium.launch();
  for (const [label, url, tenant] of [['dev-3600', 'http://127.0.0.1:3600/', 'ux4-console-a'], ['prod-preview-3602', 'http://127.0.0.1:3602/', 'ux4-console-b']]) {
    const msgs = []; const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
    const wire = (p, tag) => { p.on('console', (m) => msgs.push({ tag, type: m.type(), text: m.text().slice(0, 160) })); p.on('pageerror', (e) => msgs.push({ tag, type: 'pageerror', text: String(e).slice(0, 160) })); };
    wire(page, 'desktop');
    const ticket = 'INC77' + String(Date.now()).slice(-5);
    try {
      await page.goto(url); await page.evaluate((t) => localStorage.setItem('comm-tenant', t), tenant); await page.reload(); await page.waitForTimeout(1500);
      await L.tab(page, 'Publish').click(); await L.submit(page).click(); await page.waitForTimeout(300);           // client-side validation only
      await fill(page, 'Console sweep notice', ticket); await L.submit(page).click(); await page.getByRole('heading', { name: /published/ }).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Publish another' }).click(); await fill(page, 'Console sweep duplicate', ticket); await L.submit(page).click(); await page.waitForTimeout(1500); // the one deliberate 409
      await page.getByRole('button', { name: /Use .*suggest|Use INC/ }).first().click({ timeout: 2000 }).catch(() => {});
      await L.tab(page, 'Feed').click(); await page.waitForTimeout(1200);
      await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 }).catch(() => {}); await page.waitForTimeout(800); await page.getByLabel('Type', { exact: true }).selectOption({ index: 0 }).catch(() => {});
      await page.getByRole('button', { name: 'Refresh' }).click(); await page.waitForTimeout(800);
      const r = page.getByRole('button', { name: 'Resolve' }).first(); await r.click(); await page.keyboard.press('Escape'); await r.click();
      await page.getByRole('group').getByRole('textbox').first().fill('sweep done').catch(() => {}); await page.getByRole('group').getByRole('button', { name: /Resolve/ }).first().click().catch(() => {}); await page.waitForTimeout(1200);
      await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click(); await page.waitForTimeout(300); await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click();
      const pp = await (await b.newContext({ ...devices['iPhone 14'] })).newPage(); wire(pp, 'phone'); await pp.goto(url); await pp.evaluate((t) => localStorage.setItem('comm-tenant', t), tenant); await pp.reload(); await pp.waitForTimeout(2500);
      // clean up whatever is still active in the sweep tenant
      const api = C.apiClient(label.startsWith('dev') ? 'http://127.0.0.1:19600' : 'http://127.0.0.1:19601');
      const feed = await api('GET', `/v1/feed?tenantId=${tenant}`); for (const it of ((feed.json || {}).items || [])) await api('POST', `/v1/communications/${it.id}/retire`, { actor: 'ux4-reviewer', note: 'review cleanup' });
    } catch (e) { msgs.push({ tag: 'script', type: 'SCRIPT-ERROR', text: String(e).slice(0, 200) }); }
    const groups = {}; for (const m of msgs) { const k = `${m.tag} ${m.type}: ${m.text.replace(/\d{3,}/g, 'N')}`; groups[k] = (groups[k] || 0) + 1; }
    rec(label, { total: msgs.length, errorsOrWarnings: msgs.filter((m) => /error|warning|pageerror/i.test(m.type)).length, groups });
  }
  await b.close(); save();
})().catch((e) => { console.error(e); save(); process.exit(1); });
