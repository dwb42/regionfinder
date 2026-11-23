import type { ApiItineraryResponse } from '../../../src/api/contracts'
import { berlinDateTime } from '../../../src/api/time'
import { RealtimeProviderError, type RealtimeItineraryProvider, type RealtimeItineraryRequest } from '../types'
import { mapTransitousItinerary } from './journeyMapping'
import { resolveTransitousStop } from './stopMapping'
import { planSchema, type TransitousStop } from './types'

type Options = { fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number; maxPlansPerDay?: number; userAgent?: string }
const DAY = 24 * 60 * 60 * 1000
const ORIGIN: TransitousStop = { publicId: 'de:02000:10950_G', name: 'Hamburg Hbf', coordinate: { lat: 53.5527, lon: 10.0064 } }

export class TransitousProvider implements RealtimeItineraryProvider {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly maxPlansPerDay: number
  private readonly userAgent: string
  private readonly mappings = new Map<string, { id: string; until: number }>()
  private readonly results = new Map<string, { value: ApiItineraryResponse; until: number }>()
  private readonly pending = new Map<string, Promise<ApiItineraryResponse>>()
  private planTimes: number[] = []
  private retryAfter = 0

  constructor(options: Options = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.maxPlansPerDay = options.maxPlansPerDay ?? 700
    this.userAgent = options.userAgent ?? process.env.REGIONFINDER_HTTP_USER_AGENT ??
      'Regionfinder/0.0.0 (https://regionfinder.b42.io/; contact: dw@b42.io)'
  }

  async plan(request: RealtimeItineraryRequest): Promise<ApiItineraryResponse> {
    const requestedDeparture = berlinDateTime(`${request.date}T${request.time}:00`)
    const key = `${request.snapshotId}:${request.stop.publicId}:${request.stop.coordinate.lat},${request.stop.coordinate.lon}:${requestedDeparture}`
    const cached = this.results.get(key)
    if (cached && cached.until > this.now()) return cached.value
    const pending = this.pending.get(key)
    if (pending) return pending
    const promise = this.load(request, requestedDeparture)
    this.pending.set(key, promise)
    try {
      const value = await promise
      if (this.results.size >= 500) this.results.delete(this.results.keys().next().value!)
      this.results.set(key, { value, until: this.now() + 60_000 })
      return value
    } finally { this.pending.delete(key) }
  }

  private async load(request: RealtimeItineraryRequest, departure: string): Promise<ApiItineraryResponse> {
    const [origin, destination] = await Promise.all([this.resolve(ORIGIN), this.resolve(request.stop)])
    const now = this.now()
    this.planTimes = this.planTimes.filter((time) => time > now - DAY)
    if (this.planTimes.length >= this.maxPlansPerDay || this.planTimes.filter((time) => time > now - 60_000).length >= 30) {
      throw new RealtimeProviderError(429, 'realtime_rate_limited', 'Transitous routing budget exhausted')
    }
    this.planTimes.push(now)
    const raw = await this.get('/api/v6/plan', {
      fromPlace: origin, toPlace: destination, time: departure, transitModes: 'TRANSIT',
      numItineraries: '3', maxItineraries: '3', detailedLegs: 'false', joinInterlinedLegs: 'false',
      realtimeMode: 'REALTIME', language: 'de',
    })
    const parsed = planSchema.safeParse(raw)
    if (!parsed.success) throw new RealtimeProviderError(502, 'realtime_unavailable', 'Invalid Transitous journey response')
    return {
      snapshotId: request.snapshotId, requestedDeparture: departure, originId: origin,
      destinationPublicId: request.stop.publicId, provider: 'transitous',
      sourceAttribution: 'Transitous · Fahrplandaten und Echtzeit, soweit verfügbar',
      sourceAttributionUrl: 'https://transitous.org/sources/',
      alternatives: parsed.data.itineraries.slice(0, 3).map((itinerary) =>
        mapTransitousItinerary(itinerary, departure, new Date(this.now()).toISOString())),
    }
  }

  private async resolve(stop: TransitousStop): Promise<string> {
    const key = `${stop.publicId}:${stop.coordinate.lat},${stop.coordinate.lon}`
    const cached = this.mappings.get(key)
    if (cached && cached.until > this.now()) return cached.id
    const id = await resolveTransitousStop(stop, this.get.bind(this))
    if (this.mappings.size >= 1000) this.mappings.delete(this.mappings.keys().next().value!)
    this.mappings.set(key, { id, until: this.now() + 6 * 60 * 60 * 1000 })
    return id
  }

  private async get(path: string, params: Record<string, string>, allowMissing = false): Promise<unknown> {
    if (this.now() < this.retryAfter) throw new RealtimeProviderError(429, 'realtime_rate_limited', 'Transitous requested a pause')
    const url = new URL(path, 'https://api.transitous.org')
    url.search = new URLSearchParams(params).toString()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } })
      if (allowMissing && [400, 404].includes(response.status)) return null
      if (response.status === 429) {
        const value = response.headers.get('retry-after')
        const seconds = value && /^\d+$/.test(value) ? Number(value) : null
        const until = seconds !== null ? this.now() + seconds * 1000 : Date.parse(value ?? '')
        this.retryAfter = Math.max(this.now() + 60_000, Number.isFinite(until) ? until : 0)
        throw new RealtimeProviderError(429, 'realtime_rate_limited', 'Transitous request limit reached')
      }
      if (!response.ok) {
        if ([400, 404].includes(response.status)) this.mappings.clear()
        throw new RealtimeProviderError(502, 'realtime_unavailable', `Transitous upstream returned ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      if (error instanceof RealtimeProviderError) throw error
      throw new RealtimeProviderError(502, 'realtime_unavailable', 'Transitous is currently unavailable')
    } finally { clearTimeout(timeout) }
  }
}
