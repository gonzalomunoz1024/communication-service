import type { KeyboardEvent, ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export interface SegmentedOption<V extends string> {
  value: V
  label?: ReactNode
  icon?: IconName
  /** accessible name when the label is only an icon; also the tooltip */
  title?: string
  disabled?: boolean
}

export interface SegmentedProps<V extends string> {
  value: V
  onChange: (value: V) => void
  options: SegmentedOption<V>[]
  /** accessible name of the group; or point at a visible label with ariaLabelledBy */
  ariaLabel?: string
  ariaLabelledBy?: string
  /** id on the group, so a form can find it (and focus its selected segment) */
  id?: string
  /** id of the hint/error line that describes the group */
  describedBy?: string
  /** the group's value failed validation */
  invalid?: boolean
  size?: 'sm' | 'md'
  /** stretch to the container, equal segments */
  full?: boolean
  className?: string
}

/** iOS-style segmented control: one selected segment lifted on a recessed track. */
export function Segmented<V extends string>({ value, onChange, options, ariaLabel, ariaLabelledBy, id, describedBy, invalid, size = 'md', full, className }: SegmentedProps<V>) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const enabled = options.filter((o) => !o.disabled)
    if (enabled.length === 0) return
    const i = Math.max(0, enabled.findIndex((o) => o.value === value))
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? enabled.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length
    onChange(enabled[next].value)
    const root = e.currentTarget as HTMLElement
    root.querySelector<HTMLElement>(`[data-value="${enabled[next].value}"]`)?.focus()
  }

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      onKeyDown={onKeyDown}
      className={cx('inline-flex items-center rounded-md bg-surface-secondary p-0.5', full && 'flex w-full', className)}
    >
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.title}
            title={o.title}
            data-value={o.value}
            disabled={o.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex items-center justify-center gap-1.5 rounded-[10px] font-medium transition-all duration-150 active:scale-[0.97]',
              size === 'sm' ? 'px-2.5 py-1 text-caption' : 'px-3 py-1.5 text-sm',
              full && 'flex-1',
              selected ? 'bg-surface text-primary shadow-sm dark:bg-surface-tertiary' : 'text-secondary hover:text-primary',
            )}
          >
            {o.icon && <Icon name={o.icon} size={size === 'sm' ? 13 : 15} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
