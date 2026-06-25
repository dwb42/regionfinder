import type { ApiItineraryResponse, ApiStopDetails } from '../../src/api/contracts'
import { bahnWebLocationSearchUrl, fetchBahnWebJourneys, fetchBahnWebJson } from './bahnWebClient'
import { ExpiringCache } from './cache'
import { mapBahnWebJourneyToApiItinerary, mapDbJourneyToApiItinerary } from './journeyMapping'
import { chooseBestLocationId, directDbStopIdCandidates } from './locationMapping'
import { fetchTransportRestJson } from './transportRestClient'
import { RealtimeProviderError, type DbJourneyPayload, type RealtimeItineraryProvider, type RealtimeItineraryRequest } from './types'

export type { RealtimeItineraryProvider, RealtimeItineraryRequest } from './types'
export { RealtimeProviderError } from './types'
export { mapBahnWebJourneyToApiItinerary, mapDbJourneyToApiItinerary } from './journeyMapping'

type DbTransportRestProviderOptions = {
  baseUrl?: string
  originDbStopId?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  mappingTtlMs?: number
  journeyTtlMs?: number
  now?: () => number
  backend?: 'bahn-web' | 'db-transport-rest'
  enableCurlFallback?: boolean
}

const DEFAULT_BASE_URL = 'https://v6.db.transport.rest'
const DEFAULT_ORIGIN_DB_STOP_ID = '8002549'
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAPPING_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_JOURNEY_TTL_MS = 60 * 1000

export class DbTransportRestProvider implements RealtimeItineraryProvider {
  private readonly baseUrl: string
  private readonly originDbStopId: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly mappingTtlMs: number
  private readonly journeyTtlMs: number
  private readonly now: () => number
  private readonly backend: 'bahn-web' | 'db-transport-rest'
  private readonly enableCurlFallback: boolean
  private readonly stopMappingCache: ExpiringCache<string>
  private readonly journeyCache: ExpiringCache<ApiItineraryResponse>

  constructor(options: DbTransportRestProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.DB_TRANSPORT_REST_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.originDbStopId =
      options.originDbStopId ?? process.env.REGIONFINDER_ORIGIN_DB_STOP_ID ?? DEFAULT_ORIGIN_DB_STOP_ID
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.mappingTtlMs = options.mappingTtlMs ?? DEFAULT_MAPPING_TTL_MS
    this.journeyTtlMs = options.journeyTtlMs ?? DEFAULT_JOURNEY_TTL_MS
    this.now = options.now ?? Date.now
    this.backend =
      options.backend ??
      (process.env.REGIONFINDER_REALTIME_PROVIDER === 'db-transport-rest' ? 'db-transport-rest' : 'bahn-web')
    this.enableCurlFallback = options.enableCurlFallback ?? !options.fetchImpl
    this.stopMappingCache = new ExpiringCache(this.now)
    this.journeyCache = new ExpiringCache(this.now)
  }

  async plan(request: RealtimeItineraryRequest): Promise<ApiItineraryResponse> {
    const destinationDbStopId = await this.resolveDestinationStopId(request.stop)
    const requestedDeparture = `${request.date}T${request.time}:00+02:00`
    const journeyCacheKey = `${this.originDbStopId}:${destinationDbStopId}:${requestedDeparture.slice(0, 16)}`
    const cachedJourney = this.journeyCache.read(journeyCacheKey)

    if (cachedJourney) {
      return cachedJourney
    }

    const response =
      this.backend === 'db-transport-rest'
        ? await this.planViaTransportRest(request, destinationDbStopId, requestedDeparture)
        : await this.planViaBahnWeb(request, destinationDbStopId, requestedDeparture)

    this.journeyCache.write(journeyCacheKey, response, this.journeyTtlMs)
    return response
  }

  private async planViaTransportRest(
    request: RealtimeItineraryRequest,
    destinationDbStopId: string,
    requestedDeparture: string,
  ): Promise<ApiItineraryResponse> {
    const url = this.url('/journeys')
    url.searchParams.set('from', this.originDbStopId)
    url.searchParams.set('to', destinationDbStopId)
    url.searchParams.set('departure', requestedDeparture)
    url.searchParams.set('results', '3')
    url.searchParams.set('remarks', 'true')
    url.searchParams.set('stopovers', 'false')
    url.searchParams.set('language', 'de')
    url.searchParams.set('profile', 'dbnav')
    url.searchParams.set('routingMode', 'REALTIME')

    const payload = await fetchTransportRestJson<DbJourneyPayload>(url, this.fetchImpl, this.timeoutMs)
    const alternatives = Array.isArray(payload.journeys)
      ? payload.journeys.slice(0, 3).map((journey, index) =>
          mapDbJourneyToApiItinerary(journey, {
            index,
            requestedDeparture,
            fetchedAt: new Date(this.now()).toISOString(),
          }),
        )
      : []

    return {
      snapshotId: request.snapshotId,
      requestedDeparture,
      originId: this.originDbStopId,
      destinationPublicId: request.stop.publicId,
      alternatives,
    }
  }

