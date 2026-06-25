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
      SELECT ST_TileEnvelope($1, $2, $3) AS geom,
             ST_Transform(ST_TileEnvelope($1, $2, $3, margin => 96.0 / 2048.0), 4326) AS query_wgs84
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
      WHERE sp.geometry && bounds.query_wgs84
        AND ST_Intersects(sp.geometry, bounds.query_wgs84)
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
      WHERE $1 >= 9
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
             ST_AsMVTGeom(ST_Transform(vs.geometry, 3857), bounds.geom, 2048, 96, true) AS geom
      FROM visible_stops vs
      CROSS JOIN bounds
      LEFT JOIN latest_metric_run lmr ON true
      LEFT JOIN od_metrics odm ON odm.metric_run_id = lmr.id AND odm.destination_stop_place_id = vs.id
      LEFT JOIN route_summary ON route_summary.stop_place_id = vs.id
    )
    SELECT ST_AsMVT(mvtgeom, 'stops', 2048, 'geom') AS tile FROM mvtgeom
    `,
    z,
    x,
    y,
    modes,
    profile,
  )
}

export async function routeTile(
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
      SELECT ST_TileEnvelope($1, $2, $3) AS geom,
             ST_Transform(ST_TileEnvelope($1, $2, $3, margin => 96.0 / 2048.0), 4326) AS query_wgs84
    ),
    active_snapshot AS (
      SELECT id
      FROM data_snapshots
      WHERE is_active = true
      LIMIT 1
    ),
    latest_metric_run AS (
      SELECT mr.id
      FROM metric_runs mr
      JOIN active_snapshot snap ON snap.id = mr.snapshot_id
      WHERE mr.routing_profile_id = $5
      ORDER BY mr.completed_at DESC NULLS LAST, mr.started_at DESC
      LIMIT 1
    ),
    route_lines AS (
      SELECT rp.id::text,
             r.short_name,
             r.mode,
             CASE
               WHEN r.color ~ '^#[0-9A-Fa-f]{6}$' THEN r.color
               WHEN r.color ~ '^[0-9A-Fa-f]{6}$' THEN '#' || r.color
             ELSE NULL
             END AS route_color,
             rp.geometry_quality,
             rp.geometry_source,
             NULL::float8 AS match_confidence,
             NULL::text AS match_status,
             NULL::integer AS from_fastest_seconds,
             NULL::integer AS to_fastest_seconds,
             NULL::float8 AS segment_length_meters,
             ST_AsMVTGeom(
               ST_Transform(
                 CASE
                   WHEN $1 < 8 THEN ST_SimplifyPreserveTopology(rp.geometry, 0.01)
                   WHEN $1 < 10 THEN ST_SimplifyPreserveTopology(rp.geometry, 0.003)
                   ELSE rp.geometry
                 END,
                 3857
               ),
               bounds.geom,
               2048,
               96,
               true
             ) AS geom
      FROM route_patterns rp
      JOIN routes r ON r.id = rp.route_id AND r.snapshot_id = rp.snapshot_id
      JOIN active_snapshot snap ON snap.id = rp.snapshot_id
      CROSS JOIN bounds
      WHERE $1 >= 9
        AND rp.geometry IS NOT NULL
        AND r.mode <> ALL(ARRAY['ICE', 'IC', 'EC', 'RE', 'RB', 'RAIL', 'S', 'AKN', 'U']::text[])
        AND rp.geometry && bounds.query_wgs84
        AND ST_Intersects(rp.geometry, bounds.query_wgs84)
        AND (cardinality($4::text[]) = 0 OR r.mode = ANY($4::text[]))
    ),
    rail_segments AS (
      SELECT rss.route_id::text || ':' || rss.from_stop_place_id::text || ':' || rss.to_stop_place_id::text AS id,
             r.short_name,
             r.mode,
             CASE
               WHEN r.color ~ '^#[0-9A-Fa-f]{6}$' THEN r.color
               WHEN r.color ~ '^[0-9A-Fa-f]{6}$' THEN '#' || r.color
               ELSE NULL
             END AS route_color,
             'stop_pair_segment'::text AS geometry_quality,
             'route_pattern_stops'::text AS geometry_source,
             NULL::float8 AS match_confidence,
             NULL::text AS match_status,
             from_metric.fastest_seconds AS from_fastest_seconds,
             to_metric.fastest_seconds AS to_fastest_seconds,
             rss.length_meters::float8 AS segment_length_meters,
             ST_AsMVTGeom(ST_Transform(rss.geometry, 3857), bounds.geom, 2048, 96, true) AS geom
      FROM route_stop_segments rss
      JOIN routes r ON r.snapshot_id = rss.snapshot_id AND r.id = rss.route_id
      JOIN active_snapshot snap ON snap.id = rss.snapshot_id
      CROSS JOIN bounds
      LEFT JOIN latest_metric_run lmr ON true
      LEFT JOIN od_metrics from_metric
        ON from_metric.metric_run_id = lmr.id
       AND from_metric.destination_stop_place_id = rss.from_stop_place_id
      LEFT JOIN od_metrics to_metric
        ON to_metric.metric_run_id = lmr.id
       AND to_metric.destination_stop_place_id = rss.to_stop_place_id
      WHERE r.mode = ANY(ARRAY['ICE', 'IC', 'EC', 'RE', 'RB', 'RAIL', 'S', 'AKN', 'U']::text[])
        AND rss.length_meters <= CASE
          WHEN r.mode = 'U' THEN 8000
          WHEN r.mode = ANY(ARRAY['S', 'AKN']::text[]) THEN 15000
          ELSE 20000
        END
        AND rss.geometry && bounds.query_wgs84
        AND ST_Intersects(rss.geometry, bounds.query_wgs84)
        AND (cardinality($4::text[]) = 0 OR r.mode = ANY($4::text[]))
    ),
    mvtgeom AS (
      SELECT * FROM route_lines
      UNION ALL
      SELECT * FROM rail_segments
    )
    SELECT ST_AsMVT(mvtgeom, 'routes', 2048, 'geom') AS tile FROM mvtgeom
    `,
    z,
    x,
    y,
    modes,
    profile,
  )
}

