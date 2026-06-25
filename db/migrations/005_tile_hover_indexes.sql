CREATE INDEX IF NOT EXISTS route_pattern_stops_stop_place_idx
  ON route_pattern_stops (snapshot_id, stop_place_id);

CREATE INDEX IF NOT EXISTS metric_runs_snapshot_profile_completed_idx
  ON metric_runs (snapshot_id, routing_profile_id, completed_at DESC, started_at DESC);

CREATE INDEX IF NOT EXISTS od_metrics_metric_run_destination_idx
  ON od_metrics (metric_run_id, destination_stop_place_id);
