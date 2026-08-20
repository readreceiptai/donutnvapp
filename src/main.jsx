import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { territoryBasename } from './lib/territory'
import App from './App'
import BetaGate from './components/BetaGate'
import ErrorBoundary from './components/ErrorBoundary'
import NativeBoot from './components/NativeBoot'
import { initMonitoring } from './lib/monitoring'
import './index.css'

initMonitoring() // error monitoring (no-op until VITE_SENTRY_DSN is set)

// Self-heal after deploys. Every redeploy replaces the hashed asset files, so a
// tab opened before the deploy asks for chunks that no longer exist ("Failed to
// fetch dynamically imported module", seen in Sentry after the 2026-08-18
// deploy). Vite fires vite:preloadError for exactly this; one reload fetches
// the new index.html and heals the tab. The 30s timestamp guard prevents a
// reload loop if a deploy is genuinely broken — in that case we let the error
// throw so Sentry sees it.
window.addEventListener('vite:preloadError', (e) => {
  const last = Number(sessionStorage.getItem('dnv-chunk-reload') || 0)
  if (Date.now() - last > 30000) {
    sessionStorage.setItem('dnv-chunk-reload', String(Date.now()))
    e.preventDefault() // handled: suppress the error, do not report a self-healed tab
    window.location.reload()
  }
})

// basename makes every route relative to the territory, e.g. /ph/signup.
// BetaGate is a no-op unless VITE_BETA_PASSWORD is set (private-beta wall).
// ErrorBoundary keeps one bad render from white-screening the whole app.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={territoryBasename()}>
        <AuthProvider>
          <NativeBoot />
          <BetaGate>
            <App />
          </BetaGate>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
