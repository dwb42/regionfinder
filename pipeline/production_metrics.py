from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import subprocess
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Protocol
from zoneinfo import ZoneInfo

import psycopg
import yaml

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://regionfinder:regionfinder@localhost:55432/regionfinder")
REPORT = Path("data/reports/production-metrics.json")
SNAPSHOT_PUBLIC_ID_PATH = Path("data/processed/production-snapshot-id.txt")
PROFILE_PATH = Path(os.environ.get("ROUTING_PROFILES_PATH", "config/routing-profiles.yml"))
MOTIS_REPORT = Path("data/reports/motis-build.json")
MOTIS_GRAPH = Path(os.environ.get("MOTIS_GRAPH_DIR", "data/routing/motis/graph"))
MOTIS_BIN = Path(os.environ.get("MOTIS_BIN", "data/routing/motis/bin/motis")).resolve()
MOTIS_BASE_URL = os.environ.get("MOTIS_BASE_URL", "http://localhost:8080")
PROFILE_ID = os.environ.get("REGIONFINDER_PRODUCTION_PROFILE", "regular_tue_thu")
ORIGIN_PUBLIC_ID = os.environ.get("REGIONFINDER_ORIGIN_PUBLIC_ID", "de:02000:10950_G")
ORIGIN_MOTIS_ID = os.environ.get("REGIONFINDER_ORIGIN_MOTIS_ID", f"gtfs_{ORIGIN_PUBLIC_ID}")
STATES = ("DE-HH", "DE-SH", "DE-MV", "DE-NI")
ENGINE_KEY = "motis_one_to_all"
METRIC_DEFINITION_VERSION = "2026-06-24.nearest-rank-p90"


@dataclass(frozen=True)
class MetricEngineCapabilities:
    supports_one_to_all: bool
    includes_initial_wait: bool
    provides_leg_breakdown: bool
    duration_resolution_seconds: int


@dataclass(frozen=True)
class MetricRunContext:
    snapshot_id: str
    snapshot_public_id: str
    routing_profile_id: str
    origin_stop_place_id: str
    origin_public_id: str
    origin_motis_id: str
    profile: dict
    motis_base_url: str
    max_trip_duration_seconds: int
    motis_max_travel_minutes: int


@dataclass(frozen=True)
class ValidationReport:
    ok: bool
    details: dict


@dataclass(frozen=True)
class ReachabilitySample:
    requested_departure_at: datetime
    destination_stop_place_id: str
    duration_seconds: int | None
    transit_leg_count: int | None
    destination_source_stop_id: str | None


class TransitMetricEngine(Protocol):
    engine_key: str
    engine_version: str
    capabilities: MetricEngineCapabilities

    def validate(self, context: MetricRunContext) -> ValidationReport:
        ...

    def compute_samples(
        self,
        context: MetricRunContext,
        sample_times: Iterable[datetime],
    ) -> Iterable[ReachabilitySample]:
        ...


@dataclass
class DestinationAccumulator:
    values: list[int] = field(default_factory=list)
    transfer_counts: list[int] = field(default_factory=list)
    first_reachable: datetime | None = None
    last_reachable: datetime | None = None
    previous_reachable: datetime | None = None
    max_gap_seconds: int | None = None

    def add(self, requested_at: datetime, duration_seconds: int, transit_leg_count: int | None) -> None:
        self.values.append(duration_seconds)
        if transit_leg_count is not None:
            self.transfer_counts.append(max(0, transit_leg_count - 1))
        if self.first_reachable is None:
            self.first_reachable = requested_at
        if self.previous_reachable is not None:
            gap = int((requested_at - self.previous_reachable).total_seconds())
            self.max_gap_seconds = gap if self.max_gap_seconds is None else max(self.max_gap_seconds, gap)
        self.previous_reachable = requested_at
        self.last_reachable = requested_at