export async function railNetworkTile(db: Queryable, z: number, x: number, y: number): Promise<Buffer | null> {
  return mvtTile(
    db,
    `
    WITH bounds AS (
      SELECT ST_TileEnvelope($1, $2, $3) AS geom,
             ST_Transform(ST_TileEnvelope($1, $2, $3, margin => 96.0 / 2048.0), 4326) AS query_wgs84
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
               bounds.geom,
               2048,
               96,
               true
             ) AS geom
      FROM rail_edges re
      CROSS JOIN bounds
      WHERE re.is_active = true
        AND cardinality($4::text[]) = 0
        AND re.geom && bounds.query_wgs84
        AND ST_Intersects(re.geom, bounds.query_wgs84)
    )
    SELECT ST_AsMVT(mvtgeom, 'rail-network', 2048, 'geom') AS tile FROM mvtgeom
    `,
    z,
    x,
    y,
  )
}

export async function schoolTile(
  db: Queryable,
  z: number,
  x: number,
  y: number,
  categories: string[] = [],
  states: string[] = [],
): Promise<Buffer | null> {
  return mvtTile(
    db,
    `
    WITH bounds AS (
      SELECT ST_TileEnvelope($1, $2, $3) AS geom,
             ST_Transform(ST_TileEnvelope($1, $2, $3, margin => 96.0 / 2048.0), 4326) AS query_wgs84
    ),
    mvtgeom AS (
      SELECT s.id::text AS id,
             s.name,
             s.school_category,
             s.school_type_label,
             s.state_code,
             ST_AsMVTGeom(ST_Transform(s.geometry, 3857), bounds.geom, 2048, 96, true) AS geom
      FROM schools s
      CROSS JOIN bounds
      WHERE s.geometry && bounds.query_wgs84
        AND ST_Intersects(s.geometry, bounds.query_wgs84)
        AND (cardinality($4::text[]) = 0 OR s.school_category = ANY($4::text[]))
        AND (cardinality($5::text[]) = 0 OR s.state_code = ANY($5::text[]))
    )
    SELECT ST_AsMVT(mvtgeom, 'schools', 2048, 'geom') AS tile FROM mvtgeom
    `,
    z,
    x,
    y,
    categories,
    states,
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
