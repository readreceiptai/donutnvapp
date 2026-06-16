/* Dedicated push service worker for DonutNV proximity alerts.
   Registered separately from the PWA's offline worker so push works without
   reconfiguring the build. Shows the "a truck is near you" notification. */

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_) {}
  const title = data.title || 'DonutNV is near you! 🍩'
  const options = {
    body: data.body || 'A truck just went live nearby. Tap to see where.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(clients.openWindow(url))
})
