import { useMemo, useRef, useState } from 'react'
import { supabase, isConfigured } from '../lib/supabase'
import TurnstileWidget, { TURNSTILE_ENABLED, passesTurnstile } from '../components/Turnstile'
import BrandLogo from '../components/BrandLogo'
import InlineError from '../components/InlineError'

// ── Owner onboarding intake ──────────────────────────────────────────────
// Public, no login. A branded one-question-per-screen wizard that writes a
// single row to public.onboarding_intake (anon insert allowed by RLS). No
// third-party form tool — just our design tokens + the app's supabase client.
//
// Column names below map 1:1 to onboarding_intake columns. Conditional steps
// (LeadConnector uses, other booking service) are included/skipped by `when`,
// and the progress total updates as those conditions resolve.

const CALENDLY_URL = 'https://calendly.com/kevin-donutnv/30min'

const STEPS = [
  { key: 'territory_name', type: 'text', required: true,
    title: 'What should we call your territory?', placeholder: 'DonutNV Ocala' },
  { key: 'owner_name', type: 'text', required: true,
    title: 'Owner name(s)', placeholder: 'First and last name' },
  { key: 'business_name', type: 'text', required: true,
    title: 'Business name', help: 'Legal or DBA name.', placeholder: 'DonutNV Ocala LLC' },
  { key: 'mobile', type: 'tel', required: true,
    title: 'Best mobile number', placeholder: '(555) 123-4567' },
  { key: 'email', type: 'email', required: true,
    title: 'Best email', placeholder: 'you@email.com' },
  { key: 'operator_type', type: 'mc', required: true,
    title: 'Which best describes you?',
    options: ['Full-time owner-operator', 'Weekend or weeknight', 'Multi-unit operator'] },
  // Two independent options: The Window is the base (always included, pre-checked
  // and locked); E.L.L.E. is an optional add-on. Both -> plan 'window_elle';
  // Window only -> 'window'. Rendered by the custom 'plan' block below.
  { key: 'plan', type: 'plan', required: true,
    title: 'Which do you want?' },
  { key: 'outcomes', type: 'multi', required: true,
    title: 'What are you most looking forward to?', help: 'Check all that apply.',
    options: [
      'Knowing who my customers are for marketing',
      'Generating event leads',
      'Automating outreach and follow-up',
      'Loyalty and repeat customers',
      'Customers tracking my truck live',
      'Booking more private events and fundraisers',
      'Simplifying my day to day',
    ] },
  { key: 'unit_count', type: 'mc', required: true,
    title: 'How many trucks or trailers?', options: ['1', '2', '3', '4+'] },
  { key: 'gps_method', type: 'mc', required: true,
    title: 'For live tracking, what will you use?',
    help: 'We recommend a GPS puck for every truck, with your phone as a backup.',
    options: [
      { label: 'A plug-in GPS puck (recommended)', value: 'GPS puck',
        note: 'Most reliable. Every truck should have one; your phone stays free to use.' },
      { label: 'My phone (free)', value: 'My phone (free)',
        note: "Your phone must be dedicated to GPS and stay on during service — you won't be able to use it for anything else." },
    ] },
  { key: 'phones', type: 'mc', required: true,
    title: 'What phones will you run the app on?', options: ['iPhone', 'Android', 'Both'] },
  { key: 'owned_zips', type: 'textarea', required: true,
    title: 'Paste the ZIP codes you own', help: 'Separate them with commas or new lines.',
    placeholder: '34470, 34471, 34472' },
  { key: 'home_base', type: 'text', required: true,
    title: 'Home base address or ZIP', help: 'Where you stage the truck.',
    placeholder: 'Street address or ZIP' },
  { key: 'travel_radius', type: 'mc', required: true,
    title: 'How far do you travel for events?', options: ['~10 mi', '~20 mi', '~30 mi', '40+ mi'] },
  { key: 'uses_leadconnector', type: 'mc', required: true,
    title: 'Do you use LeadConnector today?', options: ["No, I don't use it", 'Yes'] },
  { key: 'lc_uses', type: 'multi', required: true,
    title: 'What do you use LeadConnector for?', help: 'Check all that apply.',
    when: (a) => a.uses_leadconnector === 'Yes',
    options: ['Booking or CRM', 'Texting customers', 'Review requests', 'Email campaigns', 'Other'] },
  { key: 'other_booking_service', type: 'mc', required: true,
    title: 'Are you using another booking service today?',
    when: (a) => a.plan === 'window_elle', options: ['No', 'Yes'] },
  { key: 'square_email', type: 'email', required: true,
    title: 'Your Square account email',
    help: "We'll send a secure link to connect Square for loyalty and deposits.",
    placeholder: 'you@email.com' },
  { key: 'facebook_url', type: 'text', required: false,
    title: 'Facebook page URL', help: 'Optional.', placeholder: 'https://facebook.com/yourpage' },
  { key: 'instagram_url', type: 'text', required: false,
    title: 'Instagram URL', help: 'Optional.', placeholder: 'https://instagram.com/yourhandle' },
  { key: 'event_types', type: 'multi', required: true,
    title: 'Which events do you do?', help: 'Check all that apply.',
    options: ['Public events', 'Private parties', 'Fundraisers and giveback'] },
  { key: 'notes', type: 'textarea', required: false,
    title: 'Anything you want us to know before your call?', help: 'Optional.',
    placeholder: 'Anything at all…' },
]

