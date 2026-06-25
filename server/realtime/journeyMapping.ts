import type { ApiItinerary, ApiItineraryLeg } from '../../src/api/contracts'
import { booleanOrFalse, numberOrNull, objectRecord, stringOrNull } from './valueHelpers'

export function mapDbJourneyToApiItinerary(
  journey: unknown,
  context: { index: number; requestedDeparture: string; fetchedAt: string },
): ApiItinerary {
  const record = objectRecord(journey)
  const rawLegs = Array.isArray(record.legs) ? record.legs : []
  const legs = rawLegs.map((leg, index) => mapDbLegToApiLeg(leg, index)).filter((leg) => leg !== null)
  const transitLegs = legs.filter((leg) => leg.legType === 'transit')
  const actualFirstDepartureAt = legs[0]?.departureAt ?? legs[0]?.plannedDepartureAt ?? null
  const arrivalAt = lastTime(legs, 'arrivalAt') ?? lastTime(legs, 'plannedArrivalAt')
  const requestedMs = Date.parse(context.requestedDeparture)
  const firstDepartureMs = actualFirstDepartureAt ? Date.parse(actualFirstDepartureAt) : null
  const arrivalMs = arrivalAt ? Date.parse(arrivalAt) : null
  const walkingSeconds = sumLegDurations(legs, 'walk')
  const inVehicleSeconds = sumLegDurations(legs, 'transit')

  return {
    rankType: context.index === 0 ? 'earliest_arrival' : 'fewest_transfers',
    provider: 'db-transport-rest',
    requestedDepartureAt: context.requestedDeparture,
    actualFirstDepartureAt,
    arrivalAt,
    totalDurationSeconds:
      arrivalMs === null || Number.isNaN(arrivalMs) || Number.isNaN(requestedMs)
        ? null
        : Math.max(0, Math.round((arrivalMs - requestedMs) / 1000)),
    initialWalkSeconds: legs[0]?.legType === 'walk' ? legs[0].durationSeconds : 0,
    initialWaitSeconds:
      firstDepartureMs === null || Number.isNaN(firstDepartureMs) || Number.isNaN(requestedMs)
        ? null
        : Math.max(0, Math.round((firstDepartureMs - requestedMs) / 1000)),
    inVehicleSeconds,
    transferWaitSeconds: null,
    walkingSeconds,
    walkingDistanceMeters: sumLegDistances(legs, 'walk'),
    transitDistanceMeters: sumLegDistances(legs, 'transit'),
    totalDistanceMeters: sumLegDistances(legs),
    transferCount: Math.max(0, transitLegs.length - 1),
    legs,
    refreshToken: stringOrNull(record.refreshToken),
    realtimeSource: 'v6.db.transport.rest',
    realtimeFetchedAt: context.fetchedAt,
  }
}

export function mapBahnWebJourneyToApiItinerary(
  journey: unknown,
  context: { index: number; requestedDeparture: string; fetchedAt: string },
): ApiItinerary {
  const record = objectRecord(journey)
  const rawSections = Array.isArray(record.verbindungsAbschnitte) ? record.verbindungsAbschnitte : []
  const legs = rawSections.map((section, index) => mapBahnWebSectionToApiLeg(section, index)).filter((leg) => leg !== null)
  const transitLegs = legs.filter((leg) => leg.legType === 'transit')
  const actualFirstDepartureAt = legs[0]?.departureAt ?? legs[0]?.plannedDepartureAt ?? null
  const arrivalAt = lastTime(legs, 'arrivalAt') ?? lastTime(legs, 'plannedArrivalAt')
  const requestedMs = Date.parse(context.requestedDeparture)
  const firstDepartureMs = actualFirstDepartureAt ? Date.parse(actualFirstDepartureAt) : null
  const arrivalMs = arrivalAt ? Date.parse(arrivalAt) : null
  const totalDurationSeconds =
    arrivalMs === null || Number.isNaN(arrivalMs) || Number.isNaN(requestedMs)
      ? null
      : Math.max(0, Math.round((arrivalMs - requestedMs) / 1000))

  return {
    rankType: context.index === 0 ? 'earliest_arrival' : 'fewest_transfers',
    provider: 'bahn-web',
    requestedDepartureAt: context.requestedDeparture,
    actualFirstDepartureAt,
    arrivalAt,
    totalDurationSeconds,
    initialWalkSeconds: legs[0]?.legType === 'walk' ? legs[0].durationSeconds : 0,
    initialWaitSeconds:
      firstDepartureMs === null || Number.isNaN(firstDepartureMs) || Number.isNaN(requestedMs)
        ? null
        : Math.max(0, Math.round((firstDepartureMs - requestedMs) / 1000)),
    inVehicleSeconds: sumLegDurations(legs, 'transit'),
    transferWaitSeconds: null,
    walkingSeconds: sumLegDurations(legs, 'walk'),
    walkingDistanceMeters: sumLegDistances(legs, 'walk'),
    transitDistanceMeters: sumLegDistances(legs, 'transit'),
    totalDistanceMeters: sumLegDistances(legs),
    transferCount: Math.max(0, transitLegs.length - 1),
    legs,
    refreshToken: stringOrNull(record.ctxRecon),
    realtimeSource: 'bahn.de web api',
    realtimeFetchedAt: context.fetchedAt,
  }
}

