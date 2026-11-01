import type { ReactNode } from 'react'

/**
 * Subset of the Atlas icon set (@iaf/ui Icon): 24 viewBox, 1.7 stroke, round caps and joins.
 * Same name/props, so swapping the import for '@iaf/ui' needs no call-site changes.
 */
export type IconName =
  | 'plus'
  | 'close'
  | 'close-circle'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'refresh'
  | 'trash'
  | 'bell'
  | 'clock'
  | 'calendar'
  | 'filter'
  | 'list'
  | 'tag'
  | 'alert-triangle'
  | 'warning'
  | 'info'
  | 'send'
  | 'pulse'
  | 'sun'
  | 'moon'
  | 'search'
  | 'users'
  | 'external'
  | 'edit'
  | 'history'

const TRIANGLE = (
  <>
    <path d="M12 4.2 21 19.8H3z" />
    <path d="M12 10v4.2" />
    <circle cx="12" cy="16.9" r="0.45" fill="currentColor" stroke="none" />
  </>
)

const GLYPHS: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'close-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  check: <path d="M5 12.8l4.6 4.6L19 7" />,
  'chevron-left': <path d="M14.5 5l-7 7 7 7" />,
  'chevron-down': <path d="M5 9.5l7 7 7-7" />,
  refresh: <path d="M20.5 15a8.5 8.5 0 1 1-2-8.8L20.5 10M20.5 4.5V10H15" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.7 12.6h9.6L17.5 7M10 11v5.5M14 11v5.5" />,
  bell: <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  filter: <path d="M4 5.5h16l-6.2 7.2v5.3l-3.6 1.8v-7.1z" />,
  list: (
    <>
      <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12" />
      <circle cx="4.2" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4.2" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4.2" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.5V4.5h8l9 9-8 8z" />
      <circle cx="7.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'alert-triangle': TRIANGLE,
  warning: TRIANGLE,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.5v4.5" />
      <circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  send: <path d="M20.5 3.5L3.5 10.5l7 2.5 2.5 7zM10.5 13l10-9.5" />,
  pulse: <path d="M3 12.5h4l2.6-6.5 4.2 12 2.6-6.5H21" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M19.8 19.8l-4.2-4.2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18 12.9a6.5 6.5 0 0 1 3.5 5.6" />
    </>
  ),
  external: (
    <path d="M18.5 13.5v5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5h5M15 4.5h4.5V9M19.5 4.5L11 13" />
  ),
  edit: <path d="M4.5 19.5l4.3-1L19.5 7.8a2.1 2.1 0 0 0-3-3L5.8 15.5zM14.3 7l3 3" />,
  history: <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5M3.5 4v4.5H8M12 8v4.2l2.8 1.6" />,
}

export interface IconProps {
  name: IconName
  /** rendered square size in px (default 18) */
  size?: number
  className?: string
  strokeWidth?: number
  /** screen-reader text; icons are decorative unless given one */
  title?: string
}

export function Icon({ name, size = 18, className, strokeWidth = 1.7, title }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {GLYPHS[name]}
    </svg>
  )
}
