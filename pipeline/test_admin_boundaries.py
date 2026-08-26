from __future__ import annotations

import inspect
import sqlite3
import struct
import tempfile
import unittest
from pathlib import Path

from .admin_boundaries import inspect_gpkg, normalize_import


LOCAL_GPKG = Path(
    "data/processed/bkg/vg250_01-01.utm32s.gpkg.ebenen/vg250_ebenen_0101/DE_VG250.gpkg"
)
TARGET_STATE_KEYS = ("01", "02", "03", "13")


def multipolygon_part_count(gpkg_geometry: bytes) -> int:
    flags = gpkg_geometry[3]
    envelope_indicator = (flags >> 1) & 0b111
    envelope_lengths = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    offset = 8 + envelope_lengths[envelope_indicator]
    byte_order = "<" if gpkg_geometry[offset] == 1 else ">"
    geometry_type = struct.unpack_from(f"{byte_order}I", gpkg_geometry, offset + 1)[0] % 1000

    if geometry_type != 6:
        return 1

    return struct.unpack_from(f"{byte_order}I", gpkg_geometry, offset + 5)[0]


class AdministrativeBoundaryImportTest(unittest.TestCase):
    def test_selects_the_canonical_state_county_and_municipality_layers(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            gpkg = Path(temp_dir) / "fixture.gpkg"

            with sqlite3.connect(gpkg) as connection:
                connection.execute(
                    "CREATE TABLE gpkg_contents (table_name text, data_type text, identifier text, srs_id integer)"
                )
                connection.executemany(
                    "INSERT INTO gpkg_contents VALUES (?, 'features', ?, 25832)",
                    [
                        ("v_vg250_lan", "state view"),
                        ("vg250_lan", "states"),
                        ("vg250_krs", "counties"),
                        ("vg250_gem", "municipalities"),
                    ],
                )

            selected, _ = inspect_gpkg(gpkg)

        self.assertEqual(
            selected,
            {"state": "vg250_lan", "county": "vg250_krs", "municipality": "vg250_gem"},
        )

    def test_upsert_keeps_ids_and_reimport_soft_deactivates_missing_entities(self) -> None:
        source = inspect.getsource(normalize_import)

        self.assertIn("ON CONFLICT (level, official_key) DO UPDATE", source)
        self.assertNotIn("id = EXCLUDED.id", source)
        self.assertIn("SET is_active = false", source)
        self.assertIn("parent_id = EXCLUDED.parent_id", source)

    @unittest.skipUnless(LOCAL_GPKG.exists(), "local BKG VG250 fixture is not available")
    def test_local_vg250_has_expected_hierarchy_counts_and_multipart_areas(self) -> None:
        placeholders = ", ".join("?" for _ in TARGET_STATE_KEYS)

        with sqlite3.connect(LOCAL_GPKG) as connection:
            county_count = connection.execute(
                f"SELECT count(DISTINCT ags) FROM vg250_krs WHERE gf = 4 AND sn_l IN ({placeholders})",
                TARGET_STATE_KEYS,
            ).fetchone()[0]
            municipality_count = connection.execute(
                f"SELECT count(DISTINCT ags) FROM vg250_gem WHERE gf = 4 AND sn_l IN ({placeholders})",
                TARGET_STATE_KEYS,
            ).fetchone()[0]
            missing_parents = connection.execute(
                f"""
                SELECT count(*)
                FROM vg250_gem municipality
                WHERE municipality.gf = 4
                  AND municipality.sn_l IN ({placeholders})
                  AND NOT EXISTS (
                    SELECT 1
                    FROM vg250_krs county
                    WHERE county.gf = 4
                      AND county.ags = substr(municipality.ags, 1, 5)
                  )
                """,
                TARGET_STATE_KEYS,
            ).fetchone()[0]
            geometries = connection.execute(
                f"SELECT geom FROM vg250_gem WHERE gf = 4 AND sn_l IN ({placeholders})",
                TARGET_STATE_KEYS,
            ).fetchall()

        self.assertEqual(county_count, 69)
        self.assertEqual(municipality_count, 2_795)
        self.assertEqual(missing_parents, 0)
        self.assertTrue(any(multipolygon_part_count(row[0]) > 1 for row in geometries))


if __name__ == "__main__":
    unittest.main()
