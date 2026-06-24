CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE snapshot_status AS ENUM (
    'created',
    'raw_validated',
    'importing',
    'imported',
    'normalized',
    'routing_ready',
    'metrics_ready',
    'active',
    'failed',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  name text NOT NULL,
  provider text NOT NULL,
  format text NOT NULL,
  role text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  license text,
  attribution text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS data_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  source_id uuid NOT NULL REFERENCES data_sources(id),
  status snapshot_status NOT NULL DEFAULT 'created',
  source_file_name text,
  source_sha256 text,
  import_config_sha256 text,
  valid_from date,
  valid_until date,
  imported_at timestamptz,
  activated_at timestamptz,
  pipeline_version text NOT NULL DEFAULT '0.1.0',
  quality_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS data_snapshots_one_active_idx
  ON data_snapshots (is_active)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS agencies (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_agency_id text NOT NULL,
  name text NOT NULL,
  url text,
  timezone text,
  language text,
  phone text,
  fare_url text,
  email text,
  PRIMARY KEY (snapshot_id, id),
  UNIQUE (id),
  UNIQUE (snapshot_id, source_agency_id)
);

CREATE TABLE IF NOT EXISTS stop_places (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  public_id text NOT NULL,
  dhid text,
  name text NOT NULL,
  normalized_name text NOT NULL,
  geometry geometry(Point, 4326) NOT NULL,
  state_code text,
  municipality_code text,
  municipality_name text,
  modes text[] NOT NULL DEFAULT '{}',
  identity_quality text NOT NULL DEFAULT 'missing_dhid',
  source_priority integer NOT NULL DEFAULT 100,
  is_display_stop boolean NOT NULL DEFAULT true,
  PRIMARY KEY (snapshot_id, id),
  UNIQUE (id),
  UNIQUE (snapshot_id, public_id),
  UNIQUE (snapshot_id, dhid)
);

CREATE INDEX IF NOT EXISTS stop_places_geometry_gix ON stop_places USING gist (geometry);
CREATE INDEX IF NOT EXISTS stop_places_name_idx ON stop_places (normalized_name);
CREATE INDEX IF NOT EXISTS stop_places_state_idx ON stop_places (state_code);

CREATE TABLE IF NOT EXISTS stops (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_stop_id text NOT NULL,
  stop_place_id uuid REFERENCES stop_places(id),
  dhid text,
  name text NOT NULL,
  geometry geometry(Point, 4326) NOT NULL,
  location_type integer,
  platform_code text,
  zone_id text,
  wheelchair_boarding integer,
  parent_source_stop_id text,
  quay_type text,
  source_id uuid REFERENCES data_sources(id),
  PRIMARY KEY (snapshot_id, id),
  UNIQUE (id),
  UNIQUE (snapshot_id, source_stop_id)
);

CREATE INDEX IF NOT EXISTS stops_geometry_gix ON stops USING gist (geometry);

CREATE TABLE IF NOT EXISTS stop_source_links (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  stop_place_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES data_sources(id),
  source_stop_id text NOT NULL,
  match_method text NOT NULL,
  match_confidence numeric,
  match_distance_meters numeric,
  review_status text NOT NULL DEFAULT 'pending',
  PRIMARY KEY (snapshot_id, stop_place_id, source_id, source_stop_id)
);

CREATE TABLE IF NOT EXISTS stop_aliases (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  stop_place_id uuid NOT NULL,
  alias text NOT NULL,
  language text,
  source_id uuid REFERENCES data_sources(id),
  PRIMARY KEY (snapshot_id, stop_place_id, alias)
);

CREATE TABLE IF NOT EXISTS routes (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_route_id text NOT NULL,
  agency_id uuid,
  short_name text,
  long_name text,
  route_type_raw integer,
  mode text NOT NULL,
  color text,
  text_color text,
  url text,
  source_id uuid REFERENCES data_sources(id),
  PRIMARY KEY (snapshot_id, id),
  UNIQUE (id),
  UNIQUE (snapshot_id, source_route_id)
);

CREATE TABLE IF NOT EXISTS route_patterns (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL,
  direction_id integer,
  pattern_hash text NOT NULL,
  ordered_stop_hash text NOT NULL,
  shape_id text,
  headsign text,
  geometry geometry(LineString, 4326),
  geometry_quality text NOT NULL,
  geometry_source text NOT NULL,
  length_meters numeric,
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (snapshot_id, id),
  UNIQUE (id),
  UNIQUE (snapshot_id, route_id, pattern_hash)
);

CREATE INDEX IF NOT EXISTS route_patterns_geometry_gix ON route_patterns USING gist (geometry);

CREATE TABLE IF NOT EXISTS route_pattern_stops (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  route_pattern_id uuid NOT NULL,
  stop_sequence integer NOT NULL,
  stop_id uuid NOT NULL,
  stop_place_id uuid,
  pickup_type integer,
  drop_off_type integer,
  timepoint integer,
  shape_distance_meters numeric,
  PRIMARY KEY (snapshot_id, route_pattern_id, stop_sequence)
);

CREATE TABLE IF NOT EXISTS trips (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_trip_id text NOT NULL,
  route_id uuid NOT NULL,
  route_pattern_id uuid,
  service_id text NOT NULL,
  shape_id text,
  direction_id integer,
  headsign text,
  block_id text,
  wheelchair_accessible integer,
  bikes_allowed integer,
  PRIMARY KEY (snapshot_id, id),
  UNIQUE (id),
  UNIQUE (snapshot_id, source_trip_id)
);

CREATE TABLE IF NOT EXISTS stop_times (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL,
  stop_sequence integer NOT NULL,
  stop_id uuid NOT NULL,
  arrival_seconds integer NOT NULL,
  departure_seconds integer NOT NULL,
  pickup_type integer,
  drop_off_type integer,
  timepoint integer,
  shape_distance_meters numeric,
  PRIMARY KEY (snapshot_id, trip_id, stop_sequence)
);

CREATE TABLE IF NOT EXISTS service_dates (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  service_id text NOT NULL,
  service_date date NOT NULL,
  source text NOT NULL,
  is_active boolean NOT NULL,
  PRIMARY KEY (snapshot_id, service_id, service_date)
);

CREATE TABLE IF NOT EXISTS transfers (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  from_stop_id uuid NOT NULL,
  to_stop_id uuid NOT NULL,
  transfer_type integer,
  min_transfer_time_seconds integer,
  from_route_id uuid,
  to_route_id uuid,
  from_trip_id uuid,
  to_trip_id uuid,
  PRIMARY KEY (snapshot_id, from_stop_id, to_stop_id)
);

CREATE TABLE IF NOT EXISTS pathways (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  pathway_id text NOT NULL,
  from_stop_id uuid NOT NULL,
  to_stop_id uuid NOT NULL,
  pathway_mode integer,
  is_bidirectional boolean NOT NULL DEFAULT false,
  length_meters numeric,
  traversal_time_seconds integer,
  stair_count integer,
  max_slope numeric,
  min_width numeric,
  PRIMARY KEY (snapshot_id, pathway_id)
);

CREATE TABLE IF NOT EXISTS footpaths (
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  from_stop_id uuid NOT NULL,
  to_stop_id uuid NOT NULL,
  duration_seconds integer NOT NULL,
  distance_meters numeric,
  geometry geometry(LineString, 4326),
  source text NOT NULL,
  quality text NOT NULL,
  is_bidirectional boolean NOT NULL DEFAULT true,
  PRIMARY KEY (snapshot_id, from_stop_id, to_stop_id, source)
);

CREATE TABLE IF NOT EXISTS routing_profiles (
  id text NOT NULL,
  version integer NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL,
  sample_start_seconds integer NOT NULL,
  sample_end_seconds integer NOT NULL,
  sample_interval_seconds integer NOT NULL,
  max_trip_duration_seconds integer NOT NULL,
  max_walk_distance_meters numeric NOT NULL,
  walk_speed_meters_per_second numeric NOT NULL,
  max_transfers integer NOT NULL,
  modes text[] NOT NULL,
  config jsonb NOT NULL,
  config_sha256 text NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS metric_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  routing_profile_id text NOT NULL,
  origin_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL,
  sample_count integer NOT NULL DEFAULT 0,
  engine text NOT NULL,
  engine_version text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_samples_artifact_uri text,
  raw_samples_sha256 text
);

CREATE TABLE IF NOT EXISTS od_metrics (
  metric_run_id uuid NOT NULL REFERENCES metric_runs(id) ON DELETE CASCADE,
  origin_stop_place_id uuid NOT NULL,
  destination_stop_place_id uuid NOT NULL,
  total_sample_count integer NOT NULL,
  reachable_sample_count integer NOT NULL,
  unreachable_sample_count integer NOT NULL,
  reachability_ratio numeric NOT NULL,
  fastest_seconds integer,
  average_seconds numeric,
  median_seconds numeric,
  p90_seconds integer,
  p90_publishable boolean NOT NULL,
  median_publishable boolean NOT NULL,
  minimum_transfers integer,
  median_transfers numeric,
  direct_connection_ratio numeric,
  average_initial_wait_seconds numeric,
  median_initial_wait_seconds numeric,
  average_walk_seconds numeric,
  average_in_vehicle_seconds numeric,
  first_connection_at timestamptz,
  last_connection_at timestamptz,
  max_service_gap_seconds integer,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_run_id, origin_stop_place_id, destination_stop_place_id)
);

