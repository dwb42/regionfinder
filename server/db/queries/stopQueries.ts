import type { ApiStopDetails, ApiStopSearchResult } from '../../../src/api/contracts'
import type { StopSearchFilters } from '../types'
import type { Queryable } from '../queryTypes'
import { findCurrentSnapshot } from './snapshotQueries'

export async function searchStops(db: Queryable, filters: StopSearchFilters): Promise<ApiStopSearchResult[]> {
  const result = await db.query<{
    public_id: string
    name: string
    dhid: string | null
    lat: number
    lon: number
    state_code: string | null
    municipality_name: string | null
    modes: string[]
    identity_quality: string
  }>(
    `
    SELECT sp.public_id,
           sp.name,
           sp.dhid,
           ST_Y(sp.geometry)::float8 AS lat,
           ST_X(sp.geometry)::float8 AS lon,
           sp.state_code,
           sp.municipality_name,
           sp.modes,
           sp.identity_quality
    FROM stop_places sp
    JOIN data_snapshots snap ON snap.id = sp.snapshot_id AND snap.is_active = true
    WHERE ($1 = '' OR sp.normalized_name ILIKE '%' || $1 || '%' OR sp.public_id ILIKE '%' || $1 || '%' OR sp.dhid ILIKE '%' || $1 || '%')
      AND (cardinality($2::text[]) = 0 OR sp.state_code = ANY($2::text[]))
      AND (cardinality($3::text[]) = 0 OR sp.modes && $3::text[])
    ORDER BY sp.name
    LIMIT $4
    `,
    [filters.query, filters.states, filters.modes, filters.limit],
  )

  return result.rows.map((row) => ({
    publicId: row.public_id,
    name: row.name,
    dhid: row.dhid,
    coordinate: { lat: row.lat, lon: row.lon },
    stateCode: row.state_code,
    municipalityName: row.municipality_name,
    modes: row.modes,
    identityQuality: row.identity_quality,
  }))
}

export async function findStopDetails(db: Queryable, publicId: string): Promise<ApiStopDetails | null> {
  const stops = await searchStops(db, { query: publicId, states: [], modes: [], limit: 1 })
  const base = stops.find((stop) => stop.publicId === publicId)

  if (!base) {
    return null
  }

  const technicalStops = await db.query<{
    source_stop_id: string
    name: string
    platform_code: string | null
    location_type: number | null
    quay_type: string | null
  }>(
    `
    SELECT st.source_stop_id, st.name, st.platform_code, st.location_type, st.quay_type
    FROM stops st
    JOIN stop_places sp ON sp.id = st.stop_place_id AND sp.snapshot_id = st.snapshot_id
    JOIN data_snapshots snap ON snap.id = sp.snapshot_id AND snap.is_active = true
    WHERE sp.public_id = $1
    ORDER BY st.name
    `,
    [publicId],
  )
  const routes = await db.query<{
    route_pattern_id: string
    short_name: string | null
    long_name: string | null
    mode: string
    agency_name: string | null
    direction_id: number | null
    geometry_quality: string
  }>(
    `
    SELECT rp.id::text AS route_pattern_id,
           r.short_name,
           r.long_name,
           r.mode,
           a.name AS agency_name,
           rp.direction_id,
           rp.geometry_quality
    FROM route_pattern_stops rps
    JOIN route_patterns rp ON rp.id = rps.route_pattern_id AND rp.snapshot_id = rps.snapshot_id
    JOIN routes r ON r.id = rp.route_id AND r.snapshot_id = rp.snapshot_id
    LEFT JOIN agencies a ON a.id = r.agency_id AND a.snapshot_id = r.snapshot_id
    JOIN stop_places sp ON sp.id = rps.stop_place_id AND sp.snapshot_id = rps.snapshot_id
    JOIN data_snapshots snap ON snap.id = sp.snapshot_id AND snap.is_active = true
    WHERE sp.public_id = $1
    ORDER BY r.short_name NULLS LAST, r.long_name NULLS LAST
    LIMIT 100
    `,
    [publicId],
  )
  const snapshot = await findCurrentSnapshot(db)

  return {
    ...base,
    dataStand: {
      snapshotId: snapshot?.publicId ?? 'unknown',
      qualityStatus: snapshot?.qualityStatus ?? 'unknown',
    },
    technicalStops: technicalStops.rows.map((row) => ({
      sourceStopId: row.source_stop_id,
      name: row.name,
      platformCode: row.platform_code,
      locationType: row.location_type,
      quayType: row.quay_type,
    })),
    servedRoutes: routes.rows.map((row) => ({
      routePatternId: row.route_pattern_id,
      shortName: row.short_name,
      longName: row.long_name,
      mode: row.mode,
      agencyName: row.agency_name,
      directionId: row.direction_id,
      geometryQuality: row.geometry_quality,
    })),
  }
}
