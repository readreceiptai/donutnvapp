import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// ── Reviews hub ──
// Turn happy customers into public proof. Pull in reviews left after events,
// one-tap "Feature" to publish them to the website, and paste in standout
// Google/Facebook testimonials by hand. Featured reviews show on the landing.
export default function Reviews() {
  const { profile } = useAuth()
  const [reviews, setReviews] = useState([])
  const [incoming, setIncoming] = useState([])
  const [f, setF] = useState({ author_name: '', rating: 5, body: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!profile?.tenant_id) return
    const { data: revs } = await supabase.from('reviews').select('*')
      .eq('tenant_id', profile.tenant_id).order('created_at', { ascending: false })
    setReviews(revs || [])
    const importedBookingIds = new Set((revs || []).map((r) => r.booking_id).filter(Boolean))
    const { data: bks } = await supabase.from('bookings')
      .select('id,contact_name,review_rating,review_comment,reviewed_at')
      .eq('tenant_id', profile.tenant_id).not('review_rating', 'is', null)
      .order('reviewed_at', { ascending: false }).limit(50)
    setIncoming((bks || []).filter((b) => !importedBookingIds.has(b.id)))
  }, [profile])

  useEffect(() => { load() }, [load])

  async function feature(b) {
    await supabase.from('reviews').insert({
      tenant_id: profile.tenant_id, source: 'event', booking_id: b.id,
      author_name: b.contact_name, rating: b.review_rating, body: b.review_comment || '', is_featured: true,
    })
    load()
  }

  async function addManual(e) {
    e.preventDefault(); setMsg('')
    if (!f.body.trim()) { setMsg('Add the review text.'); return }
    setBusy(true)
    const { error } = await supabase.from('reviews').insert({
      tenant_id: profile.tenant_id, source: 'manual',
      author_name: f.author_name.trim() || 'Happy customer', rating: f.rating, body: f.body.trim(), is_featured: true,
    })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    setF({ author_name: '', rating: 5, body: '' }); load()
  }

  async function toggle(r) {
    await supabase.from('reviews').update({ is_featured: !r.is_featured }).eq('id', r.id); load()
  }
  async function remove(id) {
    await supabase.from('reviews').delete().eq('id', id); load()
  }

  const featuredCount = reviews.filter((r) => r.is_featured).length

  return (
    <div className="pad-top stack">
      <h1 style={{ marginBottom: 0 }}>Reviews ⭐</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {featuredCount} featured on your site. Feature your best reviews — they show on the landing page.
      </p>

      {/* Incoming from events */}
      {incoming.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>From your events</h2>
          {incoming.map((b) => (
            <div key={b.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <Stars n={b.review_rating} />
              {b.review_comment && <p style={{ margin: '4px 0' }}>“{b.review_comment}”</p>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: '.85rem' }}>{b.contact_name}</span>
                <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => feature(b)}>Feature ›</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add a testimonial by hand */}
      <form className="card stack" onSubmit={addManual}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Add a review</h2>
        <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>Paste a great one from Google or Facebook.</p>
        <div className="field" style={{ margin: 0 }}>
          <label>Name</label>
          <input className="fld" placeholder="Sarah M." value={f.author_name} onChange={(e) => setF({ ...f, author_name: e.target.value })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Rating</label>
          <StarPicker value={f.rating} onChange={(n) => setF({ ...f, rating: n })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Review</label>
          <textarea rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })}
            style={{ width: '100%', fontSize: '1.05rem', padding: '12px 14px', border: '2px solid var(--line)', borderRadius: 12, fontFamily: 'var(--font-body)' }} />
        </div>
        {msg && <div className="error">{msg}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add & feature'}</button>
      </form>

      {/* Everything in the hub */}
      <h2 style={{ fontSize: '1.05rem', marginBottom: 0 }}>Your reviews</h2>
      {reviews.length === 0 && <p className="muted">No reviews yet. Feature an event review or add one above.</p>}
      {reviews.map((r) => (
        <div key={r.id} className={`card ${r.is_featured ? 'card-accent' : ''}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Stars n={r.rating} />
            <span className="muted" style={{ fontSize: '.75rem', textTransform: 'uppercase' }}>{r.source}</span>
          </div>
          {r.body && <p style={{ margin: '4px 0' }}>“{r.body}”</p>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <span className="muted" style={{ fontSize: '.85rem' }}>{r.author_name}</span>
            <span style={{ display: 'flex', gap: 14 }}>
              <button className="link" onClick={() => toggle(r)}>{r.is_featured ? 'Unfeature' : 'Feature'}</button>
              <button className="link" style={{ color: 'var(--red)' }} onClick={() => remove(r.id)}>Remove</button>
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function Stars({ n = 0 }) {
  return <span style={{ color: '#FFC83D', fontSize: '1rem', letterSpacing: 1 }}>{'★'.repeat(n)}<span style={{ color: 'var(--line)' }}>{'★'.repeat(5 - n)}</span></span>
}
function StarPicker({ value, onChange }) {
  return (
    <span style={{ display: 'flex', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.6rem', padding: 0, color: n <= value ? '#FFC83D' : 'var(--line)' }}>★</button>
      ))}
    </span>
  )
}
