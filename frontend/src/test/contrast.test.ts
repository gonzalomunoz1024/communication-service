/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * WCAG 2.x AA, computed from the Atlas tokens in src/ui/atlas.css: 4.5:1 for text (every text
 * role here is set at 11-15 px, so no pair qualifies as "large text"), 3:1 for graphics.
 * Tints are rgba and are composited over the surface they sit on before measuring.
 */
const css = readFileSync(new URL('../ui/atlas.css', import.meta.url), 'utf8')

type RGB = [number, number, number]
interface Color {
  rgb: RGB
  alpha: number
}

function tokens(selector: string): Record<string, string> {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`no ${selector} block in atlas.css`)
  const out: Record<string, string> = {}
  for (const [, k, v] of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[k] = v.trim()
  return out
}

function parse(value: string): Color {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 }
  }
  const rgba = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/)
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) }
  throw new Error(`unsupported colour ${value}`)
}

const channel = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: RGB) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const over = (fg: Color, bg: RGB): RGB => fg.rgb.map((c, i) => c * fg.alpha + bg[i] * (1 - fg.alpha)) as RGB

function contrast(fg: RGB, bg: RGB): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const WHITE: RGB = [255, 255, 255]
const THEMES: Array<[string, Record<string, string>]> = [
  ['light', tokens(':root')],
  ['dark', tokens('.dark')],
]
const SURFACES = ['--color-surface', '--color-surface-secondary', '--color-surface-tertiary']
/** the surfaces a tinted capsule or alert is placed on (cards and pages; never the tertiary surface) */
const TINT_SURFACES = ['--color-surface', '--color-surface-secondary']
const HUES = ['neutral', 'healthy', 'critical', 'warning']

describe.each(THEMES)('%s theme contrast', (_theme, t) => {
  const solid = (name: string): RGB => {
    const c = parse(t[name] ?? (() => { throw new Error(`${name} missing`) })())
    if (c.alpha !== 1) throw new Error(`${name} is translucent`)
    return c.rgb
  }
  const tinted = (tint: string, surface: string): RGB => over(parse(t[tint]), solid(surface))

  it('every text role reads on every surface (4.5:1)', () => {
    for (const text of ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary']) {
      for (const s of SURFACES) {
        expect(contrast(solid(text), solid(s)), `${text} on ${s}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('white text reads on the accent and critical fills (primary/danger buttons, badges)', () => {
    for (const fill of ['--color-neutral', '--color-critical']) {
      expect(contrast(WHITE, solid(fill)), `white on ${fill}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('each semantic text token reads on its tint and on the plain surfaces (4.5:1)', () => {
    for (const hue of HUES) {
      const text = `--color-${hue}-text`
      for (const s of TINT_SURFACES) {
        expect(contrast(solid(text), tinted(`--color-${hue}-bg`, s)), `${text} on ${hue} tint over ${s}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(solid(text), solid(s)), `${text} on ${s}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('the accent and critical hues work as 3:1 graphics (focus ring, dots, icons) on the main surfaces', () => {
    for (const hue of ['--color-neutral', '--color-critical']) {
      for (const s of TINT_SURFACES) {
        expect(contrast(solid(hue), solid(s)), `${hue} on ${s}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keeps the secondary/tertiary hierarchy', () => {
    const [p, s, te] = ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary'].map((n) => luminance(solid(n)))
    const surface = luminance(solid('--color-surface'))
    // primary stands out most, tertiary least, in both themes
    expect(Math.abs(p - surface)).toBeGreaterThan(Math.abs(s - surface))
    expect(Math.abs(s - surface)).toBeGreaterThan(Math.abs(te - surface))
  })
})

describe('semantic text utilities', () => {
  it('maps a *-fg utility onto the *-text token of every hue and job state', () => {
    for (const hue of ['accent', 'healthy', 'critical', 'warning']) {
      expect(css).toMatch(new RegExp(`--color-${hue}-fg:\\s*var\\(--color-[\\w-]+-text\\)`))
    }
    for (const state of ['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled']) {
      expect(css).toMatch(new RegExp(`--color-state-${state}-fg:\\s*var\\(--color-[\\w-]+\\)`))
    }
  })
})
