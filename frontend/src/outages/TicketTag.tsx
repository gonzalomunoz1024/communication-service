import { Tag } from '../ui'
import { ticketSystemLabel } from './display'
import type { Ticket } from './types'

export interface TicketTagProps {
  ticket: Ticket
  size?: 'sm' | 'md'
}

/** The ticket a notice is tied to, as a capsule; opens the tracker when the service gave it a link. */
export function TicketTag({ ticket, size = 'md' }: TicketTagProps) {
  const label = `${ticketSystemLabel(ticket.system)} ${ticket.number}`
  const tag = (
    <Tag mono outline size={size} icon={ticket.url ? 'external' : undefined} title={ticket.url ? `Open ${label}` : label}>
      {ticket.number}
    </Tag>
  )
  if (!ticket.url) return tag
  return (
    <a href={ticket.url} target="_blank" rel="noreferrer" className="no-focus-ring rounded-full transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-accent/40">
      {tag}
    </a>
  )
}
