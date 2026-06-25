from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from .schools import SOURCES, load_records, school_category_for_label


class SchoolImportTest(unittest.TestCase):
    def test_maps_all_secondary_school_categories(self) -> None:
        self.assertEqual(school_category_for_label("Gymnasium"), "gymnasium")
        self.assertEqual(school_category_for_label("Integrierte Gesamtschule"), "comprehensive")
        self.assertEqual(school_category_for_label("Freie Waldorfschule"), "waldorf")
        self.assertEqual(school_category_for_label("Berufsbildende Schule"), "vocational")
        self.assertEqual(school_category_for_label("Gymnasiale Oberstufe"), "upper_secondary")
        self.assertIsNone(school_category_for_label("Grundschule"))

    def test_loads_geojson_records_with_official_type_labels(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "hamburg.geojson"
            path.write_text(
                """
                {
                  "type": "FeatureCollection",
                  "features": [
                    {
                      "type": "Feature",
                      "properties": {
                        "schul_id": "hh-1",
                        "schulname": "Fixture Gymnasium",
                        "schulform": "Gymnasium",
                        "adresse": "Testweg 1",
                        "homepage": "https://example.test"
                      },
                      "geometry": {"type": "Point", "coordinates": [10.01, 53.55]}
                    },
                    {
                      "type": "Feature",
                      "properties": {
                        "schul_id": "hh-2",
                        "schulname": "Fixture Grundschule",
                        "schulform": "Grundschule"
                      },
                      "geometry": {"type": "Point", "coordinates": [10.02, 53.56]}
                    }
                  ]
                }
                """,
                encoding="utf-8",
            )

            records = load_records({SOURCES["HH"].state_code: path})

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].source_school_id, "hh-1")
        self.assertEqual(records[0].school_category, "gymnasium")
        self.assertEqual(records[0].school_type_label, "Gymnasium")
        self.assertEqual(records[0].address, "Testweg 1")
        self.assertEqual(records[0].website, "https://example.test")
        self.assertEqual(records[0].lon, 10.01)
        self.assertEqual(records[0].lat, 53.55)


if __name__ == "__main__":
    unittest.main()
