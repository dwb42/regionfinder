import type {
  ConnectionLeg,
  HvvReachabilityIndex,
  HvvReachabilityRouteMeta,
  HvvReachabilityTrip,
  ReachabilityResult,
} from './types'

type Boarding = {
  tripIndex: number
  stopIndex: number
}

type RouteState = {
  arrivalMinutes: number
  firstDepartureMinutes: number | null
  legs: ConnectionLeg[]
}

type QueueState = RouteState & {
  stopPlaceIndex: number
}

type PreparedIndex = {
  index: HvvReachabilityIndex
  boardingsByStopPlace: Boarding[][]
  transferEdgesByStopPlace: Array<Array<{ toStopPlaceIndex: number; transferMinutes: number }>>
  stopPlaceIndexById: Map<string, number>
}

const weekdayMask = 1

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

function createLeg(
  route: HvvReachabilityRouteMeta,
  fromStopPlaceId: string,
  toStopPlaceId: string,
  departureMinutes: number,
  arrivalMinutes: number,
): ConnectionLeg {
  return {
    routeId: route.id,
    routeName: route.name,
    operator: route.operator,
    color: route.color,
    fromStationId: fromStopPlaceId,
    toStationId: toStopPlaceId,
    departureMinutes,
    arrivalMinutes,
  }
}

function isUsefulTrip(index: HvvReachabilityIndex, trip: HvvReachabilityTrip): boolean {
  const route = index.routes[trip[0]]
  return (
    (trip[1] & weekdayMask) !== 0 &&
    trip[2].length >= 2 &&
    route?.layer !== 'bus' &&
    route?.layer !== 'faehre'
  )
}

function isBetterState(candidate: RouteState, existing: RouteState | undefined): boolean {
  if (!existing) {
    return true
  }

  return (
    candidate.arrivalMinutes < existing.arrivalMinutes ||
    (candidate.arrivalMinutes === existing.arrivalMinutes &&
      (candidate.firstDepartureMinutes ?? 0) > (existing.firstDepartureMinutes ?? 0))
  )
}

export function prepareReachabilityIndex(index: HvvReachabilityIndex): PreparedIndex {
  const boardingsByStopPlace: Boarding[][] = index.stopPlaceIds.map(() => [])
  const transferEdgesByStopPlace: PreparedIndex['transferEdgesByStopPlace'] = index.stopPlaceIds.map(() => [])

  index.trips.forEach((trip, tripIndex) => {
    if (!isUsefulTrip(index, trip)) {
      return
    }

    const stopPlaceIndexes = trip[2]

    for (let stopIndex = 0; stopIndex < stopPlaceIndexes.length - 1; stopIndex += 1) {
      boardingsByStopPlace[stopPlaceIndexes[stopIndex]]?.push({ tripIndex, stopIndex })
    }
  })

  for (const [fromStopPlaceIndex, toStopPlaceIndex, transferMinutes] of index.transferEdges ?? []) {
    transferEdgesByStopPlace[fromStopPlaceIndex]?.push({ toStopPlaceIndex, transferMinutes })
  }

  return {
    index,
    boardingsByStopPlace,
    transferEdgesByStopPlace,
    stopPlaceIndexById: new Map(index.stopPlaceIds.map((id, placeIndex) => [id, placeIndex])),
  }
}

