import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// #127 God Mode: the persistent "Acting as: [Tenant] ▾ (exit)" bar. Shown ONLY while a
// superadmin is impersonating a tenant. Quick-switch re-scopes via set_acting_tenant;
// exit clears it and returns to the corporate/native superadmin home (/admin).
// Navigation uses a full load so every page re-pulls data under the new scope.
export default function GodModeBanner() {
  const { impersonating, actingTenant, setActingTenant } = useAuth()
  const [tenants, setTenants] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!impersonating) return
    supabase.from('tenants').select('id, name, slug').eq('is_active', true).order('name')
      .then(({ data }) => setTenants(data || []))
  }, [impersonating])

  if (!impersonating) return null

  async function switchTo(id) {
    if (!id || id === actingTenant?.id) return
    setBusy(true)
    try { await setActingTenant(id) } catch { setBusy(false); return }
    const t = tenants.find((x) => x.id === id)
    // If we're on a customer storefront route, follow the new tenant's slug; otherwise
    // just reload the current operator/ELLE page (data re-pulls under the new scope).
    const onCustomer = /\/(find|rewards|account|games)(\/|$)/.test(window.location.pathname)
    if (onCustomer && t?.slug) window.location.href = `/${t.slug}/find`
    else window.location.reload()
  }

  async function exit() {
    setBusy(true)
    try { await setActingTenant(null) } catch { setBusy(false); return }
    window.location.href = '/admin' // corporate / native superadmin home
  }

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '8px 14px', background: '#fbbf24', color: '#231f20',
      fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: '.85rem',
      boxShadow: '0 2px 8px rgba(0,0,0,.25)',
    }}>
      <span aria-hidden="true">⚡</span>
      <span>Acting as: <b>{actingTenant?.name || 'tenant'}</b></span>
      <select
        value={actingTenant?.id || ''}
        onChange={(e) => switchTo(e.target.value)}
        disabled={busy}
        aria-label="Switch tenant"
        style={{ marginLeft: 4, padding: '4px 8px', borderRadius: 8, border: 'none', fontWeight: 700 }}
      >
        {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button
        onClick={exit}
        disabled={busy}
        style={{
          marginLeft: 'auto', padding: '5px 14px', borderRadius: 999, border: 'none',
          background: '#231f20', color: '#fbbf24', fontWeight: 800, cursor: 'pointer',
        }}
      >
        Exit
      </button>
    </div>
  )
}
