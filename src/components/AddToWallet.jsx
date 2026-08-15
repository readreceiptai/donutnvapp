import { useState } from 'react'
import { supabase } from '../lib/supabase'

// "Add to Wallet" for the DonutNV loyalty card — Apple Wallet on iOS/Mac,
// Google Wallet on Android. The wallet-pass Edge Function signs a real .pkpass
// (Apple) or mints a "Save to Google Wallet" link (Google). Until the platform's
// signing secrets are set it returns { configured:false } and we show a friendly
// "coming soon" state instead of a broken download.
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const IS_ANDROID = /Android/i.test(ua)
const IS_APPLE = /iPhone|iPad|iPod|Macintosh/i.test(ua)

export default function AddToWallet() {
  const [state, setState] = useState('idle') // idle | loading | soon | ready | error
  const [msg, setMsg] = useState('')

  async function addApple() {
    setState('loading'); setMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setState('error'); setMsg('Please sign in first.'); return }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wallet-pass`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ platform: 'apple' }),
      })
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const j = await res.json()
        if (j.configured === false) {
          setState('soon')
          setMsg("Your DonutNV wallet card is almost ready — we'll let you know the moment you can add it to Apple Wallet.")
          return
        }
        setState('error'); setMsg(j.error || 'Could not build your pass — please try again.'); return
      }
      // Real .pkpass — navigate to a blob URL so iOS Safari shows "Add to Apple Wallet".
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.location.href = url
      setState('ready'); setMsg('Opening your pass…')
    } catch {
      setState('error'); setMsg('Could not load your pass — please try again.')
    }
  }

  async function addGoogle() {
    setState('loading'); setMsg('')
    const { data, error } = await supabase.functions.invoke('wallet-pass', { body: { platform: 'google' } })
    if (error) { setState('error'); setMsg('Could not load your pass — please try again.'); return }
    if (data?.configured === false) {
      setState('soon')
      setMsg("Your DonutNV wallet card is almost ready — we'll let you know the moment you can save it to Google Wallet.")
      return
    }
    if (data?.saveUrl) { window.location.href = data.saveUrl; setState('ready'); setMsg('Opening Google Wallet…'); return }
    setState('error'); setMsg(data?.error || 'Could not build your pass — please try again.')
  }

  return (
    <div className="card" style={{ borderTop: '4px solid var(--brand, #e91e63)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 22 }}>📲</span>
        <h2 style={{ margin: 0 }}>Add your donut card to your wallet</h2>
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        Keep your stamp card in your phone's wallet — your progress updates itself, and we can ping you when a truck is nearby.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {!IS_ANDROID && (
          <button className="btn btn-primary" disabled={state === 'loading'} onClick={addApple}>
            {state === 'loading' ? 'Getting your card…' : ' Add to Apple Wallet'}
          </button>
        )}
        {!IS_APPLE && (
          <button className="btn btn-blue" disabled={state === 'loading'} onClick={addGoogle}>
            {state === 'loading' ? 'Getting your card…' : 'Save to Google Wallet'}
          </button>
        )}
      </div>

      {msg && <div className={state === 'error' ? 'error' : 'success'} style={{ marginTop: 12 }}>{msg}</div>}
    </div>
  )
}
