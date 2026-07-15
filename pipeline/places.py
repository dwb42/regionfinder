from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import unicodedata
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://regionfinder:regionfinder@localhost:55432/regionfinder")
REPORT_PATH = Path("data/reports/places-import.json")
PLACE_CATEGORIES = {"hof", "ferienhof", "gut", "museum"}
STATE_CODES = {"HH", "SH", "MV", "NI"}

ID_FIELDS = ("source_place_id", "place_id", "id", "uuid")
NAME_FIELDS = ("name", "titel", "title", "bezeichnung")
CATEGORY_FIELDS = ("category", "kategorie", "typ", "type")
STATE_FIELDS = ("state_code", "bundesland", "land")
ADDRESS_FIELDS = ("address", "adresse", "anschrift")
WEBSITE_FIELDS = ("website", "url", "homepage", "internet")
LON_FIELDS = ("lon", "lng", "longitude", "laengengrad", "längengrad", "x", "__lon")
LAT_FIELDS = ("lat", "latitude", "breitengrad", "y", "__lat")


@dataclass(frozen=True)
class PlaceRecord:
    source_id: str
    source_place_id: str
    category: str
    name: str
    state_code: str | None
    address: str | None
    website: str | None
    lon: float
    lat: float
    raw_properties: dict[str, Any]


def normalize_key(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return "_".join(ascii_value.casefold().replace("-", " ").split())


def normalized_row(row: dict[str, Any]) -> dict[str, Any]:
    return {normalize_key(str(key)): value for key, value in row.items()}


def first_value(row: dict[str, Any], fields: Iterable[str]) -> str | None:
    for field in fields:
        value = row.get(normalize_key(field))
        if value is None:
            continue

        text = str(value).strip()
        if text:
            return text

    return None


def parse_float(value: str | None) -> float | None:
    if not value:
        return None

    try:
        return float(value.replace(",", "."))
    except ValueError:
        return None


def normalize_category(value: str | None, default_category: str | None) -> str | None:
    category = normalize_key(value or default_category or "")

    if category in PLACE_CATEGORIES:
        return category

    return None


def normalize_state_code(value: str | None) -> str | None:
    if not value:
        return None

    text = value.strip().upper()
    aliases = {
        "HAMBURG": "HH",
        "SCHLESWIG HOLSTEIN": "SH",
        "SCHLESWIG-HOLSTEIN": "SH",
        "MECKLENBURG VORPOMMERN": "MV",
        "MECKLENBURG-VORPOMMERN": "MV",
        "NIEDERSACHSEN": "NI",
    }
    state_code = aliases.get(text, text)

    return state_code if state_code in STATE_CODES else None


def stable_source_place_id(source_id: str, row: dict[str, Any], name: str, lon: float, lat: float) -> str:
    explicit_id = first_value(row, ID_FIELDS)

    if explicit_id:
        return explicit_id

    digest = hashlib.sha1(f"{source_id}|{name}|{lon:.7f}|{lat:.7f}".encode("utf-8")).hexdigest()

    return digest[:16]


def normalize_place_row(source_id: str, raw_row: dict[str, Any], default_category: str | None = None) -> PlaceRecord | None:
    row = normalized_row(raw_row)
    name = first_value(row, NAME_FIELDS)
    category = normalize_category(first_value(row, CATEGORY_FIELDS), default_category)
    lon = parse_float(first_value(row, LON_FIELDS))
    lat = parse_float(first_value(row, LAT_FIELDS))

    if not name or not category or lon is None or lat is None:
        return None

    return PlaceRecord(
        source_id=source_id,
        source_place_id=stable_source_place_id(source_id, row, name, lon, lat),
        category=category,
        name=name,
        state_code=normalize_state_code(first_value(row, STATE_FIELDS)),
        address=first_value(row, ADDRESS_FIELDS),
        website=first_value(row, WEBSITE_FIELDS),
        lon=lon,
        lat=lat,
        raw_properties=raw_row,
    )


def rows_from_geojson(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = []

    for feature in data.get("features", []):
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}

        if geometry.get("type") != "Point":
            continue

        coordinates = geometry.get("coordinates") or []

        if len(coordinates) < 2:
            continue

        rows.append({**properties, "__lon": coordinates[0], "__lat": coordinates[1]})

    return rows


def rows_from_json(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))

    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]

    if isinstance(data, dict) and data.get("type") == "FeatureCollection":
        return rows_from_geojson(path)

    if isinstance(data, dict) and isinstance(data.get("places"), list):
        return [row for row in data["places"] if isinstance(row, dict)]

    raise ValueError(f"Unsupported JSON places format: {path}")


