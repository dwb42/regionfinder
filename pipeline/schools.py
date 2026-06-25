from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import time
import unicodedata
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://regionfinder:regionfinder@localhost:55432/regionfinder")
REPORT_PATH = Path("data/reports/schools-import.json")

SCHOOL_CATEGORIES = {"gymnasium", "comprehensive", "waldorf", "vocational", "upper_secondary"}


@dataclass(frozen=True)
class SchoolSourceSpec:
    source_id: str
    state_code: str
    source_name: str
    provider: str
    metadata_url: str
    license: str
    attribution: str
    default_paths: tuple[Path, ...]
    id_fields: tuple[str, ...]
    name_fields: tuple[str, ...]
    type_fields: tuple[str, ...]
    address_fields: tuple[str, ...]
    website_fields: tuple[str, ...]
    lon_fields: tuple[str, ...]
    lat_fields: tuple[str, ...]


SOURCES: dict[str, SchoolSourceSpec] = {
    "HH": SchoolSourceSpec(
        source_id="schools_hh",
        state_code="HH",
        source_name="Schulstammdaten und Schülerzahlen der Hamburger Schulen",
        provider="Freie und Hansestadt Hamburg",
        metadata_url="https://suche.transparenz.hamburg.de/dataset/schulstammdaten-und-schuelerzahlen-der-hamburger-schulen16",
        license="Datenlizenz Deutschland Namensnennung 2.0",
        attribution="Freie und Hansestadt Hamburg",
        default_paths=(Path("data/raw/schools/hamburg.geojson"), Path("data/raw/schools/hamburg.csv")),
        id_fields=("schul_id", "schulnummer", "bsb_nummer", "id", "uuid"),
        name_fields=("schulname", "name", "bezeichnung"),
        type_fields=("schulform", "schulart", "schultyp", "typ"),
        address_fields=("adresse", "anschrift", "strasse", "straße"),
        website_fields=("homepage", "website", "url", "internet"),
        lon_fields=("lon", "lng", "longitude", "laengengrad", "längengrad", "x", "__lon"),
        lat_fields=("lat", "latitude", "breitengrad", "y", "__lat"),
    ),
    "SH": SchoolSourceSpec(
        source_id="schools_sh",
        state_code="SH",
        source_name="Schulen Schleswig-Holstein",
        provider="Land Schleswig-Holstein",
        metadata_url="https://opendata.schleswig-holstein.de/collection/schulen/aktuell",
        license="Datenlizenz Deutschland Namensnennung 2.0",
        attribution="Land Schleswig-Holstein",
        default_paths=(Path("data/raw/schools/schleswig-holstein.geojson"), Path("data/raw/schools/schleswig-holstein.csv")),
        id_fields=("schulnummer", "dienststellennummer", "id", "uuid"),
        name_fields=("name", "schulname", "bezeichnung"),
        type_fields=("main_school_type", "school_type", "schulart", "schulform", "schultyp", "typ"),
        address_fields=("adresse", "anschrift", "strasse", "straße"),
        website_fields=("homepage", "website", "url", "internet"),
        lon_fields=("lon", "lng", "longitude", "laengengrad", "längengrad", "x", "__lon"),
        lat_fields=("lat", "latitude", "breitengrad", "y", "__lat"),
    ),
    "MV": SchoolSourceSpec(
        source_id="schools_mv",
        state_code="MV",
        source_name="Schulverzeichnis in M-V",
        provider="Land Mecklenburg-Vorpommern",
        metadata_url="https://www.geoportal-mv.de/portal/Suche/Metadatenuebersicht/Details/Schulverzeichnis%20in%20M-V/30dd8c45-9c66-4f2f-8587-0a18de323d4f",
        license="Datenlizenz Deutschland Namensnennung 2.0",
        attribution="Land Mecklenburg-Vorpommern / Geoportal.MV",
        default_paths=(Path("data/raw/schools/mecklenburg-vorpommern.geojson"), Path("data/raw/schools/mecklenburg-vorpommern.csv")),
        id_fields=("schulnummer", "dienststellennummer", "id", "uuid", "schul_id"),
        name_fields=("name", "schulname", "bezeichnung"),
        type_fields=("schulart", "schulform", "schultyp", "typ"),
        address_fields=("adresse", "anschrift", "strasse", "straße"),
        website_fields=("homepage", "website", "url", "internet"),
        lon_fields=("lon", "lng", "longitude", "laengengrad", "längengrad", "x", "__lon"),
        lat_fields=("lat", "latitude", "breitengrad", "y", "__lat"),
    ),
    "NI": SchoolSourceSpec(
        source_id="schools_ni",
        state_code="NI",
        source_name="Schulstandorte in Niedersachsen",
        provider="Landesamt für Statistik Niedersachsen",
        metadata_url="https://www.statistik.niedersachsen.de/startseite/datenangebote/georeferenzierte_karten/schulstandorte_in_niedersachsen/",
        license="Datenlizenz Deutschland Namensnennung 2.0",
        attribution="Landesamt für Statistik Niedersachsen",
        default_paths=(Path("data/raw/schools/niedersachsen.geojson"), Path("data/raw/schools/niedersachsen.csv")),
        id_fields=("schulnummer", "nummer", "id", "uuid", "schul_id"),
        name_fields=("name", "schulname", "bezeichnung"),
        type_fields=("schulform", "schulart", "schultyp", "typ"),
        address_fields=("adresse", "anschrift", "strasse", "straße"),
        website_fields=("homepage", "website", "url", "internet"),
        lon_fields=("lon", "lng", "longitude", "laengengrad", "längengrad", "x", "__lon"),
        lat_fields=("lat", "latitude", "breitengrad", "y", "__lat"),
    ),
}