class MotisOneToAllMetricEngine:
    engine_key = ENGINE_KEY
    engine_version = "motis-v2.10.2"
    capabilities = MetricEngineCapabilities(
        supports_one_to_all=True,
        includes_initial_wait=True,
        provides_leg_breakdown=False,
        duration_resolution_seconds=60,
    )

    def __init__(self, stop_to_place: dict[str, str], raw_samples_path: Path):
        self.stop_to_place = stop_to_place
        self.raw_samples_path = raw_samples_path

    def validate(self, context: MetricRunContext) -> ValidationReport:
        params = {
            "one": context.origin_motis_id,
            "maxTravelTime": "1",
            "time": sample_times(context.profile)[0].isoformat(),
            "arriveBy": "false",
            "transitModes": "TRANSIT",
        }
        url = f"{context.motis_base_url}/api/v1/one-to-all?{urllib.parse.urlencode(params)}"
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                ok = response.status == 200
                payload = json.loads(response.read().decode("utf-8")) if ok else {}
        except Exception as error:  # noqa: BLE001 - validation report keeps exact runtime error
            return ValidationReport(False, {"error": str(error), "url": url})
        origin_ok = isinstance(payload, dict) and isinstance(payload.get("one"), dict) and payload["one"].get("stopId") == context.origin_motis_id
        return ValidationReport(ok and origin_ok, {"origin_ok": origin_ok, "url": url})

    def compute_samples(
        self,
        context: MetricRunContext,
        sample_times: Iterable[datetime],
    ) -> Iterable[ReachabilitySample]:
        self.raw_samples_path.parent.mkdir(parents=True, exist_ok=True)
        max_minutes = context.motis_max_travel_minutes
        with gzip.open(self.raw_samples_path, "wt", encoding="utf-8") as raw:
            for requested_at in sample_times:
                local_iso = requested_at.isoformat()
                params = {
                    "one": context.origin_motis_id,
                    "maxTravelTime": str(max_minutes),
                    "time": local_iso,
                    "arriveBy": "false",
                    "maxTransfers": str(context.profile["max_transfers"]),
                    "transitModes": "TRANSIT",
                    "preTransitModes": "WALK",
                    "postTransitModes": "WALK",
                    "useRoutedTransfers": "true",
                }
                url = f"{context.motis_base_url}/api/v1/one-to-all?{urllib.parse.urlencode(params)}"
                started = time.time()
                with urllib.request.urlopen(url, timeout=600) as response:
                    body = response.read()
                payload = json.loads(body.decode("utf-8"))
                if "error" in payload:
                    raise RuntimeError(f"MOTIS one-to-all failed for {local_iso}: {payload['error']}")

                best_by_place: dict[str, tuple[int, int | None, str]] = {}
                for entry in payload.get("all", []):
                    place = entry.get("place") if isinstance(entry, dict) else None
                    if not isinstance(place, dict):
                        continue
                    motis_stop_id = place.get("stopId")
                    if not isinstance(motis_stop_id, str) or not motis_stop_id.startswith("gtfs_"):
                        continue
                    source_stop_id = motis_stop_id.removeprefix("gtfs_")
                    stop_place_id = self.stop_to_place.get(source_stop_id)
                    if stop_place_id is None:
                        continue
                    duration_minutes = entry.get("duration")
                    if not isinstance(duration_minutes, (int, float)):
                        continue
                    duration_seconds = int(round(float(duration_minutes) * 60))
                    if duration_seconds > context.max_trip_duration_seconds:
                        continue
                    transit_leg_count = entry.get("k") if isinstance(entry.get("k"), int) else None
                    previous = best_by_place.get(stop_place_id)
                    if previous is None or duration_seconds < previous[0]:
                        best_by_place[stop_place_id] = (duration_seconds, transit_leg_count, source_stop_id)

                raw.write(
                    json.dumps(
                        {
                            "requested_departure_at": local_iso,
                            "reachable_stop_place_count": len(best_by_place),
                            "engine": self.engine_key,
                            "engine_version": self.engine_version,
                            "elapsed_seconds": time.time() - started,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                for stop_place_id, (duration_seconds, transit_leg_count, source_stop_id) in best_by_place.items():
                    yield ReachabilitySample(
                        requested_departure_at=requested_at,
                        destination_stop_place_id=stop_place_id,
                        duration_seconds=duration_seconds,
                        transit_leg_count=transit_leg_count,
                        destination_source_stop_id=source_stop_id,
                    )


def parse_hms(value: str) -> int:
    hours, minutes, seconds = [int(part) for part in value.split(":")]
    return hours * 3600 + minutes * 60 + seconds


def sample_times(profile: dict) -> list[datetime]:
    tz = ZoneInfo(profile.get("timezone", "Europe/Berlin"))
    start_seconds = parse_hms(profile["sample_start"])
    end_seconds = parse_hms(profile["sample_end"])
    interval = int(profile["sample_interval_seconds"])
    dates = [datetime.strptime(date_text, "%Y-%m-%d").date() for date_text in profile["dates"]]
    override_dates = os.environ.get("REGIONFINDER_PRODUCTION_DATES")
    if override_dates:
        dates = [datetime.strptime(date_text.strip(), "%Y-%m-%d").date() for date_text in override_dates.split(",") if date_text.strip()]
    times: list[datetime] = []
    for service_date in dates:
        base = datetime(service_date.year, service_date.month, service_date.day, tzinfo=tz)
        current = start_seconds
        while current < end_seconds:
            times.append(base + timedelta(seconds=current))
            current += interval
    sample_limit = os.environ.get("REGIONFINDER_PRODUCTION_SAMPLE_LIMIT")
    if sample_limit:
        times = times[: int(sample_limit)]
    return times


def median_seconds(values: list[int]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[mid])
    return (ordered[mid - 1] + ordered[mid]) / 2


def p90_nearest_rank(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[math.ceil(0.9 * len(ordered)) - 1]


def average(values: list[int]) -> float | None:
    return None if not values else sum(values) / len(values)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_profile() -> dict:
    raw = yaml.safe_load(PROFILE_PATH.read_text(encoding="utf-8"))
    for profile in raw["profiles"]:
        if profile["id"] == PROFILE_ID:
            profile = dict(profile)
            profile["timezone"] = raw.get("timezone", "Europe/Berlin")
            profile["version"] = raw.get("version", 1)
            return profile
    raise SystemExit(f"Routing profile not found: {PROFILE_ID}")


def ensure_motis_server() -> subprocess.Popen[str] | None:
    try:
        with urllib.request.urlopen(f"{MOTIS_BASE_URL}/api/v1/geocode?text=Hamburg&language=de", timeout=5) as response:
            if response.status == 200:
                return None
    except Exception:
        pass
    process = subprocess.Popen(
        [str(MOTIS_BIN), "server", "-d", "data", "--log-level", "info"],
        cwd=MOTIS_GRAPH,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    for _ in range(120):
        try:
            with urllib.request.urlopen(f"{MOTIS_BASE_URL}/api/v1/geocode?text=Hamburg&language=de", timeout=2) as response:
                if response.status == 200:
                    return process
        except Exception:
            time.sleep(1)
    process.terminate()
    raise SystemExit("MOTIS server did not become ready")


def stop_motis_server(process: subprocess.Popen[str] | None) -> None:
    if process is None:
        return
    process.terminate()
    try:
        process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def upsert_routing_profile(cur: psycopg.Cursor, profile: dict) -> None:
    config_json = json.dumps(profile, sort_keys=True)
    config_sha = hashlib.sha256(config_json.encode("utf-8")).hexdigest()
    cur.execute(
        """
        INSERT INTO routing_profiles (
          id, version, name, timezone, sample_start_seconds, sample_end_seconds,
          sample_interval_seconds, max_trip_duration_seconds, max_walk_distance_meters,
          walk_speed_meters_per_second, max_transfers, modes, config, config_sha256
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
        ON CONFLICT (id, version) DO UPDATE
        SET name = EXCLUDED.name,
            timezone = EXCLUDED.timezone,
            sample_start_seconds = EXCLUDED.sample_start_seconds,
            sample_end_seconds = EXCLUDED.sample_end_seconds,
            sample_interval_seconds = EXCLUDED.sample_interval_seconds,
            max_trip_duration_seconds = EXCLUDED.max_trip_duration_seconds,
            max_walk_distance_meters = EXCLUDED.max_walk_distance_meters,
            walk_speed_meters_per_second = EXCLUDED.walk_speed_meters_per_second,
            max_transfers = EXCLUDED.max_transfers,
            modes = EXCLUDED.modes,
            config = EXCLUDED.config,
            config_sha256 = EXCLUDED.config_sha256
        """,
        [
            profile["id"],
            profile["version"],
            profile["name"],
            profile["timezone"],
            parse_hms(profile["sample_start"]),
            parse_hms(profile["sample_end"]),
            profile["sample_interval_seconds"],
            profile["max_trip_duration_seconds"],
            profile["max_walk_distance_meters"],
            profile["walk_speed_meters_per_second"],
            profile["max_transfers"],
            profile["modes"],
            config_json,
            config_sha,
        ],
    )


def main() -> None:
    if not SNAPSHOT_PUBLIC_ID_PATH.exists():
        raise SystemExit("No production snapshot id found; run pipeline:import:production first")
    if not MOTIS_REPORT.exists() or json.loads(MOTIS_REPORT.read_text(encoding="utf-8")).get("status") != "built":
        raise SystemExit("Refusing to compute production metrics without a built MOTIS graph")

    snapshot_public_id = SNAPSHOT_PUBLIC_ID_PATH.read_text(encoding="utf-8").strip()
    profile = load_profile()
    requested_times = sample_times(profile)
    motis_max_travel_minutes = int(
        os.environ.get(
            "REGIONFINDER_MOTIS_MAX_TRAVEL_MINUTES",
            str(min(240, math.ceil(int(profile["max_trip_duration_seconds"]) / 60))),
        )
    )
    if not requested_times:
        raise SystemExit("Routing profile produced no sample times")

    server_process = ensure_motis_server()
    started_at = datetime.now(timezone.utc)
    raw_samples_path = Path(f"data/processed/metrics/{snapshot_public_id}/{PROFILE_ID}/motis-one-to-all-samples.jsonl.gz")
    report: dict = {}

    try:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, valid_from, valid_until, quality_report
                    FROM data_snapshots
                    WHERE public_id = %s
                    """,
                    [snapshot_public_id],
                )
                snapshot = cur.fetchone()
                if not snapshot:
                    raise SystemExit(f"Snapshot not found: {snapshot_public_id}")
                snapshot_id, valid_from, valid_until, quality_report = snapshot
                if valid_from and any(sample.date() < valid_from for sample in requested_times):
                    raise SystemExit("Routing profile contains sample dates before snapshot valid_from")
                if valid_until and any(sample.date() > valid_until for sample in requested_times):
                    raise SystemExit("Routing profile contains sample dates after snapshot valid_until")

                upsert_routing_profile(cur, profile)
                cur.execute(
                    """
                    SELECT id
                    FROM stop_places
                    WHERE snapshot_id = %s AND public_id = %s
                    """,
                    [snapshot_id, ORIGIN_PUBLIC_ID],
                )
                origin = cur.fetchone()
                if not origin:
                    raise SystemExit(f"Origin StopPlace not found: {ORIGIN_PUBLIC_ID}")
                origin_stop_place_id = origin[0]

                cur.execute(
                    """
                    SELECT id
                    FROM stop_places
                    WHERE snapshot_id = %s
                      AND state_code = ANY(%s)
                      AND is_display_stop = true
                    ORDER BY state_code, name
                    """,
                    [snapshot_id, list(STATES)],
                )
                target_stop_place_ids = [row[0] for row in cur.fetchall()]
                if not target_stop_place_ids:
                    raise SystemExit("No target StopPlaces found in configured states")

                cur.execute(
                    """
                    SELECT st.source_stop_id, st.stop_place_id
                    FROM stops st
                    JOIN stop_places sp ON sp.id = st.stop_place_id AND sp.snapshot_id = st.snapshot_id
                    WHERE st.snapshot_id = %s
                      AND sp.state_code = ANY(%s)
                      AND sp.is_display_stop = true
                      AND st.source_stop_id IS NOT NULL
                    """,
                    [snapshot_id, list(STATES)],
                )
                stop_to_place = {row[0]: str(row[1]) for row in cur.fetchall()}
                context = MetricRunContext(
                    snapshot_id=str(snapshot_id),
                    snapshot_public_id=snapshot_public_id,
                    routing_profile_id=PROFILE_ID,
                    origin_stop_place_id=str(origin_stop_place_id),
                    origin_public_id=ORIGIN_PUBLIC_ID,
                    origin_motis_id=ORIGIN_MOTIS_ID,
                    profile=profile,
                    motis_base_url=MOTIS_BASE_URL,
                    max_trip_duration_seconds=int(profile["max_trip_duration_seconds"]),
                    motis_max_travel_minutes=motis_max_travel_minutes,
                )
                engine = MotisOneToAllMetricEngine(stop_to_place=stop_to_place, raw_samples_path=raw_samples_path)
                validation = engine.validate(context)
                if not validation.ok:
                    raise SystemExit(f"MOTIS validation failed: {validation.details}")

                cur.execute(
                    """
                    UPDATE metric_runs
                    SET status = 'failed',
                        completed_at = now(),
                        configuration = configuration || %s::jsonb
                    WHERE snapshot_id = %s
                      AND routing_profile_id = %s
                      AND engine = %s
                      AND status = 'running'
                    """,
                    [
                        json.dumps({"failed_reason": "superseded_by_new_motis_metric_run"}),
                        snapshot_id,
                        PROFILE_ID,
                        ENGINE_KEY,
                    ],
                )
                cur.execute(
                    """
                    INSERT INTO metric_runs (
                      snapshot_id, routing_profile_id, origin_id, status, sample_count,
                      engine, engine_version, configuration
                    )
                    VALUES (%s, %s, %s, 'running', %s, %s, %s, %s::jsonb)
                    RETURNING id
                    """,
                    [
                        snapshot_id,
                        PROFILE_ID,
                        ORIGIN_PUBLIC_ID,
                        len(requested_times),
                        engine.engine_key,
                        engine.engine_version,
                        json.dumps(
                            {
                                "metric_definition_version": METRIC_DEFINITION_VERSION,
                                "quantile_method": "nearest-rank-p90",
                                "engine_resolution_seconds": engine.capabilities.duration_resolution_seconds,
                                "sample_dates": sorted({sample.date().isoformat() for sample in requested_times}),
                                "sample_start": profile["sample_start"],
                                "sample_end": profile["sample_end"],
                                "sample_interval_seconds": profile["sample_interval_seconds"],
                                "profile_max_trip_duration_seconds": profile["max_trip_duration_seconds"],
                                "motis_max_travel_minutes": motis_max_travel_minutes,
                                "motis_horizon_note": (
                                    "Effective MOTIS one-to-all horizon is lower than the profile horizon; "
                                    "destinations requiring more time are counted unreachable in this run."
                                    if motis_max_travel_minutes * 60 < int(profile["max_trip_duration_seconds"])
                                    else "Effective MOTIS horizon matches the profile horizon."
                                ),
                                "r5_optional": True,
                                "r5_build_status": json.loads(Path("data/reports/r5-build.json").read_text(encoding="utf-8")).get("status")
                                if Path("data/reports/r5-build.json").exists()
                                else "missing",
                            },
                            sort_keys=True,
                        ),
                    ],
                )
                metric_run_id = cur.fetchone()[0]
                conn.commit()

                accumulators = {str(stop_place_id): DestinationAccumulator() for stop_place_id in target_stop_place_ids}
                processed_samples = 0
                for sample in engine.compute_samples(context, requested_times):
                    accumulator = accumulators.get(sample.destination_stop_place_id)
                    if accumulator is not None and sample.duration_seconds is not None:
                        accumulator.add(sample.requested_departure_at, sample.duration_seconds, sample.transit_leg_count)
                    processed_samples += 1

                raw_sha = sha256_file(raw_samples_path)
                rows = []
                total = len(requested_times)
                for destination_id, accumulator in accumulators.items():
                    reachable = len(accumulator.values)
                    unreachable = total - reachable
                    ratio = reachable / total if total else 0.0
                    med = median_seconds(accumulator.values)
                    p90 = p90_nearest_rank(accumulator.values)
                    transfer_med = median_seconds(accumulator.transfer_counts)
                    direct_ratio = (
                        sum(1 for transfers in accumulator.transfer_counts if transfers == 0) / len(accumulator.transfer_counts)
                        if accumulator.transfer_counts
                        else None
                    )
                    rows.append(
                        (
                            metric_run_id,
                            origin_stop_place_id,
                            destination_id,
                            total,
                            reachable,
                            unreachable,
                            ratio,
                            min(accumulator.values) if accumulator.values else None,
                            average(accumulator.values),
                            med if ratio >= 0.5 else None,
                            p90 if ratio >= 0.9 else None,
                            ratio >= 0.9,
                            ratio >= 0.5,
                            min(accumulator.transfer_counts) if accumulator.transfer_counts else None,
                            transfer_med,
                            direct_ratio,
                            None,
                            None,
                            None,
                            None,
                            accumulator.first_reachable,
                            accumulator.last_reachable,
                            accumulator.max_gap_seconds,
                        )
                    )

                with conn.transaction():
                    with conn.cursor() as write_cur:
                        write_cur.execute("DELETE FROM od_metrics WHERE metric_run_id = %s", [metric_run_id])
                        write_cur.executemany(
                            """
                            INSERT INTO od_metrics (
                              metric_run_id, origin_stop_place_id, destination_stop_place_id,
                              total_sample_count, reachable_sample_count, unreachable_sample_count,
                              reachability_ratio, fastest_seconds, average_seconds, median_seconds,
                              p90_seconds, p90_publishable, median_publishable, minimum_transfers,
                              median_transfers, direct_connection_ratio, average_initial_wait_seconds,
                              median_initial_wait_seconds, average_walk_seconds, average_in_vehicle_seconds,
                              first_connection_at, last_connection_at, max_service_gap_seconds
                            )
                            VALUES (
                              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                            )
                            """,
                            rows,
                        )
                        quality_report = dict(quality_report or {})
                        quality_report.update(
                            {
                                "status": "metrics_ready",
                                "metric_engine": engine.engine_key,
                                "metric_engine_version": engine.engine_version,
                                "metric_definition_version": METRIC_DEFINITION_VERSION,
                                "quantile_method": "nearest-rank-p90",
                                "osm_sha256": quality_report.get("osm_sha256")
                                or json.loads(Path("data/source-manifest.json").read_text(encoding="utf-8"))["sources"][2]["sha256"],
                                "motis_graph_status": "built",
                                "r5_status": "optional_failed",
                            }
                        )
                        write_cur.execute(
                            """
                            UPDATE metric_runs
                            SET status = 'completed',
                                completed_at = now(),
                                raw_samples_artifact_uri = %s,
                                raw_samples_sha256 = %s
                            WHERE id = %s
                            """,
                            [str(raw_samples_path), raw_sha, metric_run_id],
                        )
                        write_cur.execute(
                            """
                            UPDATE data_snapshots
                            SET status = 'metrics_ready',
                                quality_report = %s::jsonb
                            WHERE id = %s
                            """,
                            [json.dumps(quality_report, sort_keys=True), snapshot_id],
                        )

                reachable_destinations = sum(1 for accumulator in accumulators.values() if accumulator.values)
                report = {
                    "status": "completed",
                    "snapshot": snapshot_public_id,
                    "metric_run_id": str(metric_run_id),
                    "engine": engine.engine_key,
                    "engine_version": engine.engine_version,
                    "started_at": started_at.isoformat(),
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "sample_count": total,
                    "raw_engine_results_seen": processed_samples,
                    "target_stop_places": len(target_stop_place_ids),
                    "reachable_stop_places": reachable_destinations,
                    "unreachable_stop_places": len(target_stop_place_ids) - reachable_destinations,
                    "raw_samples_artifact_uri": str(raw_samples_path),
                    "raw_samples_sha256": raw_sha,
                    "profile": PROFILE_ID,
                    "dates": sorted({sample.date().isoformat() for sample in requested_times}),
                    "profile_max_trip_duration_seconds": profile["max_trip_duration_seconds"],
                    "motis_max_travel_minutes": motis_max_travel_minutes,
                    "notes": [
                        "MOTIS one-to-all duration is stored as total scheduled travel time from requested departure.",
                        "Leg breakdown metrics unavailable from one-to-all are stored as null.",
                        "R5 is treated as optional comparison engine for this snapshot.",
                    ],
                }
    finally:
        stop_motis_server(server_process)

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(REPORT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
