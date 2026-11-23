import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiStopDetails } from '../../../src/api/contracts'
import { TransitousProvider } from './provider'
import { createRealtimeProvider } from '../createRealtimeProvider'
import { mapTransitousItinerary } from './journeyMapping'
import { resolveTransitousStop } from './stopMapping'
import type { TransitousItinerary, TransitousLeg } from './types'
import { buildApp } from '../../app'
import { FixtureRepository } from '../../db/fixtureRepository'

const stop: ApiStopDetails = {
  publicId: 'de:02000:8006197', dhid: null, name: 'Tonndorf', coordinate: { lat: 53.586385, lon: 10.12305 },
  stateCode: 'DE-HH', municipalityName: 'Hamburg', modes: ['RB'], identityQuality: 'dhid',
  dataStand: { snapshotId: 'test', qualityStatus: 'ready' }, technicalStops: [], servedRoutes: [],
}
const request = { stop, date: '2026-11-23', time: '08:00', profile: 'regular_tue_thu', snapshotId: 'test' }
const leg: TransitousLeg = {
  mode: 'REGIONAL_RAIL', startTime: '2026-11-23T07:03:00Z', endTime: '2026-11-23T07:17:00Z',
  scheduledStartTime: '2026-11-23T07:01:00Z', scheduledEndTime: '2026-11-23T07:12:00Z',
  duration: 840, realTime: true, scheduled: true, displayName: 'RB81', routeShortName: '81',
  from: { name: 'Hamburg Hbf', lat: 53.5527, lon: 10.0064, track: '7', scheduledTrack: '6', departureTimestampReason: 'PREDICTED' },
  to: { name: 'Tonndorf', lat: 53.586385, lon: 10.12305, track: '1', arrivalTimestampReason: 'PREDICTED' },
  alerts: [{ headerText: 'Bauarbeiten', descriptionText: 'Bitte Hinweise beachten.' }],
}
const journey: TransitousItinerary = { startTime: leg.startTime, endTime: leg.endTime, duration: leg.duration, transfers: 0, legs: [leg] }
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers })

function mockService(plan: () => Response | Promise<Response> = () => json({ itineraries: [journey] })) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/v6/stop') {
      const id = url.searchParams.get('stopId')!
      const target = id === `de-DELFI_${stop.publicId}`
      return json({ place: { name: target ? stop.name : 'Hamburg Hbf', stopId: id,
        lat: target ? stop.coordinate.lat : 53.5527, lon: target ? stop.coordinate.lon : 10.0064 } })
    }
    if (url.pathname === '/api/v6/plan') return plan()
    throw new Error(`Unexpected request ${url.pathname}`)
  })
}
const planCalls = (mock: ReturnType<typeof mockService>) => mock.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith('/plan'))

afterEach(() => vi.unstubAllEnvs())

