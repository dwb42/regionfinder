import { stations } from '../data/stations'
import { distanceKm, roundDistance } from '../utils/geo'
import type { ConnectionLeg, HvvRoute, HvvStation, ReachableDestination, Station } from './types'

export type HvvTravelEstimate = {
  travelTimeMinutes: number
  transfers: number
  distanceKm: number
  arrivalMinutes: number
  legs: ConnectionLeg[]
  anchorName: string
}

type EstimateHvvTravelInput = {
  targetStation: HvvStation
  startStation: Station
  departureMinutes: number
  destinations: ReachableDestination[]
  hvvRoutes: HvvRoute[]
  hvvStations: HvvStation[]
  hvvStationById: Map<string, HvvStation>
}

type GraphEdge = {
  toStationId: string
  routeId: string
  routeName: string
  routeColor: string
  minutes: number
  waitMinutes: number
  isTransfer: boolean
}

type QueueState = {
  stationId: string
  arrivalMinutes: number
  transfers: number
  currentRouteId: string | null
  seedLegs: ConnectionLeg[]
  hvvLegs: ConnectionLeg[]
  anchorName: string
}

const maxEstimateMinutes = 240
const maxSettledStates = 12000
const transferDistanceKm = 0.25
const transferGridSize = 0.004

function normalizeStationName(value: string): string {
  return value.trim().toLocaleLowerCase('de-DE')
}

function isBusLikeRoute(route: HvvRoute): boolean {
  const name = route.routeShortName ?? route.name
  return route.layer === 'bus' || name.startsWith('X') || name.startsWith('M') || /^\d{2,5}$/.test(name)
}

function routeSpeedKmh(route: HvvRoute): number {
  if (route.layer === 'faehre') {
    return 18
  }
  if (isBusLikeRoute(route)) {
    return route.name.startsWith('X') ? 34 : 26
  }
  if (route.mode === 'U' || route.mode === 'S' || route.mode === 'AKN') {
    return 38
  }
  return 62
}

function routeWaitMinutes(route: HvvRoute): number {
  if (route.layer === 'faehre') {
    return 10
  }
  return isBusLikeRoute(route) ? 7 : 8
}

function estimateRouteMinutes(route: HvvRoute, distance: number, stopCount: number): number {
  const movingMinutes = (distance / routeSpeedKmh(route)) * 60
  const stopPenalty = Math.max(0, stopCount - 1) * (isBusLikeRoute(route) ? 0.65 : 0.45)

  return Math.max(2, Math.round(movingMinutes + stopPenalty))
}

function routeStationDistance(fromStation: HvvStation, toStation: HvvStation): number {
  return distanceKm(fromStation.coordinates, toStation.coordinates)
}

function buildRouteGraph(routes: HvvRoute[], stationById: Map<string, HvvStation>): Map<string, GraphEdge[]> {
  const graph = new Map<string, GraphEdge[]>()

  function addEdge(fromStationId: string, edge: GraphEdge) {
    const edges = graph.get(fromStationId) ?? []
    edges.push(edge)
    graph.set(fromStationId, edges)
  }

  for (const route of routes) {
    for (let index = 1; index < route.stationIds.length; index += 1) {
      const previousId = route.stationIds[index - 1]
      const currentId = route.stationIds[index]
      const previous = stationById.get(previousId)
      const current = stationById.get(currentId)

      if (!previous || !current) {
        continue
      }

      const segmentDistance = routeStationDistance(previous, current)

      if (segmentDistance <= 0) {
        continue
      }

      const minutes = estimateRouteMinutes(route, segmentDistance, 2)

      addEdge(previousId, {
        toStationId: currentId,
        routeId: route.id,
        routeName: route.name,
        routeColor: route.color,
        minutes,
        waitMinutes: routeWaitMinutes(route),
        isTransfer: false,
      })
      addEdge(currentId, {
        toStationId: previousId,
        routeId: route.id,
        routeName: route.name,
        routeColor: route.color,
        minutes,
        waitMinutes: routeWaitMinutes(route),
        isTransfer: false,
      })
    }
  }

  const stationsByCell = new Map<string, HvvStation[]>()
  const allStations = Array.from(stationById.values())

  for (const station of allStations) {
    const cell = stationCell(station)
    const cellStations = stationsByCell.get(cell) ?? []
    cellStations.push(station)
    stationsByCell.set(cell, cellStations)
  }

  for (const station of allStations) {
    for (const nearbyStation of nearbyTransferCandidates(station, stationsByCell)) {
      if (station.id === nearbyStation.id) {
        continue
      }

      const distance = routeStationDistance(station, nearbyStation)

      if (distance > transferDistanceKm) {
        continue
      }

      addEdge(station.id, {
        toStationId: nearbyStation.id,
        routeId: `transfer-${station.id}-${nearbyStation.id}`,
        routeName: 'Fußweg',
        routeColor: '#64748b',
        minutes: Math.max(2, Math.round((distance / 4.5) * 60)),
        waitMinutes: 0,
        isTransfer: true,
      })
    }
  }

  return graph
}

