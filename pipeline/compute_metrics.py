from __future__ import annotations

import argparse
import json
from pathlib import Path


QUANTILE_METHOD = "nearest-rank-p90"


def nearest_rank(values: list[int], quantile: float) -> int | None:
    if not values:
        return None
    rank = int(-(-len(values) * quantile // 1))
    return sorted(values)[rank - 1]


def aggregate(samples: list[int | None]) -> dict[str, object]:
    reachable = [value for value in samples if value is not None]
    ratio = len(reachable) / len(samples) if samples else 0
    return {
        "total_sample_count": len(samples),
        "reachable_sample_count": len(reachable),
        "unreachable_sample_count": len(samples) - len(reachable),
        "reachability_ratio": ratio,
        "fastest_seconds": min(reachable) if reachable else None,
        "average_seconds": sum(reachable) / len(reachable) if reachable else None,
        "median_seconds": sorted(reachable)[len(reachable) // 2] if len(reachable) % 2 == 1 else (
            (sorted(reachable)[len(reachable) // 2 - 1] + sorted(reachable)[len(reachable) // 2]) / 2
            if reachable else None
        ),
        "p90_seconds": nearest_rank(reachable, 0.9) if ratio >= 0.9 else None,
        "p90_publishable": ratio >= 0.9,
        "median_publishable": ratio >= 0.5,
        "quantile_method": QUANTILE_METHOD,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--output", default="dist/pipeline/metric-report.json")
    args = parser.parse_args()
    samples = [40 * 60, 45 * 60, 50 * 60, 70 * 60, None]
    report = {
        "snapshot": args.snapshot,
        "profile": args.profile,
        "origin": args.origin,
        "engine": "fixture-local",
        "engine_version": "0.1.0",
        "metrics": aggregate(samples),
        "note": "R5/r5py execution requires DELFI_GTFS_PATH and OSM_PBF_PATH; this fixture run validates aggregation semantics only.",
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
