from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

USER_AGENT = "Regionfinder/2.0 production-bootstrap (+local)"
MANIFEST_PATH = Path("data/source-manifest.json")


@dataclass
class SourceSpec:
    source_key: str
    source_name: str
    provider: str
    metadata_url: str
    download_url: str
    file_name: str
    format: str
    license: str
    attribution: str


SOURCES = [
    SourceSpec(
        "delfi_gtfs",
        "Deutschlandweite Sollfahrplandaten (GTFS)",
        "DELFI e.V. / Mobidrom",
        "https://www.mobilitaetsdaten.nrw/api/ckan/en/dataset/deutschlandweite-sollfahrplandaten-gtfs",
        "https://mobi.nrw/gtfs-deutschland-gesamt.zip",
        "data/raw/delfi/gtfs-deutschland-gesamt.zip",
        "zip",
        "CC BY 4.0",
        "DELFI e.V.",
    ),
    SourceSpec(
        "bkg_vg250",
        "VG250 Verwaltungsgebiete 1:250 000",
        "Bundesamt fuer Kartographie und Geodaesie",
        "https://gdz.bkg.bund.de/index.php/default/verwaltungsgebiete-1-250-000-stand-01-01-vg250-01-01.html",
        "https://daten.gdz.bkg.bund.de/produkte/vg/vg250_ebenen_0101/aktuell/vg250_01-01.utm32s.gpkg.ebenen.zip",
        "data/raw/bkg/vg250_01-01.utm32s.gpkg.ebenen.zip",
        "zip",
        "Datenlizenz Deutschland Namensnennung 2.0 / GeoNutzV",
        "GeoBasis-DE / BKG",
    ),
    SourceSpec(
        "geofabrik_germany_osm",
        "Germany OpenStreetMap PBF",
        "Geofabrik GmbH / OpenStreetMap Contributors",
        "https://download.geofabrik.de/europe/germany.html",
        "https://download.geofabrik.de/europe/germany-latest.osm.pbf",
        "data/raw/osm/germany-latest.osm.pbf",
        "osm.pbf",
        "ODbL 1.0",
        "OpenStreetMap contributors, Geofabrik GmbH",
    ),
]


def read_manifest() -> dict[str, Any]:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {"generated_at": None, "sources": []}


def write_manifest(manifest: dict[str, Any]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    manifest["generated_at"] = iso_now()
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_head(path: Path, size: int = 16) -> bytes:
    with path.open("rb") as file:
        return file.read(size)


def request(url: str, method: str = "GET") -> urllib.request.Request:
    return urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})


def resolve(spec: SourceSpec) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(request(spec.download_url, "HEAD"), timeout=60) as response:
            return {
                "http_status": response.status,
                "resolved_download_url": response.geturl(),
                "content_type": response.headers.get("content-type"),
                "content_length": response.headers.get("content-length"),
                "etag": response.headers.get("etag"),
                "last_modified": response.headers.get("last-modified"),
            }
    except urllib.error.HTTPError as error:
        return {"http_status": error.code, "resolved_download_url": error.geturl(), "error": str(error)}


def upsert_source(entry: dict[str, Any]) -> None:
    manifest = read_manifest()
    sources = [item for item in manifest.get("sources", []) if item.get("source_key") != entry["source_key"]]
    sources.append(entry)
    manifest["sources"] = sorted(sources, key=lambda item: item["source_key"])
    write_manifest(manifest)


def discover() -> None:
    for spec in SOURCES:
        resolved = resolve(spec)
        entry = {
            **asdict(spec),
            **resolved,
            "downloaded_at": None,
            "file_size_bytes": None,
            "sha256": None,
            "valid_from": None,
            "valid_until": None,
            "validation_status": "discovered",
            "integration_status": "pending",
            "notes": None,
        }
        upsert_source(entry)
        print(json.dumps({"source_key": spec.source_key, **resolved}, ensure_ascii=False))


