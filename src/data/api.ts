import type {
  ApiDrivingRouteResponse,
  ApiItineraryResponse,
  ApiMetrics,
  ApiMunicipalityList,
  ApiMunicipalityListCreateRequest,
  ApiMunicipalityListMemberships,
  ApiMunicipalityListUpdateRequest,
  ApiPlace,
  ApiPlaceCreateRequest,
  ApiPlaceUpdateRequest,
  ApiRoutePattern,
  ApiSnapshot,
  ApiStopDetails,
  ApiStopSearchResult,
  PlaceCategory,
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

async function fetchApi<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined) return fetchApiResponse<T>(path, init)
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  try {
    return await fetchApiResponse<T>(path, { ...init, signal })
  } catch (error) {
    if (timeout.aborted) {
      throw new ApiError(path, 408, 'Request Timeout', 'request_timeout', 'Die Anfrage dauert zu lange. Bitte erneut versuchen.')
    }
    throw error
  }
}

async function fetchApiResponse<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init)

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

  if (response.status === 204) {
    return undefined as T
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

export function fetchStopDetails(publicId: string, signal?: AbortSignal): Promise<ApiStopDetails> {
  return fetchApi<ApiStopDetails>(`/api/v1/stops/${encodeURIComponent(publicId)}`, { signal }, 30_000)
}

export function fetchStopMetrics(publicId: string, profile: string, date?: string, signal?: AbortSignal): Promise<ApiMetrics> {
  const params = new URLSearchParams({ profile })

  if (date) {
    params.set('date', date)
  }

  return fetchApi<ApiMetrics>(`/api/v1/stops/${encodeURIComponent(publicId)}/metrics?${params}`, { signal }, 30_000)
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
  signal?: AbortSignal,
): Promise<ApiItineraryResponse> {
  const params = new URLSearchParams({ date, time, profile })

  return fetchApi<ApiItineraryResponse>(`/api/v1/stops/${encodeURIComponent(publicId)}/realtime-itineraries?${params}`, { signal }, 90_000)
}

export function fetchDrivingRoute(publicId: string, signal?: AbortSignal): Promise<ApiDrivingRouteResponse> {
  return fetchApi<ApiDrivingRouteResponse>(`/api/v1/stops/${encodeURIComponent(publicId)}/driving-route`, { signal }, 30_000)
}

export function fetchRoutePattern(id: string): Promise<ApiRoutePattern> {
  return fetchApi<ApiRoutePattern>(`/api/v1/route-patterns/${encodeURIComponent(id)}`)
}

export type PlaceSearchOptions = {
  categories?: PlaceCategory[]
  states?: string[]
  query?: string
  limit?: number
}

export function fetchPlaces(options: PlaceSearchOptions = {}): Promise<ApiPlace[]> {
  const params = new URLSearchParams({
    q: options.query ?? '',
    limit: String(options.limit ?? 100),
  })

  if (options.categories?.length) {
    params.set('categories', options.categories.join(','))
  }

  if (options.states?.length) {
    params.set('states', options.states.join(','))
  }

  return fetchApi<ApiPlace[]>(`/api/v1/places?${params}`)
}

export function fetchPlace(id: string): Promise<ApiPlace> {
  return fetchApi<ApiPlace>(`/api/v1/places/${encodeURIComponent(id)}`)
}

export function createPlace(input: ApiPlaceCreateRequest): Promise<ApiPlace> {
  return fetchApi<ApiPlace>('/api/v1/places', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updatePlace(id: string, input: ApiPlaceUpdateRequest): Promise<ApiPlace> {
  return fetchApi<ApiPlace>(`/api/v1/places/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function deletePlace(id: string): Promise<void> {
  await fetchApi<void>(`/api/v1/places/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function fetchMunicipalityLists(): Promise<ApiMunicipalityList[]> {
  return fetchApi<ApiMunicipalityList[]>('/api/v1/municipality-lists')
}

export function createMunicipalityList(input: ApiMunicipalityListCreateRequest): Promise<ApiMunicipalityList> {
  return fetchApi<ApiMunicipalityList>('/api/v1/municipality-lists', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateMunicipalityList(
  id: string,
  input: ApiMunicipalityListUpdateRequest,
): Promise<ApiMunicipalityList> {
  return fetchApi<ApiMunicipalityList>(`/api/v1/municipality-lists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function deleteMunicipalityList(id: string): Promise<void> {
  await fetchApi<void>(`/api/v1/municipality-lists/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function fetchMunicipalityListMemberships(officialKey: string): Promise<ApiMunicipalityListMemberships> {
  return fetchApi<ApiMunicipalityListMemberships>(
    `/api/v1/municipality-lists/memberships/${encodeURIComponent(officialKey)}`,
  )
}

export async function addMunicipalityToList(listId: string, officialKey: string): Promise<void> {
  await fetchApi<void>(
    `/api/v1/municipality-lists/${encodeURIComponent(listId)}/municipalities/${encodeURIComponent(officialKey)}`,
    { method: 'PUT' },
  )
}

export async function removeMunicipalityFromList(listId: string, officialKey: string): Promise<void> {
  await fetchApi<void>(
    `/api/v1/municipality-lists/${encodeURIComponent(listId)}/municipalities/${encodeURIComponent(officialKey)}`,
    { method: 'DELETE' },
  )
}
