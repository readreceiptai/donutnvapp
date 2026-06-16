import { supabase } from './supabase'

// Subscribe this device to proximity push alerts and store the subscription so
// the server can reach it. Needs a VAPID public key (see .env / README).
// Returns { ok, reason }.
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY

export async function enablePushAlerts(profile) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'This device/browser does not support alerts.' }
  }
  if (!VAPID_PUBLIC || VAPID_PUBLIC.startsWith('your-')) {
    return { ok: false, reason: 'Alerts not configured yet (add VAPID key).' }
  }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, reason: 'You didn\'t allow notifications.' }

  const reg = await navigator.serviceWorker.register('/push-sw.js')
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
  })
  const json = sub.toJSON()
  await supabase.from('push_subscriptions').upsert({
    profile_id: profile.id, tenant_id: profile.tenant_id,
    endpoint: json.endpoint, keys: json.keys,
  }, { onConflict: 'profile_id,endpoint' })
  return { ok: true }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}
