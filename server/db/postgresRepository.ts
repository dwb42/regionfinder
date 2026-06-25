import pg from 'pg'
import type {
  ApiItineraryResponse,
  ApiMetrics,
  ApiRoutePattern,
  ApiSnapshot,
  ApiStopDetails,
  ApiStopSearchResult,
} from '../../src/api/contracts'
import { findItineraries } from './queries/itineraryQueries'
import { findStopMetrics } from './queries/metricQueries'
import { findRoutePattern } from './queries/routePatternQueries'
import { findCurrentSnapshot } from './queries/snapshotQueries'
import { findStopDetails, searchStops as searchStopsQuery } from './queries/stopQueries'
import {
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
}
