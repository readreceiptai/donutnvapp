import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Operator dashboard home (inside OperatorShell). Real numbers + the admin
// KILL SWITCH: stop any truck that's broadcasting, from anywhere.
export default function AdminHome() {
  const { profile, tenant, signOut } = useAuth()
  const [stats, setStats] = useState({ customers: null })
  const [liveTrucks, setLiveTrucks] = useState([])
  const [wallet, setWallet] = useState(null)

  const load = useCallback(async () => {
    if (!profile) return
    const { count } = await supabase.from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', profile.tenant_id).eq('role', 'customer')
    setStats({ customers: count ?? 0 })
    const { data: live } = await supabase.from('active_live_sessions').select('*')
      .eq('tenant_id', profile.tenant_id)
    setLiveTrucks(live || [])
    const { data: w } = await supabase.rpc('get_wallet_metrics', { p_tenant: profile.tenant_id })
    setWallet(Array.isArray(w) ? w[0] : w)
  }, [profile])

  useEffect(() => { load() }, [load])

  async function kill(sessionId) {
    await supabase.from('live_sessions').update({ is_live: false, ends_at: new Date().toISOString() }).eq('id', sessionId)
    load()
  }

  return (
    <div className="pad-top stack">
      <h1 style={{ marginBottom: 0 }}>{tenant?.name || 'Your territory'}</h1>
      <p className="muted" style={{ marginTop: 0 }}>Signed in as {profile?.first_name || 'owner'}.</p>

      <div style={{ display: 'flex', gap: 12 }}>
        <Stat label="Customers" value={stats.customers} />
        <Stat label="Trucks live now" value={liveTrucks.length} />
      </div>

      {/* Admin kill switch */}
      <div className="card card-accent">
        <h2 style={{ marginBottom: 6 }}>📡 Broadcasting now</h2>
        {liveTrucks.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing is broadcasting. All quiet.</p>
        ) : (
          liveTrucks.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}><span className="dot dot-live" style={{ display: 'inline-block', marginRight: 6 }} />{s.stop_name || 'Live'}</div>
                <div className="muted" style={{ fontSize: '.82rem' }}>auto-closes {fmtTime(s.ends_at)}</div>
              </div>
              <button className="btn btn-primary" style={{ width: 'auto', padding: '10px 16px', background: 'var(--red-deep)' }} onClick={() => kill(s.id)}>Stop</button>
            </div>
          ))
        )}
      </div>

      {wallet && (
        <div className="card" style={{ borderTop: '4px solid var(--brand, #e91e63)' }}>
          <h2 style={{ marginBottom: 6 }}>📲 Wallet passes</h2>
          <div style={{ display: 'flex', gap: 12 }}>
            <Stat label="Installed" value={Number(wallet.passes_installed) || 0} />
            <Stat label="Wallet members" value={Number(wallet.wallet_members) || 0} />
            <Stat label="Their spend" value={`$${(((Number(wallet.wallet_member_revenue_cents) || 0)) / 100).toFixed(0)}`} />
          </div>
          <p className="muted" style={{ fontSize: '.8rem', margin: '8px 0 0' }}>
            Revenue from members who carry the wallet card — your justification for the $99/yr. Lights up once passes go live.
          </p>
        </div>
      )}

      <Link to="/admin/live" className="btn btn-primary">🟢 Go to broadcast controls</Link>
      <Link to="/admin/games" className="btn btn-blue">🎮 Manage games & rewards</Link>
      <Link to="/admin/reviews" className="btn btn-blue">⭐ Reviews &amp; testimonials</Link>
      <Link to="/admin/customers" className="btn btn-blue">👥 Customers &amp; export</Link>
      <Link to="/admin/corporate" className="btn btn-ghost">🏢 Corporate dashboard</Link>

      <div className="card">
        <h2 style={{ marginBottom: 6 }}>Coming next</h2>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Square Loyalty sync status (wired, flip on with your Square keys)</li>
          <li>Proximity-alert send log</li>
        </ul>
      </div>

      <button className="btn btn-ghost" onClick={signOut}>Log out</button>
      <p className="center muted" style={{ fontSize: '.75rem' }}>DonutNV platform by Trench Logic</p>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="card" style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: '2rem', color: 'var(--red)' }}>
        {value === null ? '—' : value}
      </div>
      <div className="muted" style={{ fontSize: '.85rem' }}>{label}</div>
    </div>
  )
}

const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
