import { describe, expect, it } from 'vitest'
import { bytes, dayLabel, duration, formatNumber, isoDate, longDate, percent, plural, relativeTime, shortDate, truncateMiddle } from '../ui/format'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
/** 2026-11-02T12:00:00Z, the "now" every relative check is measured from. */
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0)
const ago = (ms: number) => NOW - ms
const ahead = (ms: number) => NOW + ms
const utc = { timeZone: 'UTC' }

describe('relativeTime', () => {
  it('rounds to the nearest unit, in the past and in the future', () => {
    expect(relativeTime(NOW, NOW)).toBe('just now')
    expect(relativeTime(ago(44_000), NOW)).toBe('just now')
    expect(relativeTime(ago(45_000), NOW)).toBe('1m ago')
    expect(relativeTime(ago(3 * MIN), NOW)).toBe('3m ago')
    expect(relativeTime(ahead(59 * MIN), NOW)).toBe('in 59m')
    expect(relativeTime(ago(2 * HOUR), NOW)).toBe('2h ago')
    expect(relativeTime(ahead(23 * HOUR), NOW)).toBe('in 23h')
    expect(relativeTime(ago(5 * DAY), NOW)).toBe('5d ago')
    expect(relativeTime(ahead(3 * DAY), NOW)).toBe('in 3d')
    expect(relativeTime(ago(14 * DAY), NOW)).toBe('2w ago')
    expect(relativeTime(ahead(20 * DAY), NOW)).toBe('in 3w')
  })

  it('treats a few seconds ahead as clock skew, not as the future', () => {
    expect(relativeTime(ahead(4_000), NOW)).toBe('just now')
    expect(relativeTime(ahead(30_000), NOW)).toBe('in a moment')
  })

  it('falls back to the short date beyond a month and to a dash for an unreadable input', () => {
    expect(relativeTime(ago(40 * DAY), NOW)).toBe(shortDate(ago(40 * DAY), { now: NOW }))
    expect(relativeTime('not a date', NOW)).toBe('—')
  })

  it('accepts a Date, a number or an ISO string for both instants', () => {
    expect(relativeTime(new Date(ago(MIN)), new Date(NOW))).toBe('1m ago')
    expect(relativeTime(new Date(ago(MIN)).toISOString(), NOW)).toBe('1m ago')
    expect(relativeTime(ago(MIN), new Date(NOW).toISOString())).toBe('1m ago')
  })
})

describe('duration', () => {
  it('picks the unit by size and drops a zero remainder', () => {
    expect(duration(340)).toBe('340ms')
    expect(duration(1_200)).toBe('1.2s')
    expect(duration(3_000)).toBe('3s')
    expect(duration(45_000)).toBe('45s')
    expect(duration(72_000)).toBe('1m 12s')
    expect(duration(120_000)).toBe('2m')
    expect(duration(2 * HOUR + 5 * MIN)).toBe('2h 5m')
    expect(duration(3 * HOUR)).toBe('3h')
    expect(duration(3 * DAY + 4 * HOUR)).toBe('3d 4h')
    expect(duration(2 * DAY)).toBe('2d')
  })

  it('clamps negatives to zero and dashes out nothing and infinity', () => {
    expect(duration(-5)).toBe('0ms')
    expect(duration(null)).toBe('—')
    expect(duration(undefined)).toBe('—')
    expect(duration(Number.POSITIVE_INFINITY)).toBe('—')
    expect(duration(Number.NaN)).toBe('—')
  })
})

describe('formatNumber', () => {
  it('groups digits and picks the fraction digits from the magnitude', () => {
    expect(formatNumber(12345)).toBe('12,345')
    expect(formatNumber(0.4237)).toBe('0.42')
    expect(formatNumber(12.345)).toBe('12.3')
    expect(formatNumber(-7)).toBe('-7')
  })

  it('honours explicit digits, compact notation and a locale', () => {
    expect(formatNumber(1.23456, { digits: 3 })).toBe('1.235')
    expect(formatNumber(1234, { compact: true })).toBe('1.2K')
    expect(formatNumber(3_400_000, { compact: true })).toBe('3.4M')
    expect(formatNumber(1234.5, { locale: 'de-DE', digits: 1 })).toBe('1.234,5')
  })

  it('dashes out nothing', () => {
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(undefined)).toBe('—')
    expect(formatNumber(Number.NaN)).toBe('—')
  })
})

