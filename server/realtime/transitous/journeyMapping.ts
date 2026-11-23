import type { ApiItinerary, ApiItineraryLeg } from '../../../src/api/contracts'
import type { TransitousItinerary, TransitousLeg } from './types'

const isRealtime = (reason: string | undefined, fallback: boolean) => reason
  ? ['OBSERVED', 'PROPAGATED', 'PREDICTED'].includes(reason)
  : fallback

function legToApi(leg: TransitousLeg, index: number): ApiItineraryLeg {
  const transit = leg.mode !== 'WALK'
  const departureRealtime = transit && isRealtime(leg.from.departureTimestampReason, leg.realTime)
  const arrivalRealtime = transit && isRealtime(leg.to.arrivalTimestampReason, leg.realTime)
  const notices = [...(leg.alerts ?? []), ...(leg.from.alerts ?? []), ...(leg.to.alerts ?? [])]
  const remarks = [...new Set(notices.map((notice) => [notice.headerText, notice.descriptionText].filter(Boolean).join(': ')))]
  if (leg.interlineWithPreviousLeg) remarks.unshift('Im Fahrzeug bleiben – kein Umstieg erforderlich.')
  if (transit && !leg.scheduled) remarks.push('Zusätzliche Fahrt außerhalb des regulären Fahrplans.')
  if (leg.from.track && leg.from.scheduledTrack && leg.from.track !== leg.from.scheduledTrack) {
    remarks.push(`Geändertes Abfahrtsgleis: ${leg.from.track} (planmäßig ${leg.from.scheduledTrack}).`)
  }
  if (leg.to.track && leg.to.scheduledTrack && leg.to.track !== leg.to.scheduledTrack) {
    remarks.push(`Geändertes Ankunftsgleis: ${leg.to.track} (planmäßig ${leg.to.scheduledTrack}).`)
  }
  return {
    sequence: index + 1, legType: transit ? 'transit' : 'walk', mode: leg.mode,
    routeName: leg.displayName || leg.routeShortName || null, agencyName: leg.agencyName ?? null,
    fromName: leg.from.name, toName: leg.to.name,
    departureAt: leg.startTime, arrivalAt: leg.endTime, durationSeconds: leg.duration,
    distanceMeters: leg.distance ?? null, geometry: null, headsign: leg.headsign ?? null,
    platformFrom: leg.from.track ?? leg.from.scheduledTrack ?? null,
    platformTo: leg.to.track ?? leg.to.scheduledTrack ?? null,
    plannedDepartureAt: leg.scheduledStartTime, plannedArrivalAt: leg.scheduledEndTime,
    departureDelaySeconds: departureRealtime ? (Date.parse(leg.startTime) - Date.parse(leg.scheduledStartTime)) / 1000 : undefined,
    arrivalDelaySeconds: arrivalRealtime ? (Date.parse(leg.endTime) - Date.parse(leg.scheduledEndTime)) / 1000 : undefined,
    realtime: transit ? leg.realTime : undefined,
    cancelled: Boolean(leg.cancelled || leg.from.cancelled || leg.to.cancelled), remarks,
  }
}

export function mapTransitousItinerary(raw: TransitousItinerary, requestedDeparture: string, fetchedAt: string): ApiItinerary {
  const legs = raw.legs.map(legToApi)
  const transit = legs.filter((leg) => leg.legType === 'transit')
  const walking = legs.filter((leg) => leg.legType === 'walk')
  const sumDuration = (items: ApiItineraryLeg[]) => items.reduce((sum, leg) => sum + (leg.durationSeconds ?? 0), 0)
  const sumDistance = (items: ApiItineraryLeg[]) => items.some((leg) => leg.distanceMeters === null)
    ? null : items.reduce((sum, leg) => sum + (leg.distanceMeters ?? 0), 0)
  const liveCount = transit.filter((leg) => leg.realtime).length
  return {
    provider: 'transitous', rankType: raw.transfers === 0 ? 'direct' : 'earliest_arrival',
    requestedDepartureAt: requestedDeparture, actualFirstDepartureAt: raw.startTime, arrivalAt: raw.endTime,
    totalDurationSeconds: Math.max(0, (Date.parse(raw.endTime) - Date.parse(requestedDeparture)) / 1000),
    initialWalkSeconds: legs[0].legType === 'walk' ? legs[0].durationSeconds : 0,
    initialWaitSeconds: Math.max(0, (Date.parse(raw.startTime) - Date.parse(requestedDeparture)) / 1000),
    inVehicleSeconds: sumDuration(transit), transferWaitSeconds: Math.max(0, raw.duration - sumDuration(legs)),
    walkingSeconds: sumDuration(walking), walkingDistanceMeters: sumDistance(walking),
    transitDistanceMeters: sumDistance(transit), totalDistanceMeters: sumDistance(legs),
    transferCount: raw.transfers, legs, realtimeSource: 'Transitous', realtimeFetchedAt: fetchedAt,
    realtimeStatus: liveCount === 0 ? 'scheduled' : liveCount === transit.length ? 'realtime' : 'partial',
  }
}
