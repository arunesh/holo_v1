import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Login from './ui/Login'
import { loadSession, saveSession, clearSession } from './auth/session'
import type { SessionUser } from './auth/session'
import './styles.css'

function Root() {
  const [user, setUser] = useState<SessionUser | null>(loadSession)
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
