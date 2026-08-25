import { Component } from 'react'
import { captureError } from '../lib/monitoring'

// Top-level safety net. A render error anywhere below this used to blank the
// whole screen with no recovery. Now we catch it, report it, and show the
// branded "we'll be right back" outage screen (matches status-pages/outage.html).
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
        <main style={S.card} role="alert" aria-live="polite">
          <img style={S.logo} src="/brand/logo-black.png" alt="DonutNV" />
          <img className="dnv-donut" style={S.donut} src="/mini_donut.png" alt="" aria-hidden="true" />
          <h1 style={S.h1}>Our fryer's taking a quick break</h1>
          <p style={S.p}>Something on our end got a little sticky, and we're glazing it back together right now. No need to do anything. We'll have the shop open again shortly.</p>
          <p style={{ ...S.p, fontSize: 14, color: '#8a8482', marginBottom: 4 }}>Thanks for your patience. Sweet things are worth the wait.</p>
          <button style={S.btn} onClick={() => window.location.reload()}>Try again</button>
          <div style={S.foot}>DonutNV • Make Your Next Party Sweet!®</div>
        </main>
        <style>{'@keyframes dnv-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.dnv-donut{animation:none!important}}'}</style>
      </div>
    )
  }
}

const S = {
  wrap: { background: '#FFF4EC', color: '#231F20', fontFamily: '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: '100vh' },
  card: { background: '#fff', width: '100%', maxWidth: 460, borderRadius: 20, boxShadow: '0 12px 40px rgba(0,0,0,.10)', padding: '40px 34px 30px', textAlign: 'center' },
  logo: { width: 190, maxWidth: '70%', height: 'auto', margin: '0 auto 18px', display: 'block' },
  donut: { width: 150, height: 'auto', margin: '6px auto 18px', display: 'block', animation: 'dnv-spin 4s linear infinite' },
  h1: { fontSize: 24, margin: '0 0 10px' },
  p: { fontSize: 16, lineHeight: 1.55, color: '#5b5654', margin: '0 0 14px' },
  btn: { display: 'inline-block', marginTop: 8, background: '#DD1B22', color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 15, padding: '13px 26px', border: 0, borderRadius: 12, cursor: 'pointer' },
  foot: { marginTop: 26, paddingTop: 16, borderTop: '1px solid #f1ece9', fontSize: 12, color: '#a8a2a0' },
}
