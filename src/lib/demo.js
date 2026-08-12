// Demo-mode build. A curated, territory-locked variant of the real app for showing to partners
// without exposing the production domain or the other territories. Turned on by building with
// VITE_DEMO=1 and deploying to a separate Netlify site on a neutral URL. Off (false) in the real
// production build, so none of this affects the live app.
export const DEMO = import.meta.env.VITE_DEMO === '1'
