import { useEffect, useRef, useState } from 'react'
import DonutPhoto from './DonutPhoto'

// The blue curtains hold, then gather open like real drapes to reveal the
// signup/landing — with a little firework show. Plays once per visit.
export default function CurtainIntro() {
  const [phase, setPhase] = useState('closed') // 'closed' → 'open' → 'gone'
  const fwRef = useRef(null)
  const rafRef = useRef(0)

  useEffect(() => {
    if (sessionStorage.getItem('dnv_intro_played')) { setPhase('gone'); return }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { sessionStorage.setItem('dnv_intro_played', '1'); setPhase('gone'); return }
    const open = setTimeout(() => { setPhase('open'); startFireworks() }, 1500) // hold closed longer
    const done = setTimeout(() => {
      sessionStorage.setItem('dnv_intro_played', '1'); setPhase('gone')
    }, 3900) // 1500 hold + ~2s fold + buffer
    return () => { clearTimeout(open); clearTimeout(done); cancelAnimationFrame(rafRef.current) }
  }, [])

  function startFireworks() {
    const canvas = fwRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = canvas.clientWidth, H = canvas.clientHeight
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr)
    const colors = ['#DD1B22', '#0A7BC1', '#FFF7F0', '#FFC83D', '#1772AC']
    const parts = []
    const burst = (x, y) => {
      const n = 26 + Math.floor(Math.random() * 16)
      const col = colors[Math.floor(Math.random() * colors.length)]
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.3
        const sp = 1.6 + Math.random() * 3
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, col })
      }
    }
    let last = 0, count = 0, prev = performance.now()
    const frame = (t) => {
      const dt = Math.min(34, t - prev) / 16; prev = t
      ctx.clearRect(0, 0, W, H)
      if (t - last > 240 && count < 8) { burst(W * (0.2 + Math.random() * 0.6), H * (0.12 + Math.random() * 0.32)); last = t; count++ }
      for (const p of parts) {
        if (p.life <= 0) continue
        p.vy += 0.05 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= 0.012 * dt
        ctx.globalAlpha = Math.max(0, p.life)
        ctx.fillStyle = p.col
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, 7); ctx.fill()
      }
      ctx.globalAlpha = 1
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
  }

  if (phase === 'gone') return null

  return (
    <div className={`curtain-stage ${phase === 'open' ? 'open' : ''}`} role="presentation">
      <div className="curtain-panel left" />
      <div className="curtain-panel right" />
      <canvas ref={fwRef} className="fw" />
      <div className="curtain-center">
        <DonutPhoto size={88} />
        <img src="/brand/logo-white.webp" alt="DonutNV" style={{ height: 50 }}
             onError={(e) => { e.currentTarget.style.display = 'none' }} />
        <span className="sub">rolling up…</span>
      </div>
      <img className="awning-img" src="/brand/awning.png" alt=""
           onError={(e) => { e.currentTarget.style.display = 'none' }} />
    </div>
  )
}
