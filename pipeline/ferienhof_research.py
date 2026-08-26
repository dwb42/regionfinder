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
import urllib.robotparser
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import deque
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
REQUEST_TIMEOUT_SECONDS = 10.0
MAX_RESPONSE_BYTES = 2_000_000
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

LISTED_DOMAIN_URLS = (
    "https://www.bauernhofurlaub.de",
    "https://www.bauernhofferien.de",
    "https://www.bauernhofurlaub.info",
    "https://www.landsichten.de",
    "https://www.landreise.de",
    "https://www.landtourismus.de",
    "https://www.landurlaub-mv.de",
    "https://www.landurlaub.m-vp.de",
    "https://www.bauernhof-urlaube.de",
    "https://www.sh-tourismus.de",
    "https://www.ostsee-schleswig-holstein.de",
    "https://www.nordseetourismus.de",
    "https://www.holsteinischeschweiz.de",
    "https://www.herzogtum-lauenburg.de",
    "https://www.ostseefjordschlei.de",
    "https://www.naturpark-huettener-berge.de",
    "https://www.eiderstedt.de",
    "https://www.fehmarn.de",
    "https://www.sylt.de",
    "https://www.foehr.de",
    "https://www.amrum.de",
    "https://www.pellworm.de",
    "https://www.dithmarschen-tourismus.de",
    "https://www.reiseland-niedersachsen.de",
    "https://www.lueneburger-heide.de",
    "https://www.cuxland.de",
    "https://www.emsland.com",
    "https://www.grafschaft-bentheim-tourismus.de",
    "https://www.oldenburger-muensterland.de",
    "https://www.weserbergland-tourismus.de",
    "https://www.harzinfo.de",
    "https://www.ostfriesland.travel",
    "https://www.nordseeheilbad-cuxhaven.de",
    "https://www.wangerland.de",
    "https://www.ammerland-touristik.de",
    "https://www.heideregion-uelzen.de",
    "https://www.elbtalaue.de",
    "https://www.auf-nach-mv.de",
    "https://www.vorpommern.de",
    "https://www.mecklenburgische-seenplatte.de",
    "https://www.1000seen.de",
    "https://www.mecklenburg-schwerin.de",
    "https://www.ostseeferien.de",
    "https://www.fischland-darss-zingst.de",
    "https://www.ruegen.de",
    "https://www.usedom.de",
    "https://www.ostsee-zingst.de",
    "https://www.ostseebad-dierhagen.de",
    "https://www.ostseebad-prerow.de",
    "https://www.ostseebad-wustrow.de",
    "https://www.ostseebad-ahrenshoop.de",
    "https://www.rostock.de",
    "https://www.warnemuende.de",
    "https://www.schwerin.de",
    "https://www.mueritz.de",
    "https://www.plau-am-see.de",
    "https://www.fleesensee.de",
    "https://www.malchow-tourismus.de",
    "https://www.neubrandenburg-touristinfo.de",
    "https://www.greifswald.info",
    "https://www.stralsundtourismus.de",
    "https://www.ostseebad-kuehlungsborn.de",
    "https://www.bad-doberan-heiligendamm.de",
    "https://www.ostseebad-boltenhagen.de",
)

LISTED_DOMAIN_HOSTS = {urllib.parse.urlparse(url).netloc for url in LISTED_DOMAIN_URLS}

REGION_KEYWORDS = {
    "hamburg",
    "niedersachsen",
    "schleswig",
    "holstein",
    "mecklenburg",
    "vorpommern",
    "ostsee",
    "nordsee",
    "lueneburg",
    "lüneburg",
    "heide",
    "cuxland",
    "emsland",
    "bentheim",
    "oldenburger",
    "muensterland",
    "münsterland",
    "weserbergland",
    "harz",
    "ostfriesland",
    "ammerland",
    "uelzen",
    "elbtalaue",
    "ruegen",
    "rügen",
    "usedom",
    "mueritz",
    "müritz",
    "schwerin",
    "rostock",
    "warnemuende",
    "warnemünde",
    "greifswald",
    "stralsund",
}

