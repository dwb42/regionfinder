from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


REQUIRED_GTFS_FILES = {
    "agency.txt",
    "stops.txt",
    "routes.txt",
    "trips.txt",
    "stop_times.txt",
    "calendar.txt",
}


@dataclass(frozen=True)
class GtfsValidationReport:
    source: str
    required_files_present: bool
    missing_files: list[str]
    optional_files_present: list[str]
    sha256: str

    def to_json(self) -> str:
        return json.dumps(self.__dict__, ensure_ascii=False, indent=2)


def iter_csv(path: Path) -> Iterable[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        yield from csv.DictReader(file)


def directory_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    for file in sorted(item for item in path.iterdir() if item.is_file()):
        digest.update(file.name.encode("utf-8"))
        digest.update(file.read_bytes())
    return digest.hexdigest()


def validate_gtfs_directory(path: Path) -> GtfsValidationReport:
    files = {item.name for item in path.iterdir() if item.is_file()}
    missing = sorted(REQUIRED_GTFS_FILES - files)
    optional = sorted(files - REQUIRED_GTFS_FILES)
    return GtfsValidationReport(
        source=str(path),
        required_files_present=not missing,
        missing_files=missing,
        optional_files_present=optional,
        sha256=directory_sha256(path),
    )


def parse_gtfs_time_seconds(value: str) -> int:
    hours, minutes, seconds = (int(part) for part in value.split(":"))
    if minutes > 59 or seconds > 59 or hours < 0:
        raise ValueError(f"invalid GTFS time: {value}")
    return hours * 3600 + minutes * 60 + seconds
