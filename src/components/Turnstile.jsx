import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Cloudflare Turnstile — a privacy-friendly, no-puzzle CAPTCHA alternative.
// We render the widget only when a site key is configured (VITE_TURNSTILE_SITE_KEY),
// so the app keeps working before Turnstile is set up. The token the widget
// produces is verified SERVER-SIDE by the verify-turnstile Edge Function before
// a public form is allowed through.

export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
export const TURNSTILE_ENABLED = !!TURNSTILE_SITE_KEY

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function loadScript() {
  if (window.turnstile) return Promise.resolve()
  if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC; s.async = true; s.defer = true
    document.head.appendChild(s)
  }
  return new Promise((resolve) => {
    const t = setInterval(() => { if (window.turnstile) { clearInterval(t); resolve() } }, 80)
    setTimeout(() => { clearInterval(t); resolve() }, 8000)
  })
}

// Ask the Edge Function to validate the token with Cloudflare. Returns true if
// the token is valid OR if Turnstile isn't configured yet (graceful fallback).
export async function passesTurnstile(token) {
  if (!TURNSTILE_ENABLED) return true
  try {
    const { data, error } = await supabase.functions.invoke('verify-turnstile', { body: { token } })
    if (error) return false
    return !!data?.ok
  } catch {
    return false
  }
}

// Renders the widget and reports the token up via onToken. Renders nothing when
// Turnstile isn't configured.
export default function TurnstileWidget({ onToken }) {
  const ref = useRef(null)
  const widgetId = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!TURNSTILE_ENABLED) return
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) { if (!window.turnstile) setFailed(true); return }
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t) => onToken?.(t),
        'expired-callback': () => onToken?.(''),
        'error-callback': () => { onToken?.(''); setFailed(true) },
        theme: 'light',
      })
    })
    return () => {
      cancelled = true
      try { if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current) } catch { /* noop */ }
    }
  }, [onToken])

  if (!TURNSTILE_ENABLED) return null
  return (
    <div style={{ margin: '4px 0' }}>
      <div ref={ref} />
      {failed && <div className="hint" style={{ color: 'var(--err, #c0392b)' }}>Couldn't load the verification widget — please refresh.</div>}
    </div>
  )
}
