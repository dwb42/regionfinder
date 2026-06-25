import type { ApiStopDetails } from '../../src/api/contracts'
import { numberOrNull, objectRecord, stringOrNull } from './valueHelpers'

type DbLocation = {
  id?: unknown
  extId?: unknown
  name?: unknown
  distance?: unknown
  lat?: unknown
  lon?: unknown
  type?: unknown
  location?: {
    latitude?: unknown
    longitude?: unknown
  }
}

export function directDbStopIdCandidates(stop: ApiStopDetails): string[] {
  const values = [
    stop.publicId,
    stop.dhid,
    ...stop.technicalStops.flatMap((technicalStop) => [technicalStop.sourceStopId, technicalStop.name]),
  ]
  const candidates = values.flatMap((value) => extractDbStopId(value)).filter((value) => value !== null)

  return Array.from(new Set(candidates))
}

function extractDbStopId(value: string | null | undefined): string[] {
  if (!value) {
    return []
  }

  const matches = value.match(/\d{7,8}/g) ?? []

  return Array.from(
    new Set(
      matches.flatMap((candidate) => {
        if (/^\d{7}$/.test(candidate)) {
          return [candidate]
        }

        return /^1\d{7}$/.test(candidate) ? [candidate.slice(1)] : []
      }),
    ),
  )
}

export function chooseBestLocationId(stop: ApiStopDetails, rawLocations: unknown[]): string | null {
  const scored = rawLocations
    .map((rawLocation) => {
      const location = objectRecord(rawLocation) as DbLocation
      const rawId = stringOrNull(location.id)
      const extId = stringOrNull(location.extId)
      const id = locationIdReference(rawId, extId)
      const name = stringOrNull(location.name)
      const distance = numberOrNull(location.distance)
      const coordinateDistance = locationDistanceMeters(stop, location)
      const similarity = name ? nameSimilarity(stop.name, name) : 0
      const effectiveDistance = distance ?? coordinateDistance

      if (!id) {
        return null
      }

      return {
        id,
        score: similarity * 100 - (effectiveDistance ?? 1000) / 25,
        distance: effectiveDistance,
        similarity,
      }
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => right.score - left.score)

  const best = scored[0]

  if (!best) {
    return null
  }

  return best.similarity >= 0.3 || (best.distance !== null && best.distance <= 250) ? best.id : null
}

function locationIdReference(rawId: string | null, extId: string | null): string | null {
  if (rawId?.startsWith('A=')) {
    return rawId
  }

  if (extId && /^\d{5,12}$/.test(extId)) {
    return extId
  }

  return rawId && /^\d{5,12}$/.test(rawId) ? rawId : null
}

function locationDistanceMeters(stop: ApiStopDetails, location: DbLocation): number | null {
  const lat = numberOrNull(location.lat) ?? numberOrNull(location.location?.latitude)
  const lon = numberOrNull(location.lon) ?? numberOrNull(location.location?.longitude)

  if (lat === null || lon === null) {
    return null
  }

  const latDeltaMeters = (lat - stop.coordinate.lat) * 111_320
  const lonDeltaMeters = (lon - stop.coordinate.lon) * 111_320 * Math.cos((stop.coordinate.lat * Math.PI) / 180)

  return Math.hypot(latDeltaMeters, lonDeltaMeters)
}

function nameSimilarity(left: string, right: string): number {
  const leftNormalized = normalizeName(left)
  const rightNormalized = normalizeName(right)

  if (leftNormalized === rightNormalized) {
    return 1
  }

  if (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized)) {
    return 0.85
  }

  const leftTokens = new Set(leftNormalized.split(' ').filter(Boolean))
  const rightTokens = new Set(rightNormalized.split(' ').filter(Boolean))
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length

  return leftTokens.size + rightTokens.size === 0 ? 0 : (2 * intersection) / (leftTokens.size + rightTokens.size)
}

function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replace(/\bhbf\b/g, 'hauptbahnhof')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
