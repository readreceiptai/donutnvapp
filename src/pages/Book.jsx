import { useState } from 'react'
import { Link } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import BookTruck from './BookTruck'
import Fundraise from './Fundraise'

// Book-A-Truck entry. One entry point, a split path: corporate and private events both go to the
// standard booking form; schools & non-profits go to the mission-forward fundraiser path.
export default function Book() {
  const [mode, setMode] = useState(null) // null | 'event' | 'fundraiser'

  if (mode === 'event') return <BookTruck onBack={() => setMode(null)} />
  if (mode === 'fundraiser') return <Fundraise onBack={() => setMode(null)} />

  return (
    <div className="screen pad-top">
      <div className="topbar"><BrandLogo height={30} /><Link to="/" className="link" style={{ fontSize: '.85rem' }}>Close</Link></div>
      <h1>Book-A-Truck 🚚</h1>
      <p className="muted" style={{ marginTop: -6, lineHeight: 1.4 }}>
        Want fresh, hot mini-donuts at your next event? Tell us what you're celebrating and we'll roll the truck out to you. Pick your event type to get started.
      </p>

      <div className="stack" style={{ marginTop: 12 }}>
        <button className="book-choice" onClick={() => setMode('event')}>
          <span className="bc-emoji">🎉</span>
          <span className="bc-text"><b>Corporate event</b><small>Employee appreciation, company parties, grand openings</small></span>
          <span className="bc-arrow">›</span>
        </button>
        <button className="book-choice" onClick={() => setMode('event')}>
          <span className="bc-emoji">🥳</span>
          <span className="bc-text"><b>Private party</b><small>Birthdays, weddings, graduations, celebrations</small></span>
          <span className="bc-arrow">›</span>
        </button>
        <button className="book-choice give" onClick={() => setMode('fundraiser')}>
          <span className="bc-emoji">💛</span>
          <span className="bc-text"><b>Fundraiser or Give-Back</b><small>Schools, teams, churches &amp; non-profits — raise money with donuts</small></span>
          <span className="bc-arrow">›</span>
        </button>
      </div>

      <p className="muted" style={{ fontSize: '.8rem', marginTop: 16, textAlign: 'center' }}>
        Since 2018, DonutNV owners have raised hundreds of thousands of dollars for local schools, teams, and causes. <img src="/brand/minidonut.png" alt="" style={{ height: '1em', verticalAlign: '-0.15em' }} />
      </p>

      <style>{`
        .book-choice{display:flex;align-items:center;gap:14px;width:100%;text-align:left;
          background:#fff;border:2px solid var(--line);border-radius:16px;padding:16px 16px;cursor:pointer;
          font-family:inherit;transition:border-color .12s,transform .05s}
        .book-choice:hover{border-color:var(--brand,#e91e63)}
        .book-choice:active{transform:translateY(1px)}
        .book-choice.give{background:linear-gradient(135deg,rgba(233,17,106,.05),rgba(233,166,59,.08));border-color:rgba(233,166,59,.5)}
        .bc-emoji{font-size:1.8rem;line-height:1}
        .bc-text{flex:1;display:flex;flex-direction:column;gap:2px}
        .bc-text b{font-size:1.05rem;color:var(--ink,#2b2118)}
        .bc-text small{color:var(--muted,#8a7c6b);font-size:.82rem;line-height:1.3}
        .bc-arrow{color:var(--muted,#c9b9a6);font-size:1.5rem;font-weight:700}
      `}</style>
    </div>
  )
}
