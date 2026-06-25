import type { Queryable } from '../queryTypes'

export async function stopTile(
  db: Queryable,
  z: number,
  x: number,
  y: number,
  modes: string[] = [],
  profile = 'regular_tue_thu',
): Promise<Buffer | null> {
  return mvtTile(
    db,
    `
    WITH bounds AS (
      SELECT ST_TileEnvelope($1, $2, $3) AS geom
    ),
    active_snapshot AS (
      SELECT id
      FROM data_snapshots
      WHERE is_active = true
      LIMIT 1
    ),
    visible_stops AS (
      SELECT sp.public_id,
             sp.name,
             sp.state_code,
             sp.modes,
             sp.id,
             sp.snapshot_id,
             sp.geometry,
             (sp.modes && ARRAY['BUS', 'TRAM']::text[] AND sp.modes <@ ARRAY['BUS', 'TRAM']::text[]) AS is_bus_only,
             CASE
               WHEN sp.modes && ARRAY['ICE', 'IC', 'EC', 'RE', 'RB', 'RAIL']::text[] THEN 'regional'
               WHEN sp.modes && ARRAY['S', 'AKN', 'U']::text[] THEN 'urban_rail'
               WHEN sp.modes && ARRAY['BUS', 'TRAM']::text[] AND sp.modes <@ ARRAY['BUS', 'TRAM']::text[] THEN 'bus_only'
               ELSE 'other'
             END AS stop_priority
      FROM stop_places sp
      JOIN active_snapshot snap ON snap.id = sp.snapshot_id
      CROSS JOIN bounds
      WHERE ST_Intersects(ST_Transform(sp.geometry, 3857), bounds.geom)
        AND sp.is_display_stop = true
        AND (cardinality($4::text[]) = 0 OR sp.modes && $4::text[])
    ),
    latest_metric_run AS (
      SELECT mr.id
      FROM metric_runs mr
      JOIN active_snapshot snap ON snap.id = mr.snapshot_id
      WHERE mr.routing_profile_id = $5
      ORDER BY mr.completed_at DESC NULLS LAST, mr.started_at DESC
      LIMIT 1
    ),
    distinct_route_labels AS (
      SELECT DISTINCT
             rps.stop_place_id,
             COALESCE(NULLIF(r.short_name, ''), NULLIF(r.long_name, ''), r.source_route_id) || ' · ' || r.mode AS label
      FROM visible_stops vs
      JOIN route_pattern_stops rps ON rps.snapshot_id = vs.snapshot_id AND rps.stop_place_id = vs.id
      JOIN route_patterns rp ON rp.id = rps.route_pattern_id AND rp.snapshot_id = rps.snapshot_id
      JOIN routes r ON r.id = rp.route_id AND r.snapshot_id = rp.snapshot_id
      WHERE $1 >= 10
        AND rp.is_active = true
    ),
    ranked_route_labels AS (
      SELECT stop_place_id,
             label,
             count(*) OVER (PARTITION BY stop_place_id) AS route_count,
             row_number() OVER (PARTITION BY stop_place_id ORDER BY label) AS route_rank
      FROM distinct_route_labels
    ),
    route_summary AS (
      SELECT stop_place_id,
             string_agg(label, ', ' ORDER BY label) FILTER (WHERE route_rank <= 5) AS route_labels,
             max(route_count) AS route_count
      FROM ranked_route_labels
      GROUP BY stop_place_id
    ),
    mvtgeom AS (
      SELECT vs.public_id,
             vs.name,
             vs.state_code,
             vs.modes,
             odm.fastest_seconds,
             route_summary.route_labels,
             COALESCE(route_summary.route_count, 0) AS route_count,
             vs.is_bus_only,
             vs.stop_priority,
             ST_AsMVTGeom(ST_Transform(vs.geometry, 3857), bounds.geom) AS geom
      FROM visible_stops vs
      CROSS JOIN bounds
      LEFT JOIN latest_metric_run lmr ON true
      LEFT JOIN od_metrics odm ON odm.metric_run_id = lmr.id AND odm.destination_stop_place_id = vs.id
      LEFT JOIN route_summary ON route_summary.stop_place_id = vs.id
    )
    SELECT ST_AsMVT(mvtgeom, 'stops', 4096, 'geom') AS tile FROM mvtgeom
    `,
    z,
    x,
    y,
    modes,
    profile,
  )
}

