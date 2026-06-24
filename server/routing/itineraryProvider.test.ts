import { describe, expect, it } from 'vitest'
import { removeDominatedItineraries } from './itineraryProvider'
import type { ApiItinerary } from '../../src/api/contracts'

function itinerary(overrides: Partial<ApiItinerary>): ApiItinerary {
  return {
    rankType: 'earliest_arrival',
    provider: 'test',
    requestedDepartureAt: '2026-07-07T08:00:00+02:00',
    actualFirstDepartureAt: '2026-07-07T08:10:00+02:00',
    arrivalAt: '2026-07-07T08:40:00+02:00',
    totalDurationSeconds: 2400,
    initialWalkSeconds: null,
    initialWaitSeconds: null,
    inVehicleSeconds: null,
    transferWaitSeconds: null,
    walkingSeconds: null,
    walkingDistanceMeters: 300,
    transitDistanceMeters: null,
    totalDistanceMeters: null,
    transferCount: 0,
    legs: [],
    ...overrides,
  }
}

describe('ItineraryProvider utilities', () => {
  it('removes dominated alternatives', () => {
    const result = removeDominatedItineraries([
      itinerary({ rankType: 'earliest_arrival' }),
      itinerary({
        rankType: 'least_walking',
        actualFirstDepartureAt: '2026-07-07T08:12:00+02:00',
        arrivalAt: '2026-07-07T08:45:00+02:00',
        transferCount: 1,
        walkingDistanceMeters: 500,
      }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].rankType).toBe('earliest_arrival')
  })
})
