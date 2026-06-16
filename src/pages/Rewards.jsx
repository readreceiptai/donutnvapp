import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import MiniDonut from '../components/MiniDonut'

// Earn & Play. The transactional points live in Square Loyalty (tied to the
// register). This screen shows the *gamified* layer the app owns:
//   • Stamp card  — visit N times, earn a treat (counts every check-in)
//   • Donut Passport — catch us at N different spots, unlock a bigger reward
// Whatever the operator switches on in the admin renders here automatically.
export default function Rewards() {
  const { profile } = useAuth()
  const [stamp, setStamp] = useState(null)
  const [stampCount, setStampCount] = useState(0)
  const [passport, setPassport] = useState(null)
  const [passportStops, setPassportStops] = useState(0)

  useEffect(() => {
    supabase.from('campaigns').select('*')
      .eq('is_active', true).in('kind', ['checkin_stamp', 'passport'])
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const list = data || []
        setStamp(list.find((c) => c.kind === 'checkin_stamp') || null)
        setPassport(list.find((c) => c.kind === 'passport') || null)
      })
  }, [])

  useEffect(() => {
    if (!profile || !stamp) return
    supabase.from('check_ins').select('id', { count: 'exact', head: true })
      .eq('profile_id', profile.id).eq('campaign_id', stamp.id)
      .then(({ count }) => setStampCount(count || 0))
  }, [profile, stamp])

  useEffect(() => {
    if (!profile || !passport) return
    supabase.from('check_ins').select('created_at,lat,lng')
      .eq('profile_id', profile.id).eq('campaign_id', passport.id)
      .then(({ data }) => {
        // "Different stops": dedupe by location when we have it, else by day.
        const keys = new Set((data || []).map((r) =>
          (r.lat != null && r.lng != null) ? `${r.lat.toFixed(2)},${r.lng.toFixed(2)}` : new Date(r.created_at).toDateString()))
        setPassportStops(keys.size)
      })
  }, [profile, passport])

  return (
    <div className="pad-top stack">
      <h1>Rewards</h1>

      {!stamp && !passport && (
        <div className="card center">
          <div style={{ display: 'flex', justifyContent: 'center' }}><MiniDonut size={48} /></div>
          <p className="muted" style={{ margin: '8px 0 0' }}>No game running right now — check back soon for a fresh one!</p>
        </div>
      )}

      {stamp && <StampCard campaign={stamp} count={stampCount} />}
      {passport && <Passport campaign={passport} stops={passportStops} />}

      <div className="card">
        <h2 style={{ marginBottom: 6 }}>How points work</h2>
        <p className="muted" style={{ margin: 0 }}>
          Every purchase at the truck earns loyalty points on your phone number at the register.
          Stamp cards and the Donut Passport are extra ways to win free donuts.
        </p>
      </div>
    </div>
  )
}

function StampCard({ campaign, count }) {
  const goal = campaign?.config?.goal || 5
  const reward = campaign?.config?.reward || 'A free treat'
  const filled = Math.min(count, goal)
  const done = filled >= goal
  return (
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
  )
}

function Passport({ campaign, stops }) {
  const goal = campaign?.config?.goal || 4
  const reward = campaign?.config?.reward || 'A special reward'
  const filled = Math.min(stops, goal)
  const done = filled >= goal
  return (
    <div className="card" style={{ borderTop: '4px solid var(--blue)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 22 }}>🗺️</span>
        <h2 style={{ margin: 0 }}>{campaign.name || 'Donut Passport'}</h2>
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        {done ? 'Passport complete! 🎉' : `Catch us at ${goal - filled} more ${goal - filled === 1 ? 'spot' : 'spots'} to unlock: ${reward}`}
      </p>
      <div className="passport-grid">
        {Array.from({ length: goal }, (_, i) => (
          <div key={i} className={`passport-stop ${i < filled ? 'stamped' : ''}`}>
            {i < filled ? <MiniDonut size={30} /> : <span className="passport-num">{i + 1}</span>}
          </div>
        ))}
      </div>
      {done && <div className="success" style={{ marginTop: 14 }}>Show this screen at the truck to redeem: <b>{reward}</b></div>}
    </div>
  )
}
