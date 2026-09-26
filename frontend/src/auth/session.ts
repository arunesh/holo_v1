// Sign-in. Google (or a guest request, if the server allows guests) is exchanged at
// /api/auth/* for our own short-lived session token. Every API call and tutor socket
// carries that token, and the server rejects anything without a valid one.

export type SessionUser = {
  name: string
  email?: string
  picture?: string
  provider: 'google' | 'guest'
  token: string
  /** Epoch milliseconds. */
  expiresAt: number
}

export interface AuthConfig {
  google_client_id: string | null
  allow_guest: boolean
}

const KEY = 'holodeck.session'
/** Sockets offer [AUTH_PROTOCOL, token]; browsers can't set headers on WebSockets. */
export const AUTH_PROTOCOL = 'holodeck.auth'
/** Fired when the server rejects our token, so the app returns to the login page. */
export const SIGNED_OUT = 'holodeck:signed-out'

export function loadSession(): SessionUser | null {
  try {
    const user: SessionUser | null = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    // Sessions without a server token (older builds) or past expiry sign in again.
    return user?.token && user.expiresAt > Date.now() ? user : null
  } catch {
    return null
  }
}

export function saveSession(u: SessionUser) {
  localStorage.setItem(KEY, JSON.stringify(u))
}

export function clearSession() {
  localStorage.removeItem(KEY)
}

export function signOutEverywhere() {
  clearSession()
  window.dispatchEvent(new Event(SIGNED_OUT))
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const r = await fetch('/api/auth/config')
  if (!r.ok) throw new Error('auth-config-failed')
  return r.json()
}

class SessionError extends Error {
  constructor(readonly status: number) {
    super(`session-${status}`)
  }
}

async function exchange(path: string, init: RequestInit = {}): Promise<SessionUser> {
  const r = await fetch(path, { method: 'POST', ...init })
  if (!r.ok) throw new SessionError(r.status)
  const data = await r.json()
  return {
    name: data.user.name,
    email: data.user.email,
    picture: data.user.picture,
    provider: data.user.provider,
    token: data.token,
    expiresAt: data.expires_at * 1000,
  }
}

let gisLoad: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (!gisLoad) {
    gisLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        gisLoad = null
        reject(new Error('Could not load Google sign-in'))
      }
      document.head.appendChild(s)
    })
  }
  return gisLoad
}

/** Google's popup gives an access token; the server checks it was issued to our client. */
export async function signInWithGoogle(clientId: string): Promise<SessionUser> {
  await loadGis()
  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'openid email profile',
      callback: (resp: any) =>
        resp?.access_token ? resolve(resp.access_token) : reject(new Error(resp?.error ?? 'no token')),
      error_callback: (err: any) => reject(new Error(err?.type ?? 'popup-failed')),
    })
    client.requestAccessToken()
  })
  return exchange('/api/auth/google', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken }),
  })
}

export const signInAsGuest = () => exchange('/api/auth/guest')

export const refreshSession = (user: SessionUser) =>
  exchange('/api/auth/refresh', { headers: { Authorization: `Bearer ${user.token}` } })

/** True when the server, not the network, turned the session down. */
export const rejected = (error: unknown) =>
  error instanceof SessionError && (error.status === 401 || error.status === 403)
