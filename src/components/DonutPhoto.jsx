import { useState } from 'react'
import MiniDonut from './MiniDonut'

// A real DonutNV donut photo. Drop a square donut image at /public/brand/donut.png
// (or .jpg — tell me and I'll switch the path) and it appears automatically.
// Until then it falls back to the 🍩 so nothing looks broken.
export default function DonutPhoto({ size = 120 }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <MiniDonut size={size * 0.92} />
  // The whole bucket, on transparent — no circle crop. `size` is the width;
  // height scales to keep the full bucket visible.
  return (
    <img src="/brand/donut.png" alt="DonutNV donuts" onError={() => setFailed(true)}
      style={{ width: size, height: 'auto', display: 'block', filter: 'drop-shadow(0 7px 12px rgba(0,0,0,.20))' }} />
  )
}