function mapDbLegToApiLeg(leg: unknown, index: number): ApiItineraryLeg | null {
  const record = objectRecord(leg)
  const line = objectRecord(record.line)
  const origin = objectRecord(record.origin)
  const destination = objectRecord(record.destination)
  const plannedDepartureAt = stringOrNull(record.plannedDeparture)
  const plannedArrivalAt = stringOrNull(record.plannedArrival)
  const departureAt = stringOrNull(record.departure) ?? plannedDepartureAt
  const arrivalAt = stringOrNull(record.arrival) ?? plannedArrivalAt
  const legType = line.name ? 'transit' : booleanOrFalse(record.walking) ? 'walk' : 'transfer'

  if (!departureAt && !arrivalAt && !plannedDepartureAt && !plannedArrivalAt) {
    return null
  }

  return {
    sequence: index + 1,
    legType,
    mode: stringOrNull(line.mode) ?? stringOrNull(line.product) ?? (legType === 'walk' ? 'WALK' : null),
    routeName: stringOrNull(line.name),
    agencyName: stringOrNull(objectRecord(line.operator).name),
    fromName: stringOrNull(origin.name),
    toName: stringOrNull(destination.name),
    departureAt,
    arrivalAt,
    durationSeconds: durationSeconds(departureAt, arrivalAt),
    distanceMeters: numberOrNull(record.distance),
    geometry: null,
    headsign: stringOrNull(record.direction),
    platformFrom: stringOrNull(record.departurePlatform) ?? stringOrNull(record.plannedDeparturePlatform),
    platformTo: stringOrNull(record.arrivalPlatform) ?? stringOrNull(record.plannedArrivalPlatform),
    plannedDepartureAt,
    plannedArrivalAt,
    departureDelaySeconds: numberOrNull(record.departureDelay),
    arrivalDelaySeconds: numberOrNull(record.arrivalDelay),
    cancelled: booleanOrFalse(record.cancelled),
    remarks: remarksToStrings(record.remarks),
  }
}