CRAWL_RELEVANCE_KEYWORDS = {
    "bauernhof",
    "bauernhofurlaub",
    "bauernhofferien",
    "ferienbauernhof",
    "ferienhof",
    "ferienhofe",
    "ferienhöfe",
    "hofurlaub",
    "landurlaub",
    "urlaub auf dem land",
    "urlaub auf dem bauernhof",
    "kinderbauernhof",
    "reiterhof",
    "erlebnisbauernhof",
    "biohof",
    "gutshof",
    "landhof",
    "heuhotel",
    "heuherberge",
    "bauernhofcamping",
    "hofpension",
    "ferienwohnung",
    "ferienwohnungen",
    "ferienhaus",
    "ferienhäuser",
    "gaestezimmer",
    "gästezimmer",
}

CRAWL_ENTRYPOINT_KEYWORDS = CRAWL_RELEVANCE_KEYWORDS | REGION_KEYWORDS | {
    "unterkunft",
    "unterkuenfte",
    "unterkünfte",
    "gastgeber",
    "gastgeberverzeichnis",
    "uebernachten",
    "übernachten",
    "accommodation",
    "booking",
    "search",
    "suche",
    "karte",
    "map",
}

PAGINATION_KEYWORDS = {"weiter", "mehr", "next", "seite", "page", "load", "laden"}

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


@dataclass
class DomainCrawlStats:
    domain: str
    pages_fetched: int = 0
    pages_blocked_by_robots: int = 0
    pages_failed: int = 0
    sitemap_urls_seen: int = 0
    sitemap_urls_relevant: int = 0
    internal_links_seen: int = 0
    internal_links_relevant: int = 0
    candidates_found: int = 0
    fetch_errors: list[dict[str, str]] = field(default_factory=list)
    robots_sitemaps: list[str] = field(default_factory=list)
    entrypoints: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class FrontierUrl:
    url: str
    depth: int
    reason: str


def fetch_url(url: str, retries: int = 2, delay_seconds: float = 0.7) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return response.read(MAX_RESPONSE_BYTES).decode("utf-8", "ignore")
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


def crawl_cache_id(domain_source_id: str, url: str) -> str:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]

    return f"{domain_source_id}_{digest}"


def domain_source_id(domain_url: str) -> str:
    hostname = urllib.parse.urlparse(domain_url).netloc
    ascii_value = unicodedata.normalize("NFKD", hostname).encode("ascii", "ignore").decode("ascii")
    source = re.sub(r"[^a-z0-9]+", "_", ascii_value.casefold()).strip("_")

    return f"domain_{source}"


def canonical_url(base_url: str, href: str | None) -> str | None:
    if not href:
        return None

    url = urllib.parse.urljoin(base_url, html.unescape(href.strip()))
    parsed = urllib.parse.urlparse(url)

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None

    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path or "/", "", parsed.query, ""))


def same_listed_host(url: str, expected_host: str) -> bool:
    parsed = urllib.parse.urlparse(url)

    return parsed.netloc == expected_host and parsed.netloc in LISTED_DOMAIN_HOSTS


def normalized_url_text(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    text = urllib.parse.unquote(f"{parsed.path} {parsed.query}")

    return normalize_key(text)


def has_any_keyword(text: str, keywords: Iterable[str]) -> bool:
    normalized = normalize_key(text)

    return any(normalize_key(keyword) in normalized for keyword in keywords)


def is_relevant_entrypoint(url: str, label: str = "") -> bool:
    haystack = f"{normalized_url_text(url)} {label}"

    return has_any_keyword(haystack, CRAWL_ENTRYPOINT_KEYWORDS)


def is_relevant_detail_url(url: str, label: str = "") -> bool:
    haystack = f"{normalized_url_text(url)} {label}"

    return has_any_keyword(haystack, CRAWL_RELEVANCE_KEYWORDS)


def is_pagination_link(url: str, label: str = "") -> bool:
    haystack = f"{normalized_url_text(url)} {label}"

    return has_any_keyword(haystack, PAGINATION_KEYWORDS) or bool(re.search(r"([?&](page|p|seite)=\d+|/page/\d+)", url, re.I))


def load_robot_parser(domain_url: str, refresh: bool) -> urllib.robotparser.RobotFileParser:
    parsed = urllib.parse.urlparse(domain_url)
    robots_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, "/robots.txt", "", "", ""))
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(robots_url)

    try:
        text = cached_fetch(f"{domain_source_id(domain_url)}_robots", robots_url, refresh)
    except Exception:
        parser.parse([])
        return parser

    parser.parse(text.splitlines())

    return parser


