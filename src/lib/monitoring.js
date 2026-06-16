// Error monitoring. If VITE_SENTRY_DSN is set, loads Sentry and starts capturing
// uncaught errors + promise rejections (great for catching issues on operators'
// phones in the field). No DSN set = clean no-op, so dev/staging stay quiet.
//
// To turn on: create a free Sentry project, then add VITE_SENTRY_DSN to Netlify
// env vars. The DSN is a public client value (safe to ship in the bundle).
// (Production hardening can swap this CDN load for the bundled @sentry/react SDK.)
export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  import('https://esm.sh/@sentry/browser@8')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE || 'production',
        tracesSampleRate: 0.1,
      })
      window.__SENTRY__loaded = true
    })
    .catch(() => { /* monitoring is best-effort; never block the app */ })
}
