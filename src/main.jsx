import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { territoryBasename } from './lib/territory'
import App from './App'
import { initMonitoring } from './lib/monitoring'
import './index.css'

initMonitoring() // error monitoring (no-op until VITE_SENTRY_DSN is set)

// basename makes every route relative to the territory, e.g. /ph/signup.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={territoryBasename()}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
