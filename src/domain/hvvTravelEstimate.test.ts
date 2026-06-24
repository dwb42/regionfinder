import { describe, expect, it } from 'vitest'
import { defaultStartStationId, stationById } from '../data/stations'
import { parseClockTime } from '../utils/time'
import { estimateHvvTravelToStation } from './hvvTravelEstimate'
import { calculateReachability } from './reachability'
import type { HvvRoute, HvvStation } from './types'

const buechenSeedStation = stationById.get('buechen')!
const startStation = stationById.get(defaultStartStationId)!

const buechenHvvStation: HvvStation = {
  ...buechenSeedStation,
  id: 'hvv-buechen',
  name: 'Bf. Büchen',
  source: 'hvv-gtfs',
}

const ratzeburgRegionalStation: HvvStation = {
  id: 'hvv-ratzeburg-regional',
  name: 'Ratzeburg',
  city: 'Ratzeburg',
  state: 'HVV',
  region: 'HVV-Verbundgebiet',
  coordinates: { lat: 53.698265, lon: 10.740719 },
  type: 'regional',
  source: 'hvv-gtfs',
}

const ratzeburgBusStation: HvvStation = {
  ...ratzeburgRegionalStation,
  id: 'hvv-ratzeburg-bus',
  name: 'Bf. Ratzeburg',
  coordinates: { lat: 53.698429, lon: 10.741119 },
  type: 'bus',
}

const re83Route: HvvRoute = {
  id: 'hvv-re83',
  name: 'RE83',
  color: '#0f766e',
  mode: 'RE',
  source: 'hvv-gtfs',
  layer: 'regional',
  stationIds: [buechenHvvStation.id, ratzeburgRegionalStation.id],
  stopIds: [buechenHvvStation.id, ratzeburgRegionalStation.id],
}

describe('estimateHvvTravelToStation', () => {
  it('estimates a selected HVV station on demand via reachable seed anchors', () => {
    const departureMinutes = parseClockTime('08:00')
    const destinations = calculateReachability(defaultStartStationId, departureMinutes)
    const hvvStations = [buechenHvvStation, ratzeburgRegionalStation, ratzeburgBusStation]
    const estimate = estimateHvvTravelToStation({
      targetStation: ratzeburgBusStation,
      startStation,
      departureMinutes,
      destinations,
      hvvRoutes: [re83Route],
      hvvStations,
      hvvStationById: new Map(hvvStations.map((station) => [station.id, station])),
    })

    expect(estimate).not.toBeNull()
    expect(estimate?.travelTimeMinutes).toBeGreaterThan(destinations.find((destination) => destination.station.id === 'buechen')!.travelTimeMinutes)
    expect(estimate?.legs.map((leg) => leg.routeName)).toContain('RE83')
    expect(estimate?.legs.map((leg) => leg.routeName)).toContain('Fußweg')
    expect(estimate?.distanceKm).toBeGreaterThan(40)
  })
})
