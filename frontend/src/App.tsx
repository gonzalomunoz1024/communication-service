import { useEffect, useMemo, useState } from 'react'
import { AppHeader, Icon, Input, Tabs, ThemeToggle, useTheme, type TabItem } from './ui'
import { OutageFeed, PublishOutageForm, createCommunicationClient } from './outages'

type Tab = 'feed' | 'publish'

const APP_TITLE = 'Outage Notifications'
const TENANT_KEY = 'comm-tenant'
const PUBLISHER_KEY = 'comm-publisher'

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function tabFromHash(): Tab {
  return window.location.hash === '#/publish' ? 'publish' : 'feed'
}

/** Single page, two tabs: the feed consumers see and the form publishers use. */
export default function App() {
  const { mode, cycle } = useTheme()
  const client = useMemo(() => createCommunicationClient(import.meta.env.VITE_API_BASE ?? '', { clientId: import.meta.env.VITE_CLIENT_ID }), [])
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [tenantId, setTenantId] = useState(() => readStored(TENANT_KEY, 'acme'))
  const [publisher, setPublisher] = useState(() => readStored(PUBLISHER_KEY, ''))
  const [activeCount, setActiveCount] = useState(0)

  // the tab lives in the hash so a reload (or a shared link) lands on the same one
  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (next: Tab) => {
    window.location.hash = next === 'publish' ? '#/publish' : '#/feed'
    setTab(next)
  }

  useEffect(() => {
    document.title = `${tab === 'publish' ? 'Publish' : 'Feed'} · ${APP_TITLE}`
  }, [tab])

  useEffect(() => {
    try {
      localStorage.setItem(TENANT_KEY, tenantId)
    } catch {
      /* private mode */
    }
  }, [tenantId])

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
            <span className="hidden text-footnote font-semibold leading-tight tracking-tight sm:inline">{APP_TITLE}</span>
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
              value={tenantId}
              placeholder="acme"
              onChange={(e) => setTenantId(e.target.value)}
            />
          </label>
        }
        right={<ThemeToggle mode={mode} onCycle={cycle} />}
      />

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <Tabs<Tab> ariaLabel="Sections" tabs={tabs} value={tab} onChange={go} className="mb-5" />
        {tab === 'feed' ? (
          <OutageFeed client={client} tenantId={tenantId} actor={publisher || undefined} onCount={setActiveCount} />
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
            onViewFeed={() => go('feed')}
          />
        )}
      </main>
    </div>
  )
}
