import { useState } from 'react'
import { Link } from 'react-router-dom'

// The customer Games hub. One real, playable game today (Guess the Bucket) plus
// a roadmap of what's coming. Games tie back to Rewards — play, win, earn a
// stamp toward a free bag — which is the retention hook.
const GAMES = [
  {
    id: 'guess-the-bucket',
    title: 'Guess the Bucket',
    blurb: 'Follow the donut, then pick the bucket it’s hiding under. Three rounds, one high score.',
    art: '/brand/donut_bucket.png',
    url: '/games/guess-the-bucket.html',
    live: true,
  },
  {
    id: 'donut-dash',
    title: 'Donut Dash',
    blurb: 'Run the truck route, grab the donuts, dodge the traffic. Coming soon.',
    art: '/brand/minidonut.png',
    live: false,
  },
  {
    id: 'stack-em',
    title: 'Stack ’Em',
    blurb: 'Stack the mini-donuts as high as you can without toppling. Coming soon.',
    art: '/brand/minidonut.png',
    live: false,
  },
]

export default function Games() {
  const [playing, setPlaying] = useState(null) // { title, url } | null

  return (
    <div className="pad-top stack">
      <h1 style={{ margin: 0 }}>Games</h1>

      {/* Rewards tie-in — the whole point: play, win, earn a free bag. */}
      <Link to="/rewards" className="card card-accent" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}>
        <img src="/brand/minidonut.png" alt="" style={{ width: 40, height: 40, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>Play &amp; win free donuts</div>
          <div className="muted" style={{ fontSize: '.88rem' }}>Beat your best score to earn a stamp toward your next free bag.</div>
        </div>
        <span className="link" style={{ fontSize: '.85rem' }}>Rewards ›</span>
      </Link>

      {GAMES.map((g) => (
        <div key={g.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: g.live ? 1 : 0.72 }}>
          <img src={g.art} alt="" style={{ width: 56, height: 56, objectFit: 'contain', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: '1.05rem' }}>{g.title}</span>
              {!g.live && <span className="pill pill-closed" style={{ fontSize: '.65rem' }}>Soon</span>}
            </div>
            <div className="muted" style={{ fontSize: '.85rem', marginTop: 2 }}>{g.blurb}</div>
          </div>
          {g.live ? (
            <button className="btn btn-primary" style={{ width: 'auto', padding: '10px 18px', flexShrink: 0 }} onClick={() => setPlaying({ title: g.title, url: g.url })}>Play</button>
          ) : (
            <button className="btn" style={{ width: 'auto', padding: '10px 16px', flexShrink: 0, opacity: 0.5, cursor: 'default' }} disabled>Soon</button>
          )}
        </div>
      ))}

      {/* Full-screen play overlay. */}
      {playing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#d9cdbb', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#fff', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>{playing.title}</span>
            <button className="link" style={{ fontSize: '1rem', fontWeight: 700 }} onClick={() => setPlaying(null)}>✕ Close</button>
          </div>
          <iframe title={playing.title} src={playing.url} style={{ flex: 1, width: '100%', border: 0 }} />
        </div>
      )}
    </div>
  )
}
