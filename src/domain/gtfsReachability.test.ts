import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseClockTime } from '../utils/time'
import { calculateGtfsReachability, prepareReachabilityIndex } from './gtfsReachability'
import type { HvvReachabilityIndex, StopPlace } from './types'

function readArtifact<T>(name: string): T {
  return JSON.parse(readFileSync(resolve('fixtures/hvv', name), 'utf8')) as T
}

describe('StopPlace artifacts', () => {
  it('groups Ratzeburg rail and bus GTFS stops into one StopPlace', () => {
    const stopPlaces = readArtifact<StopPlace[]>('stop-places.json')
    const ratzeburg = stopPlaces.find((stopPlace) => stopPlace.id === 'stop-place-ratzeburg')

    expect(ratzeburg).toBeDefined()
    expect(ratzeburg?.name).toBe('Ratzeburg')
    expect(ratzeburg?.modes).toContain('RE')
    expect(ratzeburg?.modes).toContain('BUS')
    expect(ratzeburg?.stopIds.length).toBeGreaterThanOrEqual(3)
  })

  it('uses passenger-facing names for key railway StopPlaces', () => {
    const stopPlaces = readArtifact<StopPlace[]>('stop-places.json')
    const names = new Set(stopPlaces.map((stopPlace) => stopPlace.name))

    expect(names.has('Hamburg Hbf')).toBe(true)
    expect(names.has('Elmshorn')).toBe(true)
    expect(names.has('Kaltenkirchen')).toBe(true)
    expect(names.has('Mölln')).toBe(true)
    expect(names.has('Ratzeburg')).toBe(true)
  })
})

describe('calculateGtfsReachability', () => {
  it('finds RE83 from Hamburg Hbf to Ratzeburg', () => {
    const index = readArtifact<HvvReachabilityIndex>('reachability-index.json')
    const prepared = prepareReachabilityIndex(index)
    const results = calculateGtfsReachability(prepared, 'stop-place-hamburg-hbf', parseClockTime('08:00'))
    const ratzeburg = results.find((result) => result.targetStopPlaceId === 'stop-place-ratzeburg')

    expect(ratzeburg).toBeDefined()
    expect(ratzeburg?.legs.map((leg) => leg.routeName)).toContain('RE83')
  })

  it('counts direct connections as zero transfers', () => {
    const index = readArtifact<HvvReachabilityIndex>('reachability-index.json')
    const prepared = prepareReachabilityIndex(index)
    const results = calculateGtfsReachability(prepared, 'stop-place-hamburg-hbf', parseClockTime('08:00'))
    const harburg = results.find((result) => result.targetStopPlaceId === 'stop-place-hamburg-harburg')

    expect(harburg).toBeDefined()
    expect(harburg?.transfers).toBe(0)
    expect(harburg?.connectionType).toBe('direct')
  })

  it('reaches key Hamburg-area rail destinations from Hamburg Hbf', () => {
    const index = readArtifact<HvvReachabilityIndex>('reachability-index.json')
    const prepared = prepareReachabilityIndex(index)
    const results = calculateGtfsReachability(prepared, 'stop-place-hamburg-hbf', parseClockTime('08:00'))
    const byTargetId = new Map(results.map((result) => [result.targetStopPlaceId, result]))

    expect(byTargetId.get('stop-place-elmshorn')?.travelTimeMinutes).toBeLessThanOrEqual(60)
    expect(byTargetId.get('stop-place-kaltenkirchen')?.travelTimeMinutes).toBeLessThanOrEqual(90)
    expect(byTargetId.get('stop-place-molln')?.legs.map((leg) => leg.routeName)).toContain('RE83')
    expect(byTargetId.get('stop-place-ratzeburg')?.legs.map((leg) => leg.routeName)).toContain('RE83')
  })
})
