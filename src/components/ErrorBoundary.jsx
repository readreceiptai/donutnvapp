import { Component } from 'react'
import { captureError } from '../lib/monitoring'

// Top-level safety net. A render error anywhere below this used to blank the
// whole screen with no recovery (and, with monitoring off, no signal either).
// Now we catch it, report it, and show a branded reload card instead.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    captureError(error, { componentStack: info?.componentStack })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={S.wrap}>
        <div style={S.card}>
          <div style={S.awning} aria-hidden="true">
            {['#DD1B22', '#fff', '#DD1B22', '#fff', '#DD1B22', '#fff', '#DD1B22'].map((c, i) => (
              <span key={i} style={{ ...S.stripe, background: c }} />
            ))}
          </div>
          <h1 style={S.h1}>Something went wrong</h1>
          <p style={S.sub}>Sorry about that. Reloading usually fixes it.</p>
          <button style={S.btn} onClick={() => window.location.reload()}>Reload</button>
          <div style={S.foot}>DonutNV • Make Your Next Party Sweet!®</div>
        </div>
      </div>
    )
  }
}

const S = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFF7F0', padding: 20, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  card: { width: '100%', maxWidth: 380, background: '#fff', borderRadius: 20, boxShadow: '0 12px 40px rgba(0,0,0,.12)', padding: '0 28px 28px', overflow: 'hidden', textAlign: 'center' },
  awning: { display: 'flex', margin: '0 -28px 22px', height: 18 },
  stripe: { flex: 1 },
  h1: { fontSize: '1.5rem', fontWeight: 800, color: '#231F20', margin: '18px 0 4px' },
  sub: { color: '#6b7280', fontSize: '.92rem', margin: '0 0 20px', lineHeight: 1.5 },
  btn: { width: '100%', padding: '13px', fontSize: '1rem', fontWeight: 700, color: '#fff', background: '#DD1B22', border: 'none', borderRadius: 12, cursor: 'pointer' },
  foot: { marginTop: 22, color: '#9ca3af', fontSize: '.72rem' },
}
