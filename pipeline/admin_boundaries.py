from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import zipfile
from pathlib import Path

import psycopg

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://regionfinder:regionfinder@localhost:55432/regionfinder")
BKG_ZIP = Path("data/raw/bkg/vg250_01-01.utm32s.gpkg.ebenen.zip")
BKG_DIR = Path("data/processed/bkg")
REPORT = Path("data/reports/bkg-boundaries.json")
GDAL_IMAGE = os.environ.get("REGIONFINDER_GDAL_IMAGE", "ghcr.io/osgeo/gdal:ubuntu-small-3.10.3")

TARGET_STATES = {
    "02": ("DE-HH", "Hamburg"),
    "03": ("DE-NI", "Niedersachsen"),
    "01": ("DE-SH", "Schleswig-Holstein"),
    "13": ("DE-MV", "Mecklenburg-Vorpommern"),
    "04": ("DE-HB", "Bremen"),
}

IMPORT_LAYERS = {
    "state": ("lan", "admin_boundaries_import"),
    "county": ("krs", "administrative_counties_import"),
    "municipality": ("gem", "administrative_municipalities_import"),
}


def extract() -> Path:
    if not BKG_ZIP.exists():
        raise SystemExit(f"BKG ZIP missing: {BKG_ZIP}")
    BKG_DIR.mkdir(parents=True, exist_ok=True)
    marker = BKG_DIR / ".extract-complete"
    if not marker.exists():
        with zipfile.ZipFile(BKG_ZIP) as archive:
            bad = archive.testzip()
            if bad:
                raise SystemExit(f"Bad BKG ZIP member: {bad}")
            archive.extractall(BKG_DIR)
        marker.write_text("ok", encoding="utf-8")
    gpkg_files = list(BKG_DIR.rglob("*.gpkg"))
    if not gpkg_files:
        raise SystemExit("No GeoPackage found in BKG ZIP")
    return gpkg_files[0]


def inspect_gpkg(gpkg: Path) -> tuple[dict[str, str], list[dict[str, str]]]:
    with sqlite3.connect(gpkg) as conn:
        rows = conn.execute("SELECT table_name, data_type, identifier, srs_id FROM gpkg_contents").fetchall()
        layers = [
            {"table_name": row[0], "data_type": row[1], "identifier": row[2], "srs_id": str(row[3])}
            for row in rows
        ]
    feature_layers = [layer["table_name"] for layer in layers if layer["data_type"] == "features"]
    selected: dict[str, str] = {}

    for level, (suffix, _) in IMPORT_LAYERS.items():
        exact = f"vg250_{suffix}"
        candidates = [name for name in feature_layers if name.lower() == exact]

        if not candidates:
            candidates = [name for name in feature_layers if name.lower().endswith(f"_{suffix}") and not name.lower().startswith("v_")]

        if not candidates:
            raise SystemExit(f"No BKG {level} feature layer found in GeoPackage")

        selected[level] = candidates[0]

    return selected, layers


def docker_gdal_import(gpkg: Path, layer: str, target_table: str) -> None:
    abs_dir = gpkg.parent.resolve()
    gpkg_name = gpkg.name
    pg = "PG:host=host.docker.internal port=55432 dbname=regionfinder user=regionfinder password=regionfinder"
    cmd = [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{abs_dir}:/data:ro",
        GDAL_IMAGE,
        "ogr2ogr",
        "-f",
        "PostgreSQL",
        pg,
        f"/data/{gpkg_name}",
        layer,
        "-nln",
        target_table,
        "-overwrite",
        "-t_srs",
        "EPSG:4326",
        "-lco",
        "GEOMETRY_NAME=geom",
    ]
    subprocess.run(cmd, check=True)


