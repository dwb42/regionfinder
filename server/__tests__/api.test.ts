import { describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app'
import { FixtureRepository } from '../db/fixtureRepository'
import { DbTransportRestProvider } from '../realtime/dbTransportRestProvider'

async function withApp(fetchImpl?: typeof fetch) {
  const app = await buildApp({
    repository: new FixtureRepository(),
    realtimeItineraryProvider: fetchImpl
      ? new DbTransportRestProvider({
          baseUrl: 'https://db.test',
          fetchImpl,
          backend: 'db-transport-rest',
          now: () => Date.parse('2026-07-07T07:59:00.000Z'),
        })
      : undefined,
  })

  return app
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function journeyPayload() {
  return {
    journeys: [
      {
        refreshToken: 'refresh-1',
        legs: [
          {
            origin: { name: 'Hamburg Hbf' },
            destination: { name: 'Aumuehle Testbahnhof' },
            departure: '2026-07-07T08:08:00+02:00',
            plannedDeparture: '2026-07-07T08:05:00+02:00',
            arrival: '2026-07-07T08:38:00+02:00',
            plannedArrival: '2026-07-07T08:35:00+02:00',
            departureDelay: 180,
            arrivalDelay: 180,
            departurePlatform: '7',
            line: { name: 'RE 1', mode: 'train' },
            direction: 'Aumuehle',
            remarks: [{ text: 'Verspätung wegen Bauarbeiten' }],
          },
        ],
      },
    ],
  }
}

describe('Regionfinder API', () => {
  it('returns current snapshot metadata', async () => {
    const app = await withApp()
    const response = await app.inject('/api/v1/snapshots/current')

    expect(response.statusCode).toBe(200)
    expect(response.headers.etag).toContain('fixture-synthetic')
    expect(response.json()).toMatchObject({
      publicId: 'fixture-synthetic-2026-07',
      qualityStatus: 'fixture_ready',
    })
  })

  it('searches stops without returning a full list by default', async () => {
    const app = await withApp()
    const response = await app.inject('/api/v1/stops/search?q=busdorf&states=DE-SH&modes=BUS')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      expect.objectContaining({
        publicId: 'de:01056:9100',
        name: 'Busdorf Mitte',
        identityQuality: 'missing_dhid',
      }),
    ])
  })

  it('returns null metric values as null instead of zero-minute placeholders', async () => {
    const app = await withApp()
    const response = await app.inject('/api/v1/stops/unknown/metrics?profile=regular_tue_thu')

    expect(response.statusCode).toBe(404)
  })

  it('returns itinerary details with total duration from requested departure', async () => {
    const app = await withApp()
    const response = await app.inject(
      '/api/v1/stops/de:01056:9001/itineraries?date=2026-07-07&time=08:00&profile=regular_tue_thu',
    )
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.alternatives[0]).toMatchObject({
      requestedDepartureAt: '2026-07-07T08:00:00+02:00',
      actualFirstDepartureAt: '2026-07-07T08:10:00+02:00',
      arrivalAt: '2026-07-07T08:40:00+02:00',
      totalDurationSeconds: 2400,
      initialWaitSeconds: 360,
    })
  })

  it('serves tile endpoints with cache headers', async () => {
    const app = await withApp()
    const response = await app.inject('/api/v1/tiles/stops/8/135/83.mvt')

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/vnd.mapbox-vector-tile')
    expect(response.headers['cache-control']).toContain('max-age=300')
  })

  it('serves rail-network debug tiles with cache headers', async () => {
    const app = await withApp()
    const response = await app.inject('/api/v1/tiles/rail-network/8/135/83.mvt')

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/vnd.mapbox-vector-tile')
    expect(response.headers.etag).toContain('rail-network-8-135-83')
  })

  it('validates invalid itinerary parameters', async () => {
    const app = await withApp()
    const response = await app.inject('/api/v1/stops/de:01056:9001/itineraries?date=07-07-2026&time=8')

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('returns realtime itineraries after mapping the stop via nearby locations', async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input))

      if (url.pathname === '/locations/nearby') {
        expect(url.searchParams.get('latitude')).toBe('53.529')
        return jsonResponse([
          {
            id: '8005555',
            name: 'Aumuehle Testbahnhof',
            distance: 80,
          },
        ])
      }

      expect(url.pathname).toBe('/journeys')
      expect(url.searchParams.get('from')).toBe('8002549')
      expect(url.searchParams.get('to')).toBe('8005555')
      expect(url.searchParams.get('departure')).toBe('2026-07-07T08:00:00+02:00')
      expect(url.searchParams.get('routingMode')).toBe('REALTIME')
      return jsonResponse(journeyPayload())
    }) as typeof fetch
    const app = await withApp(fetchImpl)
    const response = await app.inject(
      '/api/v1/stops/de:01056:9001/realtime-itineraries?date=2026-07-07&time=08:00&profile=regular_tue_thu',
    )
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.alternatives[0]).toMatchObject({
      provider: 'db-transport-rest',
      actualFirstDepartureAt: '2026-07-07T08:08:00+02:00',
      arrivalAt: '2026-07-07T08:38:00+02:00',
      refreshToken: 'refresh-1',
      realtimeSource: 'v6.db.transport.rest',
    })
    expect(body.alternatives[0].legs[0]).toMatchObject({
      routeName: 'RE 1',
      platformFrom: '7',
      departureDelaySeconds: 180,
      remarks: ['Verspätung wegen Bauarbeiten'],
    })
  })

  it('returns db_stop_unmapped when no DB stop candidate matches', async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input))

      if (url.pathname === '/locations/nearby' || url.pathname === '/locations') {
        return jsonResponse([])
      }

      throw new Error(`Unexpected upstream call ${url.pathname}`)
    }) as typeof fetch
    const app = await withApp(fetchImpl)
    const response = await app.inject(
      '/api/v1/stops/de:01056:9100/realtime-itineraries?date=2026-07-07&time=08:00&profile=regular_tue_thu',
    )

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'db_stop_unmapped' })
  })

  it('maps upstream failures to realtime_unavailable', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'upstream' }, 503)) as typeof fetch
    const app = await withApp(fetchImpl)
    const response = await app.inject(
      '/api/v1/stops/de:02000:8002550/realtime-itineraries?date=2026-07-07&time=08:00&profile=regular_tue_thu',
    )

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({ error: 'realtime_unavailable' })
  })

  it('caches realtime journeys for the same origin, destination, and minute', async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input))

      if (url.pathname === '/locations/nearby') {
        return jsonResponse([{ id: '8005555', name: 'Aumuehle Testbahnhof', distance: 80 }])
      }

      return jsonResponse(journeyPayload())
    }) as typeof fetch
    const app = await withApp(fetchImpl)
    const path =
      '/api/v1/stops/de:01056:9001/realtime-itineraries?date=2026-07-07&time=08:00&profile=regular_tue_thu'

    expect((await app.inject(path)).statusCode).toBe(200)
    expect((await app.inject(path)).statusCode).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
