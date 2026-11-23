import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app'
import { FixtureRepository } from '../db/fixtureRepository'
import { createDrivingRouteProvider } from './createDrivingRouteProvider'
import { GoogleRoutesDrivingRouteProvider } from './googleRoutesDrivingRouteProvider'
import { OsrmDrivingRouteProvider } from './osrmDrivingRouteProvider'

const apiKey = 'test-server-secret'
const timestamp = Date.parse('2026-11-23T08:00:00Z')
const result = { routes: [{ duration: '1620.5s', distanceMeters: 11100 }] }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
async function request() {
  const stop = await new FixtureRepository().stopDetails('de:01056:9001')
  if (!stop) throw new Error('Missing fixture')
  return { stop }
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Google Routes driving provider', () => {
  it('requests traffic-aware driving to the exact station and sends the key only in a header', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('X-Goog-Api-Key')).toBe(apiKey)
      expect(new Headers(init?.headers).get('X-Goog-FieldMask')).toBe('routes.duration,routes.distanceMeters,fallbackInfo')
      expect(JSON.parse(String(init?.body))).toEqual({
        origin: { location: { latLng: { latitude: 53.5527, longitude: 10.0064 } } },
        destination: { location: { latLng: { latitude: 53.529, longitude: 10.314 } } },
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE_OPTIMAL', trafficModel: 'BEST_GUESS',
        computeAlternativeRoutes: false, languageCode: 'de-DE', units: 'METRIC',
      })
      return json(result)
    })
    const provider = new GoogleRoutesDrivingRouteProvider({ apiKey, fetchImpl, now: () => timestamp })
    const response = await provider.routeToStop(await request())
    expect(response).toEqual({
      originName: 'Hamburg Hbf', destinationPublicId: 'de:01056:9001', provider: 'google-routes',
      trafficAware: true, durationSeconds: 1620.5, distanceMeters: 11100,
      sourceAttribution: 'Google Maps', fetchedAt: '2026-11-23T08:00:00.000Z',
    })
    expect(JSON.stringify(response)).not.toContain(apiKey)
  })

  it.each([{}, { routes: [] }])('reports no route for %j', async (body) => {
    const provider = new GoogleRoutesDrivingRouteProvider({ apiKey, fetchImpl: async () => json(body) })
    await expect(provider.routeToStop(await request())).rejects.toMatchObject({ statusCode: 404, reason: 'driving_route_no_route' })
  })

  it.each([
    { routes: [{ duration: 'invalid', distanceMeters: 10 }] },
    { routes: [{ duration: '10s', distanceMeters: -1 }] },
    { routes: [{ duration: '10s' }] },
    { error: { message: apiKey } },
    { ...result, fallbackInfo: { routingMode: 'TRAFFIC_UNAWARE' } },
    null,
  ])('rejects invalid or traffic-unaware responses without exposing their content: %j', async (body) => {
    const provider = new GoogleRoutesDrivingRouteProvider({ apiKey, fetchImpl: async () => json(body) })
    await expect(provider.routeToStop(await request())).rejects.toMatchObject({
      statusCode: 502, reason: 'driving_route_unavailable', message: 'Google Routes is currently unavailable',
    })
  })

  it.each([403, 429, 500])('handles upstream HTTP %s without leaking its body', async (status) => {
    const provider = new GoogleRoutesDrivingRouteProvider({ apiKey, fetchImpl: async () => json({ error: apiKey }, status) })
    await expect(provider.routeToStop(await request())).rejects.toMatchObject({
      statusCode: 502, reason: 'driving_route_unavailable', message: `Google Routes upstream returned ${status}`,
    })
  })

  it('aborts a stalled request and permits a later retry', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error(apiKey)), { once: true })
    })).mockResolvedValueOnce(json(result))
    const provider = new GoogleRoutesDrivingRouteProvider({ apiKey, fetchImpl, timeoutMs: 5 })
    const input = await request()
    await expect(provider.routeToStop(input)).rejects.toMatchObject({ message: 'Google Routes is currently unavailable' })
    await expect(provider.routeToStop(input)).resolves.toMatchObject({ provider: 'google-routes' })
  })

  it('shares only in-flight requests and fetches fresh traffic on the next visit', async () => {
    let complete!: (response: Response) => void
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
      .mockImplementation(async () => json(result))
    const provider = new GoogleRoutesDrivingRouteProvider({ apiKey, fetchImpl })
    const input = await request()
    const first = provider.routeToStop(input)
    const second = provider.routeToStop(input)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    complete(json(result))
    expect(await first).toEqual(await second)
    await provider.routeToStop(input)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('limits paid requests and resets the allowance after a minute', async () => {
    let now = timestamp
    const fetchImpl = vi.fn<typeof fetch>(async () => json(result))
    const provider = new GoogleRoutesDrivingRouteProvider({ apiKey, fetchImpl, maxRequestsPerMinute: 1, now: () => now })
    const input = await request()
    await provider.routeToStop(input)
    await expect(provider.routeToStop(input)).rejects.toMatchObject({ statusCode: 429, reason: 'driving_route_rate_limited' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    now += 60_000
    await provider.routeToStop(input)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not fall back to OSRM if the Google key is missing', async () => {
    vi.stubEnv('REGIONFINDER_GOOGLE_ROUTES_API_KEY', '')
    vi.stubEnv('REGIONFINDER_DRIVING_PROVIDER', 'google-routes')
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    await expect(createDrivingRouteProvider().routeToStop(await request())).rejects.toMatchObject({ statusCode: 503 })
    expect(fetchImpl).not.toHaveBeenCalled()
    vi.stubEnv('REGIONFINDER_DRIVING_PROVIDER', 'osrm')
    expect(createDrivingRouteProvider()).toBeInstanceOf(OsrmDrivingRouteProvider)
  })

  it('wires Google into the API and disables downstream response caching', async () => {
    vi.stubEnv('REGIONFINDER_DRIVING_PROVIDER', 'google-routes')
    vi.stubEnv('REGIONFINDER_GOOGLE_ROUTES_API_KEY', apiKey)
    vi.stubGlobal('fetch', vi.fn(async () => json(result)))
    const app = await buildApp({ repository: new FixtureRepository(), logger: false })
    try {
      const response = await app.inject('/api/v1/stops/de:01056:9001/driving-route')
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toMatchObject({ provider: 'google-routes', durationSeconds: 1620.5, trafficAware: true })
      expect(response.body).not.toContain(apiKey)
    } finally { await app.close() }
  })
})
