// The DonutNV awning valance, pinned to the top of every page (app + site).
export default function AwningBar() {
  return (
    <div className="app-awning" aria-hidden="true">
      <img src="/brand/awning.png" alt="" onError={(e) => { e.currentTarget.parentElement.style.display = 'none' }} />
    </div>
  )
}
