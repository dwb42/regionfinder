CREATE INDEX IF NOT EXISTS stop_places_display_geometry_gix
  ON stop_places USING gist (geometry)
  WHERE is_display_stop = true;

CREATE INDEX IF NOT EXISTS stop_places_modes_gin
  ON stop_places USING gin (modes);

CREATE INDEX IF NOT EXISTS routes_snapshot_mode_id_idx
  ON routes (snapshot_id, mode, id);

CREATE INDEX IF NOT EXISTS route_patterns_active_route_idx
  ON route_patterns (snapshot_id, route_id, id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS rail_edges_active_geom_gix
  ON rail_edges USING gist (geom)
  WHERE is_active = true;
