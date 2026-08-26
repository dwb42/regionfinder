CREATE TABLE IF NOT EXISTS administrative_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL CHECK (level IN ('county', 'municipality')),
  official_key text NOT NULL,
  name text NOT NULL,
  area_type text NOT NULL,
  state_code text NOT NULL CHECK (state_code IN ('HH', 'SH', 'MV', 'NI')),
  parent_id uuid REFERENCES administrative_areas(id),
  source_id uuid REFERENCES data_sources(id),
  source_layer text NOT NULL,
  geometry geometry(MultiPolygon, 4326) NOT NULL,
  label_point geometry(Point, 4326) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (level, official_key),
  CONSTRAINT administrative_areas_hierarchy_check CHECK (
    (level = 'county' AND parent_id IS NULL)
    OR (level = 'municipality' AND parent_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS administrative_areas_geometry_gix
  ON administrative_areas USING gist (geometry)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS administrative_areas_label_point_gix
  ON administrative_areas USING gist (label_point)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS administrative_areas_active_level_state_idx
  ON administrative_areas (level, state_code, official_key)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS administrative_areas_parent_idx
  ON administrative_areas (parent_id)
  WHERE is_active = true AND parent_id IS NOT NULL;
