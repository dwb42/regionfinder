import { describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app'
import { FixtureRepository } from '../db/fixtureRepository'
import { OsrmDrivingRouteProvider } from '../driving/osrmDrivingRouteProvider'
import { DbTransportRestProvider } from '../realtime/dbTransportRestProvider'

async function withApp(
  fetchImpl?: typeof fetch,
  backend: 'bahn-web' | 'db-transport-rest' = 'db-transport-rest',
  drivingFetchImpl?: typeof fetch,
) {
  const app = await buildApp({
    repository: new FixtureRepository(),
    logger: false,
    realtimeItineraryProvider: fetchImpl
      ? new DbTransportRestProvider({
          baseUrl: 'https://db.test',
          fetchImpl,
          backend,
          now: () => Date.parse('2026-07-07T07:59:00.000Z'),
        })
      : undefined,
    drivingRouteProvider: drivingFetchImpl
      ? new OsrmDrivingRouteProvider({
          baseUrl: 'https://osrm.test',
          fetchImpl: drivingFetchImpl,
          now: () => Date.parse('2026-07-07T07:59:00.000Z'),
          timeoutMs: 1_000,
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

  it('returns scheduled direct connection counts for a service date', async () => {
    const app = await withApp()
    const response = await app.inject('/api/v1/stops/de:01056:9001/metrics?profile=regular_tue_thu&date=2026-07-07')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      directConnectionCount: 18,
    })
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

  it('serves route tiles with profile-specific cache keys', async () => {
    const app = await withApp()
    const response = await app.inject('/api/v1/tiles/routes/8/135/83.mvt?modes=RE,S&profile=test_profile')

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/vnd.mapbox-vector-tile')
    expect(response.headers.etag).toContain('routes-8-135-83-RE-S-test_profile')
  })

  it('serves rail-network debug tiles with cache headers', async () => {
    const app = await withApp()
    const response = await app.inject('/api/v1/tiles/rail-network/8/135/83.mvt')

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/vnd.mapbox-vector-tile')
    expect(response.headers.etag).toContain('rail-network-8-135-83')
  })

  it('serves school POI tiles with category and state cache keys', async () => {
    class CapturingSchoolRepository extends FixtureRepository {
      schoolTileCall: { z: number; x: number; y: number; categories: string[]; states: string[] } | null = null

      override async schoolTile(
        z: number,
        x: number,
        y: number,
        categories: string[] = [],
        states: string[] = [],
      ): Promise<Buffer | null> {
        this.schoolTileCall = { z, x, y, categories, states }
        return Buffer.from('fixture-school-tile')
      }
    }

    const repository = new CapturingSchoolRepository()
    const app = await buildApp({ repository, logger: false })
    const response = await app.inject(
      '/api/v1/tiles/schools/8/135/83.mvt?categories=gymnasium,comprehensive&states=HH,SH',
    )

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/vnd.mapbox-vector-tile')
    expect(response.headers.etag).toContain('schools-8-135-83-gymnasium-comprehensive-HH-SH')
    expect(response.body).toBe('fixture-school-tile')
    expect(repository.schoolTileCall).toEqual({
      z: 8,
      x: 135,
      y: 83,
      categories: ['gymnasium', 'comprehensive'],
      states: ['HH', 'SH'],
    })
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

  it('uses full bahn.de location references for bus stop and address destinations', async () => {
    const destinationReference = 'A=2@O=Busdorf Mitte@X=10314000@Y=53529000@U=91@b=981412821@p=1706613073@'
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input))

      if (url.pathname === '/locations/nearby' || url.pathname === '/locations') {
        return jsonResponse([])
      }

      if (url.pathname === '/web/api/reiseloesung/orte') {
        return jsonResponse([
          {
            id: destinationReference,
            lat: 53.529,
            lon: 10.314,
            name: 'Busdorf Mitte',
            products: [],
            type: 'ADR',
          },
        ])
      }

      expect(url.pathname).toBe('/web/api/angebote/fahrplan')
      const body = JSON.parse(String(init?.body))
      expect(body.ankunftsHalt).toBe(destinationReference)
      return jsonResponse({
        verbindungen: [
          {
            verbindungsAbschnitte: [
              {
                startHalt: { name: 'Hamburg Hbf', abfahrt: { sollzeit: '2026-07-07T08:00:00' } },
                zielHalt: { name: 'Busdorf Mitte', ankunft: { sollzeit: '2026-07-07T08:45:00' } },
                abschnittsDauer: 2700,
                verkehrsmittel: { produktGattung: 'BUS', kategorie: 'Bus', name: '120', richtung: 'Busdorf' },
              },
            ],
          },
        ],
      })
    }) as typeof fetch
    const app = await withApp(fetchImpl, 'bahn-web')
    const response = await app.inject(
      '/api/v1/stops/de:01056:9100/realtime-itineraries?date=2026-07-07&time=08:00&profile=regular_tue_thu',
    )

    expect(response.statusCode).toBe(200)
    expect(response.json().alternatives[0]).toMatchObject({
      provider: 'bahn-web',
      actualFirstDepartureAt: '2026-07-07T08:00:00+02:00',
      arrivalAt: '2026-07-07T08:45:00+02:00',
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

  it('returns driving route duration and distance from OSRM', async () => {
    const drivingFetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input))

      expect(url.pathname).toBe('/route/v1/driving/10.0064,53.5527;10.314,53.529')
      expect(url.searchParams.get('overview')).toBe('false')
      expect(init?.headers).toMatchObject({ Accept: 'application/json' })
      return jsonResponse({
        code: 'Ok',
        routes: [{ duration: 1850.2, distance: 28640.7 }],
      })
    }) as typeof fetch
    const app = await withApp(undefined, 'db-transport-rest', drivingFetchImpl)
    const response = await app.inject('/api/v1/stops/de:01056:9001/driving-route')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      originName: 'Hamburg Hbf',
      destinationPublicId: 'de:01056:9001',
      provider: 'osrm',
      durationSeconds: 1850.2,
      distanceMeters: 28640.7,
      sourceAttribution: expect.stringContaining('OpenStreetMap'),
      fetchedAt: '2026-07-07T07:59:00.000Z',
    })
  })

  it('maps OSRM NoRoute to driving_route_no_route', async () => {
    const drivingFetchImpl = vi.fn(async () => jsonResponse({ code: 'NoRoute', routes: [] })) as typeof fetch
    const app = await withApp(undefined, 'db-transport-rest', drivingFetchImpl)
    const response = await app.inject('/api/v1/stops/de:01056:9001/driving-route')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'driving_route_no_route' })
  })

  it('maps OSRM upstream failures to driving_route_unavailable', async () => {
    const drivingFetchImpl = vi.fn(async () => jsonResponse({ code: 'TooManyRequests' }, 429)) as typeof fetch
    const app = await withApp(undefined, 'db-transport-rest', drivingFetchImpl)
    const response = await app.inject('/api/v1/stops/de:01056:9001/driving-route')

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({ error: 'driving_route_unavailable' })
  })

  it('maps OSRM timeouts to driving_route_unavailable', async () => {
    const drivingFetchImpl = vi.fn(
      (_input: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    ) as typeof fetch
    const app = await buildApp({
      repository: new FixtureRepository(),
      logger: false,
      drivingRouteProvider: new OsrmDrivingRouteProvider({
        baseUrl: 'https://osrm.test',
        fetchImpl: drivingFetchImpl,
        timeoutMs: 1,
      }),
    })
    const response = await app.inject('/api/v1/stops/de:01056:9001/driving-route')

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({ error: 'driving_route_unavailable' })
  })

  it('caches driving routes for the same stop', async () => {
    const drivingFetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 'Ok',
        routes: [{ duration: 1800, distance: 28_000 }],
      }),
    ) as typeof fetch
    const app = await withApp(undefined, 'db-transport-rest', drivingFetchImpl)
    const path = '/api/v1/stops/de:01056:9001/driving-route'

    expect((await app.inject(path)).statusCode).toBe(200)
    expect((await app.inject(path)).statusCode).toBe(200)
    expect(drivingFetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns not_found before calling OSRM for an unknown driving destination', async () => {
    const drivingFetchImpl = vi.fn(async () => jsonResponse({ code: 'Ok', routes: [] })) as typeof fetch
    const app = await withApp(undefined, 'db-transport-rest', drivingFetchImpl)
    const response = await app.inject('/api/v1/stops/unknown/driving-route')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
    expect(drivingFetchImpl).not.toHaveBeenCalled()
  })
})
