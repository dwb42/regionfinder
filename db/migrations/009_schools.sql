CREATE TABLE IF NOT EXISTS schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL,
  source_school_id text NOT NULL,
  name text NOT NULL,
  school_category text NOT NULL CHECK (
    school_category IN ('gymnasium', 'comprehensive', 'waldorf', 'vocational', 'upper_secondary')
  ),
  school_type_label text NOT NULL,
  state_code text NOT NULL CHECK (state_code IN ('HH', 'SH', 'MV', 'NI')),
  address text,
  website text,
  geometry geometry(Point, 4326) NOT NULL,
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_school_id)
);

CREATE INDEX IF NOT EXISTS schools_geometry_gix ON schools USING gist (geometry);
CREATE INDEX IF NOT EXISTS schools_category_idx ON schools (school_category);
CREATE INDEX IF NOT EXISTS schools_state_idx ON schools (state_code);