@dataclass(frozen=True)
class SchoolRecord:
    source_id: str
    source_school_id: str
    name: str
    school_category: str
    school_type_label: str
    state_code: str
    address: str | None
    website: str | None
    lon: float
    lat: float
    raw_properties: dict[str, Any]


def normalize_key(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return "_".join(ascii_value.casefold().replace("-", " ").split())


def normalize_text(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_value.casefold().replace("-", " ").replace("/", " ").split())


def normalized_row(row: dict[str, Any]) -> dict[str, Any]:
    return {normalize_key(str(key)): value for key, value in row.items()}


def as_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def first_value(row: dict[str, Any], fields: Iterable[str]) -> str | None:
    for field in fields:
        value = as_text(row.get(normalize_key(field)))
        if value:
            return value
    return None


def to_float(value: Any) -> float | None:
    text = as_text(value)
    if not text:
        return None
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def school_category_for_label(label: str) -> str | None:
    text = normalize_text(label)
    compact = "".join(text.split())

    if compact in {"gym", "gy"}:
        return "gymnasium"
    if compact in {"igs", "kgs"}:
        return "comprehensive"
    if compact in {"abg", "kol"}:
        return "upper_secondary"

    if "waldorf" in text:
        return "waldorf"
    if any(
        term in text
        for term in (
            "berufsschule",
            "berufsbild",
            "berufsfach",
            "berufliches gymnasium",
            "berufseinstiegsschule",
            "berufsoberschule",
            "fachoberschule",
            "fachschule",
            "bbs",
        )
    ):
        return "vocational"
    if any(term in text for term in ("gesamtschule", "gemeinschaftsschule", "stadtteilschule", "kooperative gesamtschule", "igs", "kgs")):
        return "comprehensive"
    if any(term in text for term in ("oberstufe", "oberstufenzentrum", "abendgymnasium", "kolleg")):
        return "upper_secondary"
    if "gymnasium" in text:
        return "gymnasium"

    return None


SH_SCHOOL_TYPE_BITS = {
    32: ("gymnasium", "Gymnasium"),
    64: ("comprehensive", "Gesamtschule"),
    128: ("vocational", "Berufsbildende Schule"),
    1024: ("comprehensive", "Gemeinschaftsschule"),
    2048: ("comprehensive", "Gemeinschaftsschule mit Oberstufe"),
}


def sh_school_type(value: str | None) -> tuple[str, str] | None:
    if not value:
        return None

    try:
        bits = int(value)
    except ValueError:
        return None

    for bit in (128, 32, 64, 2048, 1024):
        if bits & bit:
            return SH_SCHOOL_TYPE_BITS[bit]

    return None


def stable_source_school_id(source: SchoolSourceSpec, row: dict[str, Any], name: str, lon: float, lat: float) -> str:
    source_id = first_value(row, source.id_fields)
    if source_id:
        return source_id

    digest = hashlib.sha1(
        json.dumps({"name": name, "lon": round(lon, 7), "lat": round(lat, 7)}, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return f"generated-{digest[:16]}"


def normalize_school_row(source: SchoolSourceSpec, raw_row: dict[str, Any]) -> SchoolRecord | None:
    row = normalized_row(raw_row)
    name = first_value(row, source.name_fields)
    type_label = first_value(row, source.type_fields)

    if not name:
        return None

    sh_type = None
    if source.state_code == "SH":
        sh_type = sh_school_type(first_value(row, ("main_school_type",))) or sh_school_type(first_value(row, ("school_type",)))

    school_category = sh_type[0] if sh_type else school_category_for_label(" ".join(value for value in (type_label, name) if value))
    if school_category not in SCHOOL_CATEGORIES:
        return None

    lon = next((value for value in (to_float(row.get(normalize_key(field))) for field in source.lon_fields) if value is not None), None)
    lat = next((value for value in (to_float(row.get(normalize_key(field))) for field in source.lat_fields) if value is not None), None)

    if lon is None or lat is None:
        return None
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None

    return SchoolRecord(
        source_id=source.source_id,
        source_school_id=stable_source_school_id(source, row, name, lon, lat),
        name=name,
        school_category=school_category,
        school_type_label=sh_type[1] if sh_type else type_label or category_label(school_category),
        state_code=source.state_code,
        address=first_value(row, source.address_fields),
        website=first_value(row, source.website_fields),
        lon=lon,
        lat=lat,
        raw_properties=raw_row,
    )


def category_label(category: str) -> str:
    return {
        "gymnasium": "Gymnasium",
        "comprehensive": "Gesamtschule",
        "waldorf": "Waldorfschule",
        "vocational": "Berufsschule",
        "upper_secondary": "Oberstufe",
    }[category]


def rows_from_csv_text(text: str) -> Iterable[dict[str, Any]]:
    sample = text[:4096]
    dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    yield from csv.DictReader(text.splitlines(), dialect=dialect)


def rows_from_geojson_text(text: str) -> Iterable[dict[str, Any]]:
    payload = json.loads(text)

    if payload.get("type") == "FeatureCollection":
        for feature in payload.get("features", []):
            properties = dict(feature.get("properties") or {})
            geometry = feature.get("geometry") or {}
            if geometry.get("type") == "Point":
                coordinates = geometry.get("coordinates") or []
                if len(coordinates) >= 2:
                    properties["__lon"] = coordinates[0]
                    properties["__lat"] = coordinates[1]
            yield properties
        return

    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                yield item


def rows_from_path(path: Path) -> Iterable[dict[str, Any]]:
    suffix = path.suffix.casefold()

    if suffix == ".zip":
        with zipfile.ZipFile(path) as archive:
            for member in archive.namelist():
                member_suffix = Path(member).suffix.casefold()
                if member_suffix not in {".csv", ".json", ".geojson"}:
                    continue
                text = archive.read(member).decode("utf-8-sig")
                yield from rows_from_text(text, member_suffix)
        return

    yield from rows_from_text(path.read_text(encoding="utf-8-sig"), suffix)


def rows_from_text(text: str, suffix: str) -> Iterable[dict[str, Any]]:
    if suffix == ".csv":
        yield from rows_from_csv_text(text)
    elif suffix in {".json", ".geojson"}:
        yield from rows_from_geojson_text(text)
    else:
        raise ValueError(f"Unsupported school source format: {suffix}")


def load_records(paths_by_state: dict[str, Path]) -> list[SchoolRecord]:
    records: list[SchoolRecord] = []

    for state_code, path in paths_by_state.items():
        source = SOURCES[state_code]
        for row in rows_from_path(path):
            record = normalize_school_row(source, row)
            if record:
                records.append(record)

    records.sort(key=lambda record: (record.state_code, record.school_category, record.name, record.source_school_id))
    return records


def source_configuration(source: SchoolSourceSpec, path: Path | None) -> dict[str, Any]:
    data = asdict(source)
    data["default_paths"] = [str(item) for item in source.default_paths]
    data["path"] = str(path) if path else None
    return data


def import_to_database(records: list[SchoolRecord], paths_by_state: dict[str, Path], database_url: str, replace: bool) -> None:
    import psycopg

    source_ids = sorted({record.source_id for record in records})
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            for state_code, source in SOURCES.items():
                if state_code not in paths_by_state:
                    continue
                cur.execute(
                    """
                    INSERT INTO data_sources (source_key, name, provider, format, role, priority, license, attribution, configuration)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (source_key) DO UPDATE
                    SET name = EXCLUDED.name,
                        provider = EXCLUDED.provider,
                        license = EXCLUDED.license,
                        attribution = EXCLUDED.attribution,
                        configuration = EXCLUDED.configuration
                    """,
                    [
                        source.source_id,
                        source.source_name,
                        source.provider,
                        "CSV/GeoJSON",
                        "schools",
                        30,
                        source.license,
                        source.attribution,
                        json.dumps(source_configuration(source, paths_by_state.get(state_code)), ensure_ascii=False),
                    ],
                )

            if replace and source_ids:
                cur.execute("DELETE FROM schools WHERE source_id = ANY(%s)", [source_ids])

            for record in records:
                cur.execute(
                    """
                    INSERT INTO schools (
                      source_id,
                      source_school_id,
                      name,
                      school_category,
                      school_type_label,
                      state_code,
                      address,
                      website,
                      geometry,
                      raw_properties,
                      imported_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s::jsonb, now())
                    ON CONFLICT (source_id, source_school_id) DO UPDATE
                    SET name = EXCLUDED.name,
                        school_category = EXCLUDED.school_category,
                        school_type_label = EXCLUDED.school_type_label,
                        state_code = EXCLUDED.state_code,
                        address = EXCLUDED.address,
                        website = EXCLUDED.website,
                        geometry = EXCLUDED.geometry,
                        raw_properties = EXCLUDED.raw_properties,
                        imported_at = now()
                    """,
                    [
                        record.source_id,
                        record.source_school_id,
                        record.name,
                        record.school_category,
                        record.school_type_label,
                        record.state_code,
                        record.address,
                        record.website,
                        record.lon,
                        record.lat,
                        json.dumps(record.raw_properties, ensure_ascii=False),
                    ],
                )
        conn.commit()


def write_report(records: list[SchoolRecord], paths_by_state: dict[str, Path], path: Path = REPORT_PATH) -> None:
    summary: dict[str, Any] = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sources": {
            state_code: source_configuration(SOURCES[state_code], source_path)
            for state_code, source_path in sorted(paths_by_state.items())
        },
        "record_count": len(records),
        "by_state": {},
        "by_category": {},
    }

    for record in records:
        summary["by_state"][record.state_code] = summary["by_state"].get(record.state_code, 0) + 1
        summary["by_category"][record.school_category] = summary["by_category"].get(record.school_category, 0) + 1

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")


def resolve_source_paths(args: argparse.Namespace) -> dict[str, Path]:
    paths: dict[str, Path] = {}

    for state_code, source in SOURCES.items():
        explicit = getattr(args, state_code.lower())
        env_path = os.environ.get(f"REGIONFINDER_SCHOOLS_{state_code}_PATH")
        candidates = [Path(explicit)] if explicit else []
        if env_path:
            candidates.append(Path(env_path))
        candidates.extend(source.default_paths)

        selected = next((candidate for candidate in candidates if candidate.exists()), None)
        if selected:
            paths[state_code] = selected
        elif not args.allow_missing:
            expected = ", ".join(str(path) for path in source.default_paths)
            raise SystemExit(f"Missing school source for {state_code}. Set --{state_code.lower()} or create one of: {expected}")

    return paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import official secondary-school POIs into PostGIS.")
    parser.add_argument("--hh", help="Hamburg CSV/GeoJSON/ZIP source path")
    parser.add_argument("--sh", help="Schleswig-Holstein CSV/GeoJSON/ZIP source path")
    parser.add_argument("--mv", help="Mecklenburg-Vorpommern CSV/GeoJSON/ZIP source path")
    parser.add_argument("--ni", help="Niedersachsen CSV/GeoJSON/ZIP source path")
    parser.add_argument("--database-url", default=DATABASE_URL)
    parser.add_argument("--allow-missing", action="store_true", help="Import only states with available local source files")
    parser.add_argument("--dry-run", action="store_true", help="Normalize and report records without writing to the database")
    parser.add_argument("--no-replace", action="store_true", help="Do not delete old rows for imported school sources before upsert")
    parser.add_argument("--report", default=str(REPORT_PATH))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    paths_by_state = resolve_source_paths(args)
    records = load_records(paths_by_state)

    if not paths_by_state:
        raise SystemExit("No school source files selected")

    write_report(records, paths_by_state, Path(args.report))

    if not args.dry_run:
        import_to_database(records, paths_by_state, args.database_url, replace=not args.no_replace)

    print(json.dumps({"record_count": len(records), "states": sorted(paths_by_state), "report": args.report}, ensure_ascii=False))


if __name__ == "__main__":
    main()
