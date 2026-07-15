from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from .places import load_records


class PlaceImportTest(unittest.TestCase):
    def test_loads_csv_records_with_default_category(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "places.csv"
            path.write_text(
                "source_place_id,name,state_code,address,website,lat,lon\n"
                "hof-1,Fixture Hof,SH,Testweg 1,https://example.test,53.55,10.01\n",
                encoding="utf-8",
            )

            records = load_records(path, "fixture_places", "hof")

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].source_place_id, "hof-1")
        self.assertEqual(records[0].category, "hof")
        self.assertEqual(records[0].state_code, "SH")
        self.assertEqual(records[0].lon, 10.01)
        self.assertEqual(records[0].lat, 53.55)

    def test_loads_geojson_records_with_row_category(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "places.geojson"
            path.write_text(
                """
                {
                  "type": "FeatureCollection",
                  "features": [
                    {
                      "type": "Feature",
                      "properties": {
                        "id": "gut-1",
                        "name": "Fixture Gut",
                        "category": "gut",
                        "bundesland": "Schleswig-Holstein"
                      },
                      "geometry": {"type": "Point", "coordinates": [10.02, 53.56]}
                    },
                    {
                      "type": "Feature",
                      "properties": {
                        "id": "bad-1",
                        "name": "Fixture Kirche",
                        "category": "church"
                      },
                      "geometry": {"type": "Point", "coordinates": [10.03, 53.57]}
                    }
                  ]
                }
                """,
                encoding="utf-8",
            )

            records = load_records(path, "fixture_places")

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].source_place_id, "gut-1")
        self.assertEqual(records[0].category, "gut")
        self.assertEqual(records[0].state_code, "SH")


if __name__ == "__main__":
    unittest.main()
