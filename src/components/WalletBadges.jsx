// Official-style "Add to Apple Wallet" / "Add to Google Wallet" badges as inline
// SVG, drawn to each platform's published badge spec (black rounded rectangle,
// white wordmark, platform mark on the left, minimum height 40px, untouched
// proportions). Inline so they need no network fetch and cannot be blocked by
// the CSP in the native shell. Do NOT recolor, stretch, or restyle these: both
// Apple and Google require the badge to appear exactly in the official style.
//
// Usage: <AppleWalletBadge onClick={...} disabled={...} />

const base = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  background: '#000', color: '#fff', border: '1px solid #a6a6a6',
  borderRadius: 8, height: 44, padding: '0 14px 0 10px',
  cursor: 'pointer', font: '600 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  letterSpacing: -0.2, whiteSpace: 'nowrap',
}
const disabledStyle = { opacity: 0.55, cursor: 'default' }

export function AppleWalletBadge({ onClick, disabled, label = 'Add to Apple Wallet' }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      style={{ ...base, ...(disabled ? disabledStyle : null) }}>
      {/* Apple Wallet glyph: stacked cards */}
      <svg width="30" height="24" viewBox="0 0 30 24" aria-hidden="true">
        <rect x="1" y="1" width="28" height="22" rx="4" fill="#fff" />
        <rect x="1" y="1" width="28" height="7" rx="4" fill="#f5b800" />
        <rect x="1" y="6" width="28" height="6" fill="#ff5f4d" />
        <rect x="1" y="10" width="28" height="6" fill="#39b7d8" />
        <rect x="1" y="14" width="28" height="9" rx="0" fill="#232323" />
        <rect x="1" y="1" width="28" height="22" rx="4" fill="none" stroke="#000" strokeWidth="1" />
      </svg>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.05 }}>
        <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.85 }}>Add to</span>
        <span style={{ fontSize: 17, fontWeight: 600 }}>Apple Wallet</span>
      </span>
    </button>
  )
}

export function GoogleWalletBadge({ onClick, disabled, label = 'Add to Google Wallet' }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      style={{ ...base, ...(disabled ? disabledStyle : null) }}>
      {/* Google Wallet mark: the four-color folded card */}
      <svg width="30" height="24" viewBox="0 0 30 24" aria-hidden="true">
        <rect x="1" y="3" width="28" height="18" rx="4" fill="#fff" />
        <path d="M3 8 h24 v3 H3z" fill="#4285F4" />
        <path d="M3 11 h24 v3 H3z" fill="#34A853" />
        <path d="M3 14 h24 v3 H3z" fill="#FBBC04" />
        <path d="M3 17 h24 v3 a3 3 0 0 1 -3 3 H6 a3 3 0 0 1 -3 -3z" fill="#EA4335" />
        <rect x="1" y="3" width="28" height="18" rx="4" fill="none" stroke="#000" strokeWidth="1" />
      </svg>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.05 }}>
        <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.85 }}>Add to</span>
        <span style={{ fontSize: 17, fontWeight: 600 }}>Google Wallet</span>
      </span>
    </button>
  )
}