describe('percent', () => {
  it('formats values and ratios, whole numbers without decimals', () => {
    expect(percent(99.5)).toBe('99.5%')
    expect(percent(100)).toBe('100%')
    expect(percent(0.125, { ratio: true })).toBe('12.5%')
    expect(percent(0.5, { ratio: true })).toBe('50%')
    expect(percent(33.333, { digits: 2 })).toBe('33.33%')
    expect(percent(undefined)).toBe('—')
    expect(percent(Number.NaN)).toBe('—')
  })
})

describe('bytes', () => {
  it('uses binary units and trims trailing zeros', () => {
    expect(bytes(0)).toBe('0 B')
    expect(bytes(512)).toBe('512 B')
    expect(bytes(1536)).toBe('1.5 KB')
    expect(bytes(1024 * 1024)).toBe('1 MB')
    expect(bytes(5 * 1024 ** 3, 2)).toBe('5 GB')
    expect(bytes(1.25 * 1024 ** 4, 2)).toBe('1.25 TB')
    expect(bytes(1024 ** 6)).toBe('1024 PB')
  })

  it('keeps the sign and dashes out nothing', () => {
    expect(bytes(-2048)).toBe('-2 KB')
    expect(bytes(null)).toBe('—')
    expect(bytes(Number.NaN)).toBe('—')
  })
})

describe('shortDate, dayLabel, longDate, isoDate', () => {
  it('shows the time today, the day and time this year, and the date otherwise', () => {
    expect(shortDate(ago(2 * HOUR), { now: NOW, ...utc })).toBe('10:00')
    expect(shortDate(Date.UTC(2026, 9, 17, 14, 5), { now: NOW, ...utc })).toBe('17 Oct, 14:05')
    expect(shortDate(Date.UTC(2025, 9, 17, 14, 5), { now: NOW, ...utc })).toBe('17 Oct 2025')
    expect(shortDate('garbage')).toBe('—')
  })

  it('labels a day with its year only when it is not this year', () => {
    expect(dayLabel(Date.UTC(2026, 9, 17), { now: NOW, ...utc })).toBe('17 Oct')
    expect(dayLabel(Date.UTC(2025, 9, 17), { now: NOW, ...utc })).toBe('17 Oct 2025')
    expect(dayLabel(Number.NaN)).toBe('—')
  })

  it('writes the full date and time, and the ISO calendar date in UTC', () => {
    expect(longDate(Date.UTC(2026, 9, 17, 14, 5, 33), utc)).toBe('17 Oct 2026, 14:05:33')
    expect(longDate('garbage')).toBe('—')
    expect(isoDate(Date.UTC(2026, 9, 17, 23, 59))).toBe('2026-10-17')
    expect(isoDate(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01-01')
    expect(isoDate('garbage')).toBe('—')
  })

  it('takes another locale for the date words', () => {
    expect(dayLabel(Date.UTC(2025, 9, 17), { now: NOW, locale: 'en-US', ...utc })).toBe('Oct 17, 2025')
  })
})

describe('truncateMiddle and plural', () => {
  it('keeps both ends of a long identifier and leaves short ones alone', () => {
    expect(truncateMiddle('short')).toBe('short')
    expect(truncateMiddle('job_01HXK4V7Q9ZJ3M8N2P6R5T9F2C', 20)).toBe('job_01HXK4…P6R5T9F2C')
    expect(truncateMiddle('abcdefghij', 5)).toBe('ab…ij')
    expect(truncateMiddle('abcdefghij', 1)).toBe('a…j')
  })

  it('pluralises with the regular -s or the given plural, and groups the count', () => {
    expect(plural(3, 'job')).toBe('3 jobs')
    expect(plural(1, 'job')).toBe('1 job')
    expect(plural(1, 'entry', 'entries')).toBe('1 entry')
    expect(plural(0, 'entry', 'entries')).toBe('0 entries')
    expect(plural(1500, 'job')).toBe('1,500 jobs')
  })
})
