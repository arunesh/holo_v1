/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** 'true' shows the guest route on the login page. */
  readonly VITE_ALLOW_GUEST?: string
}
