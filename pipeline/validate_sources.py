from __future__ import annotations

import os
from pathlib import Path

from .gtfs import validate_gtfs_directory


def main() -> None:
    delfi_path = os.getenv("DELFI_GTFS_PATH")
    if not delfi_path:
        print("DELFI_GTFS_PATH is not set; full canonical import is blocked until a local snapshot is provided.")
    else:
        path = Path(delfi_path)
        if not path.exists():
            raise SystemExit(f"DELFI_GTFS_PATH does not exist: {path}")
        print(validate_gtfs_directory(path if path.is_dir() else path.parent).to_json())

    fixture = Path("fixtures/gtfs/synthetic")
    if fixture.exists():
        print(validate_gtfs_directory(fixture).to_json())


if __name__ == "__main__":
    main()