def robot_sitemaps(parser: urllib.robotparser.RobotFileParser) -> list[str]:
    try:
        sitemaps = parser.site_maps() or []
    except Exception:
        return []

    return [url for url in sitemaps if isinstance(url, str)]


def sitemap_candidates(domain_url: str, parser: urllib.robotparser.RobotFileParser, refresh: bool, max_sitemap_urls: int) -> tuple[list[str], list[str]]:
    parsed = urllib.parse.urlparse(domain_url)
    host = parsed.netloc
    default_sitemap = urllib.parse.urlunparse((parsed.scheme, host, "/sitemap.xml", "", "", ""))
    sitemap_queue = deque(dict.fromkeys([*robot_sitemaps(parser), default_sitemap]))
    seen_sitemaps: set[str] = set()
    urls: list[str] = []
    used_sitemaps: list[str] = []

    while sitemap_queue and len(urls) < max_sitemap_urls:
        sitemap_url = sitemap_queue.popleft()

        if sitemap_url in seen_sitemaps or not same_listed_host(sitemap_url, host):
            continue

        seen_sitemaps.add(sitemap_url)
        try:
            text = cached_fetch(f"{domain_source_id(domain_url)}_sitemap_{len(seen_sitemaps)}", sitemap_url, refresh)
        except Exception:
            continue

        used_sitemaps.append(sitemap_url)

        try:
            root = ET.fromstring(text.encode("utf-8"))
        except ET.ParseError:
            continue

        for loc in root.findall(".//{*}loc"):
            if not loc.text:
                continue

            loc_url = canonical_url(sitemap_url, loc.text)
            if not loc_url or not same_listed_host(loc_url, host):
                continue

            if loc_url.endswith(".xml") and "sitemap" in loc_url and loc_url not in seen_sitemaps:
                sitemap_queue.append(loc_url)
                continue

            urls.append(loc_url)

            if len(urls) >= max_sitemap_urls:
                break

    return urls, used_sitemaps


def extract_links(text: str, base_url: str, host: str) -> list[tuple[str, str]]:
    links: list[tuple[str, str]] = []

    for match in re.finditer(r"<a\b([^>]*)>(.*?)</a>", text, re.S | re.I):
        attrs, anchor_html = match.groups()
        href_match = re.search(r"\bhref\s*=\s*['\"]([^'\"]+)['\"]", attrs, re.I)
        if not href_match:
            continue

        url = canonical_url(base_url, href_match.group(1))
        if not url or not same_listed_host(url, host):
            continue

        label = normalize_text(anchor_html)
        links.append((url, label))

    return links


def html_title(text: str) -> str | None:
    for pattern in (
        r"<h1[^>]*>(.*?)</h1>",
        r"<meta[^>]+property=['\"]og:title['\"][^>]+content=['\"]([^'\"]+)['\"]",
        r"<title[^>]*>(.*?)</title>",
    ):
        match = re.search(pattern, text, re.S | re.I)
        if match:
            title = normalize_text(match.group(1))
            if title:
                return title

    return None


def html_meta_description(text: str) -> str | None:
    match = re.search(r"<meta[^>]+name=['\"]description['\"][^>]+content=['\"]([^'\"]+)['\"]", text, re.S | re.I)

    return normalize_text(match.group(1)) if match else None


def clean_detail_title(title: str | None) -> str | None:
    if not title:
        return None

    parts = [part.strip() for part in re.split(r"\s+[|–-]\s+", title) if part.strip()]
    for part in parts:
        normalized = normalize_key(part)
        if normalized and normalized not in {"landreise", "landsichten", "bauernhofurlaub"}:
            return part

    return title


