import type { Tone } from './Tag'

/*
 * The status-word folding that StateTag and stateTone() share. Kept out of Tag.tsx so that file
 * exports components only (Fast Refresh needs that); the kit's index re-exports these.
 */

/** The job states the platform tints; the API's richer statuses fold onto these. */
export type JobState = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'

/** Folds any status word onto one of the six tinted states. */
export function jobState(status: string): JobState {
  const s = status.toLowerCase()
  if (s === 'queued' || s === 'pending') return 'queued'
  if (s === 'running' || s === 'in-progress' || s === 'canary') return 'running'
  if (s.includes('wait') || s.includes('attention') || s === 'paused' || s === 'degraded') return 'waiting'
  if (s === 'succeeded' || s === 'passed' || s === 'promoted' || s === 'approved' || s === 'healthy' || s === 'merged' || s === 'ready' || s === 'published' || s === 'up') return 'succeeded'
  if (s === 'failed' || s === 'rejected' || s === 'rolled-back' || s === 'failing' || s === 'error' || s === 'down') return 'failed'
  if (s === 'cancelled' || s === 'canceled' || s === 'skipped' || s === 'expired' || s === 'closed' || s === 'retired' || s === 'compensated' || s === 'unknown') return 'cancelled'
  return 'cancelled'
}

/** The Tag tone that matches a state. */
export function stateTone(status: string): Tone {
  const state = jobState(status)
  if (state === 'queued' || state === 'running') return 'accent'
  if (state === 'waiting') return 'warning'
  if (state === 'succeeded') return 'healthy'
  if (state === 'failed') return 'critical'
  return 'neutral'
}
