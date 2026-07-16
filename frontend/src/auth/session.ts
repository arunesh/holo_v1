// Client-side session + Google Identity Services sign-in.
// Real Google OAuth requires VITE_GOOGLE_CLIENT_ID (a Web client ID from the
// Google Cloud console with this origin allowed); without it the login page
// offers guest access and explains what's missing.

export type SessionUser = {
  name: string
  email?: string
  picture?: string
  provider: 'google' | 'guest'
}

const KEY = 'holodeck.session'

export function loadSession(): SessionUser | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
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

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
export const googleConfigured = Boolean(CLIENT_ID)

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

export async function signInWithGoogle(): Promise<SessionUser> {
  if (!CLIENT_ID) throw new Error('missing-client-id')
  await loadGis()
  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'openid email profile',
      callback: (resp: any) =>
        resp?.access_token ? resolve(resp.access_token) : reject(new Error(resp?.error ?? 'no token')),
      error_callback: (err: any) => reject(new Error(err?.type ?? 'popup-failed')),
    })
    client.requestAccessToken()
  })
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) throw new Error('userinfo-failed')
  const info = await r.json()
  return {
    name: info.name || info.email || 'Explorer',
    email: info.email,
    picture: info.picture,
    provider: 'google',
  }
}
