# Option B — Real-Device Push Test (the merge gate)

**Purpose:** see one real "DonutNV is nearby!" notification land on a real phone,
sent by `proximity-dispatch` from a truck placed near the phone's live position.
This is the gate for merging `feature/proximity-push` into `main`.

Android first (push-ready today). iOS is identical from step 3 on, once
TestFlight or a cable install exists.

Everything the test creates is namespaced with the sentinel prefix
`ffffffff-0000-0000-0000-000000000d`… and is deleted by Block B. **No existing
truck, session, tenant, or customer is touched.** The kill switch is flipped
ON for the duration of one dispatch call and OFF again in Block B; the tenant
toggle likewise.

Territory: written for **Ocala** (`6cd18aab-3fbd-4f50-945e-15561a853c42`,
tenant of the demo truck). If the phone is physically elsewhere, use whichever
tenant the test account belongs to and change the tenant id in both blocks.

---

## 0. Before you start (5 min)

- Phone: an Android device with Google Play services, on Wi-Fi or data,
  **location services ON**, battery saver **OFF** for the test (Android
  aggressively kills background location on some OEMs when saving power).
- Sign the phone in as a **customer** account in the Ocala tenant. Use a real
  test account you can log into (email + password), NOT one of the demo dummy
  accounts. Note its email; you will look up its `profile_id` in Block A.
- Have `PROXIMITY_PROBE_SECRET` handy? No: the probe secret is deliberately
  useless for dispatch. **The dispatch call needs `CRON_SECRET`**, and nobody
  currently holds it (write-only, set in June). See section 4 for the two
  ways around that; decide before you start so you are not stuck at step 6.

## 1. Install the debug APK on the phone

From the Mac, phone connected via USB with USB debugging on:

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
$ANDROID_HOME/platform-tools/adb devices
$ANDROID_HOME/platform-tools/adb install -r ~/Desktop/Builds/donutnvapp/android/app/build/outputs/apk/debug/app-debug.apk
```

Or copy `app-debug.apk` to the phone and open it (allow "install unknown apps").
Then keep the console open in a second terminal for the whole test; every
JS log line and native bridge call shows here:

```bash
$ANDROID_HOME/platform-tools/adb logcat -s "Capacitor/Console:*" "Capacitor:*" "FirebaseMessaging:*"
```

## 2. Opt in through the REAL priming screen

On the phone: open the app → sign in → **Account** tab → scroll to
"Know when a truck is close" → **Tell me when a truck is nearby** →
read the priming screen (this is the Play prominent-disclosure copy; check it
reads right on a real screen) → pick a radius (leave 5 mi) →
**Agree and continue**.

Two OS prompts follow, in this order:
1. Location. Android 10+ shows "While using the app" first; then the app
   raises the background prompt. Choose **Allow all the time**. (If you only
   get "While using", go to Settings → Apps → DonutNV → Permissions →
   Location → "Allow all the time".)
2. Notifications (Android 13+). **Allow.**

The screen should end at "You are all set. We will let you know when a truck
is within 5 miles."

In logcat you should see, in order: `[location] flushed 1 fix(es)`,
`PushNotifications register`, and a `registration` event with a token.

## 3. Confirm the server saw the phone (Block A, part 1)

Run in the Supabase SQL editor (APP project). Replace the email.

```sql
-- A1. Find the test account and confirm opt-in, position, and push token.
with me as (
  select id from profiles where email = 'PUT-TEST-ACCOUNT-EMAIL-HERE'
)
select
  (select id from me)                                                   as profile_id,
  (select enabled || ' @ ' || radius_miles || ' mi' from proximity_prefs
     where profile_id = (select id from me))                            as opt_in,
  (select round(st_y(geog::geometry)::numeric,5)||','||round(st_x(geog::geometry)::numeric,5)
     from customer_latest_position where profile_id = (select id from me)) as phone_position,
  (select recorded_at from customer_latest_position
     where profile_id = (select id from me))                            as position_at,
  (select platform || ' / ' || left(token,12) || '…' from push_tokens
     where profile_id = (select id from me) and is_active
     order by created_at desc limit 1)                                  as push_token;
