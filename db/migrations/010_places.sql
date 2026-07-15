CREATE TABLE IF NOT EXISTS places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text,
  source_place_id text,
  origin text NOT NULL DEFAULT 'imported' CHECK (origin IN ('imported', 'manual')),
  category text NOT NULL CHECK (category IN ('hof', 'ferienhof', 'gut', 'museum')),
  name text NOT NULL,
  state_code text CHECK (state_code IN ('HH', 'SH', 'MV', 'NI')),
  address text,
  website text,
  geometry geometry(Point, 4326) NOT NULL,
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (source_id, source_place_id)
);

CREATE INDEX IF NOT EXISTS places_geometry_gix ON places USING gist (geometry) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS places_category_idx ON places (category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS places_state_idx ON places (state_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS places_source_idx ON places (source_id, source_place_id);
