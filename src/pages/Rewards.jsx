import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import AddToWallet from '../components/AddToWallet'

// In-app Rewards card — "1C · hero donut, minimal". Two stacked white cards on a
// cream page: the loyalty card (live points/tier/member) + the back-of-pass detail.
const C = { red: '#DD1B22', redDeep: '#8B1116', blue: '#023462', sky: '#1772AC', ink: '#141210', label: '#9a938c', cream: '#F4F1EC' }

// Decorative sprinkles (brand colors), positioned as % of the card.
const SPRINKLES_TOP = [
  { t: '15%', l: '40%', r: -18, c: C.sky }, { t: '11%', l: '86%', r: 24, c: C.red },
  { t: '30%', l: '8%', r: 12, c: C.sky }, { t: '22%', l: '66%', r: 40, c: '#F5C518' },
  { t: '44%', l: '28%', r: -28, c: '#ED93B1' }, { t: '38%', l: '5%', r: 18, c: '#F5C518' },
  { t: '55%', l: '18%', r: 32, c: '#F0997B' },
  { t: '46%', l: '46%', r: 20, c: C.sky }, { t: '52%', l: '56%', r: -24, c: '#F5C518' },
  { t: '58%', l: '44%', r: 36, c: C.red }, { t: '49%', l: '62%', r: 8, c: '#ED93B1' },
  { t: '64%', l: '70%', r: -18, c: '#F5C518' }, { t: '70%', l: '86%', r: 28, c: C.sky },
  { t: '76%', l: '74%', r: -32, c: '#F0997B' }, { t: '67%', l: '92%', r: 14, c: C.red },
  { t: '80%', l: '60%', r: 22, c: '#F5C518' }, { t: '61%', l: '82%', r: -12, c: '#ED93B1' },
]
const SPRINKLES_BACK = [
  { t: '12%', l: '80%', r: -20, c: '#ED93B1' }, { t: '8%', l: '58%', r: 24, c: C.sky },
  { t: '26%', l: '42%', r: 40, c: '#F5C518' }, { t: '30%', l: '72%', r: -14, c: C.red },
  { t: '20%', l: '52%', r: 12, c: '#F0997B' },
]

function Sprinkle({ s }) {
  return <span aria-hidden="true" style={{ position: 'absolute', top: s.t, left: s.l, width: 15, height: 5, borderRadius: 3, background: s.c, transform: `rotate(${s.r}deg)`, opacity: 0.9, pointerEvents: 'none' }} />
}

