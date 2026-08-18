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
