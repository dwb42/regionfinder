from __future__ import annotations

import csv
import hashlib
import json
import os
import shutil
import subprocess
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import psycopg

from . import PIPELINE_VERSION

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://regionfinder:regionfinder@localhost:55432/regionfinder")
GTFS_ZIP = Path(os.environ.get("DELFI_GTFS_PATH", "data/raw/delfi/gtfs-deutschland-gesamt.zip"))
WORK_DIR = Path("data/processed/delfi")
SERVICE_DATES_CSV = WORK_DIR / "service_dates.csv"
SERVICE_DATES_WITH_SNAPSHOT_CSV = WORK_DIR / "service_dates_with_snapshot.csv"
SOURCE_MANIFEST = Path("data/source-manifest.json")
SNAPSHOT_PUBLIC_ID_PATH = Path("data/processed/production-snapshot-id.txt")


GTFS_FILES = [
    "agency.txt",
    "stops.txt",
    "routes.txt",
    "trips.txt",
    "stop_times.txt",
    "calendar.txt",
    "calendar_dates.txt",
    "shapes.txt",
    "transfers.txt",
    "pathways.txt",
    "feed_info.txt",
]


def run_psql(sql: str) -> None:
    subprocess.run(["psql", DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c", sql], check=True)


def psql_file(sql_path: Path) -> None:
    subprocess.run(["psql", DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", str(sql_path)], check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def yyyymmdd(value: str) -> date:
    return date(int(value[:4]), int(value[4:6]), int(value[6:8]))


def normalize(value: str) -> str:
    return " ".join(value.casefold().split())


def csv_rows(path: Path) -> Iterable[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        yield from csv.DictReader(file)


def gtfs_seconds(value: str) -> int:
    parts = value.split(":")
    if len(parts) != 3:
        raise ValueError(f"invalid GTFS time {value}")
    return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])


def extract_gtfs() -> Path:
    if not GTFS_ZIP.exists():
        raise SystemExit(f"DELFI GTFS ZIP missing: {GTFS_ZIP}")
    target = WORK_DIR / GTFS_ZIP.stem
    marker = target / ".extract-complete"
    if marker.exists():
        return target
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(GTFS_ZIP) as archive:
        bad = archive.testzip()
        if bad:
            raise SystemExit(f"bad GTFS ZIP member: {bad}")
        for member in archive.namelist():
            base = Path(member).name
            if base in GTFS_FILES:
                archive.extract(member, target)
                extracted = target / member
                if extracted != target / base:
                    shutil.move(str(extracted), target / base)
    marker.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return target


def materialize_service_dates(gtfs_dir: Path) -> tuple[date | None, date | None, int]:
    calendar_path = gtfs_dir / "calendar.txt"
    calendar_dates_path = gtfs_dir / "calendar_dates.txt"
    active: dict[tuple[str, date], tuple[str, bool]] = {}
    weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

    if calendar_path.exists():
        for row in csv_rows(calendar_path):
            current = yyyymmdd(row["start_date"])
            end = yyyymmdd(row["end_date"])
            while current <= end:
                if row.get(weekdays[current.weekday()]) == "1":
                    active[(row["service_id"], current)] = ("calendar", True)
                current += timedelta(days=1)

    if calendar_dates_path.exists():
        for row in csv_rows(calendar_dates_path):
            service_date = yyyymmdd(row["date"])
            active[(row["service_id"], service_date)] = ("calendar_dates", row["exception_type"] == "1")

    SERVICE_DATES_CSV.parent.mkdir(parents=True, exist_ok=True)
    with SERVICE_DATES_CSV.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["service_id", "service_date", "source", "is_active"])
        for (service_id, service_date), (source, is_active) in sorted(active.items()):
            writer.writerow([service_id, service_date.isoformat(), source, "true" if is_active else "false"])

    active_dates = [service_date for (_, service_date), (_, is_active) in active.items() if is_active]
    return (min(active_dates) if active_dates else None, max(active_dates) if active_dates else None, len(active))


def create_staging_table(gtfs_dir: Path, name: str) -> None:
    path = gtfs_dir / f"{name}.txt"
    if not path.exists():
        run_psql(f'DROP TABLE IF EXISTS staging_gtfs."{name}"; CREATE UNLOGGED TABLE staging_gtfs."{name}" (_missing text);')
        return
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.reader(file)
        header = next(reader)
    columns = ", ".join(f'"{column}" text' for column in header)
    run_psql(f'DROP TABLE IF EXISTS staging_gtfs."{name}"; CREATE UNLOGGED TABLE staging_gtfs."{name}" ({columns});')
    run_psql(f"\\copy staging_gtfs.\"{name}\" FROM '{path.resolve()}' CSV HEADER")


def load_staging(gtfs_dir: Path) -> None:
    run_psql("DROP SCHEMA IF EXISTS staging_gtfs CASCADE; CREATE SCHEMA staging_gtfs;")
    for file in GTFS_FILES:
        create_staging_table(gtfs_dir, file.removesuffix(".txt"))
    ensure_staging_columns()
    run_psql(
        """
        CREATE INDEX IF NOT EXISTS staging_stop_times_trip_idx ON staging_gtfs.stop_times (trip_id);
        CREATE INDEX IF NOT EXISTS staging_stop_times_stop_idx ON staging_gtfs.stop_times (stop_id);
        CREATE INDEX IF NOT EXISTS staging_trips_trip_idx ON staging_gtfs.trips (trip_id);
        CREATE INDEX IF NOT EXISTS staging_trips_route_idx ON staging_gtfs.trips (route_id);
        CREATE INDEX IF NOT EXISTS staging_stops_stop_idx ON staging_gtfs.stops (stop_id);
        CREATE INDEX IF NOT EXISTS staging_shapes_shape_idx ON staging_gtfs.shapes (shape_id);
        """
    )


def ensure_staging_columns() -> None:
    required_columns = {
        "agency": [
            "agency_id",
            "agency_name",
            "agency_url",
            "agency_timezone",
            "agency_lang",
            "agency_phone",
            "agency_fare_url",
            "agency_email",
        ],
        "stops": [
            "stop_id",
            "stop_code",
            "stop_name",
            "stop_lat",
            "stop_lon",
            "location_type",
            "parent_station",
            "wheelchair_boarding",
            "platform_code",
            "zone_id",
        ],
        "routes": [
            "route_id",
            "agency_id",
            "route_short_name",
            "route_long_name",
            "route_type",
            "route_color",
            "route_text_color",
            "route_url",
        ],
        "trips": [
            "route_id",
            "service_id",
            "trip_id",
            "trip_headsign",
            "direction_id",
            "block_id",
            "shape_id",
            "wheelchair_accessible",
            "bikes_allowed",
        ],
        "stop_times": [
            "trip_id",
            "stop_id",
            "stop_sequence",
            "arrival_time",
            "departure_time",
            "pickup_type",
            "drop_off_type",
            "timepoint",
            "shape_dist_traveled",
        ],
        "shapes": ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"],
    }
    statements: list[str] = []
    for table, columns in required_columns.items():
        for column in columns:
            statements.append(
                f"""
                ALTER TABLE staging_gtfs."{table}"
                ADD COLUMN IF NOT EXISTS "{column}" text;
                """
            )
    run_psql("\n".join(statements))


def source_metadata() -> dict[str, str | None]:
    if not SOURCE_MANIFEST.exists():
        return {}
    manifest = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
    return next((item for item in manifest.get("sources", []) if item.get("source_key") == "delfi_gtfs"), {})


def import_core(gtfs_dir: Path, valid_from: date | None, valid_until: date | None, service_date_count: int) -> str:
    source_hash = sha256(GTFS_ZIP)
    public_id = f"delfi-{source_hash[:12]}"
    metadata = source_metadata()
    import_config_hash = hashlib.sha256(
        json.dumps({"pipeline": PIPELINE_VERSION, "mode": "production"}, sort_keys=True).encode("utf-8")
    ).hexdigest()

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO data_sources (source_key, name, provider, format, role, priority, license, attribution, configuration)
                VALUES ('delfi_gtfs', 'Deutschlandweite Sollfahrplandaten (GTFS)', 'DELFI e.V. / Mobidrom', 'GTFS', 'canonical_timetable', 1, 'CC BY 4.0', 'DELFI e.V.', %s)
                ON CONFLICT (source_key) DO UPDATE
                SET name = EXCLUDED.name,
                    provider = EXCLUDED.provider,
                    license = EXCLUDED.license,
                    attribution = EXCLUDED.attribution,
                    configuration = EXCLUDED.configuration
                RETURNING id
                """,
                [json.dumps(metadata)],
            )
            source_id = cur.fetchone()[0]
            cur.execute(
                """
                INSERT INTO data_snapshots (
                  public_id, source_id, status, source_file_name, source_sha256, import_config_sha256,
                  valid_from, valid_until, imported_at, pipeline_version, quality_report, is_active
                )
                VALUES (%s, %s, 'importing', %s, %s, %s, %s, %s, now(), %s, %s, false)
                ON CONFLICT (public_id) DO UPDATE
                SET status = 'importing',
                    imported_at = now(),
                    quality_report = EXCLUDED.quality_report
                RETURNING id
                """,
                [
                    public_id,
                    source_id,
                    GTFS_ZIP.name,
                    source_hash,
                    import_config_hash,
                    valid_from,
                    valid_until,
                    PIPELINE_VERSION,
                    json.dumps({"status": "importing", "service_date_rows": service_date_count}),
                ],
            )
            snapshot_id = cur.fetchone()[0]
        conn.commit()

    sql_path = WORK_DIR / "production-import.sql"
    sql_path.write_text(
        """
\\set ON_ERROR_STOP on
BEGIN;
DELETE FROM itinerary_legs WHERE itinerary_id IN (SELECT id FROM itineraries WHERE snapshot_id = :'snapshot_id');
DELETE FROM itineraries WHERE snapshot_id = :'snapshot_id';
DELETE FROM od_metrics WHERE metric_run_id IN (SELECT id FROM metric_runs WHERE snapshot_id = :'snapshot_id');
DELETE FROM metric_runs WHERE snapshot_id = :'snapshot_id';
DELETE FROM route_stop_segments WHERE snapshot_id = :'snapshot_id';
DELETE FROM route_pattern_stops WHERE snapshot_id = :'snapshot_id';
DELETE FROM stop_times WHERE snapshot_id = :'snapshot_id';
DELETE FROM trips WHERE snapshot_id = :'snapshot_id';
DELETE FROM route_patterns WHERE snapshot_id = :'snapshot_id';
DELETE FROM transfers WHERE snapshot_id = :'snapshot_id';
DELETE FROM pathways WHERE snapshot_id = :'snapshot_id';
DELETE FROM footpaths WHERE snapshot_id = :'snapshot_id';
DELETE FROM stops WHERE snapshot_id = :'snapshot_id';
DELETE FROM stop_source_links WHERE snapshot_id = :'snapshot_id';
DELETE FROM stop_aliases WHERE snapshot_id = :'snapshot_id';
DELETE FROM service_dates WHERE snapshot_id = :'snapshot_id';
DELETE FROM stop_places WHERE snapshot_id = :'snapshot_id';
DELETE FROM routes WHERE snapshot_id = :'snapshot_id';
DELETE FROM agencies WHERE snapshot_id = :'snapshot_id';

INSERT INTO agencies (snapshot_id, source_agency_id, name, url, timezone, language, phone, fare_url, email)
SELECT :'snapshot_id',
       COALESCE(NULLIF(agency_id, ''), agency_name),
       agency_name,
       NULLIF(agency_url, ''),
       NULLIF(agency_timezone, ''),
       NULLIF(agency_lang, ''),
       NULLIF(agency_phone, ''),
       NULLIF(agency_fare_url, ''),
       NULLIF(agency_email, '')
FROM staging_gtfs.agency;

WITH parent_rows AS (
  SELECT s.stop_id AS place_source_id,
         s.stop_id,
         s.stop_name,
         NULLIF(s.stop_lat, '')::double precision AS stop_lat,
         NULLIF(s.stop_lon, '')::double precision AS stop_lon
  FROM staging_gtfs.stops s
  WHERE COALESCE(NULLIF(s.location_type, ''), '0') <> '0'
),
child_orphans AS (
  SELECT s.stop_id AS place_source_id,
         s.stop_id,
         s.stop_name,
         NULLIF(s.stop_lat, '')::double precision AS stop_lat,
         NULLIF(s.stop_lon, '')::double precision AS stop_lon
  FROM staging_gtfs.stops s
  LEFT JOIN staging_gtfs.stops parent ON parent.stop_id = NULLIF(s.parent_station, '')
  WHERE COALESCE(NULLIF(s.location_type, ''), '0') = '0'
    AND parent.stop_id IS NULL
),
places AS (
  SELECT * FROM parent_rows
  UNION ALL
  SELECT * FROM child_orphans
),
place_coords AS (
  SELECT p.place_source_id,
         p.stop_name,
         COALESCE(p.stop_lat, AVG(NULLIF(c.stop_lat, '')::double precision)) AS lat,
         COALESCE(p.stop_lon, AVG(NULLIF(c.stop_lon, '')::double precision)) AS lon
  FROM places p
  LEFT JOIN staging_gtfs.stops c ON NULLIF(c.parent_station, '') = p.place_source_id
  GROUP BY p.place_source_id, p.stop_name, p.stop_lat, p.stop_lon
)
INSERT INTO stop_places (
  snapshot_id, public_id, dhid, name, normalized_name, geometry, modes, identity_quality, source_priority, is_display_stop
)
SELECT :'snapshot_id',
       place_source_id,
       CASE WHEN place_source_id ~ '^de:[0-9]+' THEN place_source_id ELSE NULL END,
       stop_name,
       lower(regexp_replace(stop_name, '\\s+', ' ', 'g')),
       ST_SetSRID(ST_MakePoint(lon, lat), 4326),
       ARRAY[]::text[],
       CASE WHEN place_source_id ~ '^de:[0-9]+' THEN 'dhid' ELSE 'missing_dhid' END,
       1,
       true
FROM place_coords
WHERE lat IS NOT NULL AND lon IS NOT NULL
ON CONFLICT (snapshot_id, public_id) DO NOTHING;

INSERT INTO stops (
  snapshot_id, source_stop_id, stop_place_id, dhid, name, geometry, location_type,
  platform_code, zone_id, wheelchair_boarding, parent_source_stop_id, quay_type, source_id
)
SELECT :'snapshot_id',
       s.stop_id,
       sp.id,
       CASE WHEN s.stop_id ~ '^de:[0-9]+' THEN s.stop_id ELSE NULL END,
       s.stop_name,
       ST_SetSRID(ST_MakePoint(NULLIF(s.stop_lon, '')::double precision, NULLIF(s.stop_lat, '')::double precision), 4326),
       NULLIF(s.location_type, '')::integer,
       NULLIF(s.platform_code, ''),
       NULLIF(s.zone_id, ''),
       NULLIF(s.wheelchair_boarding, '')::integer,
       NULLIF(s.parent_station, ''),
       CASE WHEN COALESCE(NULLIF(s.location_type, ''), '0') = '0' THEN 'quay_or_stop' ELSE 'stop_place' END,
       (SELECT id FROM data_sources WHERE source_key = 'delfi_gtfs')
FROM staging_gtfs.stops s
JOIN stop_places sp ON sp.snapshot_id = :'snapshot_id'
 AND sp.public_id = COALESCE(NULLIF(s.parent_station, ''), s.stop_id)
WHERE NULLIF(s.stop_lat, '') IS NOT NULL AND NULLIF(s.stop_lon, '') IS NOT NULL
ON CONFLICT (snapshot_id, source_stop_id) DO NOTHING;

INSERT INTO routes (snapshot_id, source_route_id, agency_id, short_name, long_name, route_type_raw, mode, color, text_color, url, source_id)
SELECT :'snapshot_id',
       r.route_id,
       a.id,
       NULLIF(r.route_short_name, ''),
       NULLIF(r.route_long_name, ''),
       NULLIF(r.route_type, '')::integer,
       CASE
         WHEN NULLIF(r.route_type, '')::integer IN (0) OR NULLIF(r.route_type, '')::integer BETWEEN 900 AND 999 THEN 'TRAM'
         WHEN NULLIF(r.route_type, '')::integer IN (1, 400, 401, 402, 403, 404, 405) THEN 'U'
         WHEN (NULLIF(r.route_type, '')::integer IN (2, 100, 101) OR NULLIF(r.route_type, '')::integer BETWEEN 100 AND 199)
              AND COALESCE(r.route_short_name, '') ~* '^(ICE|IC|EC)' THEN 'ICE'
         WHEN (NULLIF(r.route_type, '')::integer IN (2, 100) OR NULLIF(r.route_type, '')::integer BETWEEN 100 AND 199)
              AND COALESCE(r.route_short_name, '') ~* '^S' THEN 'S'
         WHEN (NULLIF(r.route_type, '')::integer IN (2, 100, 106) OR NULLIF(r.route_type, '')::integer BETWEEN 100 AND 199)
              AND COALESCE(r.route_short_name, '') ~* '^RE' THEN 'RE'
         WHEN (NULLIF(r.route_type, '')::integer IN (2, 100, 106) OR NULLIF(r.route_type, '')::integer BETWEEN 100 AND 199)
              AND COALESCE(r.route_short_name, '') ~* '^RB' THEN 'RB'
         WHEN NULLIF(r.route_type, '')::integer IN (2, 100, 101, 102, 103, 105, 106, 109) OR NULLIF(r.route_type, '')::integer BETWEEN 100 AND 199 THEN 'RAIL'
         WHEN NULLIF(r.route_type, '')::integer = 3 OR NULLIF(r.route_type, '')::integer BETWEEN 700 AND 799 THEN 'BUS'
         WHEN NULLIF(r.route_type, '')::integer = 4 OR NULLIF(r.route_type, '')::integer = 1000 THEN 'FERRY'
         WHEN NULLIF(r.route_type, '')::integer BETWEEN 1500 AND 1599 THEN 'TAXI'
         ELSE 'OTHER'
       END,
       NULLIF(r.route_color, ''),
       NULLIF(r.route_text_color, ''),
       NULLIF(r.route_url, ''),
       (SELECT id FROM data_sources WHERE source_key = 'delfi_gtfs')
FROM staging_gtfs.routes r
LEFT JOIN agencies a ON a.snapshot_id = :'snapshot_id' AND a.source_agency_id = r.agency_id
ON CONFLICT (snapshot_id, source_route_id) DO NOTHING;

COMMIT;
        """,
        encoding="utf-8",
    )
    subprocess.run(
        ["psql", DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-v", f"snapshot_id={snapshot_id}", "-f", str(sql_path)],
        check=True,
    )
    with SERVICE_DATES_CSV.open("r", encoding="utf-8", newline="") as src, SERVICE_DATES_WITH_SNAPSHOT_CSV.open(
        "w", encoding="utf-8", newline=""
    ) as dst:
        reader = csv.reader(src)
        writer = csv.writer(dst)
        next(reader)
        for row in reader:
            writer.writerow([snapshot_id, *row])
    run_psql(
        "\\copy service_dates (snapshot_id, service_id, service_date, source, is_active) "
        f"FROM '{SERVICE_DATES_WITH_SNAPSHOT_CSV.resolve()}' CSV"
    )
    import_trips_stop_times_patterns(snapshot_id)
    assign_modes_and_states(snapshot_id)
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE data_snapshots
                SET status = 'normalized',
                    quality_report = quality_report || %s::jsonb
                WHERE id = %s
                """,
                [
                    json.dumps(
                        {
                            "status": "normalized",
                            "gtfs_sha256": source_hash,
                            "imported_at": datetime.now(timezone.utc).isoformat(),
                        }
                    ),
                    snapshot_id,
                ],
            )
        conn.commit()
    SNAPSHOT_PUBLIC_ID_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PUBLIC_ID_PATH.write_text(public_id, encoding="utf-8")
    return public_id


def import_trips_stop_times_patterns(snapshot_id: str) -> None:
    sql = f"""
BEGIN;
INSERT INTO trips (
  snapshot_id, source_trip_id, route_id, service_id, shape_id, direction_id,
  headsign, block_id, wheelchair_accessible, bikes_allowed
)
SELECT '{snapshot_id}',
       t.trip_id,
       r.id,
       t.service_id,
       NULLIF(t.shape_id, ''),
       NULLIF(t.direction_id, '')::integer,
       NULLIF(t.trip_headsign, ''),
       NULLIF(t.block_id, ''),
       NULLIF(t.wheelchair_accessible, '')::integer,
       NULLIF(t.bikes_allowed, '')::integer
FROM staging_gtfs.trips t
JOIN routes r ON r.snapshot_id = '{snapshot_id}' AND r.source_route_id = t.route_id
ON CONFLICT (snapshot_id, source_trip_id) DO NOTHING;

INSERT INTO stop_times (
  snapshot_id, trip_id, stop_sequence, stop_id, arrival_seconds, departure_seconds,
  pickup_type, drop_off_type, timepoint, shape_distance_meters
)
SELECT '{snapshot_id}',
       tr.id,
       NULLIF(st.stop_sequence, '')::integer,
       s.id,
       split_part(st.arrival_time, ':', 1)::integer * 3600 + split_part(st.arrival_time, ':', 2)::integer * 60 + split_part(st.arrival_time, ':', 3)::integer,
       split_part(st.departure_time, ':', 1)::integer * 3600 + split_part(st.departure_time, ':', 2)::integer * 60 + split_part(st.departure_time, ':', 3)::integer,
       NULLIF(st.pickup_type, '')::integer,
       NULLIF(st.drop_off_type, '')::integer,
       NULLIF(st.timepoint, '')::integer,
       NULLIF(st.shape_dist_traveled, '')::numeric
FROM staging_gtfs.stop_times st
JOIN trips tr ON tr.snapshot_id = '{snapshot_id}' AND tr.source_trip_id = st.trip_id
JOIN stops s ON s.snapshot_id = '{snapshot_id}' AND s.source_stop_id = st.stop_id
ON CONFLICT (snapshot_id, trip_id, stop_sequence) DO NOTHING;

CREATE TEMP TABLE pattern_trip_signatures AS
SELECT tr.id AS trip_uuid,
       tr.route_id,
       tr.direction_id,
       tr.shape_id,
       tr.headsign,
       md5(string_agg(s.source_stop_id || ':' || COALESCE(st.pickup_type::text, '') || ':' || COALESCE(st.drop_off_type::text, ''), '>' ORDER BY st.stop_sequence)) AS ordered_stop_hash,
       encode(digest(
         tr.route_id::text || '|' || COALESCE(tr.direction_id::text, '') || '|' || COALESCE(tr.shape_id, '') || '|' ||
         string_agg(s.source_stop_id || ':' || COALESCE(st.pickup_type::text, '') || ':' || COALESCE(st.drop_off_type::text, ''), '>' ORDER BY st.stop_sequence),
         'sha256'
       ), 'hex') AS pattern_hash,
       min(tr.source_trip_id) AS source_trip_id
FROM trips tr
JOIN stop_times st ON st.snapshot_id = tr.snapshot_id AND st.trip_id = tr.id
JOIN stops s ON s.snapshot_id = st.snapshot_id AND s.id = st.stop_id
WHERE tr.snapshot_id = '{snapshot_id}'
GROUP BY tr.id, tr.route_id, tr.direction_id, tr.shape_id, tr.headsign;

CREATE TEMP TABLE pattern_representatives AS
SELECT DISTINCT ON (route_id, pattern_hash)
       route_id, direction_id, shape_id, headsign, ordered_stop_hash, pattern_hash, trip_uuid
FROM pattern_trip_signatures
ORDER BY route_id, pattern_hash, source_trip_id;

CREATE TEMP TABLE shape_geoms AS
SELECT shape_id,
       ST_SetSRID(ST_MakeLine(ST_MakePoint(NULLIF(shape_pt_lon, '')::double precision, NULLIF(shape_pt_lat, '')::double precision) ORDER BY NULLIF(shape_pt_sequence, '')::integer), 4326) AS geom,
       CASE
         WHEN count(*) >= 2 THEN ST_Length(ST_SetSRID(ST_MakeLine(ST_MakePoint(NULLIF(shape_pt_lon, '')::double precision, NULLIF(shape_pt_lat, '')::double precision) ORDER BY NULLIF(shape_pt_sequence, '')::integer), 4326)::geography)
         ELSE NULL
       END AS length_meters
FROM staging_gtfs.shapes
WHERE shape_id IS NOT NULL AND shape_id <> ''
GROUP BY shape_id;

CREATE TEMP TABLE approx_geoms AS
SELECT pr.pattern_hash,
       ST_SetSRID(ST_MakeLine(s.geometry ORDER BY st.stop_sequence), 4326) AS geom,
       ST_Length(ST_SetSRID(ST_MakeLine(s.geometry ORDER BY st.stop_sequence), 4326)::geography) AS length_meters
FROM pattern_representatives pr
JOIN stop_times st ON st.snapshot_id = '{snapshot_id}' AND st.trip_id = pr.trip_uuid
JOIN stops s ON s.snapshot_id = st.snapshot_id AND s.id = st.stop_id
GROUP BY pr.pattern_hash;

INSERT INTO route_patterns (
  snapshot_id, route_id, direction_id, pattern_hash, ordered_stop_hash, shape_id, headsign,
  geometry, geometry_quality, geometry_source, length_meters, is_active
)
SELECT '{snapshot_id}',
       pr.route_id,
       pr.direction_id,
       pr.pattern_hash,
       pr.ordered_stop_hash,
       pr.shape_id,
       pr.headsign,
       COALESCE(sg.geom, ag.geom),
       CASE WHEN sg.geom IS NOT NULL THEN 'official_gtfs' ELSE 'stop_sequence_approximation' END,
       CASE WHEN sg.geom IS NOT NULL THEN 'delfi_gtfs_shapes' ELSE 'stop_sequence_fallback' END,
       COALESCE(sg.length_meters, ag.length_meters),
       true
FROM pattern_representatives pr
LEFT JOIN shape_geoms sg ON sg.shape_id = pr.shape_id
LEFT JOIN approx_geoms ag ON ag.pattern_hash = pr.pattern_hash
ON CONFLICT (snapshot_id, route_id, pattern_hash) DO NOTHING;

UPDATE trips tr
SET route_pattern_id = rp.id
FROM pattern_trip_signatures pts
JOIN route_patterns rp ON rp.snapshot_id = '{snapshot_id}' AND rp.route_id = pts.route_id AND rp.pattern_hash = pts.pattern_hash
WHERE tr.snapshot_id = '{snapshot_id}' AND tr.id = pts.trip_uuid;

INSERT INTO route_pattern_stops (
  snapshot_id, route_pattern_id, stop_sequence, stop_id, stop_place_id,
  pickup_type, drop_off_type, timepoint, shape_distance_meters
)
SELECT '{snapshot_id}',
       rp.id,
       st.stop_sequence,
       st.stop_id,
       s.stop_place_id,
       st.pickup_type,
       st.drop_off_type,
       st.timepoint,
       st.shape_distance_meters
FROM pattern_representatives pr
JOIN route_patterns rp ON rp.snapshot_id = '{snapshot_id}' AND rp.route_id = pr.route_id AND rp.pattern_hash = pr.pattern_hash
JOIN stop_times st ON st.snapshot_id = '{snapshot_id}' AND st.trip_id = pr.trip_uuid
JOIN stops s ON s.snapshot_id = st.snapshot_id AND s.id = st.stop_id
ON CONFLICT (snapshot_id, route_pattern_id, stop_sequence) DO NOTHING;

INSERT INTO route_stop_segments (
  snapshot_id, route_id, from_stop_place_id, to_stop_place_id, geometry, length_meters
)
WITH ordered_stops AS (
  SELECT rps.snapshot_id,
         rp.route_id,
         rps.stop_place_id,
         lead(rps.stop_place_id) OVER (
           PARTITION BY rps.snapshot_id, rps.route_pattern_id
           ORDER BY rps.stop_sequence
         ) AS next_stop_place_id
  FROM route_pattern_stops rps
  JOIN route_patterns rp
    ON rp.snapshot_id = rps.snapshot_id
   AND rp.id = rps.route_pattern_id
  WHERE rps.snapshot_id = '{snapshot_id}'
    AND rps.stop_place_id IS NOT NULL
),
segment_pairs AS (
  SELECT DISTINCT
         os.snapshot_id,
         os.route_id,
         LEAST(os.stop_place_id, os.next_stop_place_id) AS from_stop_place_id,
         GREATEST(os.stop_place_id, os.next_stop_place_id) AS to_stop_place_id
  FROM ordered_stops os
  WHERE os.next_stop_place_id IS NOT NULL
    AND os.stop_place_id <> os.next_stop_place_id
)
SELECT sp.snapshot_id,
       sp.route_id,
       sp.from_stop_place_id,
       sp.to_stop_place_id,
       ST_MakeLine(from_stop.geometry, to_stop.geometry) AS geometry,
       ST_Length(ST_MakeLine(from_stop.geometry, to_stop.geometry)::geography) AS length_meters
FROM segment_pairs sp
JOIN stop_places from_stop
  ON from_stop.snapshot_id = sp.snapshot_id
 AND from_stop.id = sp.from_stop_place_id
JOIN stop_places to_stop
  ON to_stop.snapshot_id = sp.snapshot_id
 AND to_stop.id = sp.to_stop_place_id
ON CONFLICT (snapshot_id, route_id, from_stop_place_id, to_stop_place_id) DO NOTHING;

COMMIT;
    """
    run_psql(sql)


def assign_modes_and_states(snapshot_id: str) -> None:
    run_psql(
        f"""
        WITH place_modes AS (
          SELECT rps.stop_place_id, array_agg(DISTINCT r.mode ORDER BY r.mode) AS modes
          FROM route_pattern_stops rps
          JOIN route_patterns rp ON rp.snapshot_id = rps.snapshot_id AND rp.id = rps.route_pattern_id
          JOIN routes r ON r.snapshot_id = rp.snapshot_id AND r.id = rp.route_id
          WHERE rps.snapshot_id = '{snapshot_id}' AND rps.stop_place_id IS NOT NULL
          GROUP BY rps.stop_place_id
        )
        UPDATE stop_places sp
        SET modes = pm.modes
        FROM place_modes pm
        WHERE sp.snapshot_id = '{snapshot_id}' AND sp.id = pm.stop_place_id;

        UPDATE stop_places sp
        SET state_code = ab.state_code
        FROM admin_boundaries ab
        WHERE sp.snapshot_id = '{snapshot_id}'
          AND ST_Contains(ab.geometry, sp.geometry);
        """
    )


def main() -> None:
    gtfs_dir = extract_gtfs()
    valid_from, valid_until, service_date_count = materialize_service_dates(gtfs_dir)
    load_staging(gtfs_dir)
    public_id = import_core(gtfs_dir, valid_from, valid_until, service_date_count)
    print(json.dumps({"snapshot": public_id, "gtfs_dir": str(gtfs_dir)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
