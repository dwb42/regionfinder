import type { ApiItineraryResponse } from '../../../src/api/contracts'
import type { ItineraryQuery } from '../types'
import type { Queryable } from '../queryTypes'
import { findCurrentSnapshot } from './snapshotQueries'
import { searchStops } from './stopQueries'

export async function findItineraries(db: Queryable, query: ItineraryQuery): Promise<ApiItineraryResponse | null> {
  const snapshot = await findCurrentSnapshot(db)
  if (!snapshot) {
    return null
  }
  const stop = await searchStops(db, { query: query.publicId, states: [], modes: [], limit: 1 })
  const destination = stop.find((candidate) => candidate.publicId === query.publicId)
  if (!destination) {
    return null
  }

  const motisBaseUrl = process.env.MOTIS_BASE_URL ?? 'http://127.0.0.1:8080'
  const requestedDeparture = `${query.date}T${query.time}:00+02:00`
  const url = new URL('/api/v5/plan', motisBaseUrl)
  url.searchParams.set('fromPlace', process.env.REGIONFINDER_ORIGIN_MOTIS_ID ?? 'gtfs_de:02000:10950_G')
  url.searchParams.set('toPlace', `gtfs_${query.publicId}`)
  url.searchParams.set('time', requestedDeparture)
  url.searchParams.set('maxTravelTime', '240')
  url.searchParams.set('maxTransfers', '4')
  url.searchParams.set('numItineraries', '4')
  url.searchParams.set('directModes', '')
  url.searchParams.set('transitModes', 'TRANSIT')
  url.searchParams.set('detailedTransfers', 'false')
  url.searchParams.set('language', 'de')

  let payload: unknown
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }
    payload = await response.json()
  } catch {
    return null
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { itineraries?: unknown }).itineraries)) {
    return null
  }

  const requestedMs = Date.parse(requestedDeparture)
  const alternatives = (payload as { itineraries: Array<Record<string, unknown>> }).itineraries
    .slice(0, 4)
    .map((itinerary, index) => {
      const legs = Array.isArray(itinerary.legs) ? (itinerary.legs as Array<Record<string, unknown>>) : []
      const transitLegs = legs.filter((leg) => leg.mode !== 'WALK')
      const firstTransit = transitLegs[0]
      const actualFirstDepartureAt = firstTransit ? stringOrNull(firstTransit.startTime) : null
      const arrivalAt = stringOrNull(itinerary.endTime)
      const initialWalkSeconds = sumLegDurations(legs.slice(0, firstTransit ? legs.indexOf(firstTransit) : 0), 'WALK')
      const firstDepartureMs = actualFirstDepartureAt ? Date.parse(actualFirstDepartureAt) : null
      const initialWaitSeconds =
        firstDepartureMs === null ? null : Math.max(0, Math.round((firstDepartureMs - requestedMs) / 1000) - initialWalkSeconds)
      const inVehicleSeconds = sumTransitDurations(legs)
      const walkingSeconds = sumLegDurations(legs, 'WALK')
      const walkingDistanceMeters = sumLegDistances(legs, 'WALK')
      const totalDurationSeconds = arrivalAt ? Math.max(0, Math.round((Date.parse(arrivalAt) - requestedMs) / 1000)) : null

      return {
        rankType: index === 0 ? 'earliest_arrival' : 'fewest_transfers',
        provider: 'motis',
        requestedDepartureAt: requestedDeparture,
        actualFirstDepartureAt,
        arrivalAt,
        totalDurationSeconds,
        initialWalkSeconds,
        initialWaitSeconds,
        inVehicleSeconds,
        transferWaitSeconds: null,
        walkingSeconds,
        walkingDistanceMeters,
        transitDistanceMeters: null,
        totalDistanceMeters: walkingDistanceMeters,
        transferCount:
          typeof itinerary.transfers === 'number' ? itinerary.transfers : Math.max(0, transitLegs.length - 1),
        legs: legs.map((leg, sequence) => ({
          sequence,
          legType: leg.mode === 'WALK' ? 'walk' : 'transit',
          mode: stringOrNull(leg.mode),
          routeName: stringOrNull(leg.displayName) ?? stringOrNull(leg.routeShortName),
          agencyName: stringOrNull(leg.agencyName),
          fromName: placeName(leg.from),
          toName: placeName(leg.to),
          departureAt: stringOrNull(leg.startTime),
          arrivalAt: stringOrNull(leg.endTime),
          durationSeconds: typeof leg.duration === 'number' ? leg.duration : null,
          distanceMeters: typeof leg.distance === 'number' ? leg.distance : null,
          geometry: null,
          headsign: stringOrNull(leg.headsign),
          platformFrom: trackName(leg.from),
          platformTo: trackName(leg.to),
        })),
      } satisfies ApiItineraryResponse['alternatives'][number]
    })

  return {
    snapshotId: snapshot.publicId,
    requestedDeparture,
    originId: process.env.REGIONFINDER_ORIGIN_PUBLIC_ID ?? 'de:02000:10950_G',
    destinationPublicId: query.publicId,
    alternatives,
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function placeName(value: unknown): string | null {
  return value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string'
    ? (value as { name: string }).name
    : null
}

function trackName(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const place = value as { track?: unknown; scheduledTrack?: unknown }
  return typeof place.track === 'string'
    ? place.track
    : typeof place.scheduledTrack === 'string'
      ? place.scheduledTrack
      : null
}

function sumLegDurations(legs: Array<Record<string, unknown>>, mode: string): number {
  return legs.reduce((sum, leg) => sum + (leg.mode === mode && typeof leg.duration === 'number' ? leg.duration : 0), 0)
}

function sumTransitDurations(legs: Array<Record<string, unknown>>): number {
  return legs.reduce((sum, leg) => sum + (leg.mode !== 'WALK' && typeof leg.duration === 'number' ? leg.duration : 0), 0)
}

function sumLegDistances(legs: Array<Record<string, unknown>>, mode: string): number {
  return legs.reduce((sum, leg) => sum + (leg.mode === mode && typeof leg.distance === 'number' ? leg.distance : 0), 0)
}