export function calculateGtfsReachability(
  prepared: PreparedIndex,
  originStopPlaceId: string,
  referenceDepartureMinutes: number,
): ReachabilityResult[] {
  const originStopPlaceIndex = prepared.stopPlaceIndexById.get(originStopPlaceId)

  if (originStopPlaceIndex === undefined) {
    return []
  }

  const best = new Map<number, RouteState>([
    [
      originStopPlaceIndex,
      {
        arrivalMinutes: referenceDepartureMinutes,
        firstDepartureMinutes: null,
        legs: [],
      },
    ],
  ])
  const queue: QueueState[] = [
    {
      stopPlaceIndex: originStopPlaceIndex,
      arrivalMinutes: referenceDepartureMinutes,
      firstDepartureMinutes: null,
      legs: [],
    },
  ]

  while (queue.length > 0) {
    queue.sort((a, b) => a.arrivalMinutes - b.arrivalMinutes)
    const current = queue.shift()

    if (!current) {
      break
    }

    const recorded = best.get(current.stopPlaceIndex)

    if (!recorded || current.arrivalMinutes > recorded.arrivalMinutes) {
      continue
    }

    const boardings = prepared.boardingsByStopPlace[current.stopPlaceIndex] ?? []
    const transferEdges = prepared.transferEdgesByStopPlace[current.stopPlaceIndex] ?? []

    for (const edge of transferEdges) {
      const nextState = {
        arrivalMinutes: current.arrivalMinutes + edge.transferMinutes,
        firstDepartureMinutes: current.firstDepartureMinutes,
        legs: current.legs,
      }
      const existing = best.get(edge.toStopPlaceIndex)

      if (!isBetterState(nextState, existing)) {
        continue
      }

      best.set(edge.toStopPlaceIndex, nextState)
      queue.push({
        stopPlaceIndex: edge.toStopPlaceIndex,
        ...nextState,
      })
    }

    for (const boarding of boardings) {
      const trip = prepared.index.trips[boarding.tripIndex]
      const route = prepared.index.routes[trip[0]]
      const stopPlaceIndexes = trip[2]
      const departures = trip[3]
      const arrivals = trip[4]
      const boardingDeparture = departures[boarding.stopIndex]

      if (!route || boardingDeparture < current.arrivalMinutes) {
        continue
      }

      for (let targetStopIndex = boarding.stopIndex + 1; targetStopIndex < stopPlaceIndexes.length; targetStopIndex += 1) {
        const targetStopPlaceIndex = stopPlaceIndexes[targetStopIndex]
        const arrivalMinutes = arrivals[targetStopIndex]
        const leg = createLeg(
          route,
          prepared.index.stopPlaceIds[current.stopPlaceIndex],
          prepared.index.stopPlaceIds[targetStopPlaceIndex],
          boardingDeparture,
          arrivalMinutes,
        )
        const nextLegs = [...current.legs, leg]
        const nextState = {
          arrivalMinutes,
          firstDepartureMinutes: current.firstDepartureMinutes ?? boardingDeparture,
          legs: nextLegs,
        }
        const existing = best.get(targetStopPlaceIndex)

        if (!isBetterState(nextState, existing)) {
          continue
        }

        best.set(targetStopPlaceIndex, nextState)
        queue.push({
          stopPlaceIndex: targetStopPlaceIndex,
          ...nextState,
        })
      }
    }
  }

  return Array.from(best.entries())
    .filter(([stopPlaceIndex]) => stopPlaceIndex !== originStopPlaceIndex)
    .map(([targetStopPlaceIndex, state]) => {
      const transfers = countTransfers(state.legs)
      const departureMinutes = state.firstDepartureMinutes ?? referenceDepartureMinutes

      return {
        originStopPlaceId,
        targetStopPlaceId: prepared.index.stopPlaceIds[targetStopPlaceIndex],
        departureMinutes,
        arrivalMinutes: state.arrivalMinutes,
        travelTimeMinutes: state.arrivalMinutes - departureMinutes,
        transfers,
        connectionType: transfers === 0 ? 'direct' as const : 'transfer' as const,
        legs: state.legs,
        weekdayConnectionCount: prepared.index.weekdayStopCounts[targetStopPlaceIndex] ?? 0,
        weekendConnectionCount: prepared.index.weekendStopCounts[targetStopPlaceIndex] ?? 0,
      }
    })
    .sort((a, b) => a.travelTimeMinutes - b.travelTimeMinutes || a.targetStopPlaceId.localeCompare(b.targetStopPlaceId))
}
