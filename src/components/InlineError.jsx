// Drop-in failed-submit component (from status-pages/inline-error.html). Show it
// inline when a single critical write fails but the app is otherwise up: it keeps
// the user's entry and invites a retry instead of dropping the submission.
// Wire `onRetry` to re-run the failed action; the caller preserves the form data.
export default function InlineError({ onRetry, busy = false }) {
  return (
    <div style={S.wrap} role="alert">
      <div style={S.icon} aria-hidden="true">
        <img src="/mini_donut.png" alt="" style={{ width: 46, height: 'auto', display: 'block' }} />
      </div>
      <div>
        <h3 style={S.h3}>That one didn't go through</h3>
        <p style={S.p}>Our donut machine hiccuped, but your info's still here and nothing was lost. Give it another try in a sec.</p>
        {onRetry && (
          <button type="button" style={S.btn} onClick={onRetry} disabled={busy}>
            {busy ? 'Trying…' : 'Try again'}
          </button>
        )}
      </div>
    </div>
  )
}

const S = {
  wrap: { background: '#fff', border: '1px solid #f3d9c9', borderLeft: '5px solid #DD1B22', borderRadius: 12, padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'flex-start', fontFamily: '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif' },
  icon: { flex: '0 0 auto', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  h3: { margin: '0 0 4px', fontSize: 15, color: '#231F20' },
  p: { margin: '0 0 10px', fontSize: 14, lineHeight: 1.5, color: '#5b5654' },
  btn: { background: '#DD1B22', color: '#fff', border: 0, borderRadius: 9, fontWeight: 700, fontSize: 14, padding: '9px 18px', cursor: 'pointer', opacity: 1 },
}