const optValue = (o) => (typeof o === 'string' ? o : o.value)
const optLabel = (o) => (typeof o === 'string' ? o : o.label)
const optNote = (o) => (typeof o === 'string' ? '' : (o.note || ''))
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim())

function initialAnswers() {
  const a = {}
  for (const s of STEPS) a[s.key] = s.type === 'multi' ? [] : ''
  a.plan = 'window' // The Window is the base plan, always included
  return a
}

export default function Onboard() {
  const [stage, setStage] = useState('landing') // 'landing' | 'questions' | 'success'
  const [answers, setAnswers] = useState(initialAnswers)
  const [idx, setIdx] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [tsToken, setTsToken] = useState('') // Cloudflare Turnstile token (public form spam guard)
  const [submitFailed, setSubmitFailed] = useState(false) // show the inline retry card on a failed write
  const submitting = useRef(false)

  // Steps visible for the current answers (conditionals resolved). The progress
  // total tracks this, so it grows/shrinks as plan / LeadConnector are answered.
  const steps = useMemo(() => STEPS.filter((s) => !s.when || s.when(answers)), [answers])
  const total = steps.length
  const clampedIdx = Math.min(idx, total - 1)
  const step = steps[clampedIdx]

  const setValue = (key, value) => { setAnswers((p) => ({ ...p, [key]: value })); setErr('') }

  const toggleMulti = (key, value) => {
    setErr('')
    setAnswers((p) => {
      const cur = p[key] || []
      return { ...p, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }
    })
  }

  function validate(s) {
    if (!s.required) return true
    const v = answers[s.key]
    if (s.type === 'multi') return Array.isArray(v) && v.length > 0
    if ((s.type === 'email') && !emailOk(v)) return false
    return String(v || '').trim().length > 0
  }

  function next() {
    if (!validate(step)) {
      setErr(step.type === 'multi' ? 'Please pick at least one.'
        : step.type === 'email' ? 'Please enter a valid email.'
        : 'This one is required.')
      return
    }
    setErr('')
    if (clampedIdx < total - 1) { setIdx(clampedIdx + 1); return }
    // Last step: this is a public form, so require the human check before submit.
    if (TURNSTILE_ENABLED && !tsToken) { setErr('Please complete the quick "I\'m human" check below.'); return }
    submit()
  }

  function back() {
    setErr('')
    if (clampedIdx > 0) setIdx(clampedIdx - 1)
    else setStage('landing')
  }

  async function submit() {
    if (submitting.current) return
    if (!isConfigured) { setErr('Not connected yet — please try again in a moment.'); return }
    submitting.current = true
    setBusy(true)
    setErr(''); setSubmitFailed(false)
    // Server-side verify the Turnstile token (no-op until Turnstile is configured).
    if (!(await passesTurnstile(tsToken))) {
      setBusy(false); submitting.current = false
      setErr('Verification failed — please try the human check again.')
      return
    }
    // Build the row: visible answers only; hidden conditionals and empty
    // optionals go in as null. Arrays map straight to the text[] columns.
    const row = {}
    for (const s of STEPS) {
      const visible = !s.when || s.when(answers)
      const v = answers[s.key]
      if (!visible) { row[s.key] = null; continue }
      if (s.type === 'multi') row[s.key] = (v && v.length) ? v : null
      else row[s.key] = (v && String(v).trim()) ? String(v).trim() : null
    }
    const { error } = await supabase.from('onboarding_intake').insert(row)
    setBusy(false)
    submitting.current = false
    // Failed write: keep every answer in state and show the inline retry card.
    if (error) { setSubmitFailed(true); return }
    setStage('success')
  }

  // ── Landing ──
  if (stage === 'landing') {
    return (
      <Frame>
        <div className="card card-accent stack" style={{ marginTop: 24 }}>
          <div style={S.mark} aria-hidden="true"><span style={S.markHole} /></div>
          <h1 style={{ marginBottom: 4 }}>Welcome to the DonutNV App!</h1>
          <p className="muted" style={{ margin: 0 }}>
            A few quick questions, about 5 minutes, so we can build your platform. Here's the path:
          </p>
          <ol style={S.path}>
            <li>This form</li>
            <li>We set up your account</li>
            <li>A 20-minute call to connect Square and flip you live</li>
          </ol>
          <p className="muted" style={{ margin: 0, fontSize: '.9rem' }}>
            Most owners are fully live within 2 to 3 business days of their call.
          </p>
          <button className="btn btn-primary" onClick={() => { setIdx(0); setStage('questions') }}>Start</button>
        </div>
      </Frame>
    )
  }

  // ── Success ──
  if (stage === 'success') {
    return (
      <Frame>
        <div className="card card-accent stack center" style={{ marginTop: 40 }}>
          <div style={{ fontSize: 60, lineHeight: 1 }}>🎉</div>
          <h1 style={{ margin: 0 }}>You're all set.</h1>
          <p className="muted" style={{ margin: 0 }}>Book your onboarding call:</p>
          <a className="btn btn-primary" href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
            Book my onboarding call
          </a>
          <p className="muted" style={{ margin: 0, fontSize: '.8rem' }}>
            DonutNV • Make Your Next Party Sweet!®
          </p>
        </div>
      </Frame>
    )
  }

  // ── Questions ──
  const pct = Math.round(((clampedIdx + 1) / total) * 100)
  return (
    <Frame>
      <div style={S.progressWrap}>
        <div style={S.progressTrack}><div style={{ ...S.progressFill, width: `${pct}%` }} /></div>
        <div style={S.progressLabel}>Step {clampedIdx + 1} of {total}</div>
      </div>

      <form key={step.key} onSubmit={(e) => { e.preventDefault(); next() }} className="stack" style={{ marginTop: 18 }}>
        <h1 style={{ marginBottom: step.help ? 2 : 10 }}>
          {step.title} {!step.required && <span className="muted" style={{ fontWeight: 400, fontSize: '.9rem' }}>(optional)</span>}
        </h1>
        {step.help && <p className="muted" style={{ margin: '0 0 8px' }}>{step.help}</p>}

        {(step.type === 'text' || step.type === 'email' || step.type === 'tel') && (
          <div className="field" style={{ margin: 0 }}>
            <input
              type={step.type === 'tel' ? 'tel' : step.type === 'email' ? 'email' : 'text'}
              inputMode={step.type === 'tel' ? 'tel' : step.type === 'email' ? 'email' : 'text'}
              autoFocus
              placeholder={step.placeholder || ''}
              value={answers[step.key]}
              onChange={(e) => setValue(step.key, e.target.value)}
            />
          </div>
        )}

        {step.type === 'textarea' && (
          <div className="field" style={{ margin: 0 }}>
            <textarea
              autoFocus rows={4}
              placeholder={step.placeholder || ''}
              value={answers[step.key]}
              onChange={(e) => setValue(step.key, e.target.value)}
              style={S.textarea}
            />
          </div>
        )}

        {step.type === 'mc' && (
          <div className="stack" style={{ marginTop: 0 }}>
            {step.options.map((o) => {
              const val = optValue(o)
              const note = optNote(o)
              const selected = answers[step.key] === val
              return (
                <button type="button" key={val} onClick={() => setValue(step.key, val)}
                  style={{ ...S.choice, ...(note ? S.choiceTop : null), ...(selected ? S.choiceOn : null) }}>
                  <span style={{ ...S.radio, ...(note ? S.indTop : null), ...(selected ? S.radioOn : null) }} aria-hidden="true" />
                  <span style={S.optCol}>
                    <span>{optLabel(o)}</span>
                    {note && <span style={S.optNote}>{note}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {step.type === 'plan' && (
          <div className="stack" style={{ marginTop: 0 }}>
            {/* Base plan — always included, locked on. */}
            <div style={{ ...S.choice, ...S.choiceTop, ...S.choiceOn, cursor: 'default' }}>
              <span style={{ ...S.check, ...S.indTop, ...S.checkOn }} aria-hidden="true">✓</span>
              <span style={S.optCol}>
                <span>The Window (customer app)</span>
                <span style={S.optNote}>Included with every unit.</span>
              </span>
            </div>
            {/* Optional add-on — E.L.L.E. */}
            {(() => {
              const on = answers.plan === 'window_elle'
              return (
                <button type="button" onClick={() => setValue('plan', on ? 'window' : 'window_elle')}
                  style={{ ...S.choice, ...S.choiceTop, ...(on ? S.choiceOn : null) }}>
                  <span style={{ ...S.check, ...S.indTop, ...(on ? S.checkOn : null) }} aria-hidden="true">{on ? '✓' : ''}</span>
                  <span style={S.optCol}>
                    <span>E.L.L.E. (Event Lead List Engine)</span>
                    <span style={S.optNote}>Optional add-on. Finds and delivers event leads.</span>
                  </span>
                </button>
              )
            })()}
          </div>
        )}

        {step.type === 'multi' && (
          <div className="stack" style={{ marginTop: 0 }}>
            {step.options.map((o) => {
              const val = optValue(o)
              const selected = (answers[step.key] || []).includes(val)
              return (
                <button type="button" key={val} onClick={() => toggleMulti(step.key, val)}
                  style={{ ...S.choice, ...(selected ? S.choiceOn : null) }}>
                  <span style={{ ...S.check, ...(selected ? S.checkOn : null) }} aria-hidden="true">{selected ? '✓' : ''}</span>
                  <span>{optLabel(o)}</span>
                </button>
              )
            })}
          </div>
        )}

        {clampedIdx === total - 1 && <TurnstileWidget onToken={setTsToken} />}
        {submitFailed && <InlineError onRetry={submit} busy={busy} />}
        {err && <div className="error">{err}</div>}

        <div style={S.nav}>
          <button type="button" className="btn btn-ghost" style={{ flex: '0 0 34%' }} onClick={back}>Back</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>
            {clampedIdx < total - 1 ? 'Next' : (busy ? 'Submitting…' : 'Submit')}
          </button>
        </div>
      </form>
    </Frame>
  )
}

// Full-screen, phone-width, cream frame. Owns its own chrome (no app shell).
// Uses the app's real BrandLogo (logo-black) so branding matches pixel-for-pixel.
function Frame({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)' }}>
      <div className="screen" style={{ paddingTop: 18, paddingBottom: 40 }}>
        <div style={S.brand}><BrandLogo height={34} /></div>
        {children}
      </div>
    </div>
  )
}

const S = {
  brand: { display: 'flex', justifyContent: 'center', padding: '4px 0 6px' },
  mark: { width: 60, height: 60, borderRadius: '50%', background: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' },
  markHole: { width: 20, height: 20, borderRadius: '50%', background: 'var(--cream)', display: 'block' },
  path: { margin: '2px 0 0', paddingLeft: 20, lineHeight: 1.7, color: 'var(--ink)' },
  progressWrap: { position: 'sticky', top: 0, background: 'var(--cream)', paddingTop: 6, paddingBottom: 8, zIndex: 5 },
  progressTrack: { height: 8, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' },
  progressFill: { height: '100%', background: 'var(--red)', borderRadius: 999, transition: 'width .25s ease' },
  progressLabel: { marginTop: 6, fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: '.82rem', color: 'var(--muted)' },
  textarea: { width: '100%', minHeight: 110, fontFamily: 'var(--font-body)', fontSize: '1.05rem', padding: '12px 14px', border: '2px solid var(--line)', borderRadius: 12, background: '#fff', color: 'var(--ink)', resize: 'vertical' },
  choice: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 'var(--tap)', textAlign: 'left', background: '#fff', border: '2px solid var(--line)', borderRadius: 14, padding: '14px 16px', font: 'inherit', fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: '1rem', color: 'var(--ink)', cursor: 'pointer' },
  choiceOn: { borderColor: 'var(--red)', background: 'rgba(221,27,34,.06)' },
  choiceTop: { alignItems: 'flex-start' },      // top-align the indicator when an option has a note
  indTop: { marginTop: 2 },
  optCol: { display: 'flex', flexDirection: 'column', gap: 3 },
  optNote: { fontFamily: 'var(--font-body)', fontWeight: 400, fontSize: '.82rem', color: 'var(--muted)', lineHeight: 1.35 },
  radio: { flex: '0 0 auto', width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--line)', boxSizing: 'border-box' },
  radioOn: { borderColor: 'var(--red)', boxShadow: 'inset 0 0 0 5px var(--red)' },
  check: { flex: '0 0 auto', width: 22, height: 22, borderRadius: 6, border: '2px solid var(--line)', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '.8rem', fontWeight: 800 },
  checkOn: { borderColor: 'var(--red)', background: 'var(--red)' },
  nav: { display: 'flex', gap: 12, marginTop: 8 },
}