def is_low_quality_candidate_name(name: str) -> bool:
    normalized = normalize_key(name)

    return (
        normalized in {"details", "detail"}
        or normalized.startswith("welche ")
        or normalized.startswith("gibt es ")
        or normalized.startswith("sind ")
        or "©" in name
    )


def coords_from_html(text: str) -> tuple[float | None, float | None]:
    patterns = [
        r'"latitude"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?\s*,\s*"longitude"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?',
        r'"lat"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?\s*,\s*"lng"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?',
        r"data-lat(?:itude)?=['\"]([0-9]+(?:\.[0-9]+)?)['\"][^>]+data-l(?:on|ng|ongitude)=['\"]([0-9]+(?:\.[0-9]+)?)['\"]",
        r"data-l(?:on|ng|ongitude)=['\"]([0-9]+(?:\.[0-9]+)?)['\"][^>]+data-lat(?:itude)?=['\"]([0-9]+(?:\.[0-9]+)?)['\"]",
    ]

    for index, pattern in enumerate(patterns):
        match = re.search(pattern, text, re.S | re.I)
        if not match:
            continue

        first = parse_float(match.group(1))
        second = parse_float(match.group(2))

        if first is None or second is None:
            continue

        if index == 3:
            lon, lat = first, second
        elif first > 50 and second < 20:
            lat, lon = first, second
        else:
            lat, lon = first, second

        if 50 <= lat <= 56 and 6 <= lon <= 15:
            return lon, lat

    return None, None


def external_website_from_json_ld(items: list[Any], detail_url: str) -> str | None:
    detail_host = urllib.parse.urlparse(detail_url).netloc

    for item in iter_json_items(items):
        url = item.get("url")

        if not isinstance(url, str):
            continue

        absolute = absolute_url(detail_url, url)

        if absolute and urllib.parse.urlparse(absolute).netloc != detail_host:
            return absolute

    return None