def download_one(spec: SourceSpec) -> None:
    destination = Path(spec.file_name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0:
        print(f"exists {destination}")
    else:
        part = destination.with_suffix(destination.suffix + ".part")
        cmd = [
            "curl",
            "-L",
            "--fail",
            "--retry",
            "5",
            "--retry-delay",
            "5",
            "--continue-at",
            "-",
            "-A",
            USER_AGENT,
            "-o",
            str(part),
            spec.download_url,
        ]
        subprocess.run(cmd, check=True)
        head = read_head(part)
        if spec.format == "zip" and head[:4] != b"PK\x03\x04":
            raise SystemExit(f"{spec.source_key}: downloaded file is not a ZIP")
        if spec.format == "osm.pbf" and head.lstrip().startswith(b"<"):
            raise SystemExit(f"{spec.source_key}: downloaded file looks like HTML")
        part.rename(destination)
    resolved = resolve(spec)
    entry = {
        **asdict(spec),
        **resolved,
        "downloaded_at": iso_now(),
        "file_size_bytes": destination.stat().st_size,
        "sha256": sha256(destination),
        "valid_from": None,
        "valid_until": None,
        "validation_status": "downloaded",
        "integration_status": "pending",
        "notes": None,
    }
    upsert_source(entry)


def download() -> None:
    for spec in SOURCES:
        download_one(spec)


def count_zip_csv(zip_path: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    with zipfile.ZipFile(zip_path) as archive:
        for name in archive.namelist():
            if not name.endswith(".txt"):
                continue
            with archive.open(name) as file:
                counts[Path(name).name] = max(sum(1 for _ in file) - 1, 0)
    return counts


def feed_info(zip_path: Path) -> dict[str, Any]:
    info: dict[str, Any] = {}
    with zipfile.ZipFile(zip_path) as archive:
        names = {Path(name).name: name for name in archive.namelist()}
        if "feed_info.txt" in names:
            with archive.open(names["feed_info.txt"]) as raw:
                rows = list(csv.DictReader((line.decode("utf-8-sig") for line in raw)))
                if rows:
                    info.update(rows[0])
        if "calendar.txt" in names:
            with archive.open(names["calendar.txt"]) as raw:
                rows = csv.DictReader((line.decode("utf-8-sig") for line in raw))
                starts: list[str] = []
                ends: list[str] = []
                for row in rows:
                    if row.get("start_date"):
                        starts.append(row["start_date"])
                    if row.get("end_date"):
                        ends.append(row["end_date"])
                if starts:
                    info["valid_from"] = min(starts)
                if ends:
                    info["valid_until"] = max(ends)
    return info


def validate() -> None:
    manifest = read_manifest()
    for spec in SOURCES:
        path = Path(spec.file_name)
        if not path.exists():
            raise SystemExit(f"missing source file: {path}")
        status = "validated"
        notes: list[str] = []
        extra: dict[str, Any] = {}
        if spec.format == "zip":
            with zipfile.ZipFile(path) as archive:
                bad = archive.testzip()
                if bad:
                    raise SystemExit(f"{spec.source_key}: bad ZIP member {bad}")
                names = {Path(name).name for name in archive.namelist()}
            if spec.source_key == "delfi_gtfs":
                required = {"agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt"}
                missing = sorted(required - names)
                if missing:
                    raise SystemExit(f"DELFI missing required GTFS files: {missing}")
                extra["record_counts"] = count_zip_csv(path)
                extra.update(feed_info(path))
            if spec.source_key == "bkg_vg250":
                if not any(name.endswith(".gpkg") for name in names):
                    raise SystemExit("BKG ZIP contains no GeoPackage")
        elif spec.format == "osm.pbf":
            if read_head(path, 32).lstrip().startswith(b"<"):
                raise SystemExit("OSM PBF looks like HTML")
            md5_url = "https://download.geofabrik.de/europe/germany-latest.osm.pbf.md5"
            try:
                with urllib.request.urlopen(request(md5_url), timeout=60) as response:
                    expected = response.read().decode("utf-8").split()[0]
                actual = md5(path)
                extra["geofabrik_md5"] = expected
                extra["md5"] = actual
                if expected != actual:
                    status = "warning"
                    notes.append("Geofabrik latest MD5 did not match downloaded redirect target; likely mirror/latest timing mismatch.")
            except Exception as error:
                status = "warning"
                notes.append(f"MD5 check failed: {error}")
        entry = next(item for item in manifest["sources"] if item["source_key"] == spec.source_key)
        entry.update(
            {
                "file_size_bytes": path.stat().st_size,
                "sha256": sha256(path),
                "validation_status": status,
                "notes": "; ".join(notes) if notes else entry.get("notes"),
                "raw_metadata": {**entry.get("raw_metadata", {}), **extra},
            }
        )
        if extra.get("valid_from"):
            entry["valid_from"] = f"{extra['valid_from'][:4]}-{extra['valid_from'][4:6]}-{extra['valid_from'][6:8]}"
        if extra.get("valid_until"):
            entry["valid_until"] = f"{extra['valid_until'][:4]}-{extra['valid_until'][4:6]}-{extra['valid_until'][6:8]}"
    write_manifest(manifest)
    print(json.dumps({"validated": [spec.source_key for spec in SOURCES]}, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["discover", "download", "validate"])
    args = parser.parse_args()
    if args.phase == "discover":
        discover()
    elif args.phase == "download":
        download()
    else:
        validate()


if __name__ == "__main__":
    main()
