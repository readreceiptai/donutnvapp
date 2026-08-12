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

  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    setProfile(data || null)
  }, [])

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

  // What this tenant is entitled to. A franchisee can buy the DonutNV ops/customer
  // app, ELLE, or both — these gate nav + routes. has_app defaults true so existing
  // tenants keep the app; has_elle is opt-in per purchase.
  const entitlements = { app: tenant ? tenant.has_app !== false : true, elle: !!tenant?.has_elle }

  return (
    <AuthContext.Provider value={{ session, profile, tenant, entitlements, loading, reloadProfile: () => loadProfile(session?.user?.id), signOut }}>
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