```

You need all four non-null: `opt_in = true @ 5.0 mi`, a `phone_position`,
a recent `position_at`, and an `android / …` token. If `phone_position` is
null, walk 50 m or toggle location off/on and re-run; the plugin sends the
first fix immediately but only after the OS delivers one.

## 4. Place a truck next to the phone and arm the system (Block A, part 2)

**Decide the `CRON_SECRET` question first.** Two options:

- **(i) Reset it.** Dashboard → Edge Functions → Secrets → set `CRON_SECRET`
  to a value you generate. Exactly three functions read it —
  `notify-proximity`, `territory-digest`, `proximity-dispatch` — and Claude
  redeploys all three so they pick it up. Nothing schedules any of them today
  (verified: zero pg_cron jobs invoke an edge function), so nothing breaks.
  You end up holding the one secret that drives dispatch, which is the right
  long-term state anyway.
- **(ii) Temporary probe-secret dispatch.** Claude ships a one-deploy change so
  `PROXIMITY_PROBE_SECRET` also unlocks `?dry_run=1` and one real dispatch,
  gated additionally on `app_config.proximity_push_enabled='true'` — then
  reverts it after the test. Cleaner for tonight; option (i) is the right
  long-term state.

Then run (paste the `profile_id` from A1):

```sql
-- A2. Arm: a sentinel truck + live session at the PHONE'S position, tenant
-- toggle on, kill switch on. Everything sentinel-prefixed; Block B removes it.
do $$
declare
  v_profile uuid := 'PASTE-PROFILE-ID-FROM-A1';
  v_tenant  uuid := '6cd18aab-3fbd-4f50-945e-15561a853c42';   -- Ocala; change if needed
  v_lat double precision; v_lng double precision;
begin
  select st_y(geog::geometry), st_x(geog::geometry) into v_lat, v_lng
    from customer_latest_position where profile_id = v_profile;
  if v_lat is null then raise exception 'phone has no position yet; redo step 3'; end if;

  -- Truck ~0.5 mi north of the phone so the message reads "0.5 mi away".
  insert into trucks (id, tenant_id, name, is_active)
  values ('ffffffff-0000-0000-0000-000000000d01', v_tenant, 'Device-test truck', true);

  insert into live_sessions (id, tenant_id, truck_id, stop_name, is_live, started_at, ends_at, visibility)
  values ('ffffffff-0000-0000-0000-000000000d02', v_tenant, 'ffffffff-0000-0000-0000-000000000d01',
          'Device test stop', true, now(), now() + interval '2 hours', 'public');

  insert into truck_locations (tenant_id, truck_id, session_id, lat, lng, recorded_at)
  values (v_tenant, 'ffffffff-0000-0000-0000-000000000d01', 'ffffffff-0000-0000-0000-000000000d02',
          v_lat + 0.0072, v_lng, now());

  -- Tenant toggle on (row created if this tenant has none yet). Quiet hours
  -- widened so the test works at any hour; Block B restores defaults.
  insert into tenant_proximity_config (tenant_id, enabled, quiet_hours_start, quiet_hours_end)
  values (v_tenant, true, '23:59', '23:59')
  on conflict (tenant_id) do update set enabled = true,
    quiet_hours_start = '23:59', quiet_hours_end = '23:59';

  -- Customer quiet hours off too, for the same reason.
  update proximity_prefs set quiet_hours_start='23:59', quiet_hours_end='23:59'
   where profile_id = v_profile;

  update app_config set value = 'true' where key = 'proximity_push_enabled';
end $$;

-- A3. Prove the matcher sees exactly one candidate (the phone) before sending.
select profile_id, distance_m, radius_miles, stop_name
  from match_proximity_candidates(100);
