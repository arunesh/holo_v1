import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Login from './ui/Login'
import {
  loadSession,
  saveSession,
  clearSession,
  refreshSession,
  rejected,
  signOutEverywhere,
  SIGNED_OUT,
} from './auth/session'
import type { SessionUser } from './auth/session'
import './styles.css'

/** Renew this long before expiry; background tabs may run timers late. */
const RENEW_LEAD_MS = 5 * 60_000

function Root() {
  const [user, setUser] = useState<SessionUser | null>(loadSession)
  useEffect(() => {
    const signedOut = () => setUser(null)
    window.addEventListener(SIGNED_OUT, signedOut)
    return () => window.removeEventListener(SIGNED_OUT, signedOut)
  }, [])
  // Keep the short-lived session token fresh while the tab is open.
  useEffect(() => {
    if (!user) return
    let timer = 0
    let renewing = false
    const renew = () => {
      if (renewing) return
      renewing = true
      refreshSession(user).then(
        (next) => {
          saveSession(next)
          setUser(next)
        },
        (error) => {
          renewing = false
          // A network blip retries; only the server turning us down signs out.
          if (rejected(error) || user.expiresAt <= Date.now()) signOutEverywhere()
          else timer = window.setTimeout(renew, 30_000)
        },
      )
    }
    // Never more than half the remaining life, so short lifetimes can't renew in a loop.
    const lead = Math.min(RENEW_LEAD_MS, (user.expiresAt - Date.now()) / 2)
    const due = () => user.expiresAt - Date.now() - lead
    timer = window.setTimeout(renew, Math.max(0, due()))
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (user.expiresAt <= Date.now()) signOutEverywhere()
      else if (due() <= 0) renew()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user])
  if (!user) {
    return (
      <Login
        onSignIn={(u) => {
          saveSession(u)
          setUser(u)
        }}
      />
    )
  }
  return (
    <App
      user={user}
      onSignOut={() => {
        clearSession()
        setUser(null)
      }}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