def normalize_import(selected_layers: dict[str, str], layers: list[dict[str, str]]) -> None:
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO data_sources (source_key, name, provider, format, role, priority, license, attribution, configuration)
                VALUES ('bkg_vg250', 'VG250 Verwaltungsgebiete 1:250 000', 'Bundesamt fuer Kartographie und Geodaesie', 'GeoPackage', 'admin_boundaries', 10, 'Datenlizenz Deutschland Namensnennung 2.0 / GeoNutzV', 'GeoBasis-DE / BKG', %s)
                ON CONFLICT (source_key) DO UPDATE SET configuration = EXCLUDED.configuration
                RETURNING id
                """,
                [json.dumps({"layers": selected_layers, "available_layers": layers})],
            )
            source_id = cur.fetchone()[0]
            cur.execute("DELETE FROM admin_boundaries WHERE source_id = %s OR state_code IN ('DE-HH','DE-NI','DE-SH','DE-MV','DE-HB')", [source_id])
            cur.execute(
                """
                WITH raw AS (
                  SELECT *,
                         COALESCE(NULLIF(gen, ''), NULLIF(bez, '')) AS raw_name,
                         COALESCE(NULLIF(ags, ''), NULLIF(ars, ''), NULLIF(sn_l, '')) AS raw_key
                  FROM admin_boundaries_import
                ),
                mapped AS (
                  SELECT CASE
                           WHEN raw_key LIKE '02%%' OR raw_name ILIKE 'Hamburg' THEN 'DE-HH'
                           WHEN raw_key LIKE '03%%' OR raw_name ILIKE 'Niedersachsen' THEN 'DE-NI'
                           WHEN raw_key LIKE '01%%' OR raw_name ILIKE 'Schleswig-Holstein' THEN 'DE-SH'
                           WHEN raw_key LIKE '13%%' OR raw_name ILIKE 'Mecklenburg-Vorpommern' THEN 'DE-MV'
                           WHEN raw_key LIKE '04%%' OR raw_name ILIKE 'Bremen' THEN 'DE-HB'
                         END AS state_code,
                         raw_name,
                         raw_key,
                         ST_Multi(ST_MakeValid(geom))::geometry(MultiPolygon, 4326) AS geometry
                  FROM raw
                ),
                dissolved AS (
                  SELECT state_code,
                         max(raw_name) AS raw_name,
                         min(raw_key) AS raw_key,
                         ST_Multi(ST_UnaryUnion(ST_Collect(geometry)))::geometry(MultiPolygon, 4326) AS geometry
                  FROM mapped
                  WHERE state_code IS NOT NULL
                  GROUP BY state_code
                )
                INSERT INTO admin_boundaries (source_id, state_code, name, official_key, original_crs, source_layer, geometry)
                SELECT %s, state_code, raw_name, raw_key, 'BKG source CRS transformed by GDAL to EPSG:4326', %s, geometry
                FROM dissolved
                ON CONFLICT (state_code) DO UPDATE
                SET name = EXCLUDED.name,
                    official_key = EXCLUDED.official_key,
                    geometry = EXCLUDED.geometry,
                    source_layer = EXCLUDED.source_layer,
                    imported_at = now()
                """,
                [source_id, selected_layers["state"]],
            )
            cur.execute(
                """
                UPDATE administrative_areas
                SET is_active = false,
                    updated_at = now(),
                    imported_at = now()
                WHERE source_id = %s
                  AND level IN ('county', 'municipality')
                  AND is_active = true
                """,
                [source_id],
            )
            cur.execute(
                """
                WITH raw AS (
                  SELECT NULLIF(ags, '') AS official_key,
                         NULLIF(gen, '') AS name,
                         COALESCE(NULLIF(bez, ''), 'Landkreis') AS area_type,
                         CASE sn_l
                           WHEN '01' THEN 'SH'
                           WHEN '02' THEN 'HH'
                           WHEN '03' THEN 'NI'
                           WHEN '13' THEN 'MV'
                         END AS state_code,
                         ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))::geometry(MultiPolygon, 4326) AS geometry
                  FROM administrative_counties_import
                  WHERE gf = 4
                    AND sn_l IN ('01', '02', '03', '13')
                ),
                dissolved AS (
                  SELECT official_key,
                         max(name) AS name,
                         max(area_type) AS area_type,
                         max(state_code) AS state_code,
                         ST_Multi(
                           ST_CollectionExtract(
                             ST_MakeValid(ST_UnaryUnion(ST_Collect(geometry))),
                             3
                           )
                         )::geometry(MultiPolygon, 4326) AS geometry
                  FROM raw
                  WHERE official_key IS NOT NULL
                    AND name IS NOT NULL
                    AND NOT ST_IsEmpty(geometry)
                  GROUP BY official_key
                )
                INSERT INTO administrative_areas (
                  level, official_key, name, area_type, state_code, parent_id,
                  source_id, source_layer, geometry, label_point, is_active, imported_at, updated_at
                )
                SELECT 'county', official_key, name, area_type, state_code, NULL,
                       %s, %s, geometry, ST_PointOnSurface(geometry), true, now(), now()
                FROM dissolved
                ON CONFLICT (level, official_key) DO UPDATE
                SET name = EXCLUDED.name,
                    area_type = EXCLUDED.area_type,
                    state_code = EXCLUDED.state_code,
                    parent_id = NULL,
                    source_id = EXCLUDED.source_id,
                    source_layer = EXCLUDED.source_layer,
                    geometry = EXCLUDED.geometry,
                    label_point = EXCLUDED.label_point,
                    is_active = true,
                    imported_at = now(),
                    updated_at = now()
                """,
                [source_id, selected_layers["county"]],
            )
            cur.execute(
                """
                WITH raw AS (
                  SELECT NULLIF(ags, '') AS official_key,
                         NULLIF(gen, '') AS name,
                         COALESCE(NULLIF(bez, ''), 'Gemeinde') AS area_type,
                         CASE sn_l
                           WHEN '01' THEN 'SH'
                           WHEN '02' THEN 'HH'
                           WHEN '03' THEN 'NI'
                           WHEN '13' THEN 'MV'
                         END AS state_code,
                         ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))::geometry(MultiPolygon, 4326) AS geometry
                  FROM administrative_municipalities_import
                  WHERE gf = 4
                    AND sn_l IN ('01', '02', '03', '13')
                ),
                dissolved AS (
                  SELECT official_key,
                         max(name) AS name,
                         max(area_type) AS area_type,
                         max(state_code) AS state_code,
                         ST_Multi(
                           ST_CollectionExtract(
                             ST_MakeValid(ST_UnaryUnion(ST_Collect(geometry))),
                             3
                           )
                         )::geometry(MultiPolygon, 4326) AS geometry
                  FROM raw
                  WHERE official_key IS NOT NULL
                    AND name IS NOT NULL
                    AND NOT ST_IsEmpty(geometry)
                  GROUP BY official_key
                )
                INSERT INTO administrative_areas (
                  level, official_key, name, area_type, state_code, parent_id,
                  source_id, source_layer, geometry, label_point, is_active, imported_at, updated_at
                )
                SELECT 'municipality', municipality.official_key, municipality.name,
                       municipality.area_type, municipality.state_code, county.id,
                       %s, %s, municipality.geometry, ST_PointOnSurface(municipality.geometry), true, now(), now()
                FROM dissolved municipality
                JOIN administrative_areas county
                  ON county.level = 'county'
                 AND county.official_key = left(municipality.official_key, 5)
                 AND county.is_active = true
                ON CONFLICT (level, official_key) DO UPDATE
                SET name = EXCLUDED.name,
                    area_type = EXCLUDED.area_type,
                    state_code = EXCLUDED.state_code,
                    parent_id = EXCLUDED.parent_id,
                    source_id = EXCLUDED.source_id,
                    source_layer = EXCLUDED.source_layer,
                    geometry = EXCLUDED.geometry,
                    label_point = EXCLUDED.label_point,
                    is_active = true,
                    imported_at = now(),
                    updated_at = now()
                """,
                [source_id, selected_layers["municipality"]],
            )
            cur.execute("SELECT state_code, name, ST_Area(geometry::geography) FROM admin_boundaries ORDER BY state_code")
            boundary_rows = cur.fetchall()
            cur.execute(
                """
                SELECT level, state_code, count(*)
                FROM administrative_areas
                WHERE is_active = true
                  AND source_id = %s
                GROUP BY level, state_code
                ORDER BY level, state_code
                """,
                [source_id],
            )
            area_rows = cur.fetchall()
        conn.commit()
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {
                "layers": selected_layers,
                "available_layers": layers,
                "states": [{"state_code": r[0], "name": r[1], "area_m2": float(r[2])} for r in boundary_rows],
                "administrative_areas": [
                    {"level": row[0], "state_code": row[1], "count": row[2]} for row in area_rows
                ],
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "imported_states": [row[0] for row in boundary_rows],
                "administrative_area_count": sum(row[2] for row in area_rows),
                "report": str(REPORT),
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    gpkg = extract()
    selected_layers, layers = inspect_gpkg(gpkg)
    subprocess.run(["docker", "pull", GDAL_IMAGE], check=True)

    for level, layer in selected_layers.items():
        docker_gdal_import(gpkg, layer, IMPORT_LAYERS[level][1])

    normalize_import(selected_layers, layers)


if __name__ == "__main__":
    main()
