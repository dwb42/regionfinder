from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

RAW_DIR = Path("data/raw/places/ferienhoefe")
REPORT_DIR = Path("data/reports/places")
OUTPUT_CSV = RAW_DIR / "ferienhoefe_candidates.csv"
REPORT_PATH = REPORT_DIR / "ferienhoefe-research.json"
LANDREISE_BROWSER_LINKS = RAW_DIR / "landreise_browser_links.json"
OSM_CANDIDATES_JSON = RAW_DIR / "osm_ferienhof_candidates.json"
OSM_PBF_PATH = Path("data/raw/osm/germany-latest.osm.pbf")
USER_AGENT = "Regionfinder Ferienhof Research/1.0 (+local data curation)"
SUPPORTED_STATES = {"HH", "SH", "MV", "NI"}

SOURCE_URLS = {
    "landsichten_sh_kinderhof": "https://www.landsichten.de/schleswig-holstein/familienurlaub/kinderhof/",
    "landsichten_mv_kinderhof": "https://www.landsichten.de/mecklenburg-vorpommern/kinder-familie/kinderhof/",
    "landsichten_ni_kinderhof": "https://www.landsichten.de/niedersachsen/kinder-familie/kinderhof/",
    "landsichten_sh_bauernhof": "https://www.landsichten.de/schleswig-holstein/urlaub-auf-dem-bauernhof/",
    "landsichten_mv_bauernhof": "https://www.landsichten.de/mecklenburg-vorpommern/urlaub-auf-dem-bauernhof/",
    "landsichten_ni_bauernhof": "https://www.landsichten.de/niedersachsen/urlaub-auf-dem-bauernhof/",
    "bauernhofurlaub_sh": "https://www.bauernhofurlaub.de/bundeslaender/schleswig-holstein.html",
    "bauernhofurlaub_mv": "https://www.bauernhofurlaub.de/bundeslaender/mecklenburg-vorpommern.html",
    "bauernhofurlaub_ni": "https://www.bauernhofurlaub.de/bundeslaender/niedersachsen.html",
    "landreise_sh": "https://www.landreise.de/bauernhofurlaub-landurlaub/schleswig-holstein/",
    "landreise_mv": "https://www.landreise.de/bauernhofurlaub-landurlaub/mecklenburg-vorpommern/",
    "landreise_ni": "https://www.landreise.de/bauernhofurlaub-landurlaub/niedersachsen/",
}

STATE_HINTS = {
    "schleswig-holstein": "SH",
    "mecklenburg-vorpommern": "MV",
    "niedersachsen": "NI",
    "hamburg": "HH",
}

STATE_BBOXES = {
    "HH": (9.72, 53.38, 10.35, 53.75),
    "SH": (7.85, 53.35, 11.35, 55.12),
    "MV": (10.55, 53.05, 14.50, 54.85),
    "NI": (6.60, 51.25, 11.65, 53.95),
}

OSM_NAME_RE = re.compile(r"\b(ferienhof|ferienbauernhof|bauernhof|kinderbauernhof|urlaubshof|gutshof|landhof)\b", re.I)
OSM_EXCLUDE_RE = re.compile(r"\b(verkauf|shop|markt|laden|cafe|café|restaurant|zaun|zäune|service|frisch vom)\b", re.I)


@dataclass(frozen=True)
class Candidate:
    source_id: str
    source_place_id: str
    name: str
    state_code: str | None
    address: str | None
    website: str | None
    lon: float | None
    lat: float | None
    confidence: str
    source_url: str
    detail_url: str | None
    evidence: str
    raw_properties: dict[str, Any] = field(default_factory=dict)


def fetch_url(url: str, retries: int = 2, delay_seconds: float = 0.7) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return response.read().decode("utf-8", "ignore")
        except urllib.error.HTTPError as error:
            if error.code in {403, 404} or attempt == retries:
                raise
        except urllib.error.URLError:
            if attempt == retries:
                raise

        time.sleep(delay_seconds * (attempt + 1))

    raise RuntimeError(f"Could not fetch {url}")


