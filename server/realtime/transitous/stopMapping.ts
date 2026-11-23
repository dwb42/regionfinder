import type { TransitousStop } from './types'
import { matchesSchema, placeSchema } from './types'
import { RealtimeProviderError } from '../types'

export function distanceMeters(stop: TransitousStop, place: { lat: number; lon: number }): number {
  return Math.hypot((stop.coordinate.lat - place.lat) * 111320,
    (stop.coordinate.lon - place.lon) * 111320 * Math.cos(stop.coordinate.lat * Math.PI / 180))
}

function normalized(name: string): string {
  return name.toLowerCase().replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss')
    .replace(/\bhbf\b/g, 'hauptbahnhof').replace(/[^a-z0-9]+/g, ' ').trim()
}

export async function resolveTransitousStop(
  stop: TransitousStop,
  get: (path: string, params: Record<string, string>, allowMissing?: boolean) => Promise<unknown>,
): Promise<string> {
  // Both systems use DELFI. Verify the actual ID before using a geocoder's
  // merged station, which may otherwise select a nearby coach stop (e.g. Lübeck).
  const id = `de-DELFI_${stop.dhid || stop.publicId}`
  const direct = await get('/api/v6/stop', { stopId: id }, true)
  if (direct !== null) {
    const parsed = placeSchema.safeParse((direct as { place?: unknown }).place)
    if (parsed.success && parsed.data.stopId === id && distanceMeters(stop, parsed.data) <= 1000) return id
  }
  const matches = matchesSchema.safeParse(await get('/api/v1/geocode', {
    text: stop.name, type: 'STOP', place: `${stop.coordinate.lat},${stop.coordinate.lon}`, numResults: '8',
  }))
  if (!matches.success) throw new RealtimeProviderError(502, 'realtime_unavailable', 'Invalid Transitous location response')
  const name = normalized(stop.name)
  const best = matches.data.filter((candidate) => {
    const other = normalized(candidate.name)
    return candidate.type === 'STOP' && distanceMeters(stop, candidate) <= 600 &&
      (name === other || (Math.min(name.length, other.length) >= 4 && (name.includes(other) || other.includes(name))))
  }).sort((a, b) => distanceMeters(stop, a) - distanceMeters(stop, b))[0]
  if (!best) throw new RealtimeProviderError(404, 'realtime_stop_unmapped', 'No matching Transitous station found')
  return best.id
}
