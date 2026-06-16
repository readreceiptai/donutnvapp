import { createContext, useContext, useEffect, useState, useCallback } from 'react'
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      loadProfile(data.session?.user?.id).finally(() => setLoading(false))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      loadProfile(s?.user?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, profile, tenant, loading, reloadProfile: () => loadProfile(session?.user?.id), signOut }}>
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
