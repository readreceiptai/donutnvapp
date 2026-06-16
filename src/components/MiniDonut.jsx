// The real DonutNV mini donut photo (white background knocked out, transparent
// PNG, square). Scales to any `size`. Used wherever we need a donut icon —
// empty states, the Rewards tab, loyalty stamps, landing features.
export default function MiniDonut({ size = 28, title = 'mini donut' }) {
  return (
    <img src="/brand/minidonut.png" alt={title} width={size} height={size}
      style={{ display: 'block', objectFit: 'contain' }} />
  )
}
