// Distance + geofence helpers (no dependencies — works on the truck's phone).

// Meters between two lat/lng points (haversine).
export function distanceMeters(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Is this position inside any blacklisted zone (home, commissary, etc.)?
// Returns the matching zone, or null. Broadcasting is suppressed when inside.
export function blacklistedZone(pos, zones) {
  for (const z of zones || []) {
    if (distanceMeters(pos, z) <= (z.radius_m || 300)) return z
  }
  return null
}
