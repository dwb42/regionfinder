import { z } from 'zod'
import type { ApiDrivingRouteResponse } from '../../src/api/contracts'
import { DrivingRouteProviderError, type DrivingRouteProvider, type DrivingRouteRequest } from './types'

type GoogleRoutesOptions = {
  apiKey?: string
  originName?: string
  originLat?: number
  originLon?: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxRequestsPerMinute?: number
  now?: () => number
}

const routeSchema = z.object({
  duration: z.string().regex(/^\d+(?:\.\d{1,9})?s$/),
  distanceMeters: z.number().int().nonnegative().optional(),
})
const responseSchema = z.object({
  routes: z.array(routeSchema).optional(),
  fallbackInfo: z.object({ routingMode: z.string() }).optional(),
}).strict()
const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes'

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`)
  return value
}

export class GoogleRoutesDrivingRouteProvider implements DrivingRouteProvider {
  private readonly apiKey: string
  private readonly originName: string
  private readonly originLat: number
  private readonly originLon: number
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxRequestsPerMinute: number
  private readonly now: () => number
  private readonly pending = new Map<string, Promise<ApiDrivingRouteResponse>>()
  private requestTimes: number[] = []

  constructor(options: GoogleRoutesOptions = {}) {
    this.apiKey = (options.apiKey ?? process.env.REGIONFINDER_GOOGLE_ROUTES_API_KEY ?? '').trim()
    this.originName = options.originName ?? process.env.REGIONFINDER_DRIVING_ORIGIN_NAME ?? 'Hamburg Hbf'
    this.originLat = options.originLat ?? Number(process.env.REGIONFINDER_DRIVING_ORIGIN_LAT ?? 53.5527)
    this.originLon = options.originLon ?? Number(process.env.REGIONFINDER_DRIVING_ORIGIN_LON ?? 10.0064)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 10_000, 'Google Routes timeout')
    this.maxRequestsPerMinute = positiveInteger(
      options.maxRequestsPerMinute ?? Number(process.env.REGIONFINDER_GOOGLE_ROUTES_MAX_REQUESTS_PER_MINUTE ?? 60),
      'Google Routes request limit',
    )
    this.now = options.now ?? Date.now
    if (!Number.isFinite(this.originLat) || Math.abs(this.originLat) > 90 ||
        !Number.isFinite(this.originLon) || Math.abs(this.originLon) > 180) {
      throw new Error('Invalid driving origin coordinates')
    }
  }

  async routeToStop({ stop }: DrivingRouteRequest): Promise<ApiDrivingRouteResponse> {
    if (!this.apiKey) {
      throw new DrivingRouteProviderError(503, 'driving_route_unavailable', 'Google Routes is not configured')
    }

    const key = `${stop.publicId}:${stop.coordinate.lat},${stop.coordinate.lon}`
    const pending = this.pending.get(key)
    if (pending) return pending

    // Coalesce concurrent requests only. Do not cache Google's route content.
    const request = this.computeRoute(stop)
    this.pending.set(key, request)
    try {
      return await request
    } finally {
      this.pending.delete(key)
    }
  }

  private async computeRoute(stop: DrivingRouteRequest['stop']): Promise<ApiDrivingRouteResponse> {
    const now = this.now()
    this.requestTimes = this.requestTimes.filter((time) => time > now - 60_000)
    if (this.requestTimes.length >= this.maxRequestsPerMinute) {
      throw new DrivingRouteProviderError(429, 'driving_route_rate_limited', 'Driving request limit reached')
    }
    this.requestTimes.push(now)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,fallbackInfo',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: this.originLat, longitude: this.originLon } } },
          destination: { location: { latLng: { latitude: stop.coordinate.lat, longitude: stop.coordinate.lon } } },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
          trafficModel: 'BEST_GUESS',
          computeAlternativeRoutes: false,
          languageCode: 'de-DE',
          units: 'METRIC',
          // Omitting departureTime means "now" at Google, avoiding clock skew.
        }),
      })

      if (!response.ok) {
        // Never relay upstream bodies or request headers: they can contain credentials.
        throw new DrivingRouteProviderError(502, 'driving_route_unavailable', `Google Routes upstream returned ${response.status}`)
      }
      const parsed = responseSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('Invalid route response')
      if (parsed.data.fallbackInfo && parsed.data.fallbackInfo.routingMode !== 'TRAFFIC_AWARE') {
        throw new Error('Traffic-aware routing is unavailable')
      }
      const route = parsed.data.routes?.[0]
      if (!route) {
        throw new DrivingRouteProviderError(404, 'driving_route_no_route', 'No driving route found')
      }
      const durationSeconds = Number(route.duration.slice(0, -1))
      // Protobuf JSON can omit a zero-valued distance for identical waypoints.
      const distanceMeters = route.distanceMeters ?? (durationSeconds === 0 ? 0 : NaN)
      if (!Number.isFinite(durationSeconds) || !Number.isFinite(distanceMeters)) {
        throw new Error('Invalid route response')
      }
      return {
        originName: this.originName,
        destinationPublicId: stop.publicId,
        provider: 'google-routes',
        trafficAware: true,
        durationSeconds,
        distanceMeters,
        sourceAttribution: 'Google Maps',
        fetchedAt: new Date(this.now()).toISOString(),
      }
    } catch (error) {
      if (error instanceof DrivingRouteProviderError) throw error
      throw new DrivingRouteProviderError(502, 'driving_route_unavailable', 'Google Routes is currently unavailable')
    } finally {
      clearTimeout(timeout)
    }
  }
}
