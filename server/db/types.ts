import type {
  ApiItineraryResponse,
  AdministrativeAreaLevel,
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
} from '../../src/api/contracts'
import type { MunicipalityListUpdateResult, MunicipalityMembershipMutationResult } from './queries/municipalityListQueries'

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
  municipalityLists(): Promise<ApiMunicipalityList[]>
  createMunicipalityList(input: ApiMunicipalityListCreateRequest): Promise<ApiMunicipalityList | null>
  updateMunicipalityList(id: string, input: ApiMunicipalityListUpdateRequest): Promise<MunicipalityListUpdateResult>
  deleteMunicipalityList(id: string): Promise<boolean>
  municipalityListMemberships(officialKey: string): Promise<ApiMunicipalityListMemberships | null>
  addMunicipalityListMember(listId: string, officialKey: string): Promise<MunicipalityMembershipMutationResult>
  removeMunicipalityListMember(listId: string, officialKey: string): Promise<MunicipalityMembershipMutationResult>
  stopTile(z: number, x: number, y: number, modes?: string[], profile?: string): Promise<Buffer | null>
  routeTile(z: number, x: number, y: number, modes?: string[], profile?: string): Promise<Buffer | null>
  railNetworkTile(z: number, x: number, y: number): Promise<Buffer | null>
  schoolTile(z: number, x: number, y: number, categories?: string[], states?: string[]): Promise<Buffer | null>
  placeTile(z: number, x: number, y: number, categories?: PlaceCategory[], states?: string[]): Promise<Buffer | null>
  administrativeAreaTile(z: number, x: number, y: number, levels?: AdministrativeAreaLevel[], states?: string[]): Promise<Buffer | null>
  municipalityListHighlightTile(z: number, x: number, y: number, listIds?: string[]): Promise<Buffer | null>
}
