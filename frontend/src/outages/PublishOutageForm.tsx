import { useId, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Button, Card, Field, Icon, Input, Segmented, Select, Switch, Tag, Textarea, cx, inputClass, relativeTime } from '../ui'
import type { CommunicationClient } from './api'
import { SEVERITY_TONE, TYPE_HINT, titleCase } from './display'
import { explainError, isUnreachable } from './errors'
import { TicketTag } from './TicketTag'
import { AUDIENCES, COMMUNICATION_TYPES, SEVERITIES, type Communication, type CommunicationType, type Severity, type Audience } from './types'
import { TITLE_MAX, emptyDraft, parseServices, toRequest, validate, type DraftErrors, type OutageDraft } from './validation'

/** HEALTH is raised by the health-check flow, not by people. */
const PUBLISHABLE_TYPES = COMMUNICATION_TYPES.filter((t) => t !== 'HEALTH')

/** The fields validate() can fault, in the order they appear on the page. */
const FIELD_ORDER = ['severity', 'title', 'body', 'services', 'ticket', 'tenantId', 'publisher', 'startsAt', 'endsAt', 'expiresAt'] as const satisfies readonly (keyof DraftErrors)[]
type ErrorKey = (typeof FIELD_ORDER)[number]
/** element id suffix and visible label of each faultable field */
const FIELD: Record<ErrorKey, { id: string; label: string }> = {
  severity: { id: 'severity', label: 'Severity' },
  title: { id: 'title', label: 'Title' },
  body: { id: 'body', label: 'Details' },
  services: { id: 'services', label: 'Affected services' },
  ticket: { id: 'ticket', label: 'ServiceNow incident' },
  tenantId: { id: 'tenant', label: 'Tenant' },
  publisher: { id: 'publisher', label: 'Publisher' },
  startsAt: { id: 'starts', label: 'Starts' },
  endsAt: { id: 'ends', label: 'Ends' },
  expiresAt: { id: 'expires', label: 'Expires' },
}

export interface PublishOutageFormProps {
  client: CommunicationClient
  /** prefilled tenant; the field stays editable unless `lockTenant` */
  tenantId?: string
  lockTenant?: boolean
  /** prefilled publisher (team or person) */
  publisher?: string
  onPublished?: (communication: Communication) => void
  /** "View in feed" on the confirmation; the host should show that tenant's feed, filtered to that type */
  onViewFeed?: (communication: Communication) => void
}

