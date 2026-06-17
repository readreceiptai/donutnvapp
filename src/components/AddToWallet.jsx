import { useState } from 'react'
import { supabase } from '../lib/supabase'

// "Add to Apple Wallet" for the DonutNV loyalty card. The pass is signed by an
// Apple cert that doesn't exist until the HazBinz LLC developer account is
// approved — so until then the wallet-pass function returns { configured:false }
// and we show a friendly "coming soon" state instead of a broken download.
export default function AddToWallet() {
  const [state, setState] = useState('idle') // idle | loading | soon | ready | error
  const [msg, setMsg] = useState('')

  async function add() {
    setState('loading'); setMsg('')
    const { data, error } = await supabase.functions.invoke('wallet-pass', { body: { platform: 'apple' } })
    if (error) { setState('error'); setMsg('Could not load your pass — please try again.'); return }
    if (data?.configured === false) {
      setState('soon')
      setMsg("Your DonutNV wallet card is almost ready — we'll let you know the moment you can add it to Apple Wallet.")
      return
    }
    // Once signing is live this will hand back a .pkpass / Google save link to open.
    setState('ready')
    setMsg('Your pass is ready!')
  }

  return (
    <div className="card" style={{ borderTop: '4px solid var(--brand, #e91e63)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 22 }}>📲</span>
        <h2 style={{ margin: 0 }}>Add your donut card to Apple Wallet</h2>
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        Keep your stamp card in your phone's wallet — your progress updates itself, and we can ping you when a truck is nearby.
      </p>
      <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={state === 'loading'} onClick={add}>
        {state === 'loading' ? 'Getting your card…' : 'Add to Apple Wallet'}
      </button>
      {msg && <div className={state === 'error' ? 'error' : 'success'} style={{ marginTop: 12 }}>{msg}</div>}
    </div>
  )
}