function mapBahnWebSectionToApiLeg(section: unknown, index: number): ApiItineraryLeg | null {
  const record = objectRecord(section)
  const start = objectRecord(record.startHalt)
  const destination = objectRecord(record.zielHalt)
  const vehicle = objectRecord(record.verkehrsmittel)
  const startDeparture = objectRecord(start.abfahrt ?? record.abfahrt)
  const destinationArrival = objectRecord(destination.ankunft ?? record.ankunft)
  const plannedDepartureAt = localIsoToBerlin(stringOrNull(startDeparture.sollzeit))
  const plannedArrivalAt = localIsoToBerlin(stringOrNull(destinationArrival.sollzeit))
  const departureAt = localIsoToBerlin(
    stringOrNull(startDeparture.echtzeit) ?? stringOrNull(startDeparture.prognosezeit),
  ) ?? plannedDepartureAt
  const arrivalAt = localIsoToBerlin(
    stringOrNull(destinationArrival.echtzeit) ?? stringOrNull(destinationArrival.prognosezeit),
  ) ?? plannedArrivalAt
  const routeName = [stringOrNull(vehicle.kategorie), stringOrNull(vehicle.name) ?? stringOrNull(vehicle.nummer)]
    .filter(Boolean)
    .join(' ')
  const firstStop = firstArrayRecord(record.halte)
  const lastStop = lastArrayRecord(record.halte)
  const cancelled = booleanOrFalse(record.originCancelled) || booleanOrFalse(record.destinationCancelled)

  if (!departureAt && !arrivalAt && !plannedDepartureAt && !plannedArrivalAt) {
    return null
  }

  return {
    sequence: index + 1,
    legType: vehicle.name || vehicle.nummer || vehicle.kategorie ? 'transit' : 'transfer',
    mode: stringOrNull(vehicle.produktGattung) ?? stringOrNull(vehicle.typ),
    routeName: routeName || null,
    agencyName: null,
    fromName: stringOrNull(start.name) ?? stringOrNull(record.abfahrtsOrt),
    toName: stringOrNull(destination.name) ?? stringOrNull(record.ankunftsOrt),
    departureAt,
    arrivalAt,
    durationSeconds: numberOrNull(record.abschnittsDauer) ?? durationSeconds(departureAt, arrivalAt),
    distanceMeters: null,
    geometry: null,
    headsign: stringOrNull(vehicle.richtung),
    platformFrom: stringOrNull(firstStop.gleis),
    platformTo: stringOrNull(lastStop.gleis),
    plannedDepartureAt,
    plannedArrivalAt,
    departureDelaySeconds: delaySeconds(plannedDepartureAt, departureAt),
    arrivalDelaySeconds: delaySeconds(plannedArrivalAt, arrivalAt),
    cancelled,
    remarks: bahnWebRemarks(record),
  }
}

function remarksToStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((remark) => {
      if (typeof remark === 'string') {
        return remark
      }

      const record = objectRecord(remark)
      return stringOrNull(record.text) ?? stringOrNull(record.summary) ?? stringOrNull(record.code)
    })
    .filter((remark) => remark !== null)
}

function sumLegDurations(legs: ApiItineraryLeg[], type?: ApiItineraryLeg['legType']): number | null {
  const values = legs
    .filter((leg) => (type ? leg.legType === type : true))
    .map((leg) => leg.durationSeconds)
    .filter((duration) => duration !== null)

  return values.length === 0 ? null : values.reduce((total, duration) => total + duration, 0)
}

function sumLegDistances(legs: ApiItineraryLeg[], type?: ApiItineraryLeg['legType']): number | null {
  const values = legs
    .filter((leg) => (type ? leg.legType === type : true))
    .map((leg) => leg.distanceMeters)
    .filter((distance) => distance !== null)

  return values.length === 0 ? null : values.reduce((total, distance) => total + distance, 0)
}

function lastTime(legs: ApiItineraryLeg[], key: 'arrivalAt' | 'plannedArrivalAt'): string | null {
  for (let index = legs.length - 1; index >= 0; index -= 1) {
    const value = legs[index]?.[key]

    if (value) {
      return value
    }
  }

  return null
}

function durationSeconds(departureAt: string | null, arrivalAt: string | null): number | null {
  if (!departureAt || !arrivalAt) {
    return null
  }

  const departureMs = Date.parse(departureAt)
  const arrivalMs = Date.parse(arrivalAt)

  return Number.isNaN(departureMs) || Number.isNaN(arrivalMs)
    ? null
    : Math.max(0, Math.round((arrivalMs - departureMs) / 1000))
}

function delaySeconds(plannedAt: string | null, actualAt: string | null): number | null {
  if (!plannedAt || !actualAt) {
    return null
  }

  const plannedMs = Date.parse(plannedAt)
  const actualMs = Date.parse(actualAt)

  return Number.isNaN(plannedMs) || Number.isNaN(actualMs) ? null : Math.round((actualMs - plannedMs) / 1000)
}

function localIsoToBerlin(value: string | null): string | null {
  return value ? `${value}+02:00` : null
}

function firstArrayRecord(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? objectRecord(value[0]) : {}
}

function lastArrayRecord(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? objectRecord(value[value.length - 1]) : {}
}

function bahnWebRemarks(record: Record<string, unknown>): string[] {
  return [
    ...textEntries(record.priorisierteMeldungen),
    ...textEntries(record.himMeldungen),
    ...textEntries(record.risNotizen),
  ].slice(0, 5)
}

function textEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      const record = objectRecord(entry)
      return stringOrNull(record.text) ?? stringOrNull(record.ueberschrift)
    })
    .filter((entry) => entry !== null)
}
