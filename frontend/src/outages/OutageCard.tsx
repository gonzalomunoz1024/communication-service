import { useState } from 'react'
import { Button, Icon, Input, StateTag, Tag, cx, longDate, relativeTime } from '../ui'
import { SEVERITY_TONE, titleCase } from './display'
import { explainError } from './errors'
import { TicketTag } from './TicketTag'
import type { FeedItem } from './types'

export interface OutageCardProps {
  item: FeedItem
  /** shown as "Resolve"; omit to hide the action */
  onRetire?: (item: FeedItem, note: string) => Promise<void>
  /** who the resolve is recorded as; named in the confirmation */
  actor?: string
}

const SEVERITY_BAR: Record<FeedItem['severity'], string> = {
  INFO: 'bg-tertiary',
  MINOR: 'bg-accent',
  MAJOR: 'bg-warning',
  CRITICAL: 'bg-critical',
}

/** One feed item: severity rail, status, title, body, services and timing. */
export function OutageCard({ item, onRetire, actor }: OutageCardProps) {
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = item.status === 'ACTIVE'
  // a notice that has not started is withdrawn rather than resolved; both retire it
  const verb = active ? 'Resolve' : 'Withdraw'

  const retire = async () => {
    if (!onRetire) return
    setBusy(true)
    setError(null)
    try {
      await onRetire(item, note)
    } catch (e) {
      setError(explainError(e))
      setBusy(false)
    }
  }

  return (
    <article className="animate-fade-in relative overflow-hidden rounded-lg border border-stroke-light bg-surface shadow-card">
      <span aria-hidden="true" className={cx('absolute inset-y-0 left-0 w-1', SEVERITY_BAR[item.severity])} />
      <div className="flex flex-col gap-3 py-4 pl-6 pr-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <StateTag status={active ? 'failing' : 'queued'}>{active ? 'Active' : 'Scheduled'}</StateTag>
          <Tag tone={SEVERITY_TONE[item.severity]}>{titleCase(item.severity)}</Tag>
          <Tag outline>{titleCase(item.type)}</Tag>
          {item.audience !== 'CUSTOMERS' && <Tag outline>{titleCase(item.audience)}</Tag>}
          {item.ticket && <TicketTag ticket={item.ticket} />}
          {item.externalRef && item.externalRef !== item.ticket?.number && (
            <Tag mono outline>
              {item.externalRef}
            </Tag>
          )}
          <span className="ml-auto text-caption text-tertiary" title={longDate(item.updatedAt)}>
            Updated {relativeTime(item.updatedAt)}
          </span>
        </div>

        <div>
          <h3 className="text-subheadline font-semibold text-primary">{item.title}</h3>
          {item.body && <p className="mt-1 whitespace-pre-line text-sm text-secondary">{item.body}</p>}
        </div>

        {item.affectedServices.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.affectedServices.map((s) => (
              <Tag key={s} mono size="sm" icon="tag">
                {s}
              </Tag>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-tertiary">
          <span className="inline-flex items-center gap-1" title={longDate(item.startsAt)}>
            <Icon name="clock" size={12} />
            {active ? 'Started' : 'Starts'} {relativeTime(item.startsAt)}
          </span>
          {item.endsAt && (
            <span className="inline-flex items-center gap-1" title={longDate(item.endsAt)}>
              <Icon name="calendar" size={12} />
              Expected end {relativeTime(item.endsAt)}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Icon name="users" size={12} />
            {item.publisher}
          </span>
          {onRetire && !confirming && (
            <Button size="sm" variant="capsule" icon={active ? 'check' : 'close'} className="ml-auto" onClick={() => setConfirming(true)}>
              {verb}
            </Button>
          )}
        </div>

        {confirming && (
          <div className="flex flex-col gap-2 rounded-md bg-surface-secondary p-3">
            <p className="text-caption text-secondary">
              {active
                ? `Resolve${actor ? ` as ${actor}` : ''}? It leaves tenant ${item.tenantId}'s feed at once and cannot be reopened.`
                : `Withdraw${actor ? ` as ${actor}` : ''}? Withdrawing retires it before it starts: tenant ${item.tenantId}'s consumers never see it and it cannot be reopened.`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                size="sm"
                className="min-w-48 flex-1"
                placeholder={active ? 'Resolution note (optional)' : 'Reason (optional)'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" loading={busy} onClick={retire}>
                {verb}
              </Button>
            </div>
            {error && <p className="text-caption text-critical-fg" role="alert">{error}</p>}
          </div>
        )}
      </div>
    </article>
  )
}
