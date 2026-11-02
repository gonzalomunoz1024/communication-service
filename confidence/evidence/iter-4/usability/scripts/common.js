// common.js — helpers shared by the iteration-4 usability scripts
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots'); const LOGS = path.join(ROOT, 'logs');
function recorder(name) { const log = []; const rec = (step, data = {}) => { const e = { step, at: new Date().toISOString(), ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data).slice(0, 900)); }; const save = () => fs.writeFileSync(path.join(LOGS, `${name}.json`), JSON.stringify(log, null, 2)); return { log, rec, save }; }
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
function apiClient(base, clientId = 'ux4-reviewer') { return async (method, p, body, extraHeaders = {}) => { const t0 = Date.now(); try { const r = await fetch(base + p, { method, headers: { 'X-Client-Id': clientId, 'Content-Type': 'application/json', ...extraHeaders }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), signal: AbortSignal.timeout(40000) }); const text = await r.text(); let json; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text, ms: Date.now() - t0, location: r.headers.get('location') }; } catch (e) { return { error: String(e).slice(0, 160), ms: Date.now() - t0 }; } }; }
const active = (page) => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return { tag: 'body' }; const cs = getComputedStyle(a); const r = a.getBoundingClientRect(); return { tag: a.tagName.toLowerCase(), role: a.getAttribute('role'), name: a.getAttribute('aria-label') || (a.labels && a.labels[0] && a.labels[0].textContent.trim()) || a.textContent.trim().slice(0, 80), id: a.id || null, placeholder: a.getAttribute('placeholder'), outline: cs.outlineStyle + ' ' + cs.outlineWidth, boxShadow: cs.boxShadow !== 'none', inViewport: r.top >= 0 && r.bottom <= innerHeight, top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
async function tabStops(page, n, key = 'Tab') { const stops = []; for (let i = 0; i < n; i++) { await page.keyboard.press(key); stops.push(await active(page)); } return stops; }
const fmt = (s) => `${s.tag}${s.role ? '[' + s.role + ']' : ''} "${(s.name || '').slice(0, 60)}"${s.placeholder ? ' ph=' + s.placeholder : ''} ring=${s.outline}|${s.boxShadow}`;
const box = async (loc) => { const b = await loc.boundingBox().catch(() => null); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };
const mainText = (page) => page.locator('main').innerText().then((t) => t.replace(/\s+/g, ' ').trim()).catch(() => null);
// what the accessibility tree says about the focused element (Chromium's computed role and name)
async function axFocus(page) { const cdp = await page.context().newCDPSession(page); try { await cdp.send('Accessibility.enable'); const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.activeElement' }); const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId }); const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false }); const n = nodes[0] || {}; return { tag: node.nodeName.toLowerCase(), role: n.role && n.role.value, name: n.name && n.name.value, ignored: n.ignored }; } catch (e) { return { error: String(e).slice(0, 120) }; } finally { await cdp.detach().catch(() => {}); } }
async function axe(page, name, rec) { try { const { AxeBuilder } = require('@axe-core/playwright'); const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); rec(`axe:${name}`, { violations: r.violations.length, ids: r.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), incomplete: r.incomplete.map((v) => v.id), passes: r.passes.length }); return r; } catch (e) { rec(`axe:${name}`, { error: String(e) }); } }
// every text change of a live region (role=status|alert or aria-live): a stand-in for what a screen reader is handed
const LIVE = () => { window.__ann = []; const t0 = performance.now(); const seen = new WeakMap(); const check = () => { document.querySelectorAll('[role=status],[role=alert],[aria-live]').forEach((el) => { const txt = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (seen.get(el) !== txt) { seen.set(el, txt); window.__ann.push({ t: Math.round(performance.now() - t0), role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: txt.slice(0, 240) }); } }); }; new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true }); };
const ann = async (page, clear = true) => { const a = await page.evaluate(() => window.__ann || []).catch(() => []); if (clear) await page.evaluate(() => { window.__ann = []; }).catch(() => {}); return a; };
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
  feedAlert: (p) => p.locator('main [role=alert]'),
};
const badgeText = (p) => L.badge(p).innerText().catch(() => null);
const localDT = (ms) => { const d = new Date(Date.now() + ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
module.exports = { ROOT, SHOTS, LOGS, recorder, shot, apiClient, active, tabStops, fmt, box, mainText, axFocus, axe, LIVE, ann, L, badgeText, localDT };
