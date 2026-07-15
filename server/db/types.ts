import type {
  ApiItineraryResponse,
  ApiMetrics,
  ApiPlace,
  ApiPlaceCreateRequest,
  ApiPlaceUpdateRequest,
  ApiRoutePattern,
  ApiSnapshot,
  ApiStopDetails,
  ApiStopSearchResult,
  PlaceCategory,
} from '../../src/api/contracts'

export type StopSearchFilters = {
  query: string
  states: string[]
  modes: string[]
  limit: number
}

export type ItineraryQuery = {
  publicId: string
  date: string
  time: string
  profile: string
}

export type RegionfinderRepository = {
  currentSnapshot(): Promise<ApiSnapshot | null>
  searchStops(filters: StopSearchFilters): Promise<ApiStopSearchResult[]>
  stopDetails(publicId: string): Promise<ApiStopDetails | null>
  stopMetrics(publicId: string, profile: string, snapshot?: string, date?: string): Promise<ApiMetrics | null>
  itineraries(query: ItineraryQuery): Promise<ApiItineraryResponse | null>
  routePattern(id: string): Promise<ApiRoutePattern | null>
  listPlaces(categories?: PlaceCategory[], states?: string[], query?: string, limit?: number): Promise<ApiPlace[]>
  place(id: string): Promise<ApiPlace | null>
  createPlace(input: ApiPlaceCreateRequest): Promise<ApiPlace>
  updatePlace(id: string, input: ApiPlaceUpdateRequest): Promise<ApiPlace | null>
  deletePlace(id: string): Promise<boolean>
  stopTile(z: number, x: number, y: number, modes?: string[], profile?: string): Promise<Buffer | null>
  routeTile(z: number, x: number, y: number, modes?: string[], profile?: string): Promise<Buffer | null>
  railNetworkTile(z: number, x: number, y: number): Promise<Buffer | null>
  schoolTile(z: number, x: number, y: number, categories?: string[], states?: string[]): Promise<Buffer | null>
  placeTile(z: number, x: number, y: number, categories?: PlaceCategory[], states?: string[]): Promise<Buffer | null>
}
