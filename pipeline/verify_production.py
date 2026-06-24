from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://regionfinder:regionfinder@localhost:55432/regionfinder")
CERTIFIED_METRIC_ENGINES = {"motis_one_to_all", "r5py"}


def fail(message: str) -> None:
    raise SystemExit(f"production verification failed: {message}")


def main() -> None:
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.public_id, s.source_sha256, ds.source_key, s.quality_report
                FROM data_snapshots s
                JOIN data_sources ds ON ds.id = s.source_id
                WHERE s.is_active = true
                """
            )
            snapshot = cur.fetchone()
            if not snapshot:
                fail("no active snapshot")
            snapshot_id, public_id, gtfs_hash, source_key, quality_report = snapshot
            if source_key != "delfi_gtfs":
                fail(f"active source is not DELFI: {source_key}")
            if not gtfs_hash:
                fail("DELFI hash missing")
            if public_id.startswith("fixture"):
                fail("active snapshot is synthetic")
            cur.execute("SELECT count(*) FROM admin_boundaries WHERE state_code IN ('DE-HH','DE-SH','DE-MV','DE-NI')")
            if cur.fetchone()[0] != 4:
                fail("target admin boundaries missing")
            cur.execute(
                """
                SELECT state_code, count(*)
                FROM stop_places
                WHERE snapshot_id = %s AND state_code IN ('DE-HH','DE-SH','DE-MV','DE-NI')
                GROUP BY state_code
                """,
                [snapshot_id],
            )
            counts = dict(cur.fetchall())
            for state in ["DE-HH", "DE-SH", "DE-MV", "DE-NI"]:
                if counts.get(state, 0) == 0:
                    fail(f"no StopPlaces in {state}")
            cur.execute(
                """
                SELECT id, engine, engine_version, sample_count, raw_samples_sha256
                FROM metric_runs
                WHERE snapshot_id = %s AND status = 'completed'
                ORDER BY completed_at DESC
                LIMIT 1
                """,
                [snapshot_id],
            )
            metric_run = cur.fetchone()
            if not metric_run:
                fail("no completed metric run")
            metric_run_id, engine, engine_version, sample_count, raw_samples_sha256 = metric_run
            if engine not in CERTIFIED_METRIC_ENGINES:
                fail(f"metric engine is not certified: {engine}")
            if not engine_version:
                fail("metric engine version missing")
            if sample_count < 240:
                fail(f"metric sample count too low for production weekday profile: {sample_count}")
            if not raw_samples_sha256:
                fail("raw sample hash missing")
            cur.execute(
                """
                SELECT count(*)
                FROM od_metrics
                WHERE metric_run_id = %s
                """,
                [metric_run_id],
            )
            od_count = cur.fetchone()[0]
            if od_count == 0:
                fail("no od_metrics")
            cur.execute(
                """
                SELECT count(*)
                FROM stop_places
                WHERE snapshot_id = %s
                  AND state_code IN ('DE-HH','DE-SH','DE-MV','DE-NI')
                  AND is_display_stop = true
                """,
                [snapshot_id],
            )
            target_count = cur.fetchone()[0]
            if od_count < target_count:
                fail(f"metric coverage incomplete: {od_count} of {target_count} target StopPlaces")
            if not Path("data/reports/motis-build.json").exists() or json.loads(Path("data/reports/motis-build.json").read_text()).get("status") != "built":
                fail("MOTIS build report missing or failed")
    print(json.dumps({"status": "ok", "snapshot": public_id, "metric_engine": engine}, ensure_ascii=False))


if __name__ == "__main__":
    main()
