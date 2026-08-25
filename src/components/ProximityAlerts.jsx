import { useEffect, useState } from 'react'
import {
  enableProximityAlerts,
  disableProximityAlerts,
  getProximityPrefs,
  getLocationCapability,
  setProximityRadius,
} from '../lib/location'
import { registerNativePush, isNativeApp } from '../lib/nativePush'

// ── "Tell me when a truck is nearby" ───────────────────────────────────────
//
// The opt-in rate on background location is the single number this whole
// feature lives or dies by, so this component is deliberately a TWO-STEP flow:
//
//   step 1 (priming)  our own screen, explaining the trade in plain language
//   step 2 (OS prompt) only reached after the customer says yes to us
//
// Why: the OS "Allow all the time?" dialog can only be shown once. A customer
// who taps Deny there is gone for good short of a trip into Settings. Asking
// our own question first means we only spend that one shot on people who
// already said yes, and anyone who says no to us can be asked again later.
//
// Copy rules from CLAUDE.md: no donut emoji, no em dashes in customer-facing
// text.

const RADIUS_OPTIONS = [2, 5, 10]

export default function ProximityAlerts({ profile }) {
  const [prefs, setPrefs] = useState(null)
  const [cap, setCap] = useState(null)
  const [step, setStep] = useState('idle') // idle | priming | working | on | error
  const [msg, setMsg] = useState('')
  const [radius, setRadius] = useState(5)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [p, c] = await Promise.all([getProximityPrefs(profile), getLocationCapability()])
      if (!alive) return
      setPrefs(p)
      setCap(c)
      if (p?.radius_miles) setRadius(Number(p.radius_miles))
      setStep(p?.enabled ? 'on' : 'idle')
    })()
    return () => { alive = false }
  }, [profile?.id])

  async function confirmOptIn() {
    setStep('working'); setMsg('')

    const res = await enableProximityAlerts(profile, { radiusMiles: radius })
    if (!res.ok) {
      setStep('error')
      setMsg(res.reason || 'Could not turn on alerts.')
      return
    }

    // Location permission and notification permission are separate grants.
    // Getting location but not notifications means we would track someone and
    // never be able to tell them anything, so ask for both here.
    if (await isNativeApp()) {
      const push = await registerNativePush(profile)
      if (!push.ok) {
        setStep('error')
        setMsg(`${push.reason} Turn on notifications in Settings to get truck alerts.`)
        return
      }
    }

    setPrefs(await getProximityPrefs(profile))
    setStep('on')
    setMsg('')
  }

  async function turnOff() {
    setStep('working')
    const res = await disableProximityAlerts(profile)
    if (!res.ok) { setStep('error'); setMsg(res.reason); return }
    setPrefs(await getProximityPrefs(profile))
    setStep('idle')
  }

  async function changeRadius(miles) {
    setRadius(miles)
    if (prefs?.enabled) await setProximityRadius(profile, miles)
  }

  // Web users cannot get background location from any browser. Say so honestly
  // rather than showing a switch that quietly does nothing.
  if (cap && !cap.supportsBackground) {
    return (
      <div className="card" style={{ borderTop: '4px solid var(--brand, #DD1B22)' }}>
        <h2 style={{ margin: 0 }}>Know when a truck is close</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          Get the DonutNV app to be told the moment a truck rolls into your
          neighborhood. Your browser cannot do this in the background.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ borderTop: '4px solid var(--brand, #DD1B22)' }}>
      <h2 style={{ margin: 0 }}>Know when a truck is close</h2>

      {step === 'idle' && (
        <>
          <p className="muted" style={{ marginTop: 6 }}>
            We will send you one heads up when a DonutNV truck is serving near
            you. That is it.
          </p>
          <button className="btn" onClick={() => setStep('priming')}>
            Tell me when a truck is nearby
          </button>
        </>
      )}

      {step === 'priming' && (
        <>
          {/* Google Play prominent-disclosure requirement: the first sentence
              below follows Play's mandated formula ("collects location data
              to [feature], even when the app is closed or not in use") and
              must stay VERBATIM in sync with the copy filed in
              docs/STORE-SUBMISSION-LOCATION.md section 6.2. Do not reword one
              without the other. */}
          <p style={{ marginTop: 6, fontWeight: 700 }}>
            DonutNV collects location data to let you know when a truck is
            serving near you, even when the app is closed or not in use.
          </p>
          {/* The promises below are enforced in the database, not just here:
              the radius cap, quiet hours and frequency caps all live in
              match_proximity_candidates. */}
          <ul className="muted" style={{ marginTop: 6, paddingLeft: 18 }}>
            <li>We only check whether you are within {radius} miles of a truck that is open.</li>
            <li>At most a couple of alerts a day, never between 9pm and 9am.</li>
            <li>Your location is never shared with anyone and is not used for ads.</li>
            <li>Your location history is deleted every 24 hours.</li>
            <li>You can turn this off any time, right here in Account.</li>
          </ul>

          <div style={{ margin: '12px 0' }}>
            <span className="muted" style={{ marginRight: 8 }}>Tell me when a truck is within</span>
            {RADIUS_OPTIONS.map((m) => (
              <button
                key={m}
                className="btn"
                onClick={() => changeRadius(m)}
                style={{
                  marginRight: 6,
                  opacity: radius === m ? 1 : 0.55,
                  fontWeight: radius === m ? 700 : 400,
                }}
              >
                {m} mi
              </button>
            ))}
          </div>

          <p className="muted" style={{ fontSize: 13 }}>
            Next you will see your phone ask about location. Please choose
            "Allow all the time" so we can reach you when the app is closed.
          </p>

          <button className="btn" onClick={confirmOptIn}>Agree and continue</button>
          <button
            className="btn"
            onClick={() => setStep('idle')}
            style={{ marginLeft: 8, opacity: 0.6 }}
          >
            No thanks
          </button>
        </>
      )}

      {step === 'working' && <p className="muted" style={{ marginTop: 6 }}>Setting up…</p>}

      {step === 'on' && (
        <>
          <p style={{ marginTop: 6 }}>
            You are all set. We will let you know when a truck is within{' '}
            <strong>{radius} miles</strong>.
          </p>
          <div style={{ margin: '12px 0' }}>
            {RADIUS_OPTIONS.map((m) => (
              <button
                key={m}
                className="btn"
                onClick={() => changeRadius(m)}
                style={{
                  marginRight: 6,
                  opacity: radius === m ? 1 : 0.55,
                  fontWeight: radius === m ? 700 : 400,
                }}
              >
                {m} mi
              </button>
            ))}
          </div>
          <button className="btn" onClick={turnOff} style={{ opacity: 0.7 }}>
            Turn off truck alerts
          </button>
        </>
      )}

      {step === 'error' && (
        <>
          <p style={{ marginTop: 6, color: 'var(--brand, #DD1B22)' }}>{msg}</p>
          <button className="btn" onClick={() => setStep('idle')}>Back</button>
        </>
      )}
    </div>
  )
}
