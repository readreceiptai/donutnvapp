import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { resumeProximityAlerts } from '../lib/location'
import { attachPushHandlers, touchNativePushToken, isNativeApp } from '../lib/nativePush'

// ── Native-shell boot hook (Option B) ───────────────────────────────────────
//
// Renders nothing. ONLY does work inside the Capacitor shell (a no-op on the
// web build, so it is safe to mount unconditionally in main.jsx).
//
// Two separate effects on purpose (found during the iOS Simulator test):
//
//   A. Push handlers attach ONCE per app launch, independent of auth. Keying
//      this on the profile stacked duplicate listeners on every profile change
//      and, worse, ran the whole effect while profile was still null and then
//      got cancelled by React cleanup before the profile ever arrived.
//
//   B. Tracking resume runs when a signed-in profile becomes available. If the
//      customer already opted in, restart the background watcher. Without this,
//      an opted-in customer who relaunches the app is silently never tracked
//      again while the DB still reports "enabled".
export default function NativeBoot() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const handlersAttached = useRef(false)
  const resumedFor = useRef(null)

  // A. once per launch
  useEffect(() => {
    if (handlersAttached.current) return
    handlersAttached.current = true
    ;(async () => {
      if (!(await isNativeApp())) return
      await attachPushHandlers(navigate)
    })()
  }, [])

  // B. per signed-in profile
  useEffect(() => {
    const pid = profile?.id
    if (!pid || resumedFor.current === pid) return
    resumedFor.current = pid
    ;(async () => {
      if (!(await isNativeApp())) return
      try { await touchNativePushToken(profile) } catch (e) { console.warn('[push] token touch failed', String(e)) }
      const resumed = await resumeProximityAlerts(profile)
      console.log(resumed
        ? '[location] resumed background tracking for opted-in customer'
        : '[location] customer not opted in; tracking stays off')
    })()
  }, [profile?.id])

  return null
}
