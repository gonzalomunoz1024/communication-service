// axe + contrast helpers copied verbatim from v5-a11y.js (iteration-3 verifier's, adapted paths), for the iteration-4 scripts
const L = require('./lib'); const { record } = L
const { AxeBuilder } = require('/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend4/axe/node_modules/@axe-core/playwright')
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const summarise = (res) => res.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map((n) => n.target.join(' ')), summary: x.nodes[0] && x.nodes[0].failureSummary && x.nodes[0].failureSummary.slice(0, 220) }))
async function axe(page, label, tags = WCAG, gate = true) {
  const res = await new AxeBuilder({ page }).withTags(tags).analyze()
  const v = summarise(res)
  const serious = v.filter((x) => x.impact === 'critical' || x.impact === 'serious')
  const contrast = v.filter((x) => x.id === 'color-contrast')
  record('F-65', `axe ${label} [${tags.join(',')}]: ${v.length} violation rule(s), ${serious.length} serious/critical, color-contrast: ${contrast.length}${gate ? '' : ' (informational)'}`, gate ? v.length === 0 : true, { violations: v, passes: res.passes.length, incomplete: res.incomplete.map((i) => i.id) })
  return v
}
async function active(page) {
  return page.evaluate(() => { const e = document.activeElement; if (!e) return null; const lab = e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`) && document.querySelector(`label[for="${CSS.escape(e.id)}"]`).textContent) || e.textContent; return `${e.tagName.toLowerCase()}${e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''}:${(lab || '').trim().slice(0, 30)}` })
}
async function contrastSamples(page) {
  return page.evaluate(() => {
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
    const parse = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
    const over = (top, under) => { const a = top.a + under.a * (1 - top.a); return { r: (top.r * top.a + under.r * under.a * (1 - top.a)) / a, g: (top.g * top.a + under.g * under.a * (1 - top.a)) / a, b: (top.b * top.a + under.b * under.a * (1 - top.a)) / a, a } }
    const bgOf = (el) => { let acc = null; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) return acc } } const base = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; return acc ? over(acc, { ...base, a: 1 }) : base }
    const ratio = (f, b) => { const l1 = lum(f), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
    const groups = { 'tertiary text (captions, hints, meta)': '.text-tertiary', 'secondary text': '.text-secondary', 'section headings h2': 'h2', 'text inside tinted tags/banners': '[class*="-tint"]', 'critical text': '.text-critical-fg', 'accent text': '.text-accent-fg', 'captions (.text-caption)': '.text-caption', 'state capsules': '[class*="bg-state-"]' }
    const out = {}
    for (const [name, sel] of Object.entries(groups)) {
      const els = [...document.querySelectorAll(sel)].filter((e) => e.textContent.trim() && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').slice(0, 20)
      const rs = els.map((e) => { const cs = getComputedStyle(e); const fg = parse(cs.color); const bg = bgOf(e); const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700; const large = size >= 24 || (size >= 18.66 && bold); const fgc = fg.a < 1 ? over(fg, { ...bg, a: 1 }) : fg; return { text: e.textContent.trim().slice(0, 26), fg: cs.color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, px: size, ratio: +ratio(fgc, bg).toFixed(2), needs: large ? 3 : 4.5 } })
      rs.sort((a, b) => a.ratio - b.ratio)
      out[name] = { sampled: rs.length, min: rs.length ? rs[0].ratio : null, belowAA: rs.filter((r) => r.ratio < r.needs).length, worst: rs.slice(0, 2) }
    }
    return out
  })
}

module.exports = { axe, contrastSamples, WCAG }
