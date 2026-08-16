// ── Native push token registration (APNs + Android via FCM) ────────────────
//
// Companion to lib/push.js, which handles the existing WEB push channel
// (VAPID / push_subscriptions). That file is untouched: PWA users keep working
// exactly as they do today. This one registers NATIVE device tokens into
// push_tokens, and proximity-dispatch fans out to both.
//
// On iOS, @capacitor/push-notifications returns an APNs token. Firebase maps it
// to an FCM token via the GoogleService-Info.plist in the native project, which
// is why the server only ever deals in FCM tokens.

import { supabase } from './supabase'

async function capacitor() {
  const { Capacitor } = await import('@capacitor/core')
  return Capacitor
}

/** True only inside the native shell. */
export async function isNativeApp() {
  try { return (await capacitor()).isNativePlatform() } catch { return false }
}

/**
 * Ask for notification permission and register this device's token.
 * Safe to call repeatedly: the token upsert is keyed on the token itself.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function registerNativePush(profile) {
  if (!profile?.id || !profile?.tenant_id) {
    return { ok: false, reason: 'You need to be signed in.' }
  }
  if (!(await isNativeApp())) {
    return { ok: false, reason: 'Native push is only available in the app.' }
  }

  const { PushNotifications } = await import('@capacitor/push-notifications')

  let perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions()
  }
  if (perm.receive !== 'granted') {
    return { ok: false, reason: 'Notifications are turned off for DonutNV.' }
  }

  // Register the listeners BEFORE calling register(), or the token event can
  // fire before anything is listening for it.
  const registered = new Promise((resolve, reject) => {
    PushNotifications.addListener('registration', (t) => resolve(t.value))
    PushNotifications.addListener('registrationError', (e) => reject(e))
    setTimeout(() => reject(new Error('registration timed out')), 20_000)
  })

  await PushNotifications.register()

  let token
  try {
    token = await registered
  } catch (err) {
    console.error('[push] native registration failed', err)
    return { ok: false, reason: 'Could not set up alerts on this device.' }
  }

  const platform = (await capacitor()).getPlatform() // 'ios' | 'android'
  const { error } = await supabase.from('push_tokens').upsert({
    profile_id: profile.id,
    tenant_id: profile.tenant_id,
    token,
    platform,
    app_version: import.meta.env.VITE_APP_VERSION ?? null,
    is_active: true,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'token' })

  if (error) {
    console.error('[push] token upsert failed', error)
    return { ok: false, reason: 'Could not save this device.' }
  }
  return { ok: true }
}

/**
 * Wire tap-through so opening a push lands the customer on the Find map, and
 * mark the notification as opened so CTR is measurable.
 */
export async function attachPushHandlers(navigate) {
  if (!(await isNativeApp())) return
  const { PushNotifications } = await import('@capacitor/push-notifications')

  PushNotifications.addListener('pushNotificationActionPerformed', async (action) => {
    const data = action?.notification?.data ?? {}

    if (data.session_id) {
      // Best-effort CTR attribution via a narrow RPC. The log table grants only
      // SELECT to customers on purpose: opened_at is the one column they may
      // write, and only on their own rows, so the metrics cannot be poisoned.
      await supabase.rpc('mark_proximity_notification_opened', {
        p_session_id: data.session_id,
      })
    }
    navigate?.(data.url || '/find')
  })
}

/** Mark this device as still alive; drives the 90-day stale-token prune. */
export async function touchNativePushToken(profile) {
  if (!profile?.id || !(await isNativeApp())) return
  await supabase
    .from('push_tokens')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('profile_id', profile.id)
    .eq('is_active', true)
}
