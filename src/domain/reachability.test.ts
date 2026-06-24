import { describe, expect, it } from 'vitest'
import { railwayLines, routeServices } from '../data/railway'
import { defaultStartStationId } from '../data/stations'
import { parseClockTime } from '../utils/time'
import { calculateReachability, validateSeedData } from './reachability'

describe('seed data validation', () => {
  it('contains only known stations and increasing stop offsets', () => {
    expect(validateSeedData()).toEqual([])
  })

  it('keeps mapped corridor stations covered by service patterns', () => {
    const serviceStationIds = new Set(
      routeServices.flatMap((service) => service.stops.map((stop) => stop.stationId)),
    )
    const uncoveredStationIds = railwayLines
      .flatMap((line) => line.stationIds)
      .filter((stationId) => !serviceStationIds.has(stationId))

    expect(uncoveredStationIds).toEqual([])
  })
})

describe('calculateReachability', () => {
  it('finds reachable Hamburg-area destinations from Hamburg Hbf', () => {
    const destinations = calculateReachability(defaultStartStationId, parseClockTime('08:00'))
    const byId = new Map(destinations.map((destination) => [destination.station.id, destination]))

    expect(byId.get('hamburg-dammtor')?.travelTimeMinutes).toBe(7)
    expect(byId.get('hamburg-harburg')?.travelTimeMinutes).toBe(16)
    expect(byId.get('hittfeld')?.legs[0].routeName).toBe('RB41')
    expect(byId.get('hamburg-bergedorf')?.travelTimeMinutes).toBe(29)
    expect(byId.get('luebeck-hbf')?.travelTimeMinutes).toBe(70)
    expect(byId.get('kiel-hbf')?.travelTimeMinutes).toBe(98)
  })

  it('includes example connection legs with departure and arrival times', () => {
    const destinations = calculateReachability(defaultStartStationId, parseClockTime('08:00'))
    const luebeck = destinations.find((destination) => destination.station.id === 'luebeck-hbf')

    expect(luebeck).toBeDefined()
    expect(luebeck?.legs).toHaveLength(1)
    expect(luebeck?.legs[0]).toMatchObject({
      routeName: 'RE8',
      fromStationId: 'hamburg-hbf',
      toStationId: 'luebeck-hbf',
      departureMinutes: parseClockTime('08:12'),
      arrivalMinutes: parseClockTime('09:10'),
    })
  })

  it('can route from another start station using reverse service patterns', () => {
    const destinations = calculateReachability('luebeck-hbf', parseClockTime('08:00'))
    const hamburg = destinations.find((destination) => destination.station.id === 'hamburg-hbf')

    expect(hamburg?.travelTimeMinutes).toBeGreaterThan(40)
    expect(hamburg?.legs[0].routeName).toBe('RE8')
  })
})
