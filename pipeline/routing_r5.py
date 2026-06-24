from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

REPORT = Path("data/reports/r5-build.json")
GTFS = Path(os.environ.get("DELFI_GTFS_PATH", "data/raw/delfi/gtfs-deutschland-gesamt.zip")).resolve()
OSM = Path(os.environ.get("OSM_PBF_PATH", "data/raw/osm/germany-latest.osm.pbf")).resolve()
IMAGE = os.environ.get("REGIONFINDER_R5PY_IMAGE", "eclipse-temurin:21.0.7_6-jdk-jammy")


def main() -> None:
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    start = time.time()
    cmd = [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{Path.cwd()}:/work",
        "-w",
        "/work",
        IMAGE,
        "bash",
        "-lc",
        (
            "apt-get update && apt-get install -y --no-install-recommends python3 python3-pip >/tmp/r5-apt.log && "
            "python3 -m pip install r5py==1.0.4 >/tmp/r5-pip.log && "
            "python3 - <<'PY'\n"
            "import json, platform, r5py, time\n"
            "from pathlib import Path\n"
            f"osm=Path('{OSM.relative_to(Path.cwd())}')\n"
            f"gtfs=Path('{GTFS.relative_to(Path.cwd())}')\n"
            "started=time.time()\n"
            "network=r5py.TransportNetwork(osm, [gtfs])\n"
            "Path('data/routing/r5').mkdir(parents=True, exist_ok=True)\n"
            "Path('data/reports/r5-smoke-python.json').write_text(json.dumps({'r5py_version': r5py.__version__, 'python': platform.python_version(), 'build_seconds': time.time()-started}, indent=2))\n"
            "PY"
        ),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    REPORT.write_text(
        json.dumps(
            {
                "started_at_epoch": start,
                "duration_seconds": time.time() - start,
                "engine": "r5py",
                "requested_r5py_version": "1.0.4",
                "docker_image": IMAGE,
                "gtfs": str(GTFS),
                "osm": str(OSM),
                "returncode": result.returncode,
                "output_tail": result.stdout[-8000:],
                "status": "built" if result.returncode == 0 else "failed",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(REPORT.read_text(encoding="utf-8"))
    if result.returncode != 0:
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