CREATE TABLE IF NOT EXISTS itineraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
  routing_profile_id text NOT NULL,
  origin_stop_place_id uuid NOT NULL,
  destination_stop_place_id uuid NOT NULL,
  requested_departure_at timestamptz NOT NULL,
  actual_first_departure_at timestamptz,
  arrival_at timestamptz,
  total_duration_seconds integer,
  initial_walk_seconds integer,
  initial_wait_seconds integer,
  in_vehicle_seconds integer,
  transfer_wait_seconds integer,
  walking_seconds integer,
  walking_distance_meters numeric,
  transit_distance_meters numeric,
  total_distance_meters numeric,
  transfer_count integer,
  provider text NOT NULL,
  signature text NOT NULL,
  rank_type text NOT NULL
);

CREATE TABLE IF NOT EXISTS itinerary_legs (
  itinerary_id uuid NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  leg_type text NOT NULL CHECK (leg_type IN ('walk', 'transit', 'transfer', 'wait')),
  mode text,
  route_id uuid,
  route_pattern_id uuid,
  trip_id uuid,
  agency_id uuid,
  from_stop_id uuid,
  to_stop_id uuid,
  departure_at timestamptz,
  arrival_at timestamptz,
  duration_seconds integer,
  distance_meters numeric,
  geometry geometry(LineString, 4326),
  headsign text,
  platform_from text,
  platform_to text,
  PRIMARY KEY (itinerary_id, sequence)
);
