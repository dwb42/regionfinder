from __future__ import annotations

import subprocess
import sys

PHASES = [
    ["npm", "run", "data:discover"],
    ["npm", "run", "data:download"],
    ["npm", "run", "data:validate"],
    ["npm", "run", "db:migrate"],
    ["npm", "run", "boundaries:import"],
    ["npm", "run", "pipeline:import:production"],
    ["npm", "run", "routing:build:r5"],
    ["npm", "run", "metrics:compute:production"],
    ["npm", "run", "routing:build:motis"],
    ["npm", "run", "verify:production"],
]


def main() -> None:
    for phase in PHASES:
        print(f"==> {' '.join(phase)}", flush=True)
        result = subprocess.run(phase)
        if result.returncode != 0:
            raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
