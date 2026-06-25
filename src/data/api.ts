import type {
  ApiDrivingRouteResponse,
  ApiItineraryResponse,
  ApiMetrics,
  ApiRoutePattern,
  ApiSnapshot,
  ApiStopDetails,
  ApiStopSearchResult,
} from '../api/contracts'

const configuredBaseUrl = import.meta.env.VITE_REGIONFINDER_API_BASE_URL
export const apiBaseUrl = configuredBaseUrl ? configuredBaseUrl.replace(/\/$/, '') : ''

export class ApiError extends Error {
  readonly status: number
  readonly statusText: string
  readonly errorCode: string | null

  constructor(path: string, status: number, statusText: string, errorCode: string | null, message: string) {
    super(message || `${path}: ${status} ${statusText}`)
    this.name = 'ApiError'
    this.status = status
    this.statusText = statusText
    this.errorCode = errorCode
  }
}

async function fetchApi<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`)

  if (!response.ok) {
    const payload = await response
      .clone()
      .json()
      .catch(() => null)
    const errorCode =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : null
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `${path}: ${response.status} ${response.statusText}`

    throw new ApiError(path, response.status, response.statusText, errorCode, message)
  }

  return (await response.json()) as T
}

export function fetchCurrentSnapshot(): Promise<ApiSnapshot> {
  return fetchApi<ApiSnapshot>('/api/v1/snapshots/current')
}

export type StopSearchOptions = {
  states?: string[]
  modes?: string[]
  limit?: number
}

export function searchStops(query: string, options: StopSearchOptions = {}): Promise<ApiStopSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(options.limit ?? 24),
  })

  if (options.states?.length) {
    params.set('states', options.states.join(','))
  }

  if (options.modes?.length) {
    params.set('modes', options.modes.join(','))
  }

  return fetchApi<ApiStopSearchResult[]>(`/api/v1/stops/search?${params}`)
}

export function fetchStopDetails(publicId: string): Promise<ApiStopDetails> {
  return fetchApi<ApiStopDetails>(`/api/v1/stops/${encodeURIComponent(publicId)}`)
}

export function fetchStopMetrics(publicId: string, profile: string, date?: string): Promise<ApiMetrics> {
  const params = new URLSearchParams({ profile })

  if (date) {
    params.set('date', date)
  }

  return fetchApi<ApiMetrics>(`/api/v1/stops/${encodeURIComponent(publicId)}/metrics?${params}`)
}

export function fetchItineraries(publicId: string, date: string, time: string, profile: string): Promise<ApiItineraryResponse> {
  const params = new URLSearchParams({ date, time, profile })

  return fetchApi<ApiItineraryResponse>(`/api/v1/stops/${encodeURIComponent(publicId)}/itineraries?${params}`)
}

export function fetchRealtimeItineraries(
  publicId: string,
  date: string,
  time: string,
  profile: string,
): Promise<ApiItineraryResponse> {
  const params = new URLSearchParams({ date, time, profile })

  return fetchApi<ApiItineraryResponse>(`/api/v1/stops/${encodeURIComponent(publicId)}/realtime-itineraries?${params}`)
}

export function fetchDrivingRoute(publicId: string): Promise<ApiDrivingRouteResponse> {
  return fetchApi<ApiDrivingRouteResponse>(`/api/v1/stops/${encodeURIComponent(publicId)}/driving-route`)
}

export function fetchRoutePattern(id: string): Promise<ApiRoutePattern> {
  return fetchApi<ApiRoutePattern>(`/api/v1/route-patterns/${encodeURIComponent(id)}`)
}