```

A3 must return **exactly one row**: your `profile_id`, `distance_m ≈ 800`,
`radius_miles = 5.0`, `stop_name = Device test stop`. If it returns zero
rows, the most common causes: position older than 120 min (re-open the app),
or the truck fix is >15 min old (re-run A2's `truck_locations` insert).

## 5. Dispatch

Phone screen **locked**, in your hand. Then, from your terminal, one call:

```bash
curl -s -X POST "https://cfghtxfplkodjnndzmcf.supabase.co/functions/v1/proximity-dispatch" -H "x-cron-secret: PASTE_CRON_SECRET_HERE"
```

Expected: `{"ok":true,"matched":1,"sent":1,"failed":0,"skipped":0}` and,
within ~2 seconds, the phone lights up:

> **DonutNV is nearby!**
> We're 0.5 mi away at Device test stop until 9:41 PM. Fresh mini donuts, come say hi.

Tap it: the app should open on the Find map, and the tap is recorded as
`opened_at` in `proximity_notification_log` (that is the CTR signal).

## 6. Read the evidence

```sql
select channel, status, reason, distance_m, title, body, opened_at, sent_at
  from proximity_notification_log
 where profile_id = 'PASTE-PROFILE-ID'
 order by sent_at desc limit 5;
```

`channel=native, status=sent, provider_message_id` set → **merge gate cleared.**

Then prove the caps hold: run the curl **again**. Expected
`{"ok":true,"matched":0,"sent":0}` — the session dedupe (`proximity_pushes`)
and the 6-hour frequency cap both refuse a second send. That second call is
part of the test, not optional: it is the promise made in the priming screen.

## 7. Revert (Block B) — run this no matter how the test went

```sql
-- B. Disarm and remove every sentinel row. Idempotent.
update app_config set value = 'false' where key = 'proximity_push_enabled';
update tenant_proximity_config
   set enabled = false, quiet_hours_start = '21:00', quiet_hours_end = '09:00'
 where tenant_id = '6cd18aab-3fbd-4f50-945e-15561a853c42';
update proximity_prefs set quiet_hours_start='21:00', quiet_hours_end='09:00'
 where profile_id = 'PASTE-PROFILE-ID';
delete from proximity_pushes  where session_id = 'ffffffff-0000-0000-0000-000000000d02';
delete from truck_locations   where truck_id   = 'ffffffff-0000-0000-0000-000000000d01';
delete from live_sessions     where id         = 'ffffffff-0000-0000-0000-000000000d02';
delete from trucks            where id         = 'ffffffff-0000-0000-0000-000000000d01';

-- Verify: kill switch off, tenant off, no sentinel rows, no cron.
select (select value from app_config where key='proximity_push_enabled')          as kill_switch,
       (select enabled from tenant_proximity_config
         where tenant_id='6cd18aab-3fbd-4f50-945e-15561a853c42')                  as ocala_enabled,
       (select count(*) from trucks where id='ffffffff-0000-0000-0000-000000000d01') as sentinel_trucks,
       (select count(*) from cron.job where command ilike '%proximity-dispatch%')  as dispatch_crons;
```

Expect `false | false | 0 | 0`. The notification log row and the test
account's opt-in are deliberately **kept**: the log is the audit trail, and
the account is now a real opted-in beta user.

## What "pass" means, in one line

`sent:1` from the curl, the notification on the locked phone, `status=sent`
in the log, and `matched:0` on the second curl. Then merge.

## If it does not fire — where to look, in order

1. A3 returned 0 rows → matcher rules; see the A3 note.
2. `matched:1, sent:0, failed:1` → open the log row: `reason` is FCM's error
   code. `UNREGISTERED` = token stale (re-open the app, re-run A1).
   `SENDER_ID_MISMATCH` = APK built with a different google-services.json.
3. `sent:1` but nothing on the phone → the push landed at FCM but the OS
   swallowed it: check the app's notification permission, and that battery
   saver is off. `adb logcat -s FirebaseMessaging` shows delivery.
4. `403 forbidden` on the curl → wrong or missing `CRON_SECRET`; see section 4.
