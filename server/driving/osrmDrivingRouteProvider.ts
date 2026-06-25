import type { ApiDrivingRouteResponse } from '../../src/api/contracts'
import { ExpiringCache } from '../realtime/cache'
import { DrivingRouteProviderError, type DrivingRouteProvider, type DrivingRouteRequest } from './types'

type OsrmDrivingRouteProviderOptions = {
  baseUrl?: string
  originName?: string
  originLat?: number
  originLon?: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
  cacheTtlMs?: number
  now?: () => number
  userAgent?: string
}

type OsrmRoutePayload = {
  code?: string
  message?: string
  routes?: Array<{
    duration?: unknown
    distance?: unknown
  }>
}

const DEFAULT_BASE_URL = 'https://router.project-osrm.org'
const DEFAULT_ORIGIN_NAME = 'Hamburg Hbf'
const DEFAULT_ORIGIN_LAT = 53.5527
const DEFAULT_ORIGIN_LON = 10.0064
const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_USER_AGENT = 'regionfinder/0.0.0 server-side driving estimate'
const SOURCE_ATTRIBUTION = 'Route: OSRM; Kartendaten: OpenStreetMap-Mitwirkende'

export class OsrmDrivingRouteProvider implements DrivingRouteProvider {
  private readonly baseUrl: string
  private readonly originName: string
  private readonly originLat: number
  private readonly originLon: number
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly cacheTtlMs: number
  private readonly now: () => number
  private readonly userAgent: string
  private readonly cache: ExpiringCache<ApiDrivingRouteResponse>

  constructor(options: OsrmDrivingRouteProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.REGIONFINDER_OSRM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.originName = options.originName ?? process.env.REGIONFINDER_DRIVING_ORIGIN_NAME ?? DEFAULT_ORIGIN_NAME
    this.originLat =
      options.originLat ?? Number(process.env.REGIONFINDER_DRIVING_ORIGIN_LAT ?? DEFAULT_ORIGIN_LAT)
    this.originLon =
      options.originLon ?? Number(process.env.REGIONFINDER_DRIVING_ORIGIN_LON ?? DEFAULT_ORIGIN_LON)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.now = options.now ?? Date.now
    this.userAgent = options.userAgent ?? process.env.REGIONFINDER_HTTP_USER_AGENT ?? DEFAULT_USER_AGENT
    this.cache = new ExpiringCache(this.now)
  }

  async routeToStop(request: DrivingRouteRequest): Promise<ApiDrivingRouteResponse> {
    const { stop } = request
    const cacheKey = `${stop.publicId}:${stop.coordinate.lat.toFixed(6)},${stop.coordinate.lon.toFixed(6)}`
    const cached = this.cache.read(cacheKey)

    if (cached) {
      return cached
    }

    const url = this.url(stop.coordinate.lon, stop.coordinate.lat)
    const payload = await this.fetchOsrm(url)

    if (payload.code === 'NoRoute') {
      throw new DrivingRouteProviderError(404, 'driving_route_no_route', `No driving route for ${stop.publicId}`)
    }

    if (payload.code !== 'Ok') {
      throw new DrivingRouteProviderError(
        502,
        'driving_route_unavailable',
        payload.message ?? `OSRM returned ${payload.code ?? 'an invalid response'}`,
      )
    }

    const route = payload.routes?.[0]
    const durationSeconds = typeof route?.duration === 'number' ? route.duration : null
    const distanceMeters = typeof route?.distance === 'number' ? route.distance : null

    if (durationSeconds === null || distanceMeters === null) {
      throw new DrivingRouteProviderError(404, 'driving_route_no_route', `No driving route for ${stop.publicId}`)
    }

    const response: ApiDrivingRouteResponse = {
      originName: this.originName,
      destinationPublicId: stop.publicId,
      provider: 'osrm',
      durationSeconds,
      distanceMeters,
      sourceAttribution: SOURCE_ATTRIBUTION,
      fetchedAt: new Date(this.now()).toISOString(),
    }

    this.cache.write(cacheKey, response, this.cacheTtlMs)
    return response
  }

  private async fetchOsrm(url: URL): Promise<OsrmRoutePayload> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
      })

      if (!response.ok) {
        throw new DrivingRouteProviderError(
          502,
          'driving_route_unavailable',
          `OSRM upstream returned ${response.status}`,
        )
      }

      return (await response.json()) as OsrmRoutePayload
    } catch (error) {
      if (error instanceof DrivingRouteProviderError) {
        throw error
      }

      throw new DrivingRouteProviderError(
        502,
        'driving_route_unavailable',
        error instanceof Error ? error.message : 'OSRM upstream is unavailable',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private url(destinationLon: number, destinationLat: number): URL {
    const coordinates = `${this.originLon},${this.originLat};${destinationLon},${destinationLat}`
    const url = new URL(`/route/v1/driving/${coordinates}`, this.baseUrl)
    url.searchParams.set('overview', 'false')
    url.searchParams.set('alternatives', 'false')
    url.searchParams.set('steps', 'false')
    return url
  }
}
