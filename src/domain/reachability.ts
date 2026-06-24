import { railwayLines, routeServices } from '../data/railway'
import { stationById, stations } from '../data/stations'
import { distanceKm, roundDistance } from '../utils/geo'
import type { ConnectionLeg, ReachableDestination, RouteService, Station } from './types'

type QueueState = {
  stationId: string
  arrivalMinutes: number
  legs: ConnectionLeg[]
}

type BestState = {
  arrivalMinutes: number
  legs: ConnectionLeg[]
}

type ServiceBoarding = {
  route: RouteService
  originIndex: number
  departureAtOrigin: number
}

function nextServiceDeparture(service: RouteService, stationIndex: number, earliestStationDeparture: number): number | null {
  const offset = service.stops[stationIndex].offsetMinutes
  const earliestOriginDeparture = earliestStationDeparture - offset

  if (earliestOriginDeparture > service.lastDepartureMinutes) {
    return null
  }

  const waitIntervals = Math.max(
    0,
    Math.ceil((earliestOriginDeparture - service.firstDepartureMinutes) / service.intervalMinutes),
  )
  const departureAtOrigin = service.firstDepartureMinutes + waitIntervals * service.intervalMinutes

  if (departureAtOrigin > service.lastDepartureMinutes) {
    return null
  }

  return departureAtOrigin
}

function boardableServices(stationId: string, earliestDeparture: number): ServiceBoarding[] {
  return routeServices.flatMap((route) => {
    const originIndex = route.stops.findIndex((stop) => stop.stationId === stationId)

    if (originIndex === -1 || originIndex >= route.stops.length - 1) {
      return []
    }

    const departureAtOrigin = nextServiceDeparture(route, originIndex, earliestDeparture)

    return departureAtOrigin === null ? [] : [{ route, originIndex, departureAtOrigin }]
  })
}

function countTransfers(legs: ConnectionLeg[]): number {
  if (legs.length <= 1) {
    return 0
  }

  let transfers = 0

  for (let index = 1; index < legs.length; index += 1) {
    if (legs[index].routeId !== legs[index - 1].routeId) {
      transfers += 1
    }
  }

  return transfers
}

function getStation(stationId: string): Station {
  const station = stationById.get(stationId)

  if (!station) {
    throw new Error(`Unknown station id in routing data: ${stationId}`)
  }

  return station
}

export function calculateReachability(startStationId: string, departureMinutes: number): ReachableDestination[] {
  const startStation = getStation(startStationId)
  const best = new Map<string, BestState>([
    [startStationId, { arrivalMinutes: departureMinutes, legs: [] }],
  ])
  const queue: QueueState[] = [{ stationId: startStationId, arrivalMinutes: departureMinutes, legs: [] }]

  while (queue.length > 0) {
    queue.sort((a, b) => a.arrivalMinutes - b.arrivalMinutes)
    const current = queue.shift()

    if (!current) {
      break
    }

    const recorded = best.get(current.stationId)

    if (!recorded || current.arrivalMinutes > recorded.arrivalMinutes) {
      continue
    }

    const earliestDeparture = current.arrivalMinutes

    for (const boarding of boardableServices(current.stationId, earliestDeparture)) {
      const departureOffset = boarding.route.stops[boarding.originIndex].offsetMinutes
      const stationDepartureMinutes = boarding.departureAtOrigin + departureOffset

      for (let stopIndex = boarding.originIndex + 1; stopIndex < boarding.route.stops.length; stopIndex += 1) {
        const stop = boarding.route.stops[stopIndex]
        const arrivalMinutes = boarding.departureAtOrigin + stop.offsetMinutes
        const leg: ConnectionLeg = {
          routeId: boarding.route.id,
          routeName: boarding.route.name,
          operator: boarding.route.operator,
          color: boarding.route.color,
          fromStationId: current.stationId,
          toStationId: stop.stationId,
          departureMinutes: stationDepartureMinutes,
          arrivalMinutes,
        }
        const nextLegs = [...current.legs, leg]
        const existing = best.get(stop.stationId)

        if (!existing || arrivalMinutes < existing.arrivalMinutes) {
          best.set(stop.stationId, { arrivalMinutes, legs: nextLegs })
          queue.push({ stationId: stop.stationId, arrivalMinutes, legs: nextLegs })
        }
      }
    }
  }

  return Array.from(best.entries())
    .filter(([stationId]) => stationId !== startStationId)
    .map(([stationId, state]) => {
      const station = getStation(stationId)

      return {
        station,
        travelTimeMinutes: state.arrivalMinutes - departureMinutes,
        transfers: countTransfers(state.legs),
        distanceKm: roundDistance(distanceKm(startStation.coordinates, station.coordinates)),
        departureMinutes,
        arrivalMinutes: state.arrivalMinutes,
        legs: state.legs,
      }
    })
    .sort((a, b) => a.travelTimeMinutes - b.travelTimeMinutes || a.station.name.localeCompare(b.station.name))
}

export function validateSeedData(): string[] {
  const errors: string[] = []
  const knownStationIds = new Set(stations.map((station) => station.id))

  for (const service of routeServices) {
    if (service.stops.length < 2) {
      errors.push(`${service.id} has fewer than two stops`)
    }

    for (const stop of service.stops) {
      if (!knownStationIds.has(stop.stationId)) {
        errors.push(`${service.id} references unknown station ${stop.stationId}`)
      }
    }

    for (let index = 1; index < service.stops.length; index += 1) {
      if (service.stops[index].offsetMinutes <= service.stops[index - 1].offsetMinutes) {
        errors.push(`${service.id} has non-increasing stop offsets`)
      }
    }
  }

  for (const line of railwayLines) {
    if (line.stationIds.length < 2) {
      errors.push(`${line.id} has fewer than two stations`)
    }

    for (const stationId of line.stationIds) {
      if (!knownStationIds.has(stationId)) {
        errors.push(`${line.id} references unknown station ${stationId}`)
      }
    }
  }

  return errors
}
