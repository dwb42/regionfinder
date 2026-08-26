from __future__ import annotations

import unittest
import tempfile
from pathlib import Path

from .ferienhof_research import (
    Candidate,
    candidate_from_generic_page,
    dedupe_candidates,
    extract_landsichten_links,
    extract_links,
    enrich_detail_candidates,
    is_relevant_ferienhof,
    is_relevant_entrypoint,
)


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

    def test_extracts_generic_listed_domain_json_ld_candidate(self) -> None:
        html = """
        <html>
          <head>
            <title>Ferienhof Test</title>
            <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "LodgingBusiness",
              "name": "Ferienhof Test",
              "url": "https://ferienhof-test.example",
              "geo": {"@type": "GeoCoordinates", "latitude": 54.1, "longitude": 10.2},
              "address": {
                "@type": "PostalAddress",
                "streetAddress": "Testweg 1",
                "postalCode": "24300",
                "addressLocality": "Testort"
              }
            }
            </script>
          </head>
          <body>Urlaub auf dem Bauernhof</body>
        </html>
        """

        candidate = candidate_from_generic_page(
            "domain_example",
            "https://www.landurlaub-mv.de/ferienhof-test",
            html,
        )

        self.assertIsNotNone(candidate)
        assert candidate is not None
        self.assertEqual(candidate.name, "Ferienhof Test")
        self.assertEqual(candidate.state_code, "SH")
        self.assertEqual(candidate.lon, 10.2)
        self.assertEqual(candidate.lat, 54.1)
        self.assertEqual(candidate.website, "https://ferienhof-test.example")

    def test_handles_json_ld_type_lists(self) -> None:
        html = """
        <html>
          <head>
            <title>Ferienhof Test</title>
            <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": ["LocalBusiness", "LodgingBusiness"],
              "name": "Ferienhof Test",
              "geo": {"@type": "GeoCoordinates", "latitude": 54.1, "longitude": 10.2}
            }
            </script>
          </head>
          <body>Ferienwohnungen auf dem Bauernhof</body>
        </html>
        """

        candidate = candidate_from_generic_page(
            "domain_example",
            "https://www.example.test/ferienhof-test",
            html,
        )

        self.assertIsNotNone(candidate)
        assert candidate is not None
        self.assertEqual(candidate.name, "Ferienhof Test")

    def test_restricts_extracted_links_to_same_listed_host(self) -> None:
        html = """
        <a href="/urlaub-auf-dem-bauernhof">Bauernhofurlaub</a>
        <a href="https://ferienhof-test.example">Externe Hofwebsite</a>
        """

        links = extract_links(html, "https://www.landreise.de/start", "www.landreise.de")

        self.assertEqual(links, [("https://www.landreise.de/urlaub-auf-dem-bauernhof", "Bauernhofurlaub")])
        self.assertTrue(is_relevant_entrypoint(links[0][0], links[0][1]))

    def test_filters_service_only_listed_domain_candidates(self) -> None:
        service_candidate = Candidate(
            source_id="domain_example",
            source_place_id="service",
            name="Biber Ferienhof - Bootsverleih",
            state_code="MV",
            address=None,
            website="https://example.test/bootsverleih",
            lon=12.0,
            lat=54.0,
            confidence="listed_domain_structured_detail",
            source_url="https://example.test/bootsverleih",
            detail_url="https://example.test/bootsverleih",
            evidence="test",
        )
        stay_candidate = Candidate(
            source_id="domain_example",
            source_place_id="stay",
            name="Biber Ferienhof - Ferienwohnungen",
            state_code="MV",
            address=None,
            website="https://example.test/ferienwohnungen",
            lon=12.0,
            lat=54.0,
            confidence="listed_domain_structured_detail",
            source_url="https://example.test/ferienwohnungen",
            detail_url="https://example.test/ferienwohnungen",
            evidence="test",
        )

        self.assertFalse(is_relevant_ferienhof(service_candidate))
        self.assertTrue(is_relevant_ferienhof(stay_candidate))

    def test_filters_broad_listing_page_candidates(self) -> None:
        candidate = Candidate(
            source_id="domain_www_bauernhofurlaub_info",
            source_place_id="listing",
            name="Schifterhof Ruhpolding",
            state_code="SH",
            address=None,
            website="https://www.bauernhofurlaub.info/urlaub-auf-dem-bauernhof/deutschland",
            lon=10.0,
            lat=54.0,
            confidence="listed_domain_structured_detail",
            source_url="https://www.bauernhofurlaub.info/urlaub-auf-dem-bauernhof/deutschland",
            detail_url="https://www.bauernhofurlaub.info/urlaub-auf-dem-bauernhof/deutschland",
            evidence="test",
        )

        self.assertFalse(is_relevant_ferienhof(candidate))

    def test_enriches_detail_candidate_with_html_coordinate_fallback(self) -> None:
        candidate = Candidate(
            source_id="fixture_source",
            source_place_id="fixture-place",
            name="Details",
            state_code="SH",
            address=None,
            website="https://example.test/detail",
            lon=None,
            lat=None,
            confidence="listing_link",
            source_url="https://example.test/list",
            detail_url="https://example.test/detail",
            evidence="test",
        )
        html = """
        <html>
          <head>
            <title>Ferienhof Test | Landreise</title>
            <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"LodgingBusiness","name":"Details"}
            </script>
          </head>
          <body>{"geo":{"@type":"GeoCoordinates","latitude":"54.1","longitude":"10.2"}}</body>
        </html>
        """

        with tempfile.TemporaryDirectory() as temp_dir:
            import pipeline.ferienhof_research as research

            original_raw_dir = research.RAW_DIR
            research.RAW_DIR = Path(temp_dir)
            try:
                (research.RAW_DIR / "fixture_source_fixture-place.html").write_text(html, encoding="utf-8")
                enriched = enrich_detail_candidates([candidate], refresh=False, max_details=None)
            finally:
                research.RAW_DIR = original_raw_dir

        self.assertEqual(len(enriched), 1)
        self.assertEqual(enriched[0].name, "Ferienhof Test")
        self.assertEqual(enriched[0].lat, 54.1)
        self.assertEqual(enriched[0].lon, 10.2)
        self.assertEqual(enriched[0].confidence, "structured_detail")

    def test_coordinate_fallback_preserves_existing_state_code(self) -> None:
        candidate = Candidate(
            source_id="fixture_mv",
            source_place_id="fixture-place",
            name="Ferienhof Rauchhaus",
            state_code="MV",
            address=None,
            website="https://example.test/detail",
            lon=None,
            lat=None,
            confidence="listing_link",
            source_url="https://example.test/list",
            detail_url="https://example.test/detail",
            evidence="test",
        )
        html = """
        <html>
          <head>
            <title>Ferienhof Rauchhaus</title>
            <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"LodgingBusiness","name":"Ferienhof Rauchhaus"}
            </script>
          </head>
          <body>{"geo":{"@type":"GeoCoordinates","latitude":"53.5474994","longitude":"11.1892544"}}</body>
        </html>
        """

        with tempfile.TemporaryDirectory() as temp_dir:
            import pipeline.ferienhof_research as research

            original_raw_dir = research.RAW_DIR
            research.RAW_DIR = Path(temp_dir)
            try:
                (research.RAW_DIR / "fixture_mv_fixture-place.html").write_text(html, encoding="utf-8")
                enriched = enrich_detail_candidates([candidate], refresh=False, max_details=None)
            finally:
                research.RAW_DIR = original_raw_dir

        self.assertEqual(enriched[0].state_code, "MV")

    def test_fetch_errors_are_not_relevant_ferienhof_candidates(self) -> None:
        candidate = Candidate(
            source_id="fixture",
            source_place_id="fetch-error",
            name="FETCH ERROR landsichten_ni_bauernhof",
            state_code="NI",
            address=None,
            website="https://example.test",
            lon=None,
            lat=None,
            confidence="fetch_error",
            source_url="https://example.test",
            detail_url=None,
            evidence="HTTP Error 404",
        )

        self.assertFalse(is_relevant_ferienhof(candidate))


if __name__ == "__main__":
    unittest.main()