def rows_from_csv(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t") if sample.strip() else csv.excel

        return list(csv.DictReader(handle, dialect=dialect))


def load_rows(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()

    if suffix in {".geojson"}:
        return rows_from_geojson(path)

    if suffix == ".json":
        return rows_from_json(path)

    if suffix in {".csv", ".tsv"}:
        return rows_from_csv(path)

    raise ValueError(f"Unsupported places source format: {suffix}")


def load_records(path: Path, source_id: str, default_category: str | None = None) -> list[PlaceRecord]:
    records: list[PlaceRecord] = []
    seen: set[tuple[str, str]] = set()

    for row in load_rows(path):
        record = normalize_place_row(source_id, row, default_category)

        if not record:
            continue

        key = (record.source_id, record.source_place_id)
        if key in seen:
            continue

        seen.add(key)
        records.append(record)

    records.sort(key=lambda record: (record.category, record.name, record.source_place_id))

    return records


def import_to_database(records: list[PlaceRecord], database_url: str, replace_source: bool, clip_to_admin_boundaries: bool = False) -> None:
    import psycopg

    source_ids = sorted({record.source_id for record in records})
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            for source_id in source_ids:
                cur.execute(
                    """
                    INSERT INTO data_sources (source_key, name, provider, format, role, priority, license, attribution, configuration)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, '{}'::jsonb)
                    ON CONFLICT (source_key) DO UPDATE
                    SET name = EXCLUDED.name,
                        provider = EXCLUDED.provider,
                        format = EXCLUDED.format,
                        role = EXCLUDED.role
                    """,
                    [source_id, source_id, "Regionfinder places import", "CSV/GeoJSON/JSON", "places", 40, None, None],
                )

            if replace_source and source_ids:
                cur.execute("UPDATE places SET deleted_at = now(), updated_at = now() WHERE source_id = ANY(%s)", [source_ids])

            for record in records:
                cur.execute(
                    """
                    INSERT INTO places (
                      source_id,
                      source_place_id,
                      origin,
                      category,
                      name,
                      state_code,
                      address,
                      website,
                      geometry,
                      raw_properties,
                      imported_at
                    )
                    VALUES (%s, %s, 'imported', %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s::jsonb, now())
                    ON CONFLICT (source_id, source_place_id) DO UPDATE
                    SET origin = 'imported',
                        category = EXCLUDED.category,
                        name = EXCLUDED.name,
                        state_code = EXCLUDED.state_code,
                        address = EXCLUDED.address,
                        website = EXCLUDED.website,
                        geometry = EXCLUDED.geometry,
                        raw_properties = EXCLUDED.raw_properties,
                        imported_at = now(),
                        updated_at = now(),
                        deleted_at = NULL
                    """,
                    [
                        record.source_id,
                        record.source_place_id,
                        record.category,
                        record.name,
                        record.state_code,
                        record.address,
                        record.website,
                        record.lon,
                        record.lat,
                        json.dumps(record.raw_properties, ensure_ascii=False),
                    ],
                )

            if clip_to_admin_boundaries and source_ids:
                cur.execute(
                    """
                    UPDATE places p
                    SET state_code = right(b.state_code, 2),
                        updated_at = now()
                    FROM admin_boundaries b
                    WHERE p.source_id = ANY(%s)
                      AND p.deleted_at IS NULL
                      AND b.state_code IN ('DE-HH', 'DE-SH', 'DE-MV', 'DE-NI')
                      AND ST_Contains(b.geometry, p.geometry)
                      AND p.state_code IS DISTINCT FROM right(b.state_code, 2)
                    """,
                    [source_ids],
                )
                cur.execute(
                    """
                    UPDATE places p
                    SET deleted_at = now(),
                        updated_at = now()
                    WHERE p.source_id = ANY(%s)
                      AND p.deleted_at IS NULL
                      AND NOT EXISTS (
                        SELECT 1
                        FROM admin_boundaries b
                        WHERE b.state_code IN ('DE-HH', 'DE-SH', 'DE-MV', 'DE-NI')
                          AND ST_Contains(b.geometry, p.geometry)
                      )
                    """,
                    [source_ids],
                )
        conn.commit()


def write_report(records: list[PlaceRecord], path: Path = REPORT_PATH) -> None:
    summary: dict[str, Any] = {
        "record_count": len(records),
        "by_category": {},
        "by_state": {},
        "records": [asdict(record) for record in records],
    }

    for record in records:
        summary["by_category"][record.category] = summary["by_category"].get(record.category, 0) + 1
        state_key = record.state_code or "unknown"
        summary["by_state"][state_key] = summary["by_state"].get(state_key, 0) + 1

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import simple place POIs into PostGIS.")
    parser.add_argument("--source", required=True, type=Path, help="CSV, TSV, JSON or GeoJSON file")
    parser.add_argument("--source-id", required=True, help="Stable source identifier for upserts")
    parser.add_argument("--category", choices=sorted(PLACE_CATEGORIES), help="Default category when rows do not contain one")
    parser.add_argument("--database-url", default=DATABASE_URL)
    parser.add_argument("--report", type=Path, default=REPORT_PATH)
    parser.add_argument("--replace-source", action="store_true", help="Soft-delete old rows for this source before upsert")
    parser.add_argument(
        "--clip-to-admin-boundaries",
        action="store_true",
        help="Correct state_code from admin_boundaries and soft-delete rows outside HH/SH/MV/NI",
    )
    args = parser.parse_args()

    records = load_records(args.source, args.source_id, args.category)

    if not records:
        raise SystemExit("No valid place records found")

    import_to_database(records, args.database_url, args.replace_source, args.clip_to_admin_boundaries)
    write_report(records, args.report)
    print(json.dumps({"record_count": len(records), "report": str(args.report)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
