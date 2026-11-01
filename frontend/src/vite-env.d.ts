/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** origin of communication-service when the UI is not served behind the same host; '' (same origin) when unset */
  readonly VITE_API_BASE?: string
  /** how the UI identifies itself to the service (X-Client-Id); defaults to communication-frontend */
  readonly VITE_CLIENT_ID?: string
}