def candidate_from_generic_page(source_id: str, source_url: str, text: str) -> Candidate | None:
    title = html_title(text)
    description = html_meta_description(text)
    page_text = normalize_text(re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.S | re.I))
    relevance_text = " ".join(part for part in [title or "", description or "", page_text[:4000]] if part)

    if not has_any_keyword(relevance_text, CRAWL_RELEVANCE_KEYWORDS):
        return None

    json_ld = extract_json_ld(text)
    detail_candidate = candidate_from_json_ld(source_id, source_url, source_url, json_ld, title)

    if detail_candidate and detail_candidate.lon is not None and detail_candidate.lat is not None:
        website = external_website_from_json_ld(json_ld, source_url) or detail_candidate.website
        state_code = detail_candidate.state_code or state_for_coordinate(detail_candidate.lon, detail_candidate.lat)

        return Candidate(
            **{
                **asdict(detail_candidate),
                "state_code": state_code,
                "website": website,
                "confidence": "listed_domain_structured_detail",
                "raw_properties": {
                    **detail_candidate.raw_properties,
                    "title": title,
                    "description": description,
                    "crawl_url": source_url,
                },
            }
        )

    lon, lat = coords_from_html(text)
    if lon is None or lat is None:
        return None

    name = title or urllib.parse.urlparse(source_url).path.strip("/").split("/")[-1].replace("-", " ")
    state_code = state_for_coordinate(lon, lat) or state_from_source(source_id, source_url)

    return Candidate(
        source_id=source_id,
        source_place_id=source_place_id(source_id, source_url),
        name=normalize_text(name),
        state_code=state_code,
        address=None,
        website=source_url,
        lon=lon,
        lat=lat,
        confidence="listed_domain_html_detail",
        source_url=source_url,
        detail_url=source_url,
        evidence="listed-domain HTML/structured content",
        raw_properties={
            "title": title,
            "description": description,
            "crawl_url": source_url,
        },
    )


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
        item_types = item_type if isinstance(item_type, list) else [item_type]
        is_preferred_item = any(entry in preferred_types for entry in item_types if isinstance(entry, str))
        item_name = item.get("name")
        if isinstance(item_name, str) and (is_preferred_item or not name or name.startswith("Landreise Unterkunft") or "©" in name):
            name = normalize_text(item_name)

        item_url = item.get("url")
        if (
            isinstance(item_url, str)
            and not any(entry in {"ImageObject", "Organization"} for entry in item_types if isinstance(entry, str))
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

    source_state_code = state_from_source(source_id, source_url)
    coordinate_state_code = state_for_coordinate(lon, lat) if lon is not None and lat is not None else None
    state_code = source_state_code or coordinate_state_code

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
        if (
            candidate.source_id == "osm_ferienhoefe"
            or candidate.confidence.startswith("listed_domain_")
            or not candidate.detail_url
            or (max_details is not None and detail_count >= max_details)
        ):
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
            detail_values = asdict(detail_candidate)
            fallback_lon, fallback_lat = coords_from_html(detail_text)

            if detail_candidate.lon is None and detail_candidate.lat is None and fallback_lon is not None and fallback_lat is not None:
                detail_values["lon"] = fallback_lon
                detail_values["lat"] = fallback_lat
                detail_values["state_code"] = detail_candidate.state_code or candidate.state_code or state_for_coordinate(fallback_lon, fallback_lat)
                detail_values["confidence"] = "structured_detail"
                merged_raw["coordinate_source"] = "detail_html_fallback"

            title_name = clean_detail_title(html_title(detail_text))
            if title_name and is_low_quality_candidate_name(str(detail_values["name"])):
                detail_values["name"] = title_name

            enriched.append(Candidate(**{**detail_values, "raw_properties": merged_raw}))
        else:
            fallback_lon, fallback_lat = coords_from_html(detail_text)

            if fallback_lon is not None and fallback_lat is not None:
                title_name = clean_detail_title(html_title(detail_text))
                enriched.append(
                    Candidate(
                        **{
                            **asdict(candidate),
                            "name": title_name if title_name and is_low_quality_candidate_name(candidate.name) else candidate.name,
                            "lon": fallback_lon,
                            "lat": fallback_lat,
                            "state_code": candidate.state_code or state_for_coordinate(fallback_lon, fallback_lat),
                            "confidence": "structured_detail",
                            "raw_properties": {
                                **candidate.raw_properties,
                                "coordinate_source": "detail_html_fallback",
                            },
                        }
                    )
                )
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


def write_candidates(candidates: list[Candidate], path: Path | None = None) -> None:
    path = path or OUTPUT_CSV
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


def write_report(candidates: list[Candidate], deduped: list[Candidate], path: Path | None = None) -> None:
    path = path or REPORT_PATH
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

FERIENHOF_OVERNIGHT_KEYWORDS = {
    "appartement",
    "apartment",
    "bauernhofurlaub",
    "camping",
    "ferienbauernhof",
    "ferienhaus",
    "ferienhof",
    "ferienwohnung",
    "ferienzimmer",
    "gaestezimmer",
    "gästezimmer",
    "heuhotel",
    "hofpension",
    "hotel",
    "landurlaub",
    "pension",
    "uebernacht",
    "übernacht",
    "unterkunft",
    "urlaub",
    "zimmer",
}

FERIENHOF_SERVICE_ONLY_KEYWORDS = {
    "bootsverleih",
    "bushaltestelle",
    "cafe",
    "café",
    "erlebnispfad",
    "hofcafe",
    "hofcafé",
    "hofladen",
    "haltestelle",
    "museum",
    "museumsbauernhof",
    "restaurant",
    "rundbus",
    "verleih",
}


def is_relevant_ferienhof(candidate: Candidate) -> bool:
    if candidate.confidence == "fetch_error":
        return False

    if candidate.source_id == "osm_ferienhoefe":
        return bool(OSM_NAME_RE.search(candidate.name)) and not bool(OSM_EXCLUDE_RE.search(candidate.name))

    if candidate.source_id.startswith(FERIENHOF_TRUSTED_SOURCE_PREFIXES):
        return True

    if candidate.confidence.startswith("listed_domain_") and is_broad_listing_candidate_url(candidate.source_url):
        return False

    text = normalize_key(
        " ".join(
            [
                candidate.name,
                candidate.address or "",
                searchable_raw_text(candidate.raw_properties),
            ]
        )
    )

    has_include = any(keyword in text for keyword in FERIENHOF_INCLUDE_KEYWORDS)
    has_overnight = any(keyword in text for keyword in FERIENHOF_OVERNIGHT_KEYWORDS)
    has_strong_overnight = any(
        keyword in text
        for keyword in FERIENHOF_OVERNIGHT_KEYWORDS
        if keyword not in {"ferienhof", "reiterhof"}
    )
    has_service_only_signal = any(keyword in text for keyword in FERIENHOF_SERVICE_ONLY_KEYWORDS)

    if has_service_only_signal and not has_strong_overnight:
        return False

    if candidate.confidence.startswith("listed_domain_") and not has_overnight:
        return False

    return has_include


def is_broad_listing_candidate_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.strip("/").casefold()

    return bool(
        re.fullmatch(
            r"urlaub-auf-dem-bauernhof/(deutschland|hamburg|mecklenburg-vorpommern|niedersachsen|niederlande|schleswig-holstein)",
            path,
        )
    )


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


def collect_listed_domain_candidates(
    refresh: bool,
    max_pages_per_domain: int,
    max_sitemap_urls_per_domain: int,
    max_depth: int,
    delay_seconds: float,
    domain_limit: int | None = None,
    workers: int = 1,
    skipped_domains: set[str] | None = None,
) -> tuple[list[Candidate], list[dict[str, Any]]]:
    all_candidates: list[Candidate] = []
    stats_records: list[dict[str, Any]] = []

    domain_urls = LISTED_DOMAIN_URLS[:domain_limit] if domain_limit is not None else LISTED_DOMAIN_URLS
    skipped_domains = skipped_domains or set()

    for domain_url in domain_urls:
        if domain_url in skipped_domains:
            stats_records.append(
                asdict(
                    DomainCrawlStats(
                        domain=domain_url,
                        pages_failed=1,
                        fetch_errors=[{"url": domain_url, "error": "Skipped after repeated long-running crawl attempts"}],
                    )
                )
            )

    domain_urls = tuple(domain_url for domain_url in domain_urls if domain_url not in skipped_domains)

    def collect_domain(domain_url: str) -> tuple[list[Candidate], dict[str, Any]]:
        stats = DomainCrawlStats(domain=domain_url)
        candidates = collect_single_domain_candidates(
            domain_url=domain_url,
            refresh=refresh,
            max_pages=max_pages_per_domain,
            max_sitemap_urls=max_sitemap_urls_per_domain,
            max_depth=max_depth,
            delay_seconds=delay_seconds,
            stats=stats,
        )
        stats.candidates_found = len(candidates)
        return candidates, asdict(stats)

    if workers <= 1:
        for domain_url in domain_urls:
            candidates, stats = collect_domain(domain_url)
            print(
                json.dumps(
                    {
                        "domain": domain_url,
                        "pages_fetched": stats["pages_fetched"],
                        "candidates_found": stats["candidates_found"],
                        "pages_failed": stats["pages_failed"],
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            all_candidates.extend(candidates)
            stats_records.append(stats)

        return all_candidates, stats_records

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(collect_domain, domain_url): domain_url for domain_url in domain_urls}

        for future in as_completed(futures):
            domain_url = futures[future]
            try:
                candidates, stats = future.result()
            except Exception as error:
                stats = asdict(DomainCrawlStats(domain=domain_url, pages_failed=1, fetch_errors=[{"url": domain_url, "error": str(error)}]))
                candidates = []

            print(
                json.dumps(
                    {
                        "domain": domain_url,
                        "pages_fetched": stats["pages_fetched"],
                        "candidates_found": stats["candidates_found"],
                        "pages_failed": stats["pages_failed"],
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            all_candidates.extend(candidates)
            stats_records.append(stats)

    return all_candidates, stats_records


def collect_single_domain_candidates(
    domain_url: str,
    refresh: bool,
    max_pages: int,
    max_sitemap_urls: int,
    max_depth: int,
    delay_seconds: float,
    stats: DomainCrawlStats,
) -> list[Candidate]:
    parsed = urllib.parse.urlparse(domain_url)
    host = parsed.netloc
    source_id = domain_source_id(domain_url)
    parser = load_robot_parser(domain_url, refresh)
    sitemap_urls, used_sitemaps = sitemap_candidates(domain_url, parser, refresh, max_sitemap_urls)
    stats.robots_sitemaps = used_sitemaps
    stats.sitemap_urls_seen = len(sitemap_urls)

    frontier: deque[FrontierUrl] = deque()
    queued: set[str] = set()

    def enqueue(url: str, depth: int, reason: str) -> None:
        if url in queued or not same_listed_host(url, host):
            return

        queued.add(url)
        frontier.append(FrontierUrl(url=url, depth=depth, reason=reason))

    root_url = canonical_url(domain_url, "/")
    if root_url:
        enqueue(root_url, 0, "domain-root")

    for source_url in SOURCE_URLS.values():
        if urllib.parse.urlparse(source_url).netloc == host:
            enqueue(source_url, 0, "existing-source-url")

    for sitemap_url in sitemap_urls:
        if is_relevant_entrypoint(sitemap_url):
            stats.sitemap_urls_relevant += 1
            enqueue(sitemap_url, 0, "relevant-sitemap-url")

    stats.entrypoints = [item.url for item in list(frontier)[:200]]

    candidates: list[Candidate] = []
    fetched: set[str] = set()

    while frontier and stats.pages_fetched < max_pages:
        item = frontier.popleft()

        if item.url in fetched:
            continue

        fetched.add(item.url)

        if not parser.can_fetch(USER_AGENT, item.url):
            stats.pages_blocked_by_robots += 1
            continue

        try:
            text = cached_fetch(crawl_cache_id(source_id, item.url), item.url, refresh)
        except Exception as error:
            stats.pages_failed += 1
            if len(stats.fetch_errors) < 25:
                stats.fetch_errors.append({"url": item.url, "error": str(error)})
            continue

        stats.pages_fetched += 1
        candidate = candidate_from_generic_page(source_id, item.url, text)

        if candidate:
            candidates.append(candidate)

        if item.depth >= max_depth:
            if delay_seconds:
                time.sleep(delay_seconds)
            continue

        page_relevant = candidate is not None or is_relevant_entrypoint(item.url) or has_any_keyword(text[:8000], CRAWL_ENTRYPOINT_KEYWORDS)

        for link_url, label in extract_links(text, item.url, host):
            stats.internal_links_seen += 1
            should_follow = is_relevant_entrypoint(link_url, label) or (
                page_relevant and (is_pagination_link(link_url, label) or is_relevant_detail_url(link_url, label))
            )

            if should_follow:
                stats.internal_links_relevant += 1
                enqueue(link_url, item.depth + 1, "internal-relevant-link")

        if delay_seconds:
            time.sleep(delay_seconds)

    return candidates


def collect(
    refresh: bool,
    max_details: int | None = None,
    include_osm_cache: bool = True,
    include_listed_domains: bool = False,
    domain_max_pages: int = 250,
    domain_max_sitemap_urls: int = 5000,
    domain_max_depth: int = 3,
    domain_delay_seconds: float = 0.25,
    domain_limit: int | None = None,
    domain_workers: int = 1,
    skipped_domains: set[str] | None = None,
) -> tuple[list[Candidate], list[Candidate]]:
    candidates: list[Candidate] = []
    domain_stats: list[dict[str, Any]] = []

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

    if include_listed_domains:
        domain_candidates, domain_stats = collect_listed_domain_candidates(
            refresh=refresh,
            max_pages_per_domain=domain_max_pages,
            max_sitemap_urls_per_domain=domain_max_sitemap_urls,
            max_depth=domain_max_depth,
            delay_seconds=domain_delay_seconds,
            domain_limit=domain_limit,
            workers=domain_workers,
            skipped_domains=skipped_domains,
        )
        candidates.extend(domain_candidates)

    if include_osm_cache:
        candidates.extend(candidates_from_osm_cache())

    enriched = enrich_detail_candidates(candidates, refresh, max_details)
    deduped = dedupe_candidates(enriched)

    write_candidates(deduped)
    write_report(enriched, deduped)

    if domain_stats:
        augment_report_with_domain_stats(domain_stats)

    return enriched, deduped


def augment_report_with_domain_stats(domain_stats: list[dict[str, Any]], path: Path | None = None) -> None:
    path = path or REPORT_PATH
    if not path.exists():
        return

    report = json.loads(path.read_text(encoding="utf-8"))
    report["listed_domain_crawl"] = {
        "domains": list(LISTED_DOMAIN_URLS),
        "domain_count": len(LISTED_DOMAIN_URLS),
        "stats": domain_stats,
        "source_restriction": "Only listed domains were crawled by the generic domain crawler.",
    }
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    global REQUEST_TIMEOUT_SECONDS

    parser = argparse.ArgumentParser(description="Collect Ferienhof candidates from public web sources.")
    parser.add_argument("--refresh", action="store_true", help="Refetch source and detail pages instead of using cached HTML")
    parser.add_argument("--max-details", type=int, help="Limit fetched detail pages for development runs")
    parser.add_argument(
        "--listed-domains",
        action="store_true",
        help="Also crawl all explicitly listed Ferienhof/domain sources with sitemap and internal-link discovery",
    )
    parser.add_argument(
        "--listed-domains-only",
        action="store_true",
        help="Use only the explicitly listed web domains and skip cached OSM candidates",
    )
    parser.add_argument("--domain-max-pages", type=int, default=250, help="Maximum HTML pages to fetch per listed domain")
    parser.add_argument("--domain-max-sitemap-urls", type=int, default=5000, help="Maximum sitemap URLs to inspect per listed domain")
    parser.add_argument("--domain-max-depth", type=int, default=3, help="Maximum internal-link depth for listed domain crawling")
    parser.add_argument("--domain-delay-seconds", type=float, default=0.25, help="Delay between listed-domain page requests")
    parser.add_argument("--domain-limit", type=int, help="Limit listed-domain crawling to the first N domains for development checks")
    parser.add_argument("--domain-workers", type=int, default=1, help="Number of listed domains to crawl in parallel")
    parser.add_argument("--skip-domain", action="append", default=[], help="Listed domain URL to mark as technically skipped for this run")
    parser.add_argument("--request-timeout-seconds", type=float, default=REQUEST_TIMEOUT_SECONDS, help="HTTP request timeout for web research")
    parser.add_argument("--scan-osm", action="store_true", help="Scan local OSM PBF and cache additional name/tag matches")
    parser.add_argument("--scan-osm-ways", action="store_true", help="Also inspect OSM ways; slower because node locations are needed")
    parser.add_argument("--osm-pbf", type=Path, default=OSM_PBF_PATH)
    args = parser.parse_args()
    REQUEST_TIMEOUT_SECONDS = args.request_timeout_seconds

    if args.scan_osm:
        collect_osm_candidates(args.osm_pbf, include_ways=args.scan_osm_ways)

    include_listed_domains = args.listed_domains or args.listed_domains_only
    candidates, deduped = collect(
        refresh=args.refresh,
        max_details=args.max_details,
        include_osm_cache=not args.listed_domains_only,
        include_listed_domains=include_listed_domains,
        domain_max_pages=args.domain_max_pages,
        domain_max_sitemap_urls=args.domain_max_sitemap_urls,
        domain_max_depth=args.domain_max_depth,
        domain_delay_seconds=args.domain_delay_seconds,
        domain_limit=args.domain_limit,
        domain_workers=args.domain_workers,
        skipped_domains=set(args.skip_domain),
    )
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
