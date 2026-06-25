import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ApiItinerary, ApiItineraryLeg, ApiItineraryResponse, ApiStopDetails } from '../../src/api/contracts'

export type RealtimeItineraryRequest = {
  stop: ApiStopDetails
  date: string
  time: string
  profile: string
  snapshotId: string
}

export type RealtimeItineraryProvider = {
  plan(request: RealtimeItineraryRequest): Promise<ApiItineraryResponse>
}

export class RealtimeProviderError extends Error {
  readonly statusCode: number
  readonly reason: string

  constructor(statusCode: number, reason: string, message: string) {
    super(message)
    this.name = 'RealtimeProviderError'
    this.statusCode = statusCode
    this.reason = reason
  }
}

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

type CacheEntry<T> = {
  expiresAt: number
  value: T
}

type DbLocation = {
  id?: unknown
  extId?: unknown
  name?: unknown
  distance?: unknown
  lat?: unknown
  lon?: unknown
  type?: unknown
  location?: {
    latitude?: unknown
    longitude?: unknown
  }
}

type DbJourneyPayload = {
  journeys?: unknown
}

type BahnWebJourneyPayload = {
  verbindungen?: unknown
}

const DEFAULT_BASE_URL = 'https://v6.db.transport.rest'
const DEFAULT_ORIGIN_DB_STOP_ID = '8002549'
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAPPING_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_JOURNEY_TTL_MS = 60 * 1000
const BAHN_WEB_BASE_URL = 'https://www.bahn.de'
const BAHN_WEB_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const execFile = promisify(execFileCallback)

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
  private readonly stopMappingCache = new Map<string, CacheEntry<string>>()
  private readonly journeyCache = new Map<string, CacheEntry<ApiItineraryResponse>>()

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
  }

  async plan(request: RealtimeItineraryRequest): Promise<ApiItineraryResponse> {
    const destinationDbStopId = await this.resolveDestinationStopId(request.stop)
    const requestedDeparture = `${request.date}T${request.time}:00+02:00`
    const journeyCacheKey = `${this.originDbStopId}:${destinationDbStopId}:${requestedDeparture.slice(0, 16)}`
    const cachedJourney = this.readCache(this.journeyCache, journeyCacheKey)

    if (cachedJourney) {
      return cachedJourney
    }

    const response =
      this.backend === 'db-transport-rest'
        ? await this.planViaTransportRest(request, destinationDbStopId, requestedDeparture)
        : await this.planViaBahnWeb(request, destinationDbStopId, requestedDeparture)

    this.writeCache(this.journeyCache, journeyCacheKey, response, this.journeyTtlMs)
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

    const payload = await this.fetchJson<DbJourneyPayload>(url)
    const alternatives = Array.isArray(payload.journeys)
      ? payload.journeys.slice(0, 3).map((journey, index) =>
          mapDbJourneyToApiItinerary(journey, {
            index,
            requestedDeparture,
            fetchedAt: new Date(this.now()).toISOString(),
          }),
        )
      : []
    const response: ApiItineraryResponse = {
      snapshotId: request.snapshotId,
      requestedDeparture,
      originId: this.originDbStopId,
      destinationPublicId: request.stop.publicId,
      alternatives,
    }

    return response
  }

  private async planViaBahnWeb(
    request: RealtimeItineraryRequest,
    destinationDbStopId: string,
    requestedDeparture: string,
  ): Promise<ApiItineraryResponse> {
    const payload = await this.fetchBahnWebJourneys(destinationDbStopId, request.date, request.time)
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
    const cached = this.readCache(this.stopMappingCache, cacheKey)

    if (cached) {
      return cached
    }

    const directCandidate = directDbStopIdCandidates(stop)[0]

    if (directCandidate) {
      this.writeCache(this.stopMappingCache, cacheKey, directCandidate, this.mappingTtlMs)
      return directCandidate
    }

    const nearby = await this.tryResolveLocation(() => this.findNearbyStop(stop))
    if (nearby) {
      this.writeCache(this.stopMappingCache, cacheKey, nearby, this.mappingTtlMs)
      return nearby
    }

    const byName = await this.tryResolveLocation(() => this.findStopByName(stop))
    if (byName) {
      this.writeCache(this.stopMappingCache, cacheKey, byName, this.mappingTtlMs)
      return byName
    }

    if (this.backend === 'bahn-web') {
      const bahnWebLocation = await this.findBahnWebLocationByName(stop)
      if (bahnWebLocation) {
        this.writeCache(this.stopMappingCache, cacheKey, bahnWebLocation, this.mappingTtlMs)
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

    const payload = await this.fetchJson<unknown>(url)
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

    const payload = await this.fetchJson<unknown>(url)
    const candidates = Array.isArray(payload) ? payload : []
    return chooseBestLocationId(stop, candidates)
  }

  private async findBahnWebLocationByName(stop: ApiStopDetails): Promise<string | null> {
    const url = new URL('/web/api/reiseloesung/orte', BAHN_WEB_BASE_URL)
    url.searchParams.set('suchbegriff', stop.name)
    url.searchParams.set('typ', 'ALL')
    url.searchParams.set('limit', '8')

    const payload = await this.fetchBahnWebJson<unknown>(url)
    const candidates = Array.isArray(payload) ? payload : []
    return chooseBestLocationId(stop, candidates)
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(url, { signal: controller.signal })
      if (!response.ok) {
        throw new RealtimeProviderError(
          502,
          'realtime_unavailable',
          `DB realtime upstream returned ${response.status}`,
        )
      }

      return (await response.json()) as T
    } catch (error) {
      if (error instanceof RealtimeProviderError) {
        throw error
      }

      throw new RealtimeProviderError(
        502,
        'realtime_unavailable',
        error instanceof Error ? error.message : 'DB realtime upstream is unavailable',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fetchBahnWebJson<T>(url: URL): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(url, {
        headers: bahnWebHeaders(),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new RealtimeProviderError(502, 'realtime_unavailable', `Bahn web upstream returned ${response.status}`)
      }

      return (await response.json()) as T
    } catch (error) {
      if (this.enableCurlFallback) {
        return this.fetchBahnWebJsonWithCurl<T>(url)
      }

      if (error instanceof RealtimeProviderError) {
        throw error
      }

      throw new RealtimeProviderError(
        502,
        'realtime_unavailable',
        error instanceof Error ? error.message : 'Bahn web upstream is unavailable',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fetchBahnWebJsonWithCurl<T>(url: URL): Promise<T> {
    try {
      const { stdout } = await execFile(
        'curl',
        [
          '--compressed',
          '-sS',
          '-H',
          `accept: ${bahnWebHeaders().accept}`,
          '-H',
          `user-agent: ${BAHN_WEB_USER_AGENT}`,
          url.toString(),
        ],
        { timeout: this.timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      )

      return JSON.parse(stdout) as T
    } catch (error) {
      throw new RealtimeProviderError(
        502,
        'realtime_unavailable',
        error instanceof Error ? error.message : 'Bahn web curl fallback is unavailable',
      )
    }
  }

  private async fetchBahnWebJourneys(destinationDbStopId: string, date: string, time: string): Promise<BahnWebJourneyPayload> {
    const requestBody = bahnWebJourneyRequest(this.originDbStopId, destinationDbStopId, `${date}T${time}:00`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const warmupUrl = new URL('/web/api/reiseloesung/orte', BAHN_WEB_BASE_URL)
      warmupUrl.searchParams.set('suchbegriff', 'Hamburg Hbf')
      warmupUrl.searchParams.set('typ', 'ALL')
      warmupUrl.searchParams.set('limit', '1')
      const warmupResponse = await this.fetchImpl(warmupUrl, {
        headers: bahnWebHeaders(),
        signal: controller.signal,
      })
      if (!warmupResponse.ok) {
        throw new Error(`Bahn web warmup returned ${warmupResponse.status}`)
      }
      const cookie = responseCookies(warmupResponse)
      const response = await this.fetchImpl(new URL('/web/api/angebote/fahrplan', BAHN_WEB_BASE_URL), {
        method: 'POST',
        headers: {
          ...bahnWebHeaders(),
          'content-type': 'application/json',
          origin: BAHN_WEB_BASE_URL,
          referer: `${BAHN_WEB_BASE_URL}/`,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new RealtimeProviderError(502, 'realtime_unavailable', `Bahn web upstream returned ${response.status}`)
      }

      return (await response.json()) as BahnWebJourneyPayload
    } catch (error) {
      if (error instanceof RealtimeProviderError) {
        if (this.enableCurlFallback) {
          return this.fetchBahnWebJourneysWithCurl(requestBody)
        }

        throw error
      }

      if (this.enableCurlFallback) {
        return this.fetchBahnWebJourneysWithCurl(requestBody)
      }

      throw new RealtimeProviderError(
        502,
        'realtime_unavailable',
        error instanceof Error ? error.message : 'Bahn web upstream is unavailable',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fetchBahnWebJourneysWithCurl(requestBody: ReturnType<typeof bahnWebJourneyRequest>): Promise<BahnWebJourneyPayload> {
    const directory = await mkdtemp(join(tmpdir(), 'regionfinder-bahn-web-'))
    const cookieJar = join(directory, 'cookies.txt')

    try {
      await execFile(
        'curl',
        [
          '-sS',
          '-c',
          cookieJar,
          '-H',
          `accept: ${bahnWebHeaders().accept}`,
          '-H',
          `user-agent: ${BAHN_WEB_USER_AGENT}`,
          `${BAHN_WEB_BASE_URL}/web/api/reiseloesung/orte?suchbegriff=Hamburg%20Hbf&typ=ALL&limit=1`,
        ],
        { timeout: this.timeoutMs },
      )
      const { stdout } = await execFile(
        'curl',
        [
          '--compressed',
          '-sS',
          '-b',
          cookieJar,
          '-c',
          cookieJar,
          `${BAHN_WEB_BASE_URL}/web/api/angebote/fahrplan`,
          '-H',
          'accept: application/json',
          '-H',
          'content-type: application/json',
          '-H',
          `origin: ${BAHN_WEB_BASE_URL}`,
          '-H',
          `referer: ${BAHN_WEB_BASE_URL}/`,
          '-H',
          `user-agent: ${BAHN_WEB_USER_AGENT}`,
          '--data',
          JSON.stringify(requestBody),
        ],
        { timeout: this.timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      )

      return JSON.parse(stdout) as BahnWebJourneyPayload
    } catch (error) {
      throw new RealtimeProviderError(
        502,
        'realtime_unavailable',
        error instanceof Error ? error.message : 'Bahn web curl fallback is unavailable',
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  private url(path: string): URL {
    return new URL(path, this.baseUrl)
  }

  private readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = cache.get(key)

    if (!entry) {
      return null
    }

    if (entry.expiresAt <= this.now()) {
      cache.delete(key)
      return null
    }

    return entry.value
  }

  private writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
    cache.set(key, {
      expiresAt: this.now() + ttlMs,
      value,
    })
  }
}

export function mapDbJourneyToApiItinerary(
  journey: unknown,
  context: { index: number; requestedDeparture: string; fetchedAt: string },
): ApiItinerary {
  const record = objectRecord(journey)
  const rawLegs = Array.isArray(record.legs) ? record.legs : []
  const legs = rawLegs.map((leg, index) => mapDbLegToApiLeg(leg, index)).filter((leg) => leg !== null)
  const transitLegs = legs.filter((leg) => leg.legType === 'transit')
  const actualFirstDepartureAt = legs[0]?.departureAt ?? legs[0]?.plannedDepartureAt ?? null
  const arrivalAt = lastTime(legs, 'arrivalAt') ?? lastTime(legs, 'plannedArrivalAt')
  const requestedMs = Date.parse(context.requestedDeparture)
  const firstDepartureMs = actualFirstDepartureAt ? Date.parse(actualFirstDepartureAt) : null
  const arrivalMs = arrivalAt ? Date.parse(arrivalAt) : null
  const walkingSeconds = sumLegDurations(legs, 'walk')
  const inVehicleSeconds = sumLegDurations(legs, 'transit')

  return {
    rankType: context.index === 0 ? 'earliest_arrival' : 'fewest_transfers',
    provider: 'db-transport-rest',
    requestedDepartureAt: context.requestedDeparture,
    actualFirstDepartureAt,
    arrivalAt,
    totalDurationSeconds:
      arrivalMs === null || Number.isNaN(arrivalMs) || Number.isNaN(requestedMs)
        ? null
        : Math.max(0, Math.round((arrivalMs - requestedMs) / 1000)),
    initialWalkSeconds: legs[0]?.legType === 'walk' ? legs[0].durationSeconds : 0,
    initialWaitSeconds:
      firstDepartureMs === null || Number.isNaN(firstDepartureMs) || Number.isNaN(requestedMs)
        ? null
        : Math.max(0, Math.round((firstDepartureMs - requestedMs) / 1000)),
    inVehicleSeconds,
    transferWaitSeconds: null,
    walkingSeconds,
    walkingDistanceMeters: sumLegDistances(legs, 'walk'),
    transitDistanceMeters: sumLegDistances(legs, 'transit'),
    totalDistanceMeters: sumLegDistances(legs),
    transferCount: Math.max(0, transitLegs.length - 1),
    legs,
    refreshToken: stringOrNull(record.refreshToken),
    realtimeSource: 'v6.db.transport.rest',
    realtimeFetchedAt: context.fetchedAt,
  }
}

export function mapBahnWebJourneyToApiItinerary(
  journey: unknown,
  context: { index: number; requestedDeparture: string; fetchedAt: string },
): ApiItinerary {
  const record = objectRecord(journey)
  const rawSections = Array.isArray(record.verbindungsAbschnitte) ? record.verbindungsAbschnitte : []
  const legs = rawSections.map((section, index) => mapBahnWebSectionToApiLeg(section, index)).filter((leg) => leg !== null)
  const transitLegs = legs.filter((leg) => leg.legType === 'transit')
  const actualFirstDepartureAt = legs[0]?.departureAt ?? legs[0]?.plannedDepartureAt ?? null
  const arrivalAt = lastTime(legs, 'arrivalAt') ?? lastTime(legs, 'plannedArrivalAt')
  const requestedMs = Date.parse(context.requestedDeparture)
  const firstDepartureMs = actualFirstDepartureAt ? Date.parse(actualFirstDepartureAt) : null
  const arrivalMs = arrivalAt ? Date.parse(arrivalAt) : null
  const totalDurationSeconds =
    arrivalMs === null || Number.isNaN(arrivalMs) || Number.isNaN(requestedMs)
      ? null
      : Math.max(0, Math.round((arrivalMs - requestedMs) / 1000))

  return {
    rankType: context.index === 0 ? 'earliest_arrival' : 'fewest_transfers',
    provider: 'bahn-web',
    requestedDepartureAt: context.requestedDeparture,
    actualFirstDepartureAt,
    arrivalAt,
    totalDurationSeconds,
    initialWalkSeconds: legs[0]?.legType === 'walk' ? legs[0].durationSeconds : 0,
    initialWaitSeconds:
      firstDepartureMs === null || Number.isNaN(firstDepartureMs) || Number.isNaN(requestedMs)
        ? null
        : Math.max(0, Math.round((firstDepartureMs - requestedMs) / 1000)),
    inVehicleSeconds: sumLegDurations(legs, 'transit'),
    transferWaitSeconds: null,
    walkingSeconds: sumLegDurations(legs, 'walk'),
    walkingDistanceMeters: sumLegDistances(legs, 'walk'),
    transitDistanceMeters: sumLegDistances(legs, 'transit'),
    totalDistanceMeters: sumLegDistances(legs),
    transferCount: Math.max(0, transitLegs.length - 1),
    legs,
    refreshToken: stringOrNull(record.ctxRecon),
    realtimeSource: 'bahn.de web api',
    realtimeFetchedAt: context.fetchedAt,
  }
}

function mapDbLegToApiLeg(leg: unknown, index: number): ApiItineraryLeg | null {
  const record = objectRecord(leg)
  const line = objectRecord(record.line)
  const origin = objectRecord(record.origin)
  const destination = objectRecord(record.destination)
  const plannedDepartureAt = stringOrNull(record.plannedDeparture)
  const plannedArrivalAt = stringOrNull(record.plannedArrival)
  const departureAt = stringOrNull(record.departure) ?? plannedDepartureAt
  const arrivalAt = stringOrNull(record.arrival) ?? plannedArrivalAt
  const legType = line.name ? 'transit' : booleanOrFalse(record.walking) ? 'walk' : 'transfer'

  if (!departureAt && !arrivalAt && !plannedDepartureAt && !plannedArrivalAt) {
    return null
  }

  return {
    sequence: index + 1,
    legType,
    mode: stringOrNull(line.mode) ?? stringOrNull(line.product) ?? (legType === 'walk' ? 'WALK' : null),
    routeName: stringOrNull(line.name),
    agencyName: stringOrNull(objectRecord(line.operator).name),
    fromName: stringOrNull(origin.name),
    toName: stringOrNull(destination.name),
    departureAt,
    arrivalAt,
    durationSeconds: durationSeconds(departureAt, arrivalAt),
    distanceMeters: numberOrNull(record.distance),
    geometry: null,
    headsign: stringOrNull(record.direction),
    platformFrom: stringOrNull(record.departurePlatform) ?? stringOrNull(record.plannedDeparturePlatform),
    platformTo: stringOrNull(record.arrivalPlatform) ?? stringOrNull(record.plannedArrivalPlatform),
    plannedDepartureAt,
    plannedArrivalAt,
    departureDelaySeconds: numberOrNull(record.departureDelay),
    arrivalDelaySeconds: numberOrNull(record.arrivalDelay),
    cancelled: booleanOrFalse(record.cancelled),
    remarks: remarksToStrings(record.remarks),
  }
}

function mapBahnWebSectionToApiLeg(section: unknown, index: number): ApiItineraryLeg | null {
  const record = objectRecord(section)
  const start = objectRecord(record.startHalt)
  const destination = objectRecord(record.zielHalt)
  const vehicle = objectRecord(record.verkehrsmittel)
  const startDeparture = objectRecord(start.abfahrt ?? record.abfahrt)
  const destinationArrival = objectRecord(destination.ankunft ?? record.ankunft)
  const plannedDepartureAt = localIsoToBerlin(stringOrNull(startDeparture.sollzeit))
  const plannedArrivalAt = localIsoToBerlin(stringOrNull(destinationArrival.sollzeit))
  const departureAt = localIsoToBerlin(
    stringOrNull(startDeparture.echtzeit) ?? stringOrNull(startDeparture.prognosezeit),
  ) ?? plannedDepartureAt
  const arrivalAt = localIsoToBerlin(
    stringOrNull(destinationArrival.echtzeit) ?? stringOrNull(destinationArrival.prognosezeit),
  ) ?? plannedArrivalAt
  const routeName = [stringOrNull(vehicle.kategorie), stringOrNull(vehicle.name) ?? stringOrNull(vehicle.nummer)]
    .filter(Boolean)
    .join(' ')
  const firstStop = firstArrayRecord(record.halte)
  const lastStop = lastArrayRecord(record.halte)
  const cancelled = booleanOrFalse(record.originCancelled) || booleanOrFalse(record.destinationCancelled)

  if (!departureAt && !arrivalAt && !plannedDepartureAt && !plannedArrivalAt) {
    return null
  }

  return {
    sequence: index + 1,
    legType: vehicle.name || vehicle.nummer || vehicle.kategorie ? 'transit' : 'transfer',
    mode: stringOrNull(vehicle.produktGattung) ?? stringOrNull(vehicle.typ),
    routeName: routeName || null,
    agencyName: null,
    fromName: stringOrNull(start.name) ?? stringOrNull(record.abfahrtsOrt),
    toName: stringOrNull(destination.name) ?? stringOrNull(record.ankunftsOrt),
    departureAt,
    arrivalAt,
    durationSeconds: numberOrNull(record.abschnittsDauer) ?? durationSeconds(departureAt, arrivalAt),
    distanceMeters: null,
    geometry: null,
    headsign: stringOrNull(vehicle.richtung),
    platformFrom: stringOrNull(firstStop.gleis),
    platformTo: stringOrNull(lastStop.gleis),
    plannedDepartureAt,
    plannedArrivalAt,
    departureDelaySeconds: delaySeconds(plannedDepartureAt, departureAt),
    arrivalDelaySeconds: delaySeconds(plannedArrivalAt, arrivalAt),
    cancelled,
    remarks: bahnWebRemarks(record),
  }
}

function directDbStopIdCandidates(stop: ApiStopDetails): string[] {
  const values = [
    stop.publicId,
    stop.dhid,
    ...stop.technicalStops.flatMap((technicalStop) => [technicalStop.sourceStopId, technicalStop.name]),
  ]
  const candidates = values.flatMap((value) => extractDbStopId(value)).filter((value) => value !== null)

  return Array.from(new Set(candidates))
}

function extractDbStopId(value: string | null | undefined): string[] {
  if (!value) {
    return []
  }

  const matches = value.match(/\d{7,8}/g) ?? []

  return Array.from(
    new Set(
      matches.flatMap((candidate) => {
        if (/^\d{7}$/.test(candidate)) {
          return [candidate]
        }

        return /^1\d{7}$/.test(candidate) ? [candidate.slice(1)] : []
      }),
    ),
  )
}

function chooseBestLocationId(stop: ApiStopDetails, rawLocations: unknown[]): string | null {
  const scored = rawLocations
    .map((rawLocation) => {
      const location = objectRecord(rawLocation) as DbLocation
      const rawId = stringOrNull(location.id)
      const extId = stringOrNull(location.extId)
      const id = locationIdReference(rawId, extId)
      const name = stringOrNull(location.name)
      const distance = numberOrNull(location.distance)
      const coordinateDistance = locationDistanceMeters(stop, location)
      const similarity = name ? nameSimilarity(stop.name, name) : 0
      const effectiveDistance = distance ?? coordinateDistance

      if (!id) {
        return null
      }

      return {
        id,
        score: similarity * 100 - (effectiveDistance ?? 1000) / 25,
        distance: effectiveDistance,
        similarity,
      }
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => right.score - left.score)

  const best = scored[0]

  if (!best) {
    return null
  }

  return best.similarity >= 0.3 || (best.distance !== null && best.distance <= 250) ? best.id : null
}

function locationIdReference(rawId: string | null, extId: string | null): string | null {
  if (rawId?.startsWith('A=')) {
    return rawId
  }

  if (extId && /^\d{5,12}$/.test(extId)) {
    return extId
  }

  return rawId && /^\d{5,12}$/.test(rawId) ? rawId : null
}

function locationDistanceMeters(stop: ApiStopDetails, location: DbLocation): number | null {
  const lat = numberOrNull(location.lat) ?? numberOrNull(location.location?.latitude)
  const lon = numberOrNull(location.lon) ?? numberOrNull(location.location?.longitude)

  if (lat === null || lon === null) {
    return null
  }

  const latDeltaMeters = (lat - stop.coordinate.lat) * 111_320
  const lonDeltaMeters = (lon - stop.coordinate.lon) * 111_320 * Math.cos((stop.coordinate.lat * Math.PI) / 180)

  return Math.hypot(latDeltaMeters, lonDeltaMeters)
}

function nameSimilarity(left: string, right: string): number {
  const leftNormalized = normalizeName(left)
  const rightNormalized = normalizeName(right)

  if (leftNormalized === rightNormalized) {
    return 1
  }

  if (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized)) {
    return 0.85
  }

  const leftTokens = new Set(leftNormalized.split(' ').filter(Boolean))
  const rightTokens = new Set(rightNormalized.split(' ').filter(Boolean))
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length

  return leftTokens.size + rightTokens.size === 0 ? 0 : (2 * intersection) / (leftTokens.size + rightTokens.size)
}

function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replace(/\bhbf\b/g, 'hauptbahnhof')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function remarksToStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((remark) => {
      if (typeof remark === 'string') {
        return remark
      }

      const record = objectRecord(remark)
      return stringOrNull(record.text) ?? stringOrNull(record.summary) ?? stringOrNull(record.code)
    })
    .filter((remark) => remark !== null)
}

function sumLegDurations(legs: ApiItineraryLeg[], type?: ApiItineraryLeg['legType']): number | null {
  const values = legs
    .filter((leg) => (type ? leg.legType === type : true))
    .map((leg) => leg.durationSeconds)
    .filter((duration) => duration !== null)

  return values.length === 0 ? null : values.reduce((total, duration) => total + duration, 0)
}

function sumLegDistances(legs: ApiItineraryLeg[], type?: ApiItineraryLeg['legType']): number | null {
  const values = legs
    .filter((leg) => (type ? leg.legType === type : true))
    .map((leg) => leg.distanceMeters)
    .filter((distance) => distance !== null)

  return values.length === 0 ? null : values.reduce((total, distance) => total + distance, 0)
}

function lastTime(legs: ApiItineraryLeg[], key: 'arrivalAt' | 'plannedArrivalAt'): string | null {
  for (let index = legs.length - 1; index >= 0; index -= 1) {
    const value = legs[index]?.[key]

    if (value) {
      return value
    }
  }

  return null
}

function durationSeconds(departureAt: string | null, arrivalAt: string | null): number | null {
  if (!departureAt || !arrivalAt) {
    return null
  }

  const departureMs = Date.parse(departureAt)
  const arrivalMs = Date.parse(arrivalAt)

  return Number.isNaN(departureMs) || Number.isNaN(arrivalMs)
    ? null
    : Math.max(0, Math.round((arrivalMs - departureMs) / 1000))
}

function delaySeconds(plannedAt: string | null, actualAt: string | null): number | null {
  if (!plannedAt || !actualAt) {
    return null
  }

  const plannedMs = Date.parse(plannedAt)
  const actualMs = Date.parse(actualAt)

  return Number.isNaN(plannedMs) || Number.isNaN(actualMs) ? null : Math.round((actualMs - plannedMs) / 1000)
}

function localIsoToBerlin(value: string | null): string | null {
  return value ? `${value}+02:00` : null
}

function firstArrayRecord(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? objectRecord(value[0]) : {}
}

function lastArrayRecord(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? objectRecord(value[value.length - 1]) : {}
}

function bahnWebRemarks(record: Record<string, unknown>): string[] {
  return [
    ...textEntries(record.priorisierteMeldungen),
    ...textEntries(record.himMeldungen),
    ...textEntries(record.risNotizen),
  ].slice(0, 5)
}

function textEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      const record = objectRecord(entry)
      return stringOrNull(record.text) ?? stringOrNull(record.ueberschrift)
    })
    .filter((entry) => entry !== null)
}

function bahnWebHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    'user-agent': BAHN_WEB_USER_AGENT,
  }
}

function responseCookies(response: Response): string {
  const headersWithGetSetCookie = response.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = headersWithGetSetCookie.getSetCookie?.() ?? splitCombinedSetCookie(response.headers.get('set-cookie'))

  return setCookies
    .map((cookie) => cookie.split(';')[0])
    .filter(Boolean)
    .join('; ')
}

function splitCombinedSetCookie(value: string | null): string[] {
  if (!value) {
    return []
  }

  return value.split(/,\s*(?=[^;,]+=)/)
}

function bahnWebJourneyRequest(originDbStopId: string, destinationDbStopId: string, requestedLocalDateTime: string) {
  return {
    minUmstiegszeit: 0,
    deutschlandTicketVorhanden: false,
    nurDeutschlandTicketVerbindungen: false,
    reservierungsKontingenteVorhanden: false,
    schnelleVerbindungen: true,
    sitzplatzOnly: false,
    abfahrtsHalt: bahnWebLocationReference(originDbStopId),
    ankunftsHalt: bahnWebLocationReference(destinationDbStopId),
    produktgattungen: ['ICE', 'EC_IC', 'IR', 'REGIONAL', 'SBAHN', 'BUS', 'SCHIFF', 'UBAHN', 'TRAM', 'ANRUFPFLICHTIG'],
    bikeCarriage: false,
    anfrageZeitpunkt: requestedLocalDateTime,
    ankunftSuche: 'ABFAHRT',
    klasse: 'KLASSE_2',
    reisende: [
      {
        typ: 'ERWACHSENER',
        anzahl: 1,
        alter: [],
        ermaessigungen: [{ art: 'KEINE_ERMAESSIGUNG', klasse: 'KLASSENLOS' }],
      },
    ],
  }
}

function bahnWebLocationReference(value: string): string {
  return value.startsWith('A=') ? value : `A=1@L=${value}@`
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanOrFalse(value: unknown): boolean {
  return value === true
}
