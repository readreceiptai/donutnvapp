import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import MiniDonut from '../components/MiniDonut'

// Earn & Play. The transactional points live in Square Loyalty (tied to the
// register). This screen shows the *gamified* layer your app owns — here, the
// active check-in stamp card. Whatever campaign the operator switches on in the
// admin screen renders here automatically.
export default function Rewards() {
  const { profile } = useAuth()
  const [campaign, setCampaign] = useState(null)
  const [count, setCount] = useState(0)

  useEffect(() => {
    // The currently active check-in campaign for this tenant.
    supabase.from('campaigns').select('*')
      .eq('is_active', true).eq('kind', 'checkin_stamp')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setCampaign(data))
  }, [])

  useEffect(() => {
    if (!profile || !campaign) return
    supabase.from('check_ins').select('id', { count: 'exact', head: true })
      .eq('profile_id', profile.id).eq('campaign_id', campaign.id)
      .then(({ count }) => setCount(count || 0))
  }, [profile, campaign])

  const goal = campaign?.config?.goal || 5
  const reward = campaign?.config?.reward || 'A free treat'
  const filled = Math.min(count, goal)
  const done = filled >= goal

  return (
    <div className="pad-top stack">
      <h1>Rewards</h1>

      {!campaign ? (
        <div className="card center">
          <div style={{ display: 'flex', justifyContent: 'center' }}><MiniDonut size={48} /></div>
          <p className="muted" style={{ margin: '8px 0 0' }}>No game running right now — check back soon for a fresh one!</p>
        </div>
      ) : (
        <div className="card card-accent">
          <h2 style={{ marginBottom: 2 }}>{campaign.name}</h2>
          <p className="muted" style={{ marginTop: 0 }}>{done ? 'You earned it! 🎉' : `${goal - filled} more to go for: ${reward}`}</p>
          <div className="stamps" style={{ marginTop: 10 }}>
            {Array.from({ length: goal }, (_, i) => (
              <div key={i} className={`stamp ${i < filled ? 'filled' : ''}`}>{i < filled ? <MiniDonut size={22} /> : ''}</div>
            ))}
          </div>
          {done && <div className="success" style={{ marginTop: 14 }}>Show this screen at the truck to redeem: <b>{reward}</b></div>}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginBottom: 6 }}>How points work</h2>
        <p className="muted" style={{ margin: 0 }}>
          Every purchase at the truck earns loyalty points on your phone number at the register.
          Stamp cards and games like this one are extra ways to win free donuts.
        </p>
      </div>
    </div>
  )
}
