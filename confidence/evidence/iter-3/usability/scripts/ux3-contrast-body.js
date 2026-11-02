// ux3-contrast-body.js — read-only: hand-check the contrast axe left "incomplete" (the Body textarea), light + dark, 1280x800
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto('http://127.0.0.1:3000/');
    await p.evaluate((t) => { localStorage.setItem('comm-tenant', 'ux3-sre'); localStorage.setItem('atlas-theme', t); }, theme);
    await p.reload(); await p.waitForTimeout(1200);
    await p.getByRole('tab', { name: 'Publish' }).click(); await p.waitForTimeout(400);
    const out = await p.evaluate(() => {
      const el = document.getElementById('_r_1_-body');
      const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, bb]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bb); };
      const ratio = (a, b2) => { const [l1, l2] = [lum(a), lum(b2)].sort((x, y) => y - x); return ((l1 + 0.05) / (l2 + 0.05)).toFixed(2); };
      // first opaque background up the tree
      let n = el, bg = null; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] === 1)) { bg = c.slice(0, 3); break; } n = n.parentElement; }
      const fg = parse(getComputedStyle(el).color).slice(0, 3);
      const ph = parse(getComputedStyle(el, '::placeholder').color).slice(0, 3);
      const r = el.getBoundingClientRect();
      const mid = document.elementFromPoint(r.left + r.width / 2, Math.min(r.bottom - 2, window.innerHeight - 2));
      return { label: el.labels && el.labels[0] && el.labels[0].innerText, rect: [Math.round(r.top), Math.round(r.bottom)], viewportH: window.innerHeight, fg, bg, text: ratio(fg, bg), placeholder: ph, placeholderRatio: ratio(ph, bg), placeholderText: el.placeholder, atBottomEdge: mid ? (mid === el ? 'textarea itself' : mid.tagName + '.' + mid.className) : null };
    });
    console.log(theme, JSON.stringify(out));
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
