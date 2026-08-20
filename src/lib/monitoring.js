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
  // Native shells (Capacitor) get their own environment so Simulator/TestFlight
  // runs never mix into the web 'production' bucket. Detected via the URL
  // scheme, which is capacitor:// on iOS and https://localhost on Android.
  const isNative = typeof window !== 'undefined' &&
    (window.location.protocol === 'capacitor:' ||
     (window.location.protocol === 'https:' && window.location.hostname === 'localhost'))
  const platform = isNative
    ? (window.location.protocol === 'capacitor:' ? 'ios' : 'android')
    : 'web'
  // vite build always sets MODE=production, so a locally served production
  // bundle (vite preview, a file server) would otherwise pollute the real
  // production error stream. Native is checked first: Android's shell origin
  // is https://localhost and must stay native-android, not local.
  const isLocalWeb = !isNative && typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  Sentry.init({
    dsn,
    environment: isNative ? `native-${platform}`
      : isLocalWeb ? 'local'
      : (import.meta.env.MODE || 'production'),
    tracesSampleRate: 0.1,
  })
  Sentry.setTag('platform', platform)
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
