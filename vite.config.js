import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Installable PWA: add-to-home-screen + service worker for web push later.
export default defineConfig({
  // Two HTML entries: the main app (index.html) and the standalone public
  // onboarding form (onboard.html). Keeping /onboard as its own entry means the
  // Netlify edge gate can expose only the form without making the private-beta
  // app runnable (index.html stays gated).
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        onboard: 'onboard.html',
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // TEMPORARY (private beta): self-destroying service worker. This unregisters
      // any existing service worker and clears its caches on next visit, so the
      // offline cache can no longer bypass the site-wide password gate. Flip this
      // back to a normal PWA config when the site goes public.
      selfDestroying: true,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'DonutNV',
        short_name: 'DonutNV',
        description: 'Find the truck. Get alerts. Earn free donuts.',
        theme_color: '#DD1B22',
        background_color: '#FFF7F0',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
})
