from __future__ import annotations

import bz2
import json
import os
import platform
import shutil
import subprocess
import tarfile
import time
import urllib.request
from pathlib import Path

REPORT = Path("data/reports/motis-build.json")
GTFS = Path(os.environ.get("DELFI_GTFS_PATH", "data/raw/delfi/gtfs-deutschland-gesamt.zip")).resolve()
OSM = Path(os.environ.get("OSM_PBF_PATH", "data/raw/osm/germany-latest.osm.pbf")).resolve()
MOTIS_DIR = Path("data/routing/motis")
USER_AGENT = "Regionfinder/2.0 production-bootstrap (+local)"


def latest_release() -> dict:
    request = urllib.request.Request(
        "https://api.github.com/repos/motis-project/motis/releases/latest",
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def target_name() -> str:
    machine = platform.machine().lower()
    if machine in {"arm64", "aarch64"}:
        return "macos-arm64"
    return "macos-amd64"


def download_asset(release: dict) -> Path:
    target = target_name()
    assets = release.get("assets", [])
    candidates = [asset for asset in assets if target in asset.get("name", "") and asset.get("name", "").endswith(".tar.bz2")]
    if not candidates:
        raise SystemExit(f"No MOTIS release asset for {target}; assets: {[asset.get('name') for asset in assets]}")
    asset = candidates[0]
    archive = MOTIS_DIR / asset["name"]
    MOTIS_DIR.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        req = urllib.request.Request(asset["browser_download_url"], headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=600) as response, archive.open("wb") as file:
            shutil.copyfileobj(response, file)
    return archive


def main() -> None:
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    started = time.time()
    release = latest_release()
    archive = download_asset(release)
    extract_dir = MOTIS_DIR / "bin"
    if not (extract_dir / "motis").exists():
        extract_dir.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive) as tar:
            tar.extractall(extract_dir)
    binaries = list(extract_dir.rglob("motis"))
    if not binaries:
        raise SystemExit("MOTIS binary not found after extraction")
    motis = binaries[0].resolve()
    work = MOTIS_DIR / "graph"
    work.mkdir(parents=True, exist_ok=True)
    profile_source = motis.parent / "tiles-profiles"
    profile_target = work / "tiles-profiles"
    if profile_source.exists() and not profile_target.exists():
        shutil.copytree(profile_source, profile_target)
    shutil.copy2(GTFS, work / "gtfs.zip")
    shutil.copy2(OSM, work / "osm.pbf")
    commands = [
        [str(motis), "--help"],
        [str(motis), "config", "osm.pbf", "gtfs.zip"],
        [str(motis), "import"],
    ]
    logs: list[dict] = []
    for command in commands:
        result = subprocess.run(command, cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=None)
        logs.append({"command": command, "returncode": result.returncode, "output_tail": result.stdout[-4000:]})
        if result.returncode != 0:
            break
    status = "built" if logs and logs[-1]["returncode"] == 0 else "failed"
    REPORT.write_text(
        json.dumps(
            {
                "release": release.get("tag_name"),
                "asset": archive.name,
                "target": target_name(),
                "duration_seconds": time.time() - started,
                "gtfs": str(GTFS),
                "osm": str(OSM),
                "graph_dir": str(work),
                "status": status,
                "logs": logs,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(REPORT.read_text(encoding="utf-8"))
    if status != "built":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
