import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Floating "Feedback / Help" widget shown inside the signed-in apps.
// role: 'franchisee' (ELLE owner) | 'customer' (The Window). It captures pilot
// feedback into public.feedback and offers a short role-aware FAQ + a support email.
const SUPPORT_EMAIL = 'kevin@donutnv.com' // pilot support inbox — adjustable

const APP_VERSION = '2026.08.12'

const FAQ = {
  franchisee: [
    ['How does ELLE find my leads?', 'ELLE scans your owned ZIPs for events, businesses, and non-profits, scores them A–F, and finds real contacts. Fresh leads arrive in waves — work the New column first.'],
    ['A lead’s info looks wrong.', 'Tap the ⚑ flag on the card to mark bad info. That pulls it back and tells ELLE to stop surfacing it — you don’t get charged for junk.'],
    ['I already booked this event myself.', 'Mark it so ELLE doesn’t take credit for what you closed on your own. Honest attribution keeps the pilot numbers real.'],
    ['Where do my Book-A-Truck requests go?', 'Straight into your LeadConnector, same as today — nothing changes in how you follow up.'],
  ],
  customer: [
    ['How do I find the truck?', 'Open the Find tab for a live map. If a truck is close, you’ll get a heads-up so you can catch it before it rolls away.'],
    ['How do rewards work?', 'Every visit earns a stamp. Fill your card and you unlock a free bag — check the Rewards tab to see how close you are.'],
    ['Can I book a truck for my event?', 'Yes — the Book tab. Pick your event type and we’ll be in touch to make it sweet.'],
  ],
}

export default function FeedbackButton({ role = 'customer' }) {
  const { session, tenant } = useAuth()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('send')
  const [category, setCategory] = useState(role === 'franchisee' ? 'bug' : 'idea')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | done | error

  if (!session) return null // only for signed-in testers

  async function send() {
    if (!message.trim()) return
    setStatus('sending')
    const { error } = await supabase.from('feedback').insert({
      user_id: session.user.id,
      tenant_id: tenant?.id ?? null,
      role,
      category,
      message: message.trim(),
      context: {
        page: typeof location !== 'undefined' ? location.pathname : null,
        url: typeof location !== 'undefined' ? location.href : null,
        app_version: APP_VERSION,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
    })
    if (error) { setStatus('error'); return }
    setMessage('')
    setStatus('done')
  }

  const cats = role === 'franchisee'
    ? [['bug', 'Something broke'], ['bad_lead', 'Bad lead / data'], ['idea', 'Idea / request'], ['question', 'Question'], ['praise', 'What I love']]
    : [['bug', 'Something broke'], ['idea', 'Idea / request'], ['question', 'Question'], ['praise', 'What I love']]

  return (
    <>
      <button
        onClick={() => { setOpen(true); setStatus('idle') }}
        aria-label="Feedback and help"
        style={{
          position: 'fixed', right: 14, bottom: 78, zIndex: 60,
          display: 'flex', alignItems: 'center', gap: 7,
          background: 'var(--red)', color: '#fff', border: 0, borderRadius: 999,
          padding: '10px 15px', fontWeight: 800, fontFamily: 'var(--font-head, inherit)',
          fontSize: '.82rem', boxShadow: '0 6px 18px rgba(0,0,0,.22)', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '1rem' }}>&#128172;</span> Feedback
      </button>

      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(15,10,8,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div style={{ width: '100%', maxWidth: 460, background: 'var(--cream, #FFF7F0)', color: 'var(--ink,#231F20)', borderRadius: '18px 18px 0 0', padding: '16px 18px 22px', boxShadow: '0 -8px 30px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <Pill on={tab === 'send'} onClick={() => setTab('send')}>Send feedback</Pill>
                <Pill on={tab === 'help'} onClick={() => setTab('help')}>Help</Pill>
              </div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 0, fontSize: '1.4rem', lineHeight: 1, cursor: 'pointer', color: 'var(--muted,#8a827c)' }}>&times;</button>
            </div>

            {tab === 'send' && (
              status === 'done' ? (
                <div style={{ padding: '18px 4px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem' }}>&#127849;</div>
                  <p style={{ fontWeight: 700, margin: '6px 0 2px' }}>Got it — thank you!</p>
                  <p style={{ fontSize: '.85rem', color: 'var(--muted,#8a827c)' }}>This goes straight to the team. Keep it coming.</p>
                  <button onClick={() => setStatus('idle')} style={btnGhost}>Send another</button>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {cats.map(([v, label]) => (
                      <button key={v} onClick={() => setCategory(v)} style={category === v ? chipOn : chip}>{label}</button>
                    ))}
                  </div>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={role === 'franchisee' ? 'What happened, or what would make ELLE better?' : 'Tell us what you think…'}
                    rows={4}
                    style={{ width: '100%', border: '1px solid #e2d7cc', borderRadius: 12, padding: 12, fontSize: '.95rem', fontFamily: 'inherit', resize: 'vertical', background: '#fff' }}
                  />
                  {status === 'error' && <p style={{ color: 'var(--red,#DD1B22)', fontSize: '.8rem', margin: '6px 0 0' }}>Couldn’t send — check your connection and try again.</p>}
                  <button onClick={send} disabled={status === 'sending' || !message.trim()} style={{ ...btnPrimary, opacity: status === 'sending' || !message.trim() ? .6 : 1 }}>
                    {status === 'sending' ? 'Sending…' : 'Send'}
                  </button>
                </div>
              )
            )}

            {tab === 'help' && (
              <div>
                {(FAQ[role] || []).map(([q, a], i) => (
                  <details key={i} style={{ borderTop: i ? '1px solid #eadfd4' : 'none', padding: '9px 0' }}>
                    <summary style={{ fontWeight: 700, fontSize: '.9rem', cursor: 'pointer' }}>{q}</summary>
                    <p style={{ fontSize: '.86rem', color: '#5a5450', margin: '6px 0 0', lineHeight: 1.4 }}>{a}</p>
                  </details>
                ))}
                <div style={{ borderTop: '1px solid #eadfd4', marginTop: 8, paddingTop: 12 }}>
                  <p style={{ fontSize: '.86rem', margin: '0 0 8px', color: '#5a5450' }}>Still stuck? We’re quick to answer during the pilot.</p>
                  <a href={`mailto:${SUPPORT_EMAIL}?subject=DonutNV%20support`} style={{ ...btnPrimary, display: 'inline-block', textDecoration: 'none', textAlign: 'center' }}>Email support</a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const chip = { border: '1px solid #e2d7cc', background: '#fff', color: '#5a5450', borderRadius: 999, padding: '5px 11px', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }
const chipOn = { ...chip, background: 'var(--ink,#231F20)', color: '#fff', borderColor: 'var(--ink,#231F20)' }
const btnPrimary = { marginTop: 12, width: '100%', background: 'var(--red,#DD1B22)', color: '#fff', border: 0, borderRadius: 12, padding: '12px 16px', fontWeight: 800, fontSize: '.95rem', cursor: 'pointer' }
const btnGhost = { marginTop: 14, background: 'none', border: '1px solid #e2d7cc', color: '#5a5450', borderRadius: 10, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }

function Pill({ on, onClick, children }) {
  return (
    <button onClick={onClick} style={{ background: on ? 'var(--ink,#231F20)' : 'transparent', color: on ? '#fff' : 'var(--muted,#8a827c)', border: on ? '1px solid var(--ink,#231F20)' : '1px solid #e2d7cc', borderRadius: 999, padding: '6px 13px', fontSize: '.82rem', fontWeight: 700, cursor: 'pointer' }}>
      {children}
    </button>
  )
}