/** Publish an outage (or incident, maintenance, change) to communication-service. */
export function PublishOutageForm({ client, tenantId = '', lockTenant, publisher = '', onPublished, onViewFeed }: PublishOutageFormProps) {
  const id = useId()
  const [draft, setDraft] = useState<OutageDraft>(() => emptyDraft(tenantId, publisher))
  const [errors, setErrors] = useState<DraftErrors>({})
  const [submitting, setSubmitting] = useState(false)
  /** why the last publish failed: the service's words for a rejection, or that it could not be reached */
  const [serverError, setServerError] = useState<{ text: string; rejected: boolean } | null>(null)
  const [published, setPublished] = useState<Communication | null>(null)
  const [showTiming, setShowTiming] = useState(false)

  // a tenant chosen elsewhere (the header) flows in until the user edits the field here
  const [tenantTouched, setTenantTouched] = useState(false)
  const effective: OutageDraft = tenantTouched && !lockTenant ? draft : { ...draft, tenantId }

  const set = <K extends keyof OutageDraft>(key: K, value: OutageDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const f = (name: string) => `${id}-${name}`
  const note = (name: string) => `${f(name)}-note`

  /** Moves focus and the viewport to a field; for a segmented group, to its selected segment. */
  const focusField = (key: ErrorKey) => {
    const el = document.getElementById(f(FIELD[key].id))
    if (!el) return
    const target = el.getAttribute('role') === 'radiogroup' ? (el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el) : el
    target.focus({ preventScroll: true })
    target.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found = validate(effective)
    const first = FIELD_ORDER.find((k) => found[k])
    if (first) {
      // render the errors (and open Timing when one is there) before moving focus to the first
      flushSync(() => {
        setErrors(found)
        if (found.startsAt || found.endsAt || found.expiresAt) setShowTiming(true)
      })
      focusField(first)
      return
    }
    setErrors({})
    setSubmitting(true)
    setServerError(null)
    try {
      const saved = await client.publish(toRequest(effective))
      setPublished(saved)
      onPublished?.(saved)
    } catch (err) {
      setServerError({ text: explainError(err), rejected: !isUnreachable(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setDraft((d) => ({ ...emptyDraft(d.tenantId, d.publisher), type: d.type }))
    setErrors({})
    setServerError(null)
    setPublished(null)
    setShowTiming(false)
  }

  if (published) {
    return <Published communication={published} onAnother={reset} onViewFeed={onViewFeed} />
  }

  const services = parseServices(draft.services)
  const problems = FIELD_ORDER.filter((k) => errors[k])

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Card title="What's happening" subtitle="Consumers of the feed see exactly this.">
        <div className="flex flex-col gap-4">
          <Field label="Type" hint={TYPE_HINT[draft.type]} noteId={note('type')}>
            <Segmented<CommunicationType>
              id={f('type')}
              ariaLabel="Communication type"
              describedBy={note('type')}
              className="flex-wrap"
              value={draft.type}
              onChange={(v) => set('type', v)}
              options={PUBLISHABLE_TYPES.map((t) => ({ value: t, label: titleCase(t) }))}
            />
          </Field>

          <Field label="Severity" error={errors.severity} noteId={note('severity')}>
            <Segmented<Severity>
              id={f('severity')}
              ariaLabel="Severity"
              describedBy={errors.severity ? note('severity') : undefined}
              invalid={!!errors.severity}
              value={draft.severity}
              onChange={(v) => set('severity', v)}
              options={SEVERITIES.map((s) => ({ value: s, label: titleCase(s) }))}
            />
          </Field>

          <Field label="Title" required htmlFor={f('title')} error={errors.title} hint={`${draft.title.length}/${TITLE_MAX}`}>
            <Input
              id={f('title')}
              aria-describedby={note('title')}
              value={draft.title}
              maxLength={TITLE_MAX}
              invalid={!!errors.title}
              placeholder="Payments API returning 503s"
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>

          <Field label="Details" htmlFor={f('body')} error={errors.body} hint="Impact, workaround, next update. Plain text.">
            <Textarea
              id={f('body')}
              aria-describedby={note('body')}
              rows={5}
              value={draft.body}
              invalid={!!errors.body}
              placeholder="Card payments fail for roughly 30% of requests. Retries succeed. Next update in 30 minutes."
              onChange={(e) => set('body', e.target.value)}
            />
          </Field>

          <Field
            label="Affected services"
            htmlFor={f('services')}
            error={errors.services}
            hint="Comma separated. Consumers filter the feed by these names."
          >
            <Input
              id={f('services')}
              aria-describedby={note('services')}
              mono
              value={draft.services}
              invalid={!!errors.services}
              placeholder="payments-api, checkout-web"
              onChange={(e) => set('services', e.target.value)}
            />
            {services.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {services.map((s) => (
                  <Tag key={s} mono size="sm" icon="tag">
                    {s}
                  </Tag>
                ))}
              </div>
            )}
          </Field>

          <Field label="ServiceNow incident" htmlFor={f('ticket')} error={errors.ticket} hint="Optional. The INC tracking this; consumers get a link to it.">
            <Input id={f('ticket')} aria-describedby={note('ticket')} mono value={draft.ticket} invalid={!!errors.ticket} placeholder="INC0012345" onChange={(e) => set('ticket', e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="Who and where">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tenant" required htmlFor={f('tenant')} error={errors.tenantId} hint="The tenant whose feed this lands in.">
            <Input
              id={f('tenant')}
              aria-describedby={note('tenant')}
              mono
              value={effective.tenantId}
              disabled={lockTenant}
              invalid={!!errors.tenantId}
              placeholder="acme"
              onChange={(e) => {
                setTenantTouched(true)
                set('tenantId', e.target.value)
              }}
            />
          </Field>
          <Field label="Publisher" required htmlFor={f('publisher')} error={errors.publisher} hint="Your team or name, recorded in the audit trail.">
            <Input id={f('publisher')} aria-describedby={note('publisher')} value={draft.publisher} invalid={!!errors.publisher} placeholder="payments-oncall" onChange={(e) => set('publisher', e.target.value)} />
          </Field>
          <Field label="Audience" htmlFor={f('audience')}>
            <Select
              id={f('audience')}
              ariaLabel="Audience"
              value={draft.audience}
              onChange={(v) => set('audience', v as Audience)}
              options={AUDIENCES.map((a) => ({ value: a, label: titleCase(a) }))}
            />
          </Field>
          <Field label="External reference" htmlFor={f('ref')} hint="Idempotency key, optional; defaults to the incident number.">
            <Input id={f('ref')} aria-describedby={note('ref')} mono value={draft.externalRef} placeholder="payments-2026-11-01" onChange={(e) => set('externalRef', e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card
        title="Timing"
        subtitle={showTiming ? 'Times are in your local time zone.' : 'Starts now and stays up until you retire it.'}
        actions={
          <Button size="sm" variant="ghost" icon={showTiming ? 'chevron-down' : 'calendar'} onClick={() => setShowTiming((v) => !v)}>
            {showTiming ? 'Hide' : 'Schedule'}
          </Button>
        }
      >
        {showTiming ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Starts" htmlFor={f('starts')} error={errors.startsAt} hint="Empty means now.">
              <input id={f('starts')} aria-describedby={note('starts')} aria-invalid={errors.startsAt ? true : undefined} type="datetime-local" className={cx(inputClass, 'px-3 py-2 text-sm')} value={draft.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
            </Field>
            <Field label="Ends" required={draft.type === 'MAINTENANCE'} htmlFor={f('ends')} error={errors.endsAt} hint="Expected resolution.">
              <input id={f('ends')} aria-describedby={note('ends')} aria-invalid={errors.endsAt ? true : undefined} type="datetime-local" className={cx(inputClass, 'px-3 py-2 text-sm')} value={draft.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
            </Field>
            <Field label="Expires" htmlFor={f('expires')} error={errors.expiresAt} hint="Drops off the feed then.">
              <input id={f('expires')} aria-describedby={note('expires')} aria-invalid={errors.expiresAt ? true : undefined} type="datetime-local" className={cx(inputClass, 'px-3 py-2 text-sm')} value={draft.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
            </Field>
          </div>
        ) : undefined}
      </Card>

      {problems.length > 0 && (
        <div role="alert" className="flex items-start gap-2.5 rounded-md bg-critical-tint px-4 py-3 text-sm text-critical-fg">
          <Icon name="alert-triangle" size={16} className="mt-0.5 shrink-0" />
          <p>
            <span className="font-medium">{problems.length === 1 ? 'One field needs attention' : `${problems.length} fields need attention`}:</span>{' '}
            {problems.map((k, i) => (
              <span key={k}>
                <button type="button" className="font-medium underline underline-offset-2" onClick={() => focusField(k)}>
                  {FIELD[k].label}
                </button>
                {` (${errors[k]})`}
                {i < problems.length - 1 ? ', ' : '.'}
              </span>
            ))}
          </p>
        </div>
      )}

      {serverError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-md bg-critical-tint px-4 py-3 text-sm text-critical-fg">
          <Icon name="alert-triangle" size={16} className="mt-0.5 shrink-0" />
          <span>
            {serverError.rejected && <span className="font-medium">The service rejected this. </span>}
            {serverError.text}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2.5 text-sm text-secondary">
          <Switch size="sm" label="Save as draft" checked={draft.draft} onChange={(v) => set('draft', v)} />
          Save as draft (not visible to consumers)
        </label>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={reset} disabled={submitting}>
            Clear
          </Button>
          <Button type="submit" variant={draft.draft ? 'secondary' : 'primary'} icon="send" loading={submitting}>
            {draft.draft ? 'Save draft' : `Publish ${titleCase(draft.type).toLowerCase()}`}
          </Button>
        </div>
      </div>
    </form>
  )
}

function Published({ communication: c, onAnother, onViewFeed }: { communication: Communication; onAnother: () => void; onViewFeed?: (communication: Communication) => void }) {
  const live = c.status === 'ACTIVE'
  return (
    <Card className="animate-scale-in">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className={cx('flex h-12 w-12 items-center justify-center rounded-full', live ? 'bg-healthy-tint text-healthy-fg' : 'bg-accent-tint text-accent-fg')}>
          <Icon name="check" size={22} strokeWidth={2.2} />
        </div>
        <div>
          <p className="text-title3 font-semibold text-primary">
            {c.status === 'DRAFT' ? 'Draft saved' : live ? `${titleCase(c.type)} published` : `${titleCase(c.type)} scheduled`}
          </p>
          <p className="mt-1 text-sm text-secondary">
            {c.status === 'DRAFT'
              ? 'Consumers will not see it until it is published.'
              : live
                ? `Live in the ${c.tenantId} feed now.`
                : `Goes live ${relativeTime(c.startsAt)}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <Tag tone={SEVERITY_TONE[c.severity]} dot>
            {titleCase(c.severity)}
          </Tag>
          <Tag mono outline>
            {c.id}
          </Tag>
          {c.ticket && <TicketTag ticket={c.ticket} />}
        </div>
        <div className="mt-2 flex gap-2">
          <Button onClick={onAnother} icon="plus">
            Publish another
          </Button>
          {onViewFeed && c.status !== 'DRAFT' && (
            <Button variant="primary" onClick={() => onViewFeed(c)} iconRight="external">
              View in feed
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
