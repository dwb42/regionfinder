import type {
  ApiItineraryResponse,
  ApiMetrics,
  ApiRoutePattern,
  ApiSnapshot,
  ApiStopDetails,
  ApiStopSearchResult,
} from '../api/contracts'

const configuredBaseUrl = import.meta.env.VITE_REGIONFINDER_API_BASE_URL
export const apiBaseUrl = configuredBaseUrl ? configuredBaseUrl.replace(/\/$/, '') : ''

async function fetchApi<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`)

  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${response.statusText}`)
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

export function fetchStopMetrics(publicId: string, profile: string): Promise<ApiMetrics> {
  const params = new URLSearchParams({ profile })

  return fetchApi<ApiMetrics>(`/api/v1/stops/${encodeURIComponent(publicId)}/metrics?${params}`)
}

export function fetchItineraries(publicId: string, date: string, time: string, profile: string): Promise<ApiItineraryResponse> {
  const params = new URLSearchParams({ date, time, profile })

  return fetchApi<ApiItineraryResponse>(`/api/v1/stops/${encodeURIComponent(publicId)}/itineraries?${params}`)
}

export function fetchRoutePattern(id: string): Promise<ApiRoutePattern> {
  return fetchApi<ApiRoutePattern>(`/api/v1/route-patterns/${encodeURIComponent(id)}`)
}
