/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** origin of communication-service when the UI is not served behind the same host; '' (same origin) when unset */
  readonly VITE_API_BASE?: string
}
