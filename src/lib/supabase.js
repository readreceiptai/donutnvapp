import { createClient } from '@supabase/supabase-js'

// One Supabase client for the whole app. Reads keys from .env (Vite injects them).
const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

// Helpful console warning if the keys aren't set yet (common first-run gotcha).
if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.warn('[DonutNV] Supabase keys missing — copy .env.example to .env and fill them in.')
}

export const supabase = createClient(url || 'https://placeholder.supabase.co', anon || 'placeholder')

export const TENANT_SLUG = import.meta.env.VITE_TENANT_SLUG || 'donutnv-home'
export const isConfigured = Boolean(url && anon && !url.includes('YOUR-PROJECT'))
