import type { ReactNode } from 'react'
import { cx } from './cx'

export interface AppHeaderProps {
  left?: ReactNode
  right?: ReactNode
  center?: ReactNode
  className?: string
}

/** The glass sticky header (kit AppHeader without the command-palette trigger). */
export function AppHeader({ left, right, center, className }: AppHeaderProps) {
  return (
    <header className={cx('glass sticky top-0 z-40 border-b border-stroke-light', className)}>
      <div className="grid h-14 w-full grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">{left}</div>
        <div className="flex justify-center">{center}</div>
        <div className="flex min-w-0 items-center justify-end gap-1">{right}</div>
      </div>
    </header>
  )
}