export async function routeTile(db: Queryable, z: number, x: number, y: number, modes: string[] = []): Promise<Buffer | null> {
  return mvtTile(
    db,
    `
    WITH bounds AS (
      SELECT ST_TileEnvelope($1, $2, $3) AS geom
    ),
    mvtgeom AS (
      SELECT rp.id::text,
             r.short_name,
             r.mode,
             CASE
               WHEN r.color ~ '^#[0-9A-Fa-f]{6}$' THEN r.color
               WHEN r.color ~ '^[0-9A-Fa-f]{6}$' THEN '#' || r.color
               ELSE NULL
             END AS route_color,
             rpd.geometry_quality,
             rpd.geometry_source,
             rpd.match_confidence::float8,
             rpd.match_status,
             ST_AsMVTGeom(
               ST_Transform(
                 CASE
                   WHEN $1 < 8 THEN ST_SimplifyPreserveTopology(rpd.geometry, 0.01)
                   WHEN $1 < 10 THEN ST_SimplifyPreserveTopology(rpd.geometry, 0.003)
                   ELSE rpd.geometry
                 END,
                 3857
               ),
               bounds.geom
             ) AS geom
      FROM route_patterns rp
      JOIN route_pattern_display_geometries rpd ON rpd.snapshot_id = rp.snapshot_id AND rpd.route_pattern_id = rp.id
      JOIN routes r ON r.id = rp.route_id AND r.snapshot_id = rp.snapshot_id
      JOIN data_snapshots snap ON snap.id = rp.snapshot_id AND snap.is_active = true
      CROSS JOIN bounds
      WHERE rpd.geometry IS NOT NULL
        AND ST_Intersects(ST_Transform(rpd.geometry, 3857), bounds.geom)
        AND (cardinality($4::text[]) = 0 OR r.mode = ANY($4::text[]))
    )
    SELECT ST_AsMVT(mvtgeom, 'routes', 4096, 'geom') AS tile FROM mvtgeom
    `,
    z,
    x,
    y,
    modes,
  )
}

export async function railNetworkTile(db: Queryable, z: number, x: number, y: number): Promise<Buffer | null> {
  return mvtTile(
    db,
    `
    WITH bounds AS (
      SELECT ST_TileEnvelope($1, $2, $3) AS geom
    ),
    mvtgeom AS (
      SELECT re.id::text,
             re.osm_id::text AS osm_id,
             re.railway,
             re.service,
             re.usage,
             re.is_service,
             ST_AsMVTGeom(
               ST_Transform(
                 CASE
                   WHEN $1 < 10 THEN ST_SimplifyPreserveTopology(re.geom, 0.002)
                   ELSE re.geom
                 END,
                 3857
               ),
               bounds.geom
             ) AS geom
      FROM rail_edges re
      CROSS JOIN bounds
      WHERE re.is_active = true
        AND cardinality($4::text[]) = 0
        AND ST_Intersects(ST_Transform(re.geom, 3857), bounds.geom)
    )
    SELECT ST_AsMVT(mvtgeom, 'rail-network', 4096, 'geom') AS tile FROM mvtgeom
    `,
    z,
    x,
    y,
  )
}

async function mvtTile(
  db: Queryable,
  sql: string,
  z: number,
  x: number,
  y: number,
  modes: string[] = [],
  ...extraParams: unknown[]
): Promise<Buffer | null> {
  const result = await db.query<{ tile: Buffer | null }>(sql, [z, x, y, modes, ...extraParams])

  return result.rows[0]?.tile ?? null
}
