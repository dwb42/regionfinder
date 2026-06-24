from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import PIPELINE_VERSION
from .gtfs import iter_csv, parse_gtfs_time_seconds, validate_gtfs_directory


def normalize_name(value: str) -> str:
    return " ".join(value.casefold().split())


def inspect_feed(path: Path) -> dict[str, object]:
    report = validate_gtfs_directory(path)
    if not report.required_files_present:
        raise SystemExit(report.to_json())

    stops = list(iter_csv(path / "stops.txt"))
    trips = list(iter_csv(path / "trips.txt"))
    stop_times = list(iter_csv(path / "stop_times.txt"))
    routes = list(iter_csv(path / "routes.txt"))
    calendar_dates = list(iter_csv(path / "calendar_dates.txt")) if (path / "calendar_dates.txt").exists() else []
    shapes = list(iter_csv(path / "shapes.txt")) if (path / "shapes.txt").exists() else []
    parent_stops = {row["stop_id"] for row in stops if row.get("location_type") == "1"}
    child_stops = [row for row in stops if row.get("parent_station")]
    seconds_over_midnight = [
        parse_gtfs_time_seconds(row["departure_time"])
        for row in stop_times
        if parse_gtfs_time_seconds(row["departure_time"]) >= 24 * 3600
    ]

    return {
        "pipeline_version": PIPELINE_VERSION,
        "source": str(path),
        "source_sha256": report.sha256,
        "counts": {
            "stops": len(stops),
            "parent_stations": len(parent_stops),
            "child_stops": len(child_stops),
            "routes": len(routes),
            "trips": len(trips),
            "stop_times": len(stop_times),
            "calendar_dates": len(calendar_dates),
            "shapes": len(shapes),
        },
        "quality_report": {
            "status": "fixture_validated",
            "missing_required_files": report.missing_files,
            "times_over_midnight": len(seconds_over_midnight),
            "missing_shapes": len([trip for trip in trips if not trip.get("shape_id")]),
        },
        "normalized_stop_names": sorted({normalize_name(row["stop_name"]) for row in stops})[:10],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--source-key", required=True)
    parser.add_argument("--output", default="dist/pipeline/synthetic-import-report.json")
    args = parser.parse_args()

    report = inspect_feed(Path(args.source))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"source_key": args.source_key, "report": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