  private async planViaBahnWeb(
    request: RealtimeItineraryRequest,
    destinationDbStopId: string,
    requestedDeparture: string,
  ): Promise<ApiItineraryResponse> {
    const payload = await fetchBahnWebJourneys({
      originDbStopId: this.originDbStopId,
      destinationDbStopId,
      date: request.date,
      time: request.time,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      enableCurlFallback: this.enableCurlFallback,
    })
    const alternatives = Array.isArray(payload.verbindungen)
      ? payload.verbindungen
          .slice(0, 3)
          .map((journey, index) =>
            mapBahnWebJourneyToApiItinerary(journey, {
              index,
              requestedDeparture,
              fetchedAt: new Date(this.now()).toISOString(),
            }),
          )
      : []

    return {
      snapshotId: request.snapshotId,
      requestedDeparture,
      originId: this.originDbStopId,
      destinationPublicId: request.stop.publicId,
      alternatives,
    }
  }

  private async resolveDestinationStopId(stop: ApiStopDetails): Promise<string> {
    const cacheKey = stop.publicId
    const cached = this.stopMappingCache.read(cacheKey)

    if (cached) {
      return cached
    }

    const directCandidate = directDbStopIdCandidates(stop)[0]

    if (directCandidate) {
      this.stopMappingCache.write(cacheKey, directCandidate, this.mappingTtlMs)
      return directCandidate
    }

    const nearby = await this.tryResolveLocation(() => this.findNearbyStop(stop))
    if (nearby) {
      this.stopMappingCache.write(cacheKey, nearby, this.mappingTtlMs)
      return nearby
    }

    const byName = await this.tryResolveLocation(() => this.findStopByName(stop))
    if (byName) {
      this.stopMappingCache.write(cacheKey, byName, this.mappingTtlMs)
      return byName
    }

    if (this.backend === 'bahn-web') {
      const bahnWebLocation = await this.findBahnWebLocationByName(stop)
      if (bahnWebLocation) {
        this.stopMappingCache.write(cacheKey, bahnWebLocation, this.mappingTtlMs)
        return bahnWebLocation
      }
    }

    throw new RealtimeProviderError(404, 'db_stop_unmapped', `No DB stop mapping for ${stop.publicId}`)
  }

  private async tryResolveLocation(resolve: () => Promise<string | null>): Promise<string | null> {
    try {
      return await resolve()
    } catch (error) {
      if (this.backend === 'bahn-web' && error instanceof RealtimeProviderError) {
        return null
      }

      throw error
    }
  }

  private async findNearbyStop(stop: ApiStopDetails): Promise<string | null> {
    const url = this.url('/locations/nearby')
    url.searchParams.set('latitude', String(stop.coordinate.lat))
    url.searchParams.set('longitude', String(stop.coordinate.lon))
    url.searchParams.set('results', '5')
    url.searchParams.set('distance', '1000')
    url.searchParams.set('stops', 'true')
    url.searchParams.set('language', 'de')
    url.searchParams.set('profile', 'dbnav')

    const payload = await fetchTransportRestJson<unknown>(url, this.fetchImpl, this.timeoutMs)
    const candidates = Array.isArray(payload) ? payload : []
    return chooseBestLocationId(stop, candidates)
  }

  private async findStopByName(stop: ApiStopDetails): Promise<string | null> {
    const url = this.url('/locations')
    url.searchParams.set('query', stop.name)
    url.searchParams.set('results', '5')
    url.searchParams.set('stops', 'true')
    url.searchParams.set('addresses', 'false')
    url.searchParams.set('poi', 'false')
    url.searchParams.set('language', 'de')
    url.searchParams.set('profile', 'dbnav')

    const payload = await fetchTransportRestJson<unknown>(url, this.fetchImpl, this.timeoutMs)
    const candidates = Array.isArray(payload) ? payload : []
    return chooseBestLocationId(stop, candidates)
  }

  private async findBahnWebLocationByName(stop: ApiStopDetails): Promise<string | null> {
    const payload = await fetchBahnWebJson<unknown>({
      url: bahnWebLocationSearchUrl(stop.name),
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      enableCurlFallback: this.enableCurlFallback,
    })
    const candidates = Array.isArray(payload) ? payload : []
    return chooseBestLocationId(stop, candidates)
  }

  private url(path: string): URL {
    return new URL(path, this.baseUrl)
  }
}
