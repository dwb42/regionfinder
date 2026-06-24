from __future__ import annotations

import json
import os
import shutil
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


def inspect_gpkg(gpkg: Path) -> tuple[str, list[dict[str, str]]]:
    with sqlite3.connect(gpkg) as conn:
        rows = conn.execute("SELECT table_name, data_type, identifier, srs_id FROM gpkg_contents").fetchall()
        layers = [
            {"table_name": row[0], "data_type": row[1], "identifier": row[2], "srs_id": str(row[3])}
            for row in rows
        ]
    candidates = [layer["table_name"] for layer in layers if "lan" in layer["table_name"].lower()]
    if not candidates:
        candidates = [layer["table_name"] for layer in layers if layer["data_type"] == "features"]
    if not candidates:
        raise SystemExit("No feature layer found in BKG GeoPackage")
    return candidates[0], layers


def docker_gdal_import(gpkg: Path, layer: str) -> None:
    subprocess.run(["docker", "pull", GDAL_IMAGE], check=True)
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
        "admin_boundaries_import",
        "-overwrite",
        "-t_srs",
        "EPSG:4326",
        "-lco",
        "GEOMETRY_NAME=geom",
    ]
    subprocess.run(cmd, check=True)


def normalize_import(layer: str, layers: list[dict[str, str]]) -> None:
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO data_sources (source_key, name, provider, format, role, priority, license, attribution, configuration)
                VALUES ('bkg_vg250', 'VG250 Verwaltungsgebiete 1:250 000', 'Bundesamt fuer Kartographie und Geodaesie', 'GeoPackage', 'admin_boundaries', 10, 'Datenlizenz Deutschland Namensnennung 2.0 / GeoNutzV', 'GeoBasis-DE / BKG', %s)
                ON CONFLICT (source_key) DO UPDATE SET configuration = EXCLUDED.configuration
                RETURNING id
                """,
                [json.dumps({"layer": layer, "layers": layers})],
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
                [source_id, layer],
            )
            cur.execute("SELECT state_code, name, ST_Area(geometry::geography) FROM admin_boundaries ORDER BY state_code")
            rows = cur.fetchall()
        conn.commit()
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {"layer": layer, "layers": layers, "states": [{"state_code": r[0], "name": r[1], "area_m2": float(r[2])} for r in rows]},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"imported_states": [row[0] for row in rows], "report": str(REPORT)}, ensure_ascii=False))


def main() -> None:
    gpkg = extract()
    layer, layers = inspect_gpkg(gpkg)
    docker_gdal_import(gpkg, layer)
    normalize_import(layer, layers)


if __name__ == "__main__":
    main()
