CREATE EXTENSION IF NOT EXISTS pgrouting;
CREATE EXTENSION IF NOT EXISTS hstore;

CREATE TABLE IF NOT EXISTS rail_vertices (
  id bigserial PRIMARY KEY,
  geom geometry(Point, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rail_vertices_geom_gix
  ON rail_vertices USING gist (geom);

CREATE TABLE IF NOT EXISTS rail_edges (
  id bigserial PRIMARY KEY,
  osm_id bigint,
  railway text NOT NULL,
  service text,
  usage text,
  name text,
  geom geometry(LineString, 4326) NOT NULL,
  source bigint REFERENCES rail_vertices(id),
  target bigint REFERENCES rail_vertices(id),
  length_meters numeric NOT NULL,
  cost numeric NOT NULL,
  reverse_cost numeric NOT NULL,
  is_service boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rail_edges_geom_gix
  ON rail_edges USING gist (geom);

CREATE INDEX IF NOT EXISTS rail_edges_source_target_idx
  ON rail_edges (source, target);

CREATE INDEX IF NOT EXISTS rail_edges_railway_idx
  ON rail_edges (railway);

CREATE TABLE IF NOT EXISTS stop_rail_snaps (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  stop_place_id uuid NOT NULL,
  edge_id bigint NOT NULL REFERENCES rail_edges(id) ON DELETE CASCADE,
  vertex_id bigint REFERENCES rail_vertices(id),
  candidate_rank integer NOT NULL DEFAULT 1,
  snap_geometry geometry(Point, 4326) NOT NULL,
  snap_distance_meters numeric NOT NULL,
  confidence numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, stop_place_id, candidate_rank)
);

CREATE INDEX IF NOT EXISTS stop_rail_snaps_stop_idx
  ON stop_rail_snaps (snapshot_id, stop_place_id);

CREATE INDEX IF NOT EXISTS stop_rail_snaps_geom_gix
  ON stop_rail_snaps USING gist (snap_geometry);

CREATE TABLE IF NOT EXISTS route_pattern_rail_matches (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  route_pattern_id uuid NOT NULL,
  geometry geometry(Geometry, 4326),
  confidence numeric NOT NULL DEFAULT 0,
  match_status text NOT NULL,
  failed_segments integer NOT NULL DEFAULT 0,
  total_segments integer NOT NULL DEFAULT 0,
  mean_snap_distance_meters numeric,
  max_snap_distance_meters numeric,
  detour_factor numeric,
  shape_deviation_meters numeric,
  source text NOT NULL DEFAULT 'osm_rail_network',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, route_pattern_id)
);

CREATE INDEX IF NOT EXISTS route_pattern_rail_matches_geom_gix
  ON route_pattern_rail_matches USING gist (geometry);

CREATE INDEX IF NOT EXISTS route_pattern_rail_matches_status_idx
  ON route_pattern_rail_matches (match_status, confidence);

DROP VIEW IF EXISTS route_pattern_display_geometries;

ALTER TABLE route_pattern_rail_matches
  ALTER COLUMN geometry TYPE geometry(Geometry, 4326)
  USING geometry::geometry(Geometry, 4326);

CREATE OR REPLACE VIEW route_pattern_display_geometries AS
SELECT rp.snapshot_id,
       rp.id AS route_pattern_id,
       CASE
         WHEN rm.confidence >= 0.70 AND rm.geometry IS NOT NULL THEN rm.geometry
         ELSE rp.geometry
       END AS geometry,
       CASE
         WHEN rm.confidence >= 0.70 AND rm.geometry IS NOT NULL THEN 'osm_reconstructed'
         WHEN rm.confidence >= 0.45 AND rm.geometry IS NOT NULL THEN 'osm_reconstructed_low_confidence'
         ELSE rp.geometry_quality
       END AS geometry_quality,
       CASE
         WHEN rm.confidence >= 0.45 AND rm.geometry IS NOT NULL THEN rm.source
         ELSE rp.geometry_source
       END AS geometry_source,
       rm.confidence AS match_confidence,
       rm.match_status,
       COALESCE(
         CASE WHEN rm.confidence >= 0.70 AND rm.geometry IS NOT NULL THEN ST_Length(rm.geometry::geography) END,
         rp.length_meters
       ) AS length_meters
FROM route_patterns rp
LEFT JOIN route_pattern_rail_matches rm
  ON rm.snapshot_id = rp.snapshot_id
 AND rm.route_pattern_id = rp.id;
