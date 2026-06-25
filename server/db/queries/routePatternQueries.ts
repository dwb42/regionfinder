import type { ApiRoutePattern } from '../../../src/api/contracts'
import type { Queryable } from '../queryTypes'

export async function findRoutePattern(db: Queryable, id: string): Promise<ApiRoutePattern | null> {
  const result = await db.query<{
    id: string
    short_name: string | null
    long_name: string | null
    mode: string
    agency_name: string | null
    direction_id: number | null
    headsign: string | null
    geometry_json: string | null
    geometry_quality: string
    geometry_source: string
    length_meters: string | null
    trip_count: string
  }>(
    `
    SELECT rp.id::text,
           r.short_name,
           r.long_name,
           r.mode,
           a.name AS agency_name,
           rp.direction_id,
           rp.headsign,
           ST_AsGeoJSON(rpd.geometry) AS geometry_json,
           rpd.geometry_quality,
           rpd.geometry_source,
           rpd.length_meters,
           COALESCE(tc.trip_count, 0)::text AS trip_count
    FROM route_patterns rp
    JOIN route_pattern_display_geometries rpd ON rpd.snapshot_id = rp.snapshot_id AND rpd.route_pattern_id = rp.id
    JOIN routes r ON r.id = rp.route_id AND r.snapshot_id = rp.snapshot_id
    LEFT JOIN agencies a ON a.id = r.agency_id AND a.snapshot_id = r.snapshot_id
    JOIN data_snapshots snap ON snap.id = rp.snapshot_id AND snap.is_active = true
    LEFT JOIN (
      SELECT snapshot_id, route_pattern_id, count(*) AS trip_count
      FROM trips
      GROUP BY snapshot_id, route_pattern_id
    ) tc ON tc.route_pattern_id = rp.id AND tc.snapshot_id = rp.snapshot_id
    WHERE rp.id = $1::uuid
    `,
    [id],
  )
  const row = result.rows[0]
  if (!row) {
    return null
  }

  const stops = await db.query<{
    stop_sequence: number
    public_id: string
    name: string
    platform_code: string | null
  }>(
    `
    SELECT rps.stop_sequence,
           sp.public_id,
           sp.name,
           st.platform_code
    FROM route_pattern_stops rps
    JOIN stop_places sp ON sp.id = rps.stop_place_id AND sp.snapshot_id = rps.snapshot_id
    LEFT JOIN stops st ON st.id = rps.stop_id AND st.snapshot_id = rps.snapshot_id
    WHERE rps.route_pattern_id = $1::uuid
    ORDER BY rps.stop_sequence
    `,
    [id],
  )

  return {
    id: row.id,
    route: {
      shortName: row.short_name,
      longName: row.long_name,
      mode: row.mode,
      agencyName: row.agency_name,
    },
    directionId: row.direction_id,
    headsign: row.headsign,
    geometry: row.geometry_json ? (JSON.parse(row.geometry_json) as ApiRoutePattern['geometry']) : null,
    geometryQuality: row.geometry_quality,
    geometrySource: row.geometry_source,
    lengthMeters: row.length_meters === null ? null : Number(row.length_meters),
    stops: stops.rows.map((stop) => ({
      sequence: stop.stop_sequence,
      publicId: stop.public_id,
      name: stop.name,
      platformCode: stop.platform_code,
    })),
    tripCount: Number(row.trip_count),
  }
}
