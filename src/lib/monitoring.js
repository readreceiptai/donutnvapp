// Error monitoring. If VITE_SENTRY_DSN is set, Sentry (bundled — NOT loaded from
// a CDN, so no third-party code runs in the same context as the Supabase session)
// starts capturing uncaught errors + promise rejections. No DSN = clean no-op, so
// dev/staging stay quiet.
//
// To turn on: create a free Sentry project, then add VITE_SENTRY_DSN to Netlify
// env vars. The DSN is a public client value (safe to ship in the bundle).
import * as Sentry from '@sentry/react'

let enabled = false

export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || 'production',
    tracesSampleRate: 0.1,
  })
  enabled = true
}

// Report a handled error (used by the top-level ErrorBoundary). Safe to call
// whether or not monitoring is configured — it's a no-op until initMonitoring
// runs with a DSN.
export function captureError(error, context) {
  if (!enabled) return
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined)
  } catch { /* monitoring is best-effort; never throw from the reporter */ }
}
