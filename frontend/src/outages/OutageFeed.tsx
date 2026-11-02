import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, EmptyState, Field, Icon, Input, Select, StatusDot, Switch, cx } from '../ui'
import type { CommunicationClient } from './api'
import { titleCase } from './display'
import { OutageCard } from './OutageCard'
import { COMMUNICATION_TYPES, SEVERITIES, type CommunicationType, type FeedFilter, type FeedItem, type Severity } from './types'
import { useOutageFeed, type Connection } from './useOutageFeed'

export interface OutageFeedProps {
  client: CommunicationClient
  tenantId: string
  /** actor recorded when resolving from here; omit `allowResolve` to hide the action */
  actor?: string
  allowResolve?: boolean
  /** initial type filter; '' shows every type (default OUTAGE) */
  defaultType?: CommunicationType | ''
  /** reports the visible count, e.g. for a tab badge */
  onCount?: (count: number) => void
}

const CONNECTION: Record<Connection, { label: string; kind: 'healthy' | 'warning' | 'neutral'; pulse?: boolean }> = {
  off: { label: 'Paused', kind: 'neutral' },
  connecting: { label: 'Connecting', kind: 'warning', pulse: true },
  live: { label: 'Live', kind: 'healthy', pulse: true },
  reconnecting: { label: 'Reconnecting', kind: 'warning', pulse: true },
}

/** The consumer view: what is active or upcoming for a tenant, kept live over SSE. */
export function OutageFeed({ client, tenantId, actor, allowResolve = true, defaultType = 'OUTAGE', onCount }: OutageFeedProps) {
  const id = useId()
  const [service, setService] = useState('')
  const [type, setType] = useState<CommunicationType | ''>(defaultType)
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [live, setLive] = useState(true)

  const filter = useMemo<FeedFilter>(
    () => ({ tenantId, service: service.trim() || undefined, type: type || undefined, severity: severity || undefined }),
    [tenantId, service, type, severity],
  )
  const feed = useOutageFeed(client, filter, live)
  const conn = CONNECTION[feed.connection]
  const connLabel = feed.reconnectAttempt > 0 ? `${conn.label} (${feed.reconnectAttempt})` : conn.label
  const active = feed.items.filter((i) => i.status === 'ACTIVE')
  const upcoming = feed.items.filter((i) => i.status === 'SCHEDULED')
  useEffect(() => {
    onCount?.(active.length)
  }, [active.length, onCount])

  // the last notice resolved from this page: announced (role=status) and shown for a moment
  const [resolved, setResolved] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!resolved) return
    const t = setTimeout(() => setResolved(null), 8_000)
    return () => clearTimeout(t)
  }, [resolved])

  const resolve = allowResolve
    ? async (item: FeedItem, note: string) => {
        await client.retire(item.id, actor, note)
        feed.remove(item.id)
        setResolved(item.title)
        // the card leaves with the button that had focus: keep keyboard focus on the list
        list.current?.focus({ preventScroll: true })
      }
    : undefined

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-stroke-light bg-surface-tertiary p-4">
        <Field label="Service" htmlFor={`${id}-service`} className="min-w-48 flex-1">
          <Input id={`${id}-service`} size="sm" mono leading="search" placeholder="Any service" value={service} onChange={(e) => setService(e.target.value)} />
        </Field>
        <Field label="Type" htmlFor={`${id}-type`} className="w-40">
          <Select
            id={`${id}-type`}
            size="sm"
            ariaLabel="Type"
            value={type}
            onChange={(v) => setType(v as CommunicationType | '')}
            options={[{ value: '', label: 'All types' }, ...COMMUNICATION_TYPES.map((t) => ({ value: t, label: titleCase(t) }))]}
          />
        </Field>
        <Field label="Minimum severity" htmlFor={`${id}-severity`} className="w-40">
          <Select
            id={`${id}-severity`}
            size="sm"
            ariaLabel="Minimum severity"
            value={severity}
            onChange={(v) => setSeverity(v as Severity | '')}
            options={[{ value: '', label: 'Any severity' }, ...SEVERITIES.map((s) => ({ value: s, label: titleCase(s) }))]}
          />
        </Field>
        <div className="ml-auto flex items-center gap-3 pb-1">
          <label className="flex items-center gap-2 text-caption text-secondary">
            <Switch size="sm" label="Live updates" checked={live} onChange={setLive} />
            <StatusDot kind={conn.kind} pulse={conn.pulse} label={connLabel} />
          </label>
          <Button size="sm" variant="ghost" icon="refresh" onClick={feed.refresh} loading={feed.loading}>
            Refresh
          </Button>
        </div>
      </div>

      <p role="status" aria-live="polite" className={cx('flex items-center gap-1.5 text-caption text-secondary', !resolved && 'sr-only')}>
        {resolved && (
          <>
            <Icon name="check" size={12} className="text-healthy-fg" />
            Resolved “{resolved}”. It has left every consumer's feed.
          </>
        )}
      </p>

      {!tenantId.trim() ? (
        <EmptyState icon="users" title="Choose a tenant" message="The feed is per tenant. Enter one at the top of the page." />
      ) : feed.error ? (
        <EmptyState
          icon="alert-triangle"
          iconClassName="text-critical"
          title="Couldn't load the feed"
          message={feed.error}
          action={
            <Button size="sm" icon="refresh" onClick={feed.refresh}>
              Try again
            </Button>
          }
        />
      ) : feed.loading && feed.items.length === 0 ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-28 rounded-lg" />
          ))}
        </div>
      ) : feed.items.length === 0 ? (
        <EmptyState
          icon="check"
          iconClassName="text-healthy-fg"
          title="All clear"
          message={`Nothing ${type ? titleCase(type).toLowerCase() + ' ' : ''}is active or upcoming for ${tenantId}${service.trim() ? ` on ${service.trim()}` : ''}.`}
        />
      ) : (
        <div ref={list} tabIndex={-1} className="flex flex-col gap-5 outline-none">
          <Section title="Active now" count={active.length} tone="critical">
            {active.map((i) => (
              <OutageCard key={i.id} item={i} onRetire={resolve} />
            ))}
          </Section>
          <Section title="Upcoming" count={upcoming.length} tone="accent">
            {upcoming.map((i) => (
              <OutageCard key={i.id} item={i} onRetire={resolve} />
            ))}
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ title, count, tone, children }: { title: string; count: number; tone: 'critical' | 'accent'; children: ReactNode }) {
  if (count === 0) return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-tertiary">
        <Icon name={tone === 'critical' ? 'alert-triangle' : 'calendar'} size={13} className={cx(tone === 'critical' ? 'text-critical' : 'text-accent')} />
        {title}
        <span className="tabular-nums">{count}</span>
      </h2>
      {children}
    </section>
  )
}
