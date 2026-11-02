/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** origin of communication-service when the UI is not served behind the same host; '' (same origin) when unset */
  readonly VITE_API_BASE?: string
  /** how the UI identifies itself to the service (X-Client-Id); defaults to communication-frontend */
  readonly VITE_CLIENT_ID?: string
  /** the tenant the page opens on; unset (the default) means the tenant used last in that browser, else none */
  readonly VITE_DEFAULT_TENANT?: string
}
