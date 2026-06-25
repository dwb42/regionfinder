ALTER TABLE route_stop_segments
  ADD COLUMN IF NOT EXISTS length_meters numeric;

UPDATE route_stop_segments
SET length_meters = ST_Length(geometry::geography)
WHERE length_meters IS NULL;

ALTER TABLE route_stop_segments
  ALTER COLUMN length_meters SET NOT NULL;

CREATE INDEX IF NOT EXISTS route_stop_segments_snapshot_route_length_idx
  ON route_stop_segments (snapshot_id, route_id, length_meters);
