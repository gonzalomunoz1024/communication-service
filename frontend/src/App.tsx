import { useEffect, useMemo, useState } from 'react'
import { AppHeader, Icon, Input, Tabs, ThemeToggle, useTheme, type TabItem } from './ui'
import { OutageFeed, PublishOutageForm, createCommunicationClient, type CommunicationType } from './outages'

type Tab = 'feed' | 'publish'

const APP_TITLE = 'Outage Notifications'
const TENANT_KEY = 'comm-tenant'
const PUBLISHER_KEY = 'comm-publisher'
/** Shown while no tenant is set: on a first visit, or after the field was cleared. */
const TENANT_PROMPT = 'Enter the tenant your consumers read; the service owners assign it.'
/** How long typing in the header's tenant field pauses before the feed follows it (Enter or leaving the field: at once). */
const TENANT_SETTLE_MS = 400

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

/** The tenant the page opens on: the build's default, else the one used last in this browser, else none. */
function initialTenant(): string {
  return import.meta.env.VITE_DEFAULT_TENANT?.trim() || readStored(TENANT_KEY, '')
}

function tabFromHash(): Tab {
  return window.location.hash === '#/publish' ? 'publish' : 'feed'
}

/** Single page, two tabs: the feed consumers see and the form publishers use. */
export default function App() {
  const { mode, cycle } = useTheme()
  const client = useMemo(() => createCommunicationClient(import.meta.env.VITE_API_BASE ?? '', { clientId: import.meta.env.VITE_CLIENT_ID }), [])
  const [tab, setTab] = useState<Tab>(tabFromHash)
  // the header field and the tenant the page shows: the feed and the form follow the field once typing
  // pauses, so typing "ux2-sre" is one load and one stream subscription, not one per keystroke
  const [tenantInput, setTenantInput] = useState(initialTenant)
  const [tenantId, setTenantId] = useState(tenantInput)
  const [publisher, setPublisher] = useState(() => readStored(PUBLISHER_KEY, ''))
  // the feed's type filter when the tab opens; "View in feed" points it at what was just published
  const [feedType, setFeedType] = useState<CommunicationType | ''>('OUTAGE')
  // "View in feed" also puts keyboard focus on the feed's list; switching tabs leaves focus on the tabs
  const [focusFeed, setFocusFeed] = useState(false)
  const [activeCount, setActiveCount] = useState(0)

  // the tab lives in the hash so a reload (or a shared link) lands on the same one
  useEffect(() => {
    const onHash = () => {
      setTab(tabFromHash())
      setFocusFeed(false)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (next: Tab) => {
    window.location.hash = next === 'publish' ? '#/publish' : '#/feed'
    setTab(next)
    setFocusFeed(false)
  }

  useEffect(() => {
    document.title = `${tab === 'publish' ? 'Publish' : 'Feed'} · ${APP_TITLE}`
  }, [tab])

  useEffect(() => {
    if (tenantInput === tenantId) return
    const t = setTimeout(() => setTenantId(tenantInput), TENANT_SETTLE_MS)
    return () => clearTimeout(t)
  }, [tenantInput, tenantId])
  const showTenant = (tenant: string) => {
    setTenantInput(tenant)
    setTenantId(tenant)
  }

  useEffect(() => {
    try {
      localStorage.setItem(TENANT_KEY, tenantInput)
    } catch {
      /* private mode */
    }
  }, [tenantInput])

  const tabs: TabItem<Tab>[] = [
    { id: 'feed', label: 'Feed', icon: 'bell', count: activeCount },
    { id: 'publish', label: 'Publish', icon: 'plus' },
  ]

  return (
    <div className="min-h-screen bg-surface-secondary">
      <AppHeader
        left={
          <span className="flex items-center gap-2.5 text-primary">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white">
              <Icon name="bell" size={16} strokeWidth={2} />
            </span>
            <h1 className="sr-only text-footnote font-semibold leading-tight tracking-tight sm:not-sr-only">{APP_TITLE}</h1>
          </span>
        }
        center={
          <label className="flex items-center gap-2 text-caption text-secondary">
            Tenant
            <Input
              size="sm"
              mono
              aria-label="Tenant"
              className="w-28 sm:w-40"
              value={tenantInput}
              placeholder="acme"
              title={TENANT_PROMPT}
              onChange={(e) => setTenantInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') showTenant(e.currentTarget.value)
              }}
              onBlur={(e) => showTenant(e.currentTarget.value)}
            />
          </label>
        }
        right={<ThemeToggle mode={mode} onCycle={cycle} />}
      />

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        {!tenantInput.trim() && (
          <p className="mb-5 flex items-center gap-2.5 rounded-md border border-stroke-light bg-surface px-4 py-3 text-sm text-secondary">
            <Icon name="info" size={16} className="shrink-0 text-accent" />
            {TENANT_PROMPT}
          </p>
        )}
        <Tabs<Tab> ariaLabel="Sections" tabs={tabs} value={tab} onChange={go} className="mb-5" />
        {tab === 'feed' ? (
          <OutageFeed client={client} tenantId={tenantId} actor={publisher || undefined} defaultType={feedType} onCount={setActiveCount} autoFocus={focusFeed} />
        ) : (
          <PublishOutageForm
            client={client}
            tenantId={tenantId}
            publisher={publisher}
            onPublished={(c) => {
              setPublisher(c.publisher)
              try {
                localStorage.setItem(PUBLISHER_KEY, c.publisher)
              } catch {
                /* private mode */
              }
            }}
            onViewFeed={(c) => {
              // land on the feed that shows it: its tenant, filtered to its type, with focus on its list
              showTenant(c.tenantId)
              setFeedType(c.type)
              go('feed')
              setFocusFeed(true)
            }}
          />
        )}
      </main>
    </div>
  )
}
