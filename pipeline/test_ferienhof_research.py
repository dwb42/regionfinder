from __future__ import annotations

import unittest

from .ferienhof_research import dedupe_candidates, extract_landsichten_links, Candidate


class FerienhofResearchTest(unittest.TestCase):
    def test_extracts_landsichten_teaser_links(self) -> None:
        html = """
        <a class="teaser-card-href" href="/gastgeber/ferienhof-lucht-muehbrook-9441/" id="GER00020060030199441" target="_blank">
        """

        records = extract_landsichten_links(
            "landsichten_sh_kinderhof",
            "https://www.landsichten.de/schleswig-holstein/familienurlaub/kinderhof/",
            html,
        )

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].source_place_id, "GER00020060030199441")
        self.assertEqual(records[0].name, "ferienhof lucht muehbrook")
        self.assertEqual(records[0].state_code, "SH")

    def test_prefers_coordinate_records_when_deduping(self) -> None:
        weak = Candidate(
            source_id="a",
            source_place_id="1",
            name="Ferienhof Test",
            state_code="SH",
            address="Testweg 1",
            website=None,
            lon=None,
            lat=None,
            confidence="listing_link",
            source_url="https://example.test",
            detail_url=None,
            evidence="listing",
        )
        strong = Candidate(
            source_id="b",
            source_place_id="2",
            name="Ferienhof Test",
            state_code="SH",
            address="Testweg 1",
            website="https://example.test/detail",
            lon=10.0,
            lat=53.0,
            confidence="structured_detail",
            source_url="https://example.test",
            detail_url="https://example.test/detail",
            evidence="jsonld",
        )

        records = dedupe_candidates([weak, strong])

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].source_id, "b")


if __name__ == "__main__":
    unittest.main()
