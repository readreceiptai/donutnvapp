import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { activeTerritory } from '../lib/territory'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [loading, setLoading] = useState(true)
  // Superadmin "God Mode" (#127): the server-stored acting-as tenant. Non-superadmins
  // never have one. effectiveTenantId (below) is what every operator page scopes to.
  const [actingTenantId, setActingTenantId] = useState(null)
  const [actingTenant, setActingTenantObj] = useState(null)

  // Load the tenant (white-label branding) once on boot, even before login.
  // The territory comes from the URL (/ph) → falls back to the default.
  useEffect(() => {
    supabase.from('tenants').select('*').eq('slug', activeTerritory()).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setTenant(data)
          applyBrand(data.brand)
        }
      })
  }, [])

  // Load the current superadmin's acting-as tenant (server-stored, survives refresh).
  // RLS returns a row only for a verified superadmin; everyone else resolves to null.
  const refreshActingAs = useCallback(async (prof) => {
    if (!prof?.is_superadmin) { setActingTenantId(null); setActingTenantObj(null); return }
    const { data } = await supabase.from('superadmin_acting_as').select('acting_tenant_id').maybeSingle()
    const id = data?.acting_tenant_id || null
    setActingTenantId(id)
    if (id) {
      const { data: t } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle()
      setActingTenantObj(t || null)
    } else {
      setActingTenantObj(null)
    }
  }, [])

  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); setActingTenantId(null); setActingTenantObj(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    setProfile(data || null)
    await refreshActingAs(data || null)
  }, [refreshActingAs])

  const uidRef = useRef(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      uidRef.current = data.session?.user?.id ?? null
      setSession(data.session)
      loadProfile(data.session?.user?.id).finally(() => setLoading(false))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      const newUid = s?.user?.id ?? null
      setSession(s)
      // Only reload the profile (and re-enter loading, which remounts the app) when
      // the actual signed-in user changes. Routine token refreshes — which fire when
      // you switch browser tabs — keep the same user, so we leave in-page state alone.
      if (newUid !== uidRef.current) {
        uidRef.current = newUid
        setLoading(true)
        loadProfile(newUid).finally(() => setLoading(false))
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const signOut = () => supabase.auth.signOut()

  // God Mode control: set (or clear, with null) the acting-as tenant. Hard-gated to
  // verified superadmins on the SERVER (set_acting_tenant raises otherwise); this is
  // just the client trigger + local refresh. Callers handle navigation.
  const setActingTenant = useCallback(async (tenantId) => {
    const { error } = await supabase.rpc('set_acting_tenant', { p_tenant: tenantId ?? null })
    if (error) throw error
    await refreshActingAs(profile)
  }, [profile, refreshActingAs])

  const isSuperadmin = !!profile?.is_superadmin
  const effectiveTenantId = actingTenantId || profile?.tenant_id || null
  const impersonating = !!actingTenantId && actingTenantId !== profile?.tenant_id

  // What this tenant is entitled to. A franchisee can buy the DonutNV ops/customer
  // app, ELLE, or both — these gate nav + routes. has_app defaults true so existing
  // tenants keep the app; has_elle is opt-in per purchase.
  const entitlements = { app: tenant ? tenant.has_app !== false : true, elle: !!tenant?.has_elle }

  return (
    <AuthContext.Provider value={{ session, profile, tenant, entitlements, loading, reloadProfile: () => loadProfile(session?.user?.id), signOut, isSuperadmin, effectiveTenantId, impersonating, actingTenantId, actingTenant, setActingTenant }}>
      {children}
    </AuthContext.Provider>
  )
}

// White-label: push tenant brand colors into CSS variables at runtime.
function applyBrand(brand) {
  if (!brand) return
  const root = document.documentElement
  const map = { red: '--red', redDeep: '--red-deep', blue: '--blue', navy: '--navy', ink: '--ink', cream: '--cream' }
  Object.entries(map).forEach(([k, v]) => { if (brand[k]) root.style.setProperty(v, brand[k]) })
}
