import { useEffect, useRef, useState } from 'react'
import { checkBackend } from '../lib/health'
import OutageScreen from './OutageScreen'

// Customer-facing backend-unreachable guard (#121). Pings Supabase at boot and on
// an interval; if it's unreachable it shows the branded outage screen instead of a
// hung/blank app, and auto-recovers (no manual reload) once Supabase answers again.
//
// Fail-safe: we render the app normally until a check actually CONCLUDES the
// backend is down (checkBackend already retries), so a slow/flaky check never
// falsely blacks out a working app. We poll faster while down (to recover fast)
// and slower while up. An 'online' event (device reconnects) forces a re-check.
const POLL_UP_MS = 30000
const POLL_DOWN_MS = 8000

export default function BackendHealthGate({ children }) {
  const [down, setDown] = useState(false)
  const [checking, setChecking] = useState(false)
  const inFlight = useRef(false)
  const timer = useRef(null)
  const alive = useRef(true)
  const retryRef = useRef(() => {})

  useEffect(() => {
    alive.current = true

    async function runCheck() {
      if (inFlight.current) return
      inFlight.current = true
      setChecking(true)
      const healthy = await checkBackend()
      inFlight.current = false
      if (!alive.current) return
      setChecking(false)
      setDown(!healthy)
      clearTimeout(timer.current)
      timer.current = setTimeout(runCheck, healthy ? POLL_UP_MS : POLL_DOWN_MS)
    }
    retryRef.current = runCheck

    runCheck() // boot-time check
    const onOnline = () => runCheck()
    window.addEventListener('online', onOnline)
    return () => {
      alive.current = false
      clearTimeout(timer.current)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  if (down) return <OutageScreen onRetry={() => retryRef.current()} checking={checking} />
  return children
}
