import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'
import { jobState, type JobState } from './job-state'

export type Tone = 'neutral' | 'accent' | 'healthy' | 'warning' | 'critical'

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-secondary text-secondary',
  accent: 'bg-accent-tint text-accent-fg',
  healthy: 'bg-healthy-tint text-healthy-fg',
  warning: 'bg-warning-tint text-warning-fg',
  critical: 'bg-critical-tint text-critical-fg',
}

const DOT: Record<Tone, string> = {
  neutral: 'bg-tertiary',
  accent: 'bg-accent',
  healthy: 'bg-healthy',
  warning: 'bg-warning',
  critical: 'bg-critical',
}

export interface TagProps {
  tone?: Tone
  children: ReactNode
  icon?: IconName
  /** small leading dot in the tone colour */
  dot?: boolean
  /** pulse the dot (live) */
  pulse?: boolean
  mono?: boolean
  uppercase?: boolean
  size?: 'sm' | 'md'
  /** outlined capsule instead of a tinted one */
  outline?: boolean
  className?: string
  title?: string
}

/** Capsule label: status words, owners, environments, counts of things. */
export function Tag({ tone = 'neutral', children, icon, dot, pulse, mono, uppercase, size = 'md', outline, className, title }: TagProps) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full font-medium',
        size === 'sm' ? 'px-1.5 py-px text-caption2' : 'px-2 py-0.5 text-caption',
        outline ? 'border border-stroke-light text-secondary' : TONE[tone],
        mono && 'font-mono',
        uppercase && 'uppercase tracking-wide',
        className,
      )}
    >
      {dot && <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone], pulse && 'animate-pulse-subtle')} />}
      {icon && <Icon name={icon} size={size === 'sm' ? 10 : 12} />}
      <span className="truncate">{children}</span>
    </span>
  )
}

const STATE_CLASS: Record<JobState, string> = {
  queued: 'bg-state-queued-tint text-state-queued-fg',
  running: 'bg-state-running-tint text-state-running-fg',
  waiting: 'bg-state-waiting-tint text-state-waiting-fg',
  succeeded: 'bg-state-succeeded-tint text-state-succeeded-fg',
  failed: 'bg-state-failed-tint text-state-failed-fg',
  cancelled: 'bg-state-cancelled-tint text-state-cancelled-fg',
}

const STATE_DOT: Record<JobState, string> = {
  queued: 'bg-state-queued',
  running: 'bg-state-running',
  waiting: 'bg-state-waiting',
  succeeded: 'bg-state-succeeded',
  failed: 'bg-state-failed',
  cancelled: 'bg-state-cancelled',
}

export interface StateTagProps {
  /** any API status word; folded with jobState() */
  status: string
  /** display text (defaults to the status) */
  children?: ReactNode
  size?: 'sm' | 'md'
  className?: string
}

/** "in-progress" → "In progress": the status word as a sentence, when no display text is given. */
function sentence(status: string): string {
  const words = status.replace(/-/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Status capsule with a leading dot; running pulses. Text is shown as given (sentence case). */
export function StateTag({ status, children, size = 'md', className }: StateTagProps) {
  const state = jobState(status)
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium',
        size === 'sm' ? 'px-1.5 py-px text-caption2' : 'px-2 py-0.5 text-caption',
        STATE_CLASS[state],
        className,
      )}
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', STATE_DOT[state], state === 'running' && 'animate-pulse-subtle')} />
      {children ?? sentence(status)}
    </span>
  )
}
