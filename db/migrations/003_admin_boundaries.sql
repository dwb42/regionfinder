CREATE TABLE IF NOT EXISTS admin_boundaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES data_sources(id),
  source_snapshot_id uuid REFERENCES data_snapshots(id),
  state_code text NOT NULL UNIQUE,
  name text NOT NULL,
  official_key text,
  original_crs text,
  source_layer text,
  geometry geometry(MultiPolygon, 4326) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_boundaries_geometry_gix
  ON admin_boundaries USING gist (geometry);

CREATE TABLE IF NOT EXISTS source_artifacts (
  source_key text PRIMARY KEY,
  source_name text NOT NULL,
  provider text NOT NULL,
  metadata_url text,
  resolved_download_url text,
  downloaded_at timestamptz,
  http_status integer,
  etag text,
  last_modified text,
  file_name text,
  file_size_bytes bigint,
  sha256 text,
  format text,
  license text,
  attribution text,
  valid_from date,
  valid_until date,
  validation_status text NOT NULL DEFAULT 'pending',
  integration_status text NOT NULL DEFAULT 'pending',
  notes text,
  raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