function stationCell(station: HvvStation): string {
  return `${Math.floor(station.coordinates.lat / transferGridSize)}:${Math.floor(station.coordinates.lon / transferGridSize)}`
}

function nearbyTransferCandidates(station: HvvStation, stationsByCell: Map<string, HvvStation[]>): HvvStation[] {
  const latCell = Math.floor(station.coordinates.lat / transferGridSize)
  const lonCell = Math.floor(station.coordinates.lon / transferGridSize)
  const candidates: HvvStation[] = []

  for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
    for (let lonOffset = -1; lonOffset <= 1; lonOffset += 1) {
      candidates.push(...(stationsByCell.get(`${latCell + latOffset}:${lonCell + lonOffset}`) ?? []))
    }
  }

  return candidates
}

function stationNameLooksRelated(seedStation: Station, hvvStation: HvvStation): boolean {
  const seedName = normalizeStationName(seedStation.name)
  const hvvName = normalizeStationName(hvvStation.name)
  const seedCity = normalizeStationName(seedStation.city)

  return hvvName === seedName || hvvName.includes(seedName) || hvvName.includes(seedCity)
}

function findHvvAnchorIds(seedStation: Station, hvvStations: HvvStation[]): string[] {
  const directMatches = seedStation.sourceStopId
    ? hvvStations.filter((station) => station.sourceStopId === seedStation.sourceStopId)
    : []

  if (directMatches.length > 0) {
    return directMatches.map((station) => station.id)
  }

  return hvvStations
    .map((station) => ({
      station,
      distance: distanceKm(seedStation.coordinates, station.coordinates),
      relatedName: stationNameLooksRelated(seedStation, station),
    }))
    .filter((candidate) => candidate.distance <= (candidate.relatedName ? 1.2 : 0.45))
    .sort((a, b) => {
      if (a.relatedName !== b.relatedName) {
        return a.relatedName ? -1 : 1
      }

      return a.distance - b.distance
    })
    .slice(0, 8)
    .map((candidate) => candidate.station.id)
}

function pushInitialState(
  queue: QueueState[],
  best: Map<string, number>,
  anchorId: string,
  anchorName: string,
  arrivalMinutes: number,
  transfers: number,
  seedLegs: ConnectionLeg[],
) {
  const key = `${anchorId}|seed`
  const existing = best.get(key)

  if (existing !== undefined && existing <= arrivalMinutes) {
    return
  }

  best.set(key, arrivalMinutes)
  queue.push({
    stationId: anchorId,
    arrivalMinutes,
    transfers,
    currentRouteId: null,
    seedLegs,
    hvvLegs: [],
    anchorName,
  })
}

function appendHvvLeg(state: QueueState, edge: GraphEdge, departureMinutes: number, arrivalMinutes: number): ConnectionLeg[] {
  const lastLeg = state.hvvLegs.at(-1)

  if (!edge.isTransfer && lastLeg?.routeId === edge.routeId) {
    return [
      ...state.hvvLegs.slice(0, -1),
      {
        ...lastLeg,
        toStationId: edge.toStationId,
        arrivalMinutes,
      },
    ]
  }

  return [
    ...state.hvvLegs,
    {
      routeId: edge.routeId,
      routeName: edge.routeName,
      operator: 'HVV GTFS',
      color: edge.routeColor,
      fromStationId: state.stationId,
      toStationId: edge.toStationId,
      departureMinutes,
      arrivalMinutes,
    },
  ]
}