describe('Transitous routing', () => {
  it('serves normalized results and budget errors through the public API', async () => {
    const repository = new FixtureRepository()
    vi.spyOn(repository, 'stopDetails').mockResolvedValue(stop)
    const app = await buildApp({ repository, logger: false,
      realtimeItineraryProvider: new TransitousProvider({ fetchImpl: mockService(), maxPlansPerDay: 1 }),
    })
    try {
      const path = `/api/v1/stops/${encodeURIComponent(stop.publicId)}/realtime-itineraries?date=2026-11-23&profile=regular_tue_thu&time=`
      const response = await app.inject(`${path}08%3A00`)
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toMatchObject({ provider: 'transitous', alternatives: [{ realtimeStatus: 'realtime' }] })
      const limited = await app.inject(`${path}08%3A10`)
      expect(limited.statusCode).toBe(429)
      expect(limited.json()).toMatchObject({ error: 'realtime_rate_limited' })
    } finally { await app.close() }
  })

  it('is the default backend and rejects misspelled providers', () => {
    vi.stubEnv('REGIONFINDER_REALTIME_PROVIDER', undefined)
    expect(createRealtimeProvider()).toBeInstanceOf(TransitousProvider)
    vi.stubEnv('REGIONFINDER_REALTIME_PROVIDER', 'typo')
    expect(createRealtimeProvider).toThrow('REGIONFINDER_REALTIME_PROVIDER')
  })

  it('requests verified DELFI stations and Berlin time with a contact user agent', async () => {
    const fetchImpl = mockService()
    const result = await new TransitousProvider({ fetchImpl }).plan(request)
    expect(result).toMatchObject({ provider: 'transitous', sourceAttributionUrl: 'https://transitous.org/sources/' })
    expect(result.alternatives[0]).toMatchObject({ transferCount: 0, realtimeStatus: 'realtime', totalDurationSeconds: 1020 })
    const [input, init] = planCalls(fetchImpl)[0]
    const url = new URL(String(input))
    expect(url.origin).toBe('https://api.transitous.org')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      fromPlace: 'de-DELFI_de:02000:10950_G', toPlace: `de-DELFI_${stop.publicId}`,
      time: '2026-11-23T08:00:00+01:00', numItineraries: '3', maxItineraries: '3', realtimeMode: 'REALTIME',
    })
    expect(new Headers(init?.headers).get('User-Agent')).toContain('contact: dw@b42.io')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('shares concurrent queries, caches for one minute, and refreshes using cached station IDs', async () => {
    let now = Date.parse('2026-11-23T07:00:00Z')
    const fetchImpl = mockService()
    const provider = new TransitousProvider({ fetchImpl, now: () => now })
    const results = await Promise.all([provider.plan(request), provider.plan(request)])
    expect(results[0]).toEqual(results[1])
    await provider.plan(request)
    expect(planCalls(fetchImpl)).toHaveLength(1)
    now += 60_001
    await provider.plan(request)
    expect(planCalls(fetchImpl)).toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('enforces the daily planning budget and allows new plans after 24 hours', async () => {
    let now = Date.parse('2026-11-23T07:00:00Z')
    const fetchImpl = mockService()
    const provider = new TransitousProvider({ fetchImpl, now: () => now, maxPlansPerDay: 1 })
    await provider.plan(request)
    await expect(provider.plan({ ...request, time: '08:10' })).rejects.toMatchObject({ statusCode: 429, reason: 'realtime_rate_limited' })
    expect(planCalls(fetchImpl)).toHaveLength(1)
    now += 86_400_001
    await provider.plan(request)
    expect(planCalls(fetchImpl)).toHaveLength(2)
  })

  it('honors Retry-After without immediately hitting the upstream again', async () => {
    let now = Date.parse('2026-11-23T07:00:00Z')
    let limited = true
    const fetchImpl = mockService(() => limited ? json({}, 429, { 'retry-after': '120' }) : json({ itineraries: [] }))
    const provider = new TransitousProvider({ fetchImpl, now: () => now })
    await expect(provider.plan(request)).rejects.toMatchObject({ reason: 'realtime_rate_limited' })
    now += 60_001
    await expect(provider.plan(request)).rejects.toMatchObject({ reason: 'realtime_rate_limited' })
    expect(planCalls(fetchImpl)).toHaveLength(1)
    limited = false
    now += 60_000
    expect((await provider.plan(request)).alternatives).toEqual([])
  })

  it('does not mistake invalid upstream data for no connections or cache the error', async () => {
    let broken = true
    const fetchImpl = mockService(() => json(broken ? { error: 'internal failure' } : { itineraries: [] }))
    const provider = new TransitousProvider({ fetchImpl })
    await expect(provider.plan(request)).rejects.toMatchObject({ statusCode: 502, reason: 'realtime_unavailable' })
    broken = false
    expect((await provider.plan(request)).alternatives).toEqual([])
  })

  it('aborts hung upstream requests and returns a friendly error', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    await expect(new TransitousProvider({ fetchImpl, timeoutMs: 5 }).plan(request)).rejects.toMatchObject({ reason: 'realtime_unavailable' })
  })
})

describe('Transitous station identity', () => {
  it('prefers the exact DELFI station over nearby merged coach stops', async () => {
    const get = vi.fn(async () => ({ place: { name: stop.name, stopId: `de-DELFI_${stop.publicId}`, ...stop.coordinate } }))
    expect(await resolveTransitousStop(stop, get)).toBe(`de-DELFI_${stop.publicId}`)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('accepts a close name match when the DELFI ID is unavailable', async () => {
    const get = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce([
      { id: 'wrong-city', name: 'Tonndorf', type: 'STOP', lat: 50, lon: 10 },
      { id: 'correct', name: 'Hamburg Tonndorf', type: 'STOP', ...stop.coordinate },
    ])
    expect(await resolveTransitousStop(stop, get)).toBe('correct')
  })

  it('rejects a distant reused ID and unrelated neighboring stops', async () => {
    const get = vi.fn().mockResolvedValueOnce({ place: { name: 'Tonndorf', stopId: `de-DELFI_${stop.publicId}`, lat: 50, lon: 10 } })
      .mockResolvedValueOnce([{ id: 'neighbor', name: 'Rahlstedt', type: 'STOP', ...stop.coordinate }])
    await expect(resolveTransitousStop(stop, get)).rejects.toMatchObject({ reason: 'realtime_stop_unmapped', statusCode: 404 })
  })
})

describe('Transitous journey details', () => {
  const map = (legs: TransitousLeg[], transfers = 0) => mapTransitousItinerary({ ...journey, legs, transfers }, '2026-11-23T08:00:00+01:00', '2026-11-23T07:00:00Z')

  it('preserves delays, cancellations, platform changes and service notices', () => {
    const result = map([{ ...leg, to: { ...leg.to, cancelled: true } }])
    expect(result.legs[0]).toMatchObject({ routeName: 'RB81', departureDelaySeconds: 120, arrivalDelaySeconds: 300, cancelled: true, platformFrom: '7', platformTo: '1' })
    expect(result.legs[0].remarks).toContain('Geändertes Abfahrtsgleis: 7 (planmäßig 6).')
    expect(result.legs[0].remarks).toContain('Bauarbeiten: Bitte Hinweise beachten.')
    expect(result.totalDistanceMeters).toBeNull()
  })

  it('does not claim punctuality when only scheduled times are available', () => {
    const result = map([{ ...leg, realTime: false, from: { ...leg.from, departureTimestampReason: 'NO_RT_DATA' }, to: { ...leg.to, arrivalTimestampReason: 'INCONSISTENT_RT' } }])
    expect(result.realtimeStatus).toBe('scheduled')
    expect(result.legs[0].departureDelaySeconds).toBeUndefined()
    expect(result.legs[0].arrivalDelaySeconds).toBeUndefined()
  })

  it('uses arrival-only realtime without inventing a departure delay', () => {
    const result = map([{ ...leg, from: { ...leg.from, departureTimestampReason: 'NO_RT_DATA' } }])
    expect(result.legs[0].departureDelaySeconds).toBeUndefined()
    expect(result.legs[0].arrivalDelaySeconds).toBe(300)
  })

  it('keeps through-running legs at zero transfers and indicates partial realtime', () => {
    const result = map([leg, { ...leg, realTime: false, interlineWithPreviousLeg: true, from: { ...leg.from, departureTimestampReason: 'NO_RT_DATA' }, to: { ...leg.to, arrivalTimestampReason: 'NO_RT_DATA' } }])
    expect(result.transferCount).toBe(0)
    expect(result.realtimeStatus).toBe('partial')
    expect(result.legs[1].remarks).toContain('Im Fahrzeug bleiben – kein Umstieg erforderlich.')
  })
})
