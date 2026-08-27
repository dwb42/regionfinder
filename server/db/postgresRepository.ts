import pg from 'pg'
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
import { findItineraries } from './queries/itineraryQueries'
import {
  addMunicipalityListMember,
  createMunicipalityList,
  deleteMunicipalityList,
  listMunicipalityLists,
  municipalityListMemberships,
  removeMunicipalityListMember,
  updateMunicipalityList,
  type MunicipalityListUpdateResult,
  type MunicipalityMembershipMutationResult,
} from './queries/municipalityListQueries'
import { findStopMetrics } from './queries/metricQueries'
import { createPlace, deletePlace, findPlace, listPlaces, updatePlace } from './queries/placeQueries'
import { findRoutePattern } from './queries/routePatternQueries'
import { findCurrentSnapshot } from './queries/snapshotQueries'
import { findStopDetails, searchStops as searchStopsQuery } from './queries/stopQueries'
import {
  administrativeAreaTile as administrativeAreaTileQuery,
  municipalityListHighlightTile as municipalityListHighlightTileQuery,
  placeTile as placeTileQuery,
  railNetworkTile as railNetworkTileQuery,
  routeTile as routeTileQuery,
  schoolTile as schoolTileQuery,
  stopTile as stopTileQuery,
} from './queries/tileQueries'
import type { ItineraryQuery, RegionfinderRepository, StopSearchFilters } from './types'

const { Pool } = pg

export class PostgresRepository implements RegionfinderRepository {
  readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString })
  }

  currentSnapshot(): Promise<ApiSnapshot | null> {
    return findCurrentSnapshot(this.pool)
  }

  searchStops(filters: StopSearchFilters): Promise<ApiStopSearchResult[]> {
    return searchStopsQuery(this.pool, filters)
  }

  stopDetails(publicId: string): Promise<ApiStopDetails | null> {
    return findStopDetails(this.pool, publicId)
  }

  stopMetrics(publicId: string, profile: string, _snapshot?: string, date?: string): Promise<ApiMetrics | null> {
    return findStopMetrics(this.pool, publicId, profile, date)
  }

  itineraries(query: ItineraryQuery): Promise<ApiItineraryResponse | null> {
    return findItineraries(this.pool, query)
  }

  routePattern(id: string): Promise<ApiRoutePattern | null> {
    return findRoutePattern(this.pool, id)
  }

  listPlaces(categories: PlaceCategory[] = [], states: string[] = [], query = '', limit = 100): Promise<ApiPlace[]> {
    return listPlaces(this.pool, categories, states, query, limit)
  }

  place(id: string): Promise<ApiPlace | null> {
    return findPlace(this.pool, id)
  }

  createPlace(input: ApiPlaceCreateRequest): Promise<ApiPlace> {
    return createPlace(this.pool, input)
  }

  updatePlace(id: string, input: ApiPlaceUpdateRequest): Promise<ApiPlace | null> {
    return updatePlace(this.pool, id, input)
  }

  deletePlace(id: string): Promise<boolean> {
    return deletePlace(this.pool, id)
  }

  municipalityLists(): Promise<ApiMunicipalityList[]> {
    return listMunicipalityLists(this.pool)
  }

  createMunicipalityList(input: ApiMunicipalityListCreateRequest): Promise<ApiMunicipalityList | null> {
    return createMunicipalityList(this.pool, input)
  }

  updateMunicipalityList(id: string, input: ApiMunicipalityListUpdateRequest): Promise<MunicipalityListUpdateResult> {
    return updateMunicipalityList(this.pool, id, input)
  }

  deleteMunicipalityList(id: string): Promise<boolean> {
    return deleteMunicipalityList(this.pool, id)
  }

  municipalityListMemberships(officialKey: string): Promise<ApiMunicipalityListMemberships | null> {
    return municipalityListMemberships(this.pool, officialKey)
  }

  addMunicipalityListMember(listId: string, officialKey: string): Promise<MunicipalityMembershipMutationResult> {
    return addMunicipalityListMember(this.pool, listId, officialKey)
  }

  removeMunicipalityListMember(listId: string, officialKey: string): Promise<MunicipalityMembershipMutationResult> {
    return removeMunicipalityListMember(this.pool, listId, officialKey)
  }

  stopTile(z: number, x: number, y: number, modes: string[] = [], profile = 'regular_tue_thu'): Promise<Buffer | null> {
    return stopTileQuery(this.pool, z, x, y, modes, profile)
  }

  routeTile(z: number, x: number, y: number, modes: string[] = [], profile = 'regular_tue_thu'): Promise<Buffer | null> {
    return routeTileQuery(this.pool, z, x, y, modes, profile)
  }

  railNetworkTile(z: number, x: number, y: number): Promise<Buffer | null> {
    return railNetworkTileQuery(this.pool, z, x, y)
  }

  schoolTile(z: number, x: number, y: number, categories: string[] = [], states: string[] = []): Promise<Buffer | null> {
    return schoolTileQuery(this.pool, z, x, y, categories, states)
  }

  placeTile(z: number, x: number, y: number, categories: PlaceCategory[] = [], states: string[] = []): Promise<Buffer | null> {
    return placeTileQuery(this.pool, z, x, y, categories, states)
  }

  administrativeAreaTile(
    z: number,
    x: number,
    y: number,
    levels: AdministrativeAreaLevel[] = [],
    states: string[] = [],
  ): Promise<Buffer | null> {
    return administrativeAreaTileQuery(this.pool, z, x, y, levels, states)
  }

  municipalityListHighlightTile(z: number, x: number, y: number, listIds: string[] = []): Promise<Buffer | null> {
    return municipalityListHighlightTileQuery(this.pool, z, x, y, listIds)
  }
}