export default function Rewards() {
  const { profile, tenant } = useAuth()
  const [r, setR] = useState(null)

  useEffect(() => {
    if (!profile?.id) return
    supabase.rpc('get_member_rewards', { p_profile: profile.id })
      .then(({ data }) => setR(Array.isArray(data) ? data[0] : data))
  }, [profile])

  const balance = r?.points_balance ?? 0
  const tier = r?.tier ?? 'Glazed'
  const freeDozen = r?.free_dozen_pts ?? 2000
  const memberSince = profile?.created_at ? new Date(profile.created_at).getFullYear() : new Date().getFullYear()
  const name = displayName(profile)
  const memberNo = memberNumber(profile?.id)
  const homeTruck = tenant?.name || 'DonutNV'

  const card = { position: 'relative', background: '#fff', borderRadius: 22, overflow: 'hidden', boxShadow: '0 10px 30px rgba(20,18,16,0.10)' }

  return (
    <div className="pad-top" style={{ paddingBottom: 24 }}>
      {/* ── Loyalty card ── */}
      <div style={card}>
        <div style={{ display: 'flex', height: 12 }}>
          <div style={{ flex: 1, background: C.red }} /><div style={{ flex: 1, background: C.redDeep }} />
          <div style={{ flex: 1, background: C.blue }} /><div style={{ flex: 1, background: C.sky }} />
        </div>

        <div style={{ position: 'relative', padding: '20px 22px 22px' }}>
          {SPRINKLES_TOP.map((s, i) => <Sprinkle key={i} s={s} />)}

          <div style={{ position: 'relative', zIndex: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <img src="/brand/logo-black.png" alt="DonutNV" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
            <span style={{ color: C.blue, fontWeight: 800, letterSpacing: 2.5, fontSize: 15 }}>REWARDS</span>
          </div>

          <div style={{ position: 'relative', minHeight: 250, marginTop: 16 }}>
            <img src="/hero_cup.png" alt="" aria-hidden="true"
              style={{ position: 'absolute', right: -20, top: -6, width: 236, height: 'auto', objectFit: 'contain', zIndex: 1 }} />
            <div style={{ position: 'relative', zIndex: 2, maxWidth: '50%' }}>
              <div style={{ color: C.label, letterSpacing: 2.5, fontSize: 13, fontWeight: 700 }}>BALANCE</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 66, fontWeight: 800, color: C.ink, lineHeight: 1, letterSpacing: -1.5 }}>{balance.toLocaleString()}</span>
                <span style={{ fontSize: 21, fontWeight: 800, color: C.red }}>pts</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: C.cream, borderRadius: 24, padding: '10px 18px', marginTop: 18 }}>
                <span style={{ width: 10, height: 10, borderRadius: 10, background: C.red }} />
                <span style={{ fontWeight: 800, letterSpacing: 1, color: C.ink, fontSize: 15 }}>{tier.toUpperCase()} TIER</span>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #ece7e0', margin: '2px 0 14px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ color: C.label, letterSpacing: 2, fontSize: 12, fontWeight: 700 }}>MEMBER SINCE {memberSince}</div>
              <div style={{ fontSize: 23, fontWeight: 800, color: C.ink, marginTop: 4 }}>{name}</div>
            </div>
            <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: 2, color: '#8a837b', fontSize: 15 }}>{memberNo}</div>
          </div>
          <p style={{ color: C.label, fontSize: 14, margin: '10px 0 0', lineHeight: 1.5 }}>
            Enter your phone number at the register with every purchase to earn points.
          </p>
        </div>
      </div>

      {/* ── Back of pass ── */}
      <div style={{ ...card, marginTop: 16 }}>
        <div style={{ position: 'relative', padding: '20px 22px' }}>
          {SPRINKLES_BACK.map((s, i) => <Sprinkle key={i} s={s} />)}
          <div style={{ position: 'relative', zIndex: 2 }}>
            <div style={{ color: C.blue, fontWeight: 800, letterSpacing: 2.5, fontSize: 15, marginBottom: 12 }}>BACK OF PASS</div>
            <Row label="Free dozen at" value={`${freeDozen.toLocaleString()} pts`} first />
            <Row label="Birthday treat" value="Free dozen donuts" />
            <Row label="Home truck" value={homeTruck} />
            <div style={{ background: C.cream, borderRadius: 16, padding: '14px 16px', marginTop: 16, color: '#5b544d', fontSize: 14, lineHeight: 1.5 }}>
              Please enter your telephone number at the register with every purchase. Points are only credited when your number is entered at checkout.
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}><AddToWallet /></div>
    </div>
  )
}

function Row({ label, value, first }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderTop: first ? 'none' : '1px solid #f2eee8' }}>
      <span style={{ color: '#7c756e', fontSize: 15 }}>{label}</span>
      <span style={{ fontWeight: 800, color: C.ink, fontSize: 15 }}>{value}</span>
    </div>
  )
}

function displayName(p) {
  if (!p) return 'Member'
  const f = p.first_name || 'Member'
  return p.last_name ? `${f} ${p.last_name[0]}.` : f
}

function memberNumber(id) {
  if (!id) return 'DNV 0000 0000'
  const hex = id.replace(/[^0-9a-f]/gi, '').slice(0, 10)
  let n = 0
  for (const c of hex) n = (n * 31 + parseInt(c, 16)) >>> 0
  const s = String(n).padStart(8, '0').slice(0, 8)
  return `DNV ${s.slice(0, 4)} ${s.slice(4, 8)}`
}
