import { cx } from './cx'
import { Icon } from './Icon'
import { inputClass } from './Field'

export interface SelectOption {
  value: string
  label: string
  /** secondary text after the label */
  hint?: string
  disabled?: boolean
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  ariaLabel: string
  className?: string
  mono?: boolean
  placeholder?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  id?: string
}

/**
 * Same props as the kit's Select, drawn over a native <select> so it carries no popover
 * machinery. Swap for '@iaf/ui' Select when porting for the material listbox.
 */
export function Select({ value, onChange, options, ariaLabel, className, mono, placeholder, disabled, size = 'md', id }: SelectProps) {
  return (
    <div className={cx('relative', className)}>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          inputClass,
          'cursor-pointer appearance-none pl-3 pr-8',
          size === 'sm' ? 'py-1.5 text-caption' : 'py-2 text-sm',
          mono && 'font-mono',
        )}
      >
        {placeholder != null && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.hint ? `${o.label} — ${o.hint}` : o.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevron-down"
        size={size === 'sm' ? 12 : 14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tertiary"
      />
    </div>
  )
}
