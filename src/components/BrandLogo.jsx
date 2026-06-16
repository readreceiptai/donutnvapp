import { useState } from 'react'

// Your real DonutNV wordmark. Two versions:
//   default → logo-black.webp (dark wordmark, for light/cream backgrounds)
//   light   → logo-white.webp (white-outline wordmark, for blue/dark backgrounds)
// Falls back to text only if the files are ever missing.
export default function BrandLogo({ height = 30, light = false }) {
  const [failed, setFailed] = useState(false)
  const src = light ? '/brand/logo-white.webp' : '/brand/logo-black.webp'
  if (failed) {
    return (
      <span className="wordmark" style={{ fontSize: height * 0.72 }}>
        Donut<span style={{ color: light ? '#fff' : 'var(--blue)' }}>NV</span>
      </span>
    )
  }
  return <img src={src} alt="DonutNV" style={{ height, display: 'block' }} onError={() => setFailed(true)} />
}
