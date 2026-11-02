import { describe, expect, it } from 'vitest'
import { jobState, stateTone, type JobState } from '../ui'

describe('jobState', () => {
  it('folds the API status words onto the six tinted states, whatever their case', () => {
    const table: Record<JobState, string[]> = {
      queued: ['queued', 'PENDING'],
      running: ['running', 'in-progress', 'canary'],
      waiting: ['waiting', 'waiting-for-approval', 'needs-attention', 'paused', 'degraded'],
      succeeded: ['succeeded', 'passed', 'promoted', 'approved', 'healthy', 'merged', 'ready', 'published', 'UP'],
      failed: ['failed', 'rejected', 'rolled-back', 'failing', 'error', 'DOWN'],
      cancelled: ['cancelled', 'canceled', 'skipped', 'expired', 'closed', 'retired', 'compensated', 'unknown', 'something-else'],
    }
    for (const [state, words] of Object.entries(table)) {
      for (const word of words) expect(jobState(word), word).toBe(state)
    }
  })
})

describe('stateTone', () => {
  it('gives each state its capsule tone', () => {
    expect(stateTone('queued')).toBe('accent')
    expect(stateTone('running')).toBe('accent')
    expect(stateTone('paused')).toBe('warning')
    expect(stateTone('healthy')).toBe('healthy')
    expect(stateTone('DOWN')).toBe('critical')
    expect(stateTone('retired')).toBe('neutral')
  })
})
