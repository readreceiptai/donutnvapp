import React from 'react'
import ReactDOM from 'react-dom/client'
import Onboard from './pages/Onboard'
import './index.css'
import './onboard-brand.css' // exact brand tokens, scoped to /onboard (must load after index.css)

// Standalone entry for the PUBLIC owner-onboarding form (/onboard).
//
// This is deliberately its OWN page, separate from the main app bundle: it
// renders only the Onboard wizard — no router, no AuthProvider, no app shell.
// That lets the Netlify edge gate expose /onboard to invitees WITHOUT exposing
// (or making runnable) the rest of the private-beta app, whose index.html stays
// gated. Onboard talks to Supabase directly via the anon client.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Onboard />
  </React.StrictMode>
)
