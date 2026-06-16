// Lightweight, keyless bot defense for public forms: a hidden "honeypot" field
// (humans never fill it; bots do) + a minimum fill time (bots submit instantly).
// Stops the overwhelming majority of spam. Cloudflare Turnstile is the hardened
// server-verified upgrade — tracked for later.
export function isLikelyBot({ honeypot, startedAt, minMs = 2500 }) {
  if (honeypot && honeypot.trim()) return true
  if (startedAt && Date.now() - startedAt < minMs) return true
  return false
}

export const honeypotStyle = {
  position: 'absolute', left: '-9999px', top: 0, width: '1px', height: '1px',
  opacity: 0, pointerEvents: 'none', overflow: 'hidden',
}