def cached_fetch(source_id: str, url: str, refresh: bool) -> str:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / f"{source_id}.html"

    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8")

    text = fetch_url(url)
    path.write_text(text, encoding="utf-8")

    return text


def normalize_text(value: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", value))
    text = re.sub(r"\s+", " ", text).strip()

    return text


def normalize_key(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")

    return " ".join(ascii_value.casefold().replace("-", " ").replace("/", " ").split())


def source_place_id(source_id: str, value: str) -> str:
    digest = hashlib.sha1(f"{source_id}|{value}".encode("utf-8")).hexdigest()

    return digest[:16]


def absolute_url(base_url: str, url: str | None) -> str | None:
    if not url:
        return None

    return urllib.parse.urljoin(base_url, html.unescape(url))


def state_from_source(source_id: str, url: str) -> str | None:
    haystack = f"{source_id} {url}".casefold()

    for hint, state_code in STATE_HINTS.items():
        if hint in haystack or hint.replace("-", "_") in haystack:
            return state_code

    return None


def extract_json_ld(text: str) -> list[Any]:
    payloads: list[Any] = []

    for match in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', text, re.S | re.I):
        raw = html.unescape(match.group(1).strip())
        raw = re.sub(r"[\x00-\x1f]+", " ", raw)

        try:
            payloads.append(json.loads(raw))
        except json.JSONDecodeError:
            continue

    return payloads


def iter_json_items(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value

        for child in value.values():
            yield from iter_json_items(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_json_items(child)


def coords_from_json_ld(items: list[Any]) -> tuple[float | None, float | None]:
    for item in iter_json_items(items):
        geo = item.get("geo")

        if not isinstance(geo, dict):
            continue

        lat = parse_float(geo.get("latitude"))
        lon = parse_float(geo.get("longitude"))

        if lat is not None and lon is not None:
            return lon, lat

    return None, None


def parse_float(value: Any) -> float | None:
    if value is None:
        return None

    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return None


def candidate_from_json_ld(
    source_id: str,
    source_url: str,
    detail_url: str | None,
    items: list[Any],
    fallback_name: str | None,
) -> Candidate | None:
    name = fallback_name
    address = None
    website = detail_url
    lon, lat = coords_from_json_ld(items)
    preferred_types = {"LodgingBusiness", "LocalBusiness", "Hotel"}

    for item in iter_json_items(items):
        item_type = item.get("@type")
        is_preferred_item = item_type in preferred_types or (
            isinstance(item_type, list) and any(entry in preferred_types for entry in item_type)
        )
        item_name = item.get("name")
        if isinstance(item_name, str) and (is_preferred_item or not name or name.startswith("Landreise Unterkunft") or "©" in name):
            name = normalize_text(item_name)

        item_url = item.get("url")
        if (
            isinstance(item_url, str)
            and (is_preferred_item or item_type not in {"ImageObject", "Organization"})
            and "imgcdn." not in item_url
            and "#ratings" not in item_url
        ):
            website = absolute_url(detail_url or source_url, item_url)

        item_address = item.get("address")
        if isinstance(item_address, str):
            address = normalize_text(item_address)
        elif isinstance(item_address, dict):
            parts = [
                item_address.get("streetAddress"),
                item_address.get("postalCode"),
                item_address.get("addressLocality"),
            ]
            address_text = " ".join(str(part).strip() for part in parts if part)
            address = normalize_text(address_text) if address_text else address

    if not name:
        return None

    state_code = state_from_source(source_id, source_url)

    return Candidate(
        source_id=source_id,
        source_place_id=source_place_id(source_id, detail_url or name),
        name=name,
        state_code=state_code,
        address=address,
        website=website,
        lon=lon,
        lat=lat,
        confidence="structured_detail" if lon is not None and lat is not None else "structured_detail_without_coords",
        source_url=source_url,
        detail_url=detail_url,
        evidence="application/ld+json",
        raw_properties={"json_ld": items},
    )


def extract_landsichten_links(source_id: str, source_url: str, text: str) -> list[Candidate]:
    candidates: list[Candidate] = []

    pattern = re.compile(
        r'<a[^>]+class=["\'][^"\']*teaser-card-href[^"\']*["\'][^>]+href=["\']([^"\']+)["\'][^>]*id=["\']([^"\']+)["\'][^>]*>',
        re.I,
    )

    for match in pattern.finditer(text):
        href, external_id = match.groups()
        detail_url = absolute_url(source_url, href)
        slug_name = href.strip("/").split("/")[-1]
        name = normalize_text(slug_name.rsplit("-", 1)[0].replace("-", " "))
        candidates.append(
            Candidate(
                source_id=source_id,
                source_place_id=external_id,
                name=name,
                state_code=state_from_source(source_id, source_url),
                address=None,
                website=detail_url,
                lon=None,
                lat=None,
                confidence="listing_link",
                source_url=source_url,
                detail_url=detail_url,
                evidence="landsichten teaser-card-href",
                raw_properties={"external_id": external_id, "href": href},
            )
        )

    return candidates


def extract_bauernhofurlaub_links(source_id: str, source_url: str, text: str) -> list[Candidate]:
    candidates: list[Candidate] = []

    for match in re.finditer(r'href=["\']([^"\']*/hofdetails/ukv/house/([^"\']+))["\'][^>]*>(.*?)</a>', text, re.S | re.I):
        href, external_id, anchor = match.groups()
        detail_url = absolute_url(source_url, href)
        name = normalize_text(anchor)

        if not name:
            name = external_id.rsplit("-", 1)[0].replace("-", " ")

        candidates.append(
            Candidate(
                source_id=source_id,
                source_place_id=external_id,
                name=name,
                state_code=state_from_source(source_id, source_url),
                address=None,
                website=detail_url,
                lon=None,
                lat=None,
                confidence="listing_link",
                source_url=source_url,
                detail_url=detail_url,
                evidence="bauernhofurlaub house link",
                raw_properties={"external_id": external_id, "href": href},
            )
        )

    return candidates


def extract_landreise_listing(source_id: str, source_url: str, text: str) -> list[Candidate]:
    candidates: list[Candidate] = []
    facility_ids = sorted(set(re.findall(r'data-facility-id=["\'](\d+)["\']', text)))

    for facility_id in facility_ids:
        block_match = re.search(rf'.{{0,1800}}data-facility-id=["\']{re.escape(facility_id)}["\'].{{0,2200}}', text, re.S)
        block = block_match.group(0) if block_match else ""
        title_match = re.search(r'<h[23][^>]*>(.*?)</h[23]>', block, re.S | re.I)
        link_match = re.search(r'href=["\']([^"\']+)["\']', block, re.I)
        name = normalize_text(title_match.group(1)) if title_match else f"Landreise Unterkunft {facility_id}"
        detail_url = absolute_url(source_url, link_match.group(1)) if link_match else None

        candidates.append(
            Candidate(
                source_id=source_id,
                source_place_id=facility_id,
                name=name,
                state_code=state_from_source(source_id, source_url),
                address=None,
                website=detail_url or source_url,
                lon=None,
                lat=None,
                confidence="listing_link",
                source_url=source_url,
                detail_url=detail_url,
                evidence="landreise data-facility-id",
                raw_properties={"facility_id": facility_id},
            )
        )

    return candidates


def candidates_from_landreise_browser_links() -> list[Candidate]:
    if not LANDREISE_BROWSER_LINKS.exists():
        return []

    data = json.loads(LANDREISE_BROWSER_LINKS.read_text(encoding="utf-8"))
    candidates: list[Candidate] = []

    for record in data.get("records", []):
        detail_url = record.get("detailUrl")
        source_id = record.get("sourceId")

        if not isinstance(detail_url, str) or not isinstance(source_id, str):
            continue

        candidates.append(
            Candidate(
                source_id=source_id,
                source_place_id=source_place_id(source_id, detail_url),
                name=normalize_text(record.get("listingText") or f"Landreise Unterkunft {detail_url.rsplit('-', 1)[-1].strip('/')}"),
                state_code=record.get("stateCode") if record.get("stateCode") in SUPPORTED_STATES else state_from_source(source_id, detail_url),
                address=None,
                website=detail_url,
                lon=None,
                lat=None,
                confidence="browser_listing_link",
                source_url=record.get("url") or detail_url,
                detail_url=detail_url,
                evidence="landreise browser-rendered listing",
                raw_properties=record,
            )
        )

    return candidates


def candidates_from_osm_cache() -> list[Candidate]:
    if not OSM_CANDIDATES_JSON.exists():
        return []

    data = json.loads(OSM_CANDIDATES_JSON.read_text(encoding="utf-8"))
    candidates: list[Candidate] = []

    for record in data.get("records", []):
        name = record.get("name")
        lat = parse_float(record.get("lat"))
        lon = parse_float(record.get("lon"))
        state_code = record.get("state_code")

        if not isinstance(name, str) or lat is None or lon is None or state_code not in SUPPORTED_STATES:
            continue

        osm_type = record.get("osm_type")
        osm_id = record.get("osm_id")
        source_place = f"{osm_type}/{osm_id}"
        tags = record.get("tags") if isinstance(record.get("tags"), dict) else {}
        website = first_osm_tag(tags, ("website", "contact:website", "url"))

        candidates.append(
            Candidate(
                source_id="osm_ferienhoefe",
                source_place_id=source_place,
                name=normalize_text(name),
                state_code=state_code,
                address=osm_address(tags),
                website=website,
                lon=lon,
                lat=lat,
                confidence="osm_name_match",
                source_url="data/raw/osm/germany-latest.osm.pbf",
                detail_url=f"https://www.openstreetmap.org/{osm_type}/{osm_id}",
                evidence="OpenStreetMap name/tag match",
                raw_properties=record,
            )
        )

    return candidates


def first_osm_tag(tags: dict[str, Any], keys: Iterable[str]) -> str | None:
    for key in keys:
        value = tags.get(key)

        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def osm_address(tags: dict[str, Any]) -> str | None:
    parts = [
        tags.get("addr:street"),
        tags.get("addr:housenumber"),
        tags.get("addr:postcode"),
        tags.get("addr:city"),
    ]
    text = " ".join(str(part).strip() for part in parts if part)

    return text or None


def state_for_coordinate(lon: float, lat: float) -> str | None:
    for state_code in ("HH", "SH", "MV", "NI"):
        min_lon, min_lat, max_lon, max_lat = STATE_BBOXES[state_code]

        if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
            return state_code

    return None


def is_osm_ferienhof_candidate(name: str, tags: dict[str, str]) -> bool:
    if not OSM_NAME_RE.search(name) or OSM_EXCLUDE_RE.search(name):
        return False

    tag_text = normalize_key(" ".join(f"{key} {value}" for key, value in tags.items()))
    positive_tags = {
        "tourism apartment",
        "tourism guest house",
        "tourism chalet",
        "tourism hotel",
        "tourism camp site",
        "tourism caravan site",
        "farmyard",
        "guest house",
        "apartment",
        "accommodation",
        "farm",
        "equestrian",
    }

    return any(token in tag_text for token in positive_tags) or any(
        keyword in normalize_key(name)
        for keyword in ("ferienhof", "ferienbauernhof", "urlaubshof", "kinderbauernhof")
    )


def collect_osm_candidates(pbf_path: Path = OSM_PBF_PATH, include_ways: bool = False) -> list[dict[str, Any]]:
    try:
        import osmium
    except ImportError as error:
        raise RuntimeError("Python package 'osmium' is required for local OSM research") from error

    class Handler(osmium.SimpleHandler):
        def __init__(self) -> None:
            super().__init__()
            self.records: list[dict[str, Any]] = []

        def node(self, node: Any) -> None:
            self._add("node", node.id, node.tags, node.location.lon, node.location.lat)

        def way(self, way: Any) -> None:
            if not include_ways:
                return

            lon, lat = way_center(way)

            if lon is not None and lat is not None:
                self._add("way", way.id, way.tags, lon, lat)

        def relation(self, relation: Any) -> None:
            tags = dict(relation.tags)
            name = tags.get("name")

            if name and is_osm_ferienhof_candidate(name, tags):
                # Relations without a precomputed center are kept out of the import CSV.
                return

        def _add(self, osm_type: str, osm_id: int, tags_view: Any, lon: float, lat: float) -> None:
            try:
                name = tags_view.get("name")
            except Exception:
                name = None

            if not name or not OSM_NAME_RE.search(name) or OSM_EXCLUDE_RE.search(name):
                return

            tags = dict(tags_view)

            if not is_osm_ferienhof_candidate(name, tags):
                return

            state_code = state_for_coordinate(lon, lat)

            if not state_code:
                return

            self.records.append(
                {
                    "osm_type": osm_type,
                    "osm_id": osm_id,
                    "name": name,
                    "state_code": state_code,
                    "lon": lon,
                    "lat": lat,
                    "tags": tags,
                }
            )

    handler = Handler()
    handler.apply_file(str(pbf_path), locations=include_ways)

    OSM_CANDIDATES_JSON.parent.mkdir(parents=True, exist_ok=True)
    OSM_CANDIDATES_JSON.write_text(
        json.dumps({"source": str(pbf_path), "records": handler.records}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return handler.records


def way_center(way: Any) -> tuple[float | None, float | None]:
    lon_sum = 0.0
    lat_sum = 0.0
    count = 0

    try:
        nodes = way.nodes
    except Exception:
        return None, None

    for node_ref in nodes:
        try:
            location = node_ref.location

            if not location.valid():
                continue

            lon_sum += location.lon
            lat_sum += location.lat
            count += 1
        except Exception:
            continue

    if count == 0:
        return None, None

    return lon_sum / count, lat_sum / count


def enrich_detail_candidates(candidates: list[Candidate], refresh: bool, max_details: int | None) -> list[Candidate]:
    enriched: list[Candidate] = []
    detail_count = 0

    for candidate in candidates:
        if candidate.source_id == "osm_ferienhoefe" or not candidate.detail_url or (max_details is not None and detail_count >= max_details):
            enriched.append(candidate)
            continue

        detail_source_id = f"{candidate.source_id}_{candidate.source_place_id}"
        detail_cache_path = RAW_DIR / f"{detail_source_id}.html"
        was_cached = detail_cache_path.exists() and not refresh

        try:
            detail_text = cached_fetch(detail_source_id, candidate.detail_url, refresh)
        except Exception as error:
            enriched.append(
                Candidate(
                    **{
                        **asdict(candidate),
                        "raw_properties": {**candidate.raw_properties, "detail_error": str(error)},
                    }
                )
            )
            continue

        detail_count += 1
        json_ld = extract_json_ld(detail_text)
        detail_candidate = candidate_from_json_ld(
            candidate.source_id,
            candidate.source_url,
            candidate.detail_url,
            json_ld,
            candidate.name,
        )

        if detail_candidate:
            merged_raw = {**candidate.raw_properties, **detail_candidate.raw_properties}
            enriched.append(Candidate(**{**asdict(detail_candidate), "raw_properties": merged_raw}))
        else:
            enriched.append(candidate)

        if not was_cached:
            time.sleep(0.35)

    return enriched


def dedupe_candidates(candidates: list[Candidate]) -> list[Candidate]:
    best_by_key: dict[str, Candidate] = {}

    for candidate in candidates:
        key = dedupe_key(candidate)
        current = best_by_key.get(key)

        if not current or candidate_score(candidate) > candidate_score(current):
            best_by_key[key] = candidate

    return sorted(best_by_key.values(), key=lambda item: (item.state_code or "", item.name, item.source_id))


def dedupe_key(candidate: Candidate) -> str:
    address = normalize_key(candidate.address or "")

    if address:
        return f"address:{normalize_key(candidate.name)}:{address}"

    if candidate.lat is not None and candidate.lon is not None:
        return f"geo:{round(candidate.lat, 4)}:{round(candidate.lon, 4)}:{normalize_key(candidate.name)}"

    return f"name:{candidate.state_code or ''}:{normalize_key(candidate.name)}"


def candidate_score(candidate: Candidate) -> int:
    score = 0

    if candidate.lat is not None and candidate.lon is not None:
        score += 100
    if candidate.address:
        score += 20
    if candidate.website:
        score += 10
    if candidate.confidence == "structured_detail":
        score += 10

    return score


def write_candidates(candidates: list[Candidate], path: Path = OUTPUT_CSV) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "source_place_id",
                "name",
                "category",
                "state_code",
                "address",
                "website",
                "lat",
                "lon",
                "source_id",
                "confidence",
                "source_url",
                "detail_url",
                "evidence",
            ],
        )
        writer.writeheader()

        for candidate in candidates:
            if (
                candidate.state_code not in SUPPORTED_STATES
                or candidate.lat is None
                or candidate.lon is None
                or not is_relevant_ferienhof(candidate)
            ):
                continue

            writer.writerow(
                {
                    "source_place_id": candidate.source_place_id,
                    "name": candidate.name,
                    "category": "ferienhof",
                    "state_code": candidate.state_code,
                    "address": candidate.address or "",
                    "website": candidate.website or "",
                    "lat": candidate.lat,
                    "lon": candidate.lon,
                    "source_id": "ferienhoefe_web_research",
                    "confidence": candidate.confidence,
                    "source_url": candidate.source_url,
                    "detail_url": candidate.detail_url or "",
                    "evidence": candidate.evidence,
                }
            )


def write_report(candidates: list[Candidate], deduped: list[Candidate], path: Path = REPORT_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with_coords = [candidate for candidate in deduped if candidate.lat is not None and candidate.lon is not None]
    importable = [
        candidate
        for candidate in with_coords
        if candidate.state_code in SUPPORTED_STATES and is_relevant_ferienhof(candidate)
    ]

    report = {
        "raw_candidate_count": len(candidates),
        "deduped_candidate_count": len(deduped),
        "with_coordinates_count": len(with_coords),
        "importable_count": len(importable),
        "relevance_filter": {
            "include_keywords": sorted(FERIENHOF_INCLUDE_KEYWORDS),
            "always_include_source_prefixes": sorted(FERIENHOF_TRUSTED_SOURCE_PREFIXES),
        },
        "by_source": {},
        "by_state": {},
        "sources": SOURCE_URLS,
        "candidates": [asdict(candidate) for candidate in deduped],
        "output_csv": str(OUTPUT_CSV),
    }

    for candidate in candidates:
        report["by_source"][candidate.source_id] = report["by_source"].get(candidate.source_id, 0) + 1

    for candidate in deduped:
        state = candidate.state_code or "unknown"
        report["by_state"][state] = report["by_state"].get(state, 0) + 1

    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


FERIENHOF_TRUSTED_SOURCE_PREFIXES = (
    "landsichten_sh_kinderhof",
    "landsichten_sh_bauernhof",
    "landsichten_mv_kinderhof",
    "landsichten_mv_bauernhof",
    "landsichten_ni_kinderhof",
    "landsichten_ni_bauernhof",
    "bauernhofurlaub_",
)

FERIENHOF_INCLUDE_KEYWORDS = {
    "bauernhof",
    "bauernhofurlaub",
    "ferienbauernhof",
    "ferienhof",
    "gutshof",
    "landgut",
    "landhof",
    "reiterhof",
    "urlaub auf dem bauernhof",
}


def is_relevant_ferienhof(candidate: Candidate) -> bool:
    if candidate.source_id == "osm_ferienhoefe":
        return bool(OSM_NAME_RE.search(candidate.name)) and not bool(OSM_EXCLUDE_RE.search(candidate.name))

    if candidate.source_id.startswith(FERIENHOF_TRUSTED_SOURCE_PREFIXES):
        return True

    text = normalize_key(
        " ".join(
            [
                candidate.name,
                candidate.address or "",
                searchable_raw_text(candidate.raw_properties),
            ]
        )
    )

    return any(keyword in text for keyword in FERIENHOF_INCLUDE_KEYWORDS)


def searchable_raw_text(value: Any) -> str:
    parts: list[str] = []

    def visit(entry: Any, key: str | None = None) -> None:
        if isinstance(entry, dict):
            for child_key, child_value in entry.items():
                normalized_key = normalize_key(str(child_key))

                if normalized_key in {"url", "href", "detailurl", "sourceurl", "image", "logo", "context"}:
                    continue

                visit(child_value, normalized_key)
        elif isinstance(entry, list):
            for child in entry:
                visit(child, key)
        elif isinstance(entry, (str, int, float)) and key in {
            "name",
            "description",
            "address",
            "streetaddress",
            "addresslocality",
            "addressregion",
            "reviewbody",
            "text",
        }:
            parts.append(str(entry))

    visit(value)

    return " ".join(parts)


def collect(refresh: bool, max_details: int | None = None) -> tuple[list[Candidate], list[Candidate]]:
    candidates: list[Candidate] = []

    for source_id, source_url in SOURCE_URLS.items():
        try:
            text = cached_fetch(source_id, source_url, refresh)
        except Exception as error:
            candidates.append(
                Candidate(
                    source_id=source_id,
                    source_place_id=source_place_id(source_id, "fetch-error"),
                    name=f"FETCH ERROR {source_id}",
                    state_code=state_from_source(source_id, source_url),
                    address=None,
                    website=source_url,
                    lon=None,
                    lat=None,
                    confidence="fetch_error",
                    source_url=source_url,
                    detail_url=None,
                    evidence=str(error),
                    raw_properties={"error": str(error)},
                )
            )
            continue

        if source_id.startswith("landsichten"):
            candidates.extend(extract_landsichten_links(source_id, source_url, text))
        elif source_id.startswith("bauernhofurlaub"):
            candidates.extend(extract_bauernhofurlaub_links(source_id, source_url, text))
        elif source_id.startswith("landreise"):
            candidates.extend(extract_landreise_listing(source_id, source_url, text))

    candidates.extend(candidates_from_landreise_browser_links())
    candidates.extend(candidates_from_osm_cache())

    enriched = enrich_detail_candidates(candidates, refresh, max_details)
    deduped = dedupe_candidates(enriched)

    write_candidates(deduped)
    write_report(enriched, deduped)

    return enriched, deduped


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect Ferienhof candidates from public web sources.")
    parser.add_argument("--refresh", action="store_true", help="Refetch source and detail pages instead of using cached HTML")
    parser.add_argument("--max-details", type=int, help="Limit fetched detail pages for development runs")
    parser.add_argument("--scan-osm", action="store_true", help="Scan local OSM PBF and cache additional name/tag matches")
    parser.add_argument("--scan-osm-ways", action="store_true", help="Also inspect OSM ways; slower because node locations are needed")
    parser.add_argument("--osm-pbf", type=Path, default=OSM_PBF_PATH)
    args = parser.parse_args()

    if args.scan_osm:
        collect_osm_candidates(args.osm_pbf, include_ways=args.scan_osm_ways)

    candidates, deduped = collect(refresh=args.refresh, max_details=args.max_details)
    importable = [
        candidate
        for candidate in deduped
        if candidate.state_code in SUPPORTED_STATES
        and candidate.lat is not None
        and candidate.lon is not None
        and is_relevant_ferienhof(candidate)
    ]

    print(
        json.dumps(
            {
                "raw_candidate_count": len(candidates),
                "deduped_candidate_count": len(deduped),
                "importable_count": len(importable),
                "output_csv": str(OUTPUT_CSV),
                "report": str(REPORT_PATH),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
