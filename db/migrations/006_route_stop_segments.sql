CREATE TABLE IF NOT EXISTS route_stop_segments (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  route_id uuid NOT NULL,
  from_stop_place_id uuid NOT NULL REFERENCES stop_places(id),
  to_stop_place_id uuid NOT NULL REFERENCES stop_places(id),
  geometry geometry(LineString, 4326) NOT NULL,
  length_meters numeric NOT NULL,
  PRIMARY KEY (snapshot_id, route_id, from_stop_place_id, to_stop_place_id),
  FOREIGN KEY (snapshot_id, route_id) REFERENCES routes(snapshot_id, id) ON DELETE CASCADE,
  CHECK (from_stop_place_id <> to_stop_place_id)
);

CREATE INDEX IF NOT EXISTS route_stop_segments_geometry_gix
  ON route_stop_segments USING gist (geometry);

CREATE INDEX IF NOT EXISTS route_stop_segments_snapshot_route_idx
  ON route_stop_segments (snapshot_id, route_id);

CREATE INDEX IF NOT EXISTS route_stop_segments_snapshot_route_length_idx
  ON route_stop_segments (snapshot_id, route_id, length_meters);

INSERT INTO route_stop_segments (
  snapshot_id, route_id, from_stop_place_id, to_stop_place_id, geometry, length_meters
)
WITH ordered_stops AS (
  SELECT rps.snapshot_id,
         rp.route_id,
         rps.stop_place_id,
         lead(rps.stop_place_id) OVER (
           PARTITION BY rps.snapshot_id, rps.route_pattern_id
           ORDER BY rps.stop_sequence
         ) AS next_stop_place_id
  FROM route_pattern_stops rps
  JOIN route_patterns rp
    ON rp.snapshot_id = rps.snapshot_id
   AND rp.id = rps.route_pattern_id
  WHERE rps.stop_place_id IS NOT NULL
),
segment_pairs AS (
  SELECT DISTINCT
         os.snapshot_id,
         os.route_id,
         LEAST(os.stop_place_id, os.next_stop_place_id) AS from_stop_place_id,
         GREATEST(os.stop_place_id, os.next_stop_place_id) AS to_stop_place_id
  FROM ordered_stops os
  WHERE os.next_stop_place_id IS NOT NULL
    AND os.stop_place_id <> os.next_stop_place_id
)
SELECT sp.snapshot_id,
       sp.route_id,
       sp.from_stop_place_id,
       sp.to_stop_place_id,
       ST_MakeLine(from_stop.geometry, to_stop.geometry) AS geometry,
       ST_Length(ST_MakeLine(from_stop.geometry, to_stop.geometry)::geography) AS length_meters
FROM segment_pairs sp
JOIN stop_places from_stop
  ON from_stop.snapshot_id = sp.snapshot_id
 AND from_stop.id = sp.from_stop_place_id
JOIN stop_places to_stop
  ON to_stop.snapshot_id = sp.snapshot_id
 AND to_stop.id = sp.to_stop_place_id
ON CONFLICT (snapshot_id, route_id, from_stop_place_id, to_stop_place_id) DO NOTHING;
