// Demo-mode build. A curated, territory-locked variant of the real app for showing to partners
// without exposing the production domain or the other territories. Turned on by building with
// VITE_DEMO=1 and deploying to a separate Netlify site on a neutral URL. Off (false) in the real
// production build, so none of this affects the live app.
// On when built with VITE_DEMO=1, OR whenever the app is served from the
// mv-preview demo site — so the demo always presents Ocala regardless of the
// build flag. Production (donutnvapp.com) never matches, so it's unaffected.
const demoHost = typeof window !== 'undefined' && /mv-preview/i.test(window.location.hostname)
export const DEMO = import.meta.env.VITE_DEMO === '1' || demoHost
