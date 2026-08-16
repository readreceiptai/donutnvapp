// ── Tuning knobs for the location pipeline ─────────────────────────────────
// Kept in one file because these numbers are the battery/UX contract, and the
// brief calls battery perception the single biggest retention factor.

// Metres of movement before the OS wakes us with a new fix. ~500m is
// "significant location change" territory: it is roughly a city block or two,
// far coarser than a 5-mile geofence needs, and it keeps the GPS radio off.
// Do not lower this to chase precision; the radius does the precision work
// server-side.
export const DEFAULT_DISTANCE_FILTER = 500

// How many fixes we buffer before flushing to location-ingest. Batching is what
// keeps the radio and the network quiet: one HTTPS request per handful of
// movements instead of one per fix.
export const FLUSH_BATCH_SIZE = 10

// Force a flush after this long even if the batch is not full, so a customer
// who moves once and stops still has a fresh position on the server.
export const FLUSH_INTERVAL_MS = 5 * 60 * 1000

// Hard cap matching location-ingest's MAX_BATCH. If the device was offline and
// the buffer grew past this, we drop the OLDEST fixes: for "where are you now"
// the newest fix is the only one that matters.
export const MAX_BUFFER = 100