function toEstimate(state: QueueState, input: EstimateHvvTravelInput): HvvTravelEstimate {
  return {
    travelTimeMinutes: state.arrivalMinutes - input.departureMinutes,
    transfers: state.transfers,
    distanceKm: roundDistance(distanceKm(input.startStation.coordinates, input.targetStation.coordinates)),
    arrivalMinutes: state.arrivalMinutes,
    legs: [...state.seedLegs, ...state.hvvLegs],
    anchorName: state.anchorName,
  }
}

export function estimateHvvTravelToStation(input: EstimateHvvTravelInput): HvvTravelEstimate | null {
  const graph = buildRouteGraph(input.hvvRoutes, input.hvvStationById)
  const best = new Map<string, number>()
  const queue: QueueState[] = []

  const startAnchors = findHvvAnchorIds(input.startStation, input.hvvStations)

  for (const anchorId of startAnchors) {
    const anchor = input.hvvStationById.get(anchorId)
    pushInitialState(queue, best, anchorId, anchor?.name ?? input.startStation.name, input.departureMinutes, 0, [])
  }

  for (const destination of input.destinations) {
    const anchorIds = findHvvAnchorIds(destination.station, input.hvvStations)

    for (const anchorId of anchorIds) {
      const anchor = input.hvvStationById.get(anchorId)
      pushInitialState(
        queue,
        best,
        anchorId,
        anchor?.name ?? destination.station.name,
        destination.arrivalMinutes,
        destination.transfers,
        destination.legs,
      )
    }
  }

  let settledStates = 0

  while (queue.length > 0 && settledStates < maxSettledStates) {
    queue.sort((a, b) => a.arrivalMinutes - b.arrivalMinutes || a.transfers - b.transfers)
    const current = queue.shift()

    if (!current) {
      break
    }

    settledStates += 1

    if (current.stationId === input.targetStation.id) {
      return toEstimate(current, input)
    }

    const edges = graph.get(current.stationId) ?? []

    for (const edge of edges) {
      const changesRoute = current.currentRouteId !== edge.routeId
      const waitMinutes = changesRoute ? edge.waitMinutes : 0
      const arrivalMinutes = current.arrivalMinutes + waitMinutes + edge.minutes
      const travelTimeMinutes = arrivalMinutes - input.departureMinutes

      if (travelTimeMinutes <= 0 || travelTimeMinutes > maxEstimateMinutes) {
        continue
      }

      const transferIncrement =
        edge.isTransfer
          ? 0
          : current.currentRouteId === null
          ? current.seedLegs.length > 0
            ? 1
            : 0
          : changesRoute
            ? 1
            : 0
      const transfers = current.transfers + transferIncrement
      const key = `${edge.toStationId}|${edge.routeId}`
      const existing = best.get(key)

      if (existing !== undefined && existing <= arrivalMinutes) {
        continue
      }

      best.set(key, arrivalMinutes)
      queue.push({
        stationId: edge.toStationId,
        arrivalMinutes,
        transfers,
        currentRouteId: edge.routeId,
        seedLegs: current.seedLegs,
        hvvLegs: appendHvvLeg(current, edge, current.arrivalMinutes + waitMinutes, arrivalMinutes),
        anchorName: current.anchorName,
      })
    }
  }

  return null
}

export function findNearestSeedStation(station: HvvStation): Station | null {
  const directMatch = stations.find((candidate) => candidate.sourceStopId === station.sourceStopId)

  if (directMatch) {
    return directMatch
  }

  const exactNameMatch = stations.find(
    (candidate) =>
      normalizeStationName(candidate.name) === normalizeStationName(station.name) &&
      distanceKm(candidate.coordinates, station.coordinates) <= 0.8,
  )

  if (exactNameMatch) {
    return exactNameMatch
  }

  const nearest = stations
    .map((candidate) => ({
      station: candidate,
      distance: distanceKm(candidate.coordinates, station.coordinates),
    }))
    .sort((a, b) => a.distance - b.distance)[0]

  return nearest && nearest.distance <= 0.65 ? nearest.station : null
}
