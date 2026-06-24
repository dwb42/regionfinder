import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { FixtureRepository } from '../db/fixtureRepository'

async function withApp() {
  const app = await buildApp({ repository: new FixtureRepository() })

  return app
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

  it('validates invalid itinerary parameters', async () => {
    const app = await withApp()
    const response = await app.inject('/api/v1/stops/de:01056:9001/itineraries?date=07-07-2026&time=8')

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })
})
