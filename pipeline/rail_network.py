from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://regionfinder:regionfinder@localhost:55432/regionfinder")
OSM_PBF = Path(os.environ.get("OSM_PBF_PATH", "data/raw/osm/germany-latest.osm.pbf"))
OSM2PGSQL_IMAGE = os.environ.get("OSM2PGSQL_IMAGE", "iboates/osm2pgsql:latest")
OSMIUM_IMAGE = os.environ.get("OSMIUM_IMAGE", "iboates/osmium:latest")
RAIL_MODES = ("ICE", "IC", "EC", "RE", "RB", "RAIL", "S", "AKN", "U", "TRAM")
RAILWAY_TAG_FILTERS = ("w/railway=rail", "w/railway=light_rail", "w/railway=subway", "w/railway=tram")
CORRIDOR_BBOXES = {
    "hamburg-core": "9.55,53.35,10.35,53.85",
    "hamburg-altona-elmshorn": "9.55,53.45,10.10,53.85",
    "hamburg-luebeck": "9.85,53.45,10.95,54.05",
    "hamburg-lueneburg": "9.75,53.15,10.55,53.65",
    "hamburg-buchholz-bremen": "8.55,52.95,10.15,53.65",
    "hamburg-kiel": "9.55,53.50,10.45,54.45",
    "hamburg-buechen": "9.85,53.25,10.95,53.75",
}


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_text_array(values: tuple[str, ...]) -> str:
    return "ARRAY[" + ", ".join(sql_literal(value) for value in values) + "]::text[]"


def bbox_filter_clause(bbox: str | None, geometry_expression: str = "rp.geometry") -> str:
    if not bbox:
        return ""

    parts = [float(part.strip()) for part in bbox.split(",")]
    if len(parts) != 4:
        raise SystemExit("--bbox must be min_lon,min_lat,max_lon,max_lat")

    min_lon, min_lat, max_lon, max_lat = parts
    return (
        f"AND ST_Intersects({geometry_expression}, "
        f"ST_MakeEnvelope({min_lon}, {min_lat}, {max_lon}, {max_lat}, 4326))"
    )


def resolve_bbox(bbox: str | None, corridor: str | None) -> str | None:
    if bbox and corridor:
        raise SystemExit("Use either --bbox or --corridor, not both")

    if not corridor:
        return bbox

    try:
        return CORRIDOR_BBOXES[corridor]
    except KeyError:
        known = ", ".join(sorted(CORRIDOR_BBOXES))
        raise SystemExit(f"Unknown corridor {corridor!r}. Known corridors: {known}") from None


def route_label_filter_clause(routes: str | None) -> str:
    if not routes:
        return ""

    route_values = tuple(route.strip() for route in routes.split(",") if route.strip())
    if not route_values:
        return ""

    return (
        "AND COALESCE(NULLIF(r.short_name, ''), NULLIF(r.long_name, ''), r.source_route_id) "
        f"= ANY({sql_text_array(route_values)})"
    )


def run_psql(sql: str) -> None:
    subprocess.run(["psql", DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c", sql], check=True)


def docker_database_url() -> str:
    override = os.environ.get("OSM2PGSQL_DATABASE_URL")
    if override:
        return override

    parsed = urlparse(DATABASE_URL)
    if parsed.hostname not in {"127.0.0.1", "localhost"}:
        return DATABASE_URL

    netloc = parsed.netloc.replace(parsed.hostname, "host.docker.internal", 1)
    return urlunparse(parsed._replace(netloc=netloc))


def filtered_rail_pbf_path(pbf_path: Path) -> Path:
    override = os.environ.get("OSM_RAIL_PBF_PATH")
    if override:
        return Path(override)

    name = pbf_path.name
    if name.endswith(".osm.pbf"):
        name = f"{name[:-8]}-railways.osm.pbf"
    else:
        name = f"{pbf_path.stem}-railways.osm.pbf"

    return Path("data/processed/osm") / name


def filter_osm_railways(pbf_path: Path) -> Path:
    if not pbf_path.exists():
        raise SystemExit(f"OSM PBF missing: {pbf_path}")

    output_path = filtered_rail_pbf_path(pbf_path)
    if output_path.exists() and output_path.stat().st_mtime >= pbf_path.stat().st_mtime:
        return output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{pbf_path.resolve().parent}:/input:ro",
            "-v",
            f"{output_path.resolve().parent}:/output",
            OSMIUM_IMAGE,
            "tags-filter",
            f"/input/{pbf_path.name}",
            *RAILWAY_TAG_FILTERS,
            "-o",
            f"/output/{output_path.name}",
            "--overwrite",
        ],
        check=True,
    )
    return output_path


def drop_osm_staging_tables() -> None:
    run_psql(
        """
        DROP TABLE IF EXISTS
          staging_osm_rail_point,
          staging_osm_rail_line,
          staging_osm_rail_polygon,
          staging_osm_rail_roads
        CASCADE;
        """
    )


def import_osm_with_osm2pgsql(pbf_path: Path) -> None:
    if not pbf_path.exists():
        raise SystemExit(f"OSM PBF missing: {pbf_path}")

    drop_osm_staging_tables()
    mounted_dir = pbf_path.resolve().parent
    mounted_file = f"/data/{pbf_path.name}"
    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{mounted_dir}:/data:ro",
            OSM2PGSQL_IMAGE,
            "--create",
            "--slim",
            "--drop",
            "--latlong",
            "--hstore",
            "--prefix",
            "staging_osm_rail",
            "--database",
            docker_database_url(),
            mounted_file,
        ],
        check=True,
    )


def build_rail_edges() -> None:
    run_psql(
        """
        BEGIN;
        DELETE FROM route_pattern_rail_matches;
        DELETE FROM stop_rail_snaps;
        TRUNCATE rail_edges, rail_vertices RESTART IDENTITY CASCADE;

        CREATE TEMP TABLE raw_rail_edges AS
        SELECT osm_id,
               railway,
               NULLIF(service, '') AS service,
               NULLIF(tags->'usage', '') AS usage,
               NULLIF(name, '') AS name,
               (ST_Dump(ST_LineMerge(way))).geom::geometry(LineString, 4326) AS geom
        FROM staging_osm_rail_line
        WHERE railway IN ('rail', 'light_rail', 'subway', 'tram')
          AND COALESCE(tags->'abandoned', '') = ''
          AND COALESCE(tags->'construction', '') = ''
          AND COALESCE(tags->'disused', '') = ''
          AND COALESCE(tags->'razed', '') = ''
          AND GeometryType(way) IN ('LINESTRING', 'MULTILINESTRING');

        DELETE FROM raw_rail_edges
        WHERE ST_NPoints(geom) < 2 OR ST_Length(geom::geography) < 10;

        CREATE INDEX raw_rail_edges_geom_gix ON raw_rail_edges USING gist (geom);

        CREATE TEMP TABLE noded_rail_segments AS
        SELECT row_number() OVER () AS segment_id,
               osm_id,
               railway,
               service,
               usage,
               name,
               geom,
               ST_AsEWKB(ST_SnapToGrid(ST_StartPoint(geom), 0.0000001)) AS source_key,
               ST_AsEWKB(ST_SnapToGrid(ST_EndPoint(geom), 0.0000001)) AS target_key
        FROM raw_rail_edges
        WHERE ST_NPoints(geom) >= 2 AND ST_Length(geom::geography) >= 5;

        CREATE TEMP TABLE rail_vertex_candidates AS
        SELECT DISTINCT ON (node_key)
               node_key,
               ST_SnapToGrid(geom, 0.0000001)::geometry(Point, 4326) AS geom
        FROM (
          SELECT source_key AS node_key, ST_StartPoint(geom) AS geom FROM noded_rail_segments
          UNION ALL
          SELECT target_key AS node_key, ST_EndPoint(geom) AS geom FROM noded_rail_segments
        ) endpoints
        ORDER BY node_key;

        CREATE TEMP TABLE rail_vertex_lookup AS
        SELECT node_key,
               row_number() OVER (ORDER BY node_key)::bigint AS id,
               geom
        FROM rail_vertex_candidates;

        ALTER TABLE rail_vertex_lookup ADD PRIMARY KEY (node_key);

        INSERT INTO rail_vertices (id, geom)
        SELECT id, geom
        FROM rail_vertex_lookup
        ORDER BY id;

        SELECT setval('rail_vertices_id_seq', COALESCE((SELECT max(id) FROM rail_vertices), 1), true);

        INSERT INTO rail_edges (
          osm_id, railway, service, usage, name, geom, source, target,
          length_meters, cost, reverse_cost, is_service, is_active
        )
        SELECT s.osm_id,
               s.railway,
               s.service,
               s.usage,
               s.name,
               s.geom,
               source_vertex.id,
               target_vertex.id,
               ST_Length(s.geom::geography),
               ST_Length(s.geom::geography) * CASE
                 WHEN s.service IN ('yard', 'siding', 'spur', 'crossover') THEN 8
                 ELSE 1
               END,
               ST_Length(s.geom::geography) * CASE
                 WHEN s.service IN ('yard', 'siding', 'spur', 'crossover') THEN 8
                 ELSE 1
               END,
               COALESCE(s.service IN ('yard', 'siding', 'spur', 'crossover'), false),
               true
        FROM noded_rail_segments s
        JOIN rail_vertex_lookup source_vertex ON source_vertex.node_key = s.source_key
        JOIN rail_vertex_lookup target_vertex ON target_vertex.node_key = s.target_key
        WHERE source_vertex.id <> target_vertex.id;

        COMMIT;
        ANALYZE rail_vertices;
        ANALYZE rail_edges;
        """
    )


def snap_stops(snapshot_public_id: str | None) -> None:
    snapshot_filter = f"snap.public_id = {sql_literal(snapshot_public_id)}" if snapshot_public_id else "snap.is_active = true"
    rail_modes = sql_text_array(RAIL_MODES)
    run_psql(
        f"""
        DELETE FROM stop_rail_snaps srs
        USING data_snapshots snap
        WHERE snap.id = srs.snapshot_id AND {snapshot_filter};

        WITH rail_stop_places AS (
          SELECT sp.snapshot_id, sp.id AS stop_place_id, sp.geometry
          FROM stop_places sp
          JOIN data_snapshots snap ON snap.id = sp.snapshot_id
          WHERE {snapshot_filter}
            AND sp.modes && {rail_modes}
        ),
        candidates AS (
          SELECT rsp.snapshot_id,
                 rsp.stop_place_id,
                 re.id AS edge_id,
                 CASE
                   WHEN ST_Distance(rsp.geometry::geography, ST_StartPoint(re.geom)::geography)
                      <= ST_Distance(rsp.geometry::geography, ST_EndPoint(re.geom)::geography)
                     THEN re.source
                   ELSE re.target
                 END AS vertex_id,
                 ST_ClosestPoint(re.geom, rsp.geometry)::geometry(Point, 4326) AS snap_geometry,
                 ST_Distance(rsp.geometry::geography, re.geom::geography) AS snap_distance_meters,
                 row_number() OVER (
                   PARTITION BY rsp.snapshot_id, rsp.stop_place_id
                   ORDER BY ST_Distance(rsp.geometry::geography, re.geom::geography), re.is_service
                 ) AS candidate_rank
          FROM rail_stop_places rsp
          JOIN rail_edges re
            ON re.is_active = true
           AND ST_DWithin(rsp.geometry, re.geom, 0.01)
           AND ST_DWithin(rsp.geometry::geography, re.geom::geography, 800)
        )
        INSERT INTO stop_rail_snaps (
          snapshot_id, stop_place_id, edge_id, vertex_id, candidate_rank,
          snap_geometry, snap_distance_meters, confidence
        )
        SELECT snapshot_id,
               stop_place_id,
               edge_id,
               vertex_id,
               candidate_rank,
               snap_geometry,
               snap_distance_meters,
               GREATEST(0, 1 - (snap_distance_meters / 800.0))
        FROM candidates
        WHERE candidate_rank <= 3
        """
    )


def match_route_patterns(
    snapshot_public_id: str | None,
    limit: int | None,
    bbox: str | None,
    modes: str | None,
    routes: str | None,
) -> None:
    snapshot_filter = f"snap.public_id = {sql_literal(snapshot_public_id)}" if snapshot_public_id else "snap.is_active = true"
    limit_clause = f"LIMIT {int(limit)}" if limit else ""
    mode_values = tuple(mode.strip() for mode in modes.split(",") if mode.strip()) if modes else RAIL_MODES
    rail_modes = sql_text_array(mode_values)
    pattern_bbox_filter = bbox_filter_clause(bbox)
    route_label_filter = route_label_filter_clause(routes)
    run_psql(
        f"""
                DELETE FROM route_pattern_rail_matches rpm
                USING route_patterns rp, routes r, data_snapshots snap
                WHERE rp.snapshot_id = rpm.snapshot_id
                  AND rp.id = rpm.route_pattern_id
                  AND r.snapshot_id = rp.snapshot_id
                  AND r.id = rp.route_id
                  AND snap.id = rp.snapshot_id
                  AND {snapshot_filter}
                  AND r.mode = ANY({rail_modes})
                  {route_label_filter}
                  {pattern_bbox_filter};

                CREATE TEMP TABLE rail_pattern_segments ON COMMIT DROP AS
                WITH ordered_stops AS (
                  SELECT rp.snapshot_id,
                         rp.id AS route_pattern_id,
                         rp.geometry AS gtfs_geometry,
                         r.mode,
                         rps.stop_sequence,
                         srs.vertex_id,
                         srs.snap_distance_meters,
                         sp.geometry AS stop_geometry,
                         lead(srs.vertex_id) OVER (PARTITION BY rp.snapshot_id, rp.id ORDER BY rps.stop_sequence) AS next_vertex_id,
                         lead(sp.geometry) OVER (PARTITION BY rp.snapshot_id, rp.id ORDER BY rps.stop_sequence) AS next_stop_geometry
                  FROM route_patterns rp
                  JOIN routes r ON r.snapshot_id = rp.snapshot_id AND r.id = rp.route_id
                  JOIN data_snapshots snap ON snap.id = rp.snapshot_id
                  JOIN route_pattern_stops rps ON rps.snapshot_id = rp.snapshot_id AND rps.route_pattern_id = rp.id
                  JOIN stop_places sp ON sp.snapshot_id = rps.snapshot_id AND sp.id = rps.stop_place_id
                  LEFT JOIN stop_rail_snaps srs
                    ON srs.snapshot_id = rps.snapshot_id
                   AND srs.stop_place_id = rps.stop_place_id
                   AND srs.candidate_rank = 1
                  WHERE {snapshot_filter}
                    AND r.mode = ANY({rail_modes})
                    {pattern_bbox_filter}
                    {route_label_filter}
                  ORDER BY rp.id, rps.stop_sequence
                  {limit_clause}
                )
                SELECT snapshot_id,
                       route_pattern_id,
                       gtfs_geometry,
                       mode,
                       stop_sequence,
                       vertex_id AS source_vertex_id,
                       next_vertex_id AS target_vertex_id,
                       snap_distance_meters,
                       ST_Distance(stop_geometry::geography, next_stop_geometry::geography) AS straight_distance_meters
                FROM ordered_stops
                WHERE next_stop_geometry IS NOT NULL;

                CREATE INDEX rail_pattern_segments_pattern_idx
                  ON rail_pattern_segments (snapshot_id, route_pattern_id, stop_sequence);

                CREATE TEMP TABLE rail_components ON COMMIT DROP AS
                SELECT node, component
                FROM pgr_connectedComponents(
                  'SELECT id, source, target, cost, reverse_cost FROM rail_edges WHERE is_active = true'
                );

                CREATE INDEX rail_components_node_idx ON rail_components (node);

                CREATE TEMP TABLE rail_match_components ON COMMIT DROP AS
                SELECT DISTINCT source_component.component
                FROM (
                  SELECT *
                  FROM rail_pattern_segments
                  WHERE source_vertex_id IS NOT NULL
                    AND target_vertex_id IS NOT NULL
                    AND source_vertex_id <> target_vertex_id
                ) ps
                JOIN rail_components source_component
                  ON source_component.node = ps.source_vertex_id
                JOIN rail_components target_component
                  ON target_component.node = ps.target_vertex_id
                 AND target_component.component = source_component.component;

                CREATE INDEX rail_match_components_component_idx
                  ON rail_match_components (component);

                CREATE TEMP TABLE rail_match_edges ON COMMIT DROP AS
                SELECT DISTINCT re.id,
                       re.source,
                       re.target,
                       re.cost,
                       re.reverse_cost,
                       re.geom,
                       re.length_meters,
                       re.railway,
                       re.is_service
                FROM rail_edges re
                JOIN rail_components rc ON rc.node = re.source
                JOIN rail_match_components mc ON mc.component = rc.component
                WHERE re.is_active = true;

                CREATE INDEX rail_match_edges_id_idx ON rail_match_edges (id);

                CREATE TEMP TABLE rail_pattern_path_edges ON COMMIT DROP AS
                SELECT ps.snapshot_id,
                       ps.route_pattern_id,
                       ps.stop_sequence,
                       path.seq AS path_sequence,
                       path.edge AS edge_id,
                       re.geom,
                       re.length_meters,
                       re.railway,
                       re.is_service
                FROM (
                  SELECT *
                  FROM rail_pattern_segments
                  WHERE source_vertex_id IS NOT NULL
                    AND target_vertex_id IS NOT NULL
                    AND source_vertex_id <> target_vertex_id
                ) ps
                JOIN rail_components source_component
                  ON source_component.node = ps.source_vertex_id
                JOIN rail_components target_component
                  ON target_component.node = ps.target_vertex_id
                 AND target_component.component = source_component.component
                JOIN LATERAL pgr_dijkstra(
                  'SELECT id, source, target, cost, reverse_cost FROM rail_match_edges',
                  ps.source_vertex_id,
                  ps.target_vertex_id,
                  false
                ) path ON true
                JOIN rail_match_edges re ON re.id = path.edge
                WHERE path.edge <> -1;

                CREATE TEMP TABLE rail_pattern_stats ON COMMIT DROP AS
                SELECT ps.snapshot_id,
                       ps.route_pattern_id,
                       count(*) AS total_segments,
                       count(*) FILTER (WHERE ps.source_vertex_id IS NULL OR ps.target_vertex_id IS NULL) AS unsnapped_segments,
                       count(*) FILTER (
                         WHERE ps.source_vertex_id IS NOT NULL
                           AND ps.target_vertex_id IS NOT NULL
                           AND ps.source_vertex_id <> ps.target_vertex_id
                           AND NOT EXISTS (
                             SELECT 1
                             FROM rail_pattern_path_edges ppe
                             WHERE ppe.snapshot_id = ps.snapshot_id
                               AND ppe.route_pattern_id = ps.route_pattern_id
                               AND ppe.stop_sequence = ps.stop_sequence
                           )
                       ) AS unrouted_segments,
                       avg(ps.snap_distance_meters) AS mean_snap_distance_meters,
                       max(ps.snap_distance_meters) AS max_snap_distance_meters,
                       sum(ps.straight_distance_meters) AS straight_distance_meters
                FROM rail_pattern_segments ps
                GROUP BY ps.snapshot_id, ps.route_pattern_id;

                CREATE TEMP TABLE rail_pattern_geometries ON COMMIT DROP AS
                SELECT ppe.snapshot_id,
                       ppe.route_pattern_id,
                       ST_LineMerge(ST_Collect(ppe.geom ORDER BY ppe.stop_sequence, ppe.path_sequence)) AS geometry,
                       sum(ppe.length_meters) AS routed_length_meters,
                       bool_or(ppe.is_service) AS uses_service_edges
                FROM rail_pattern_path_edges ppe
                GROUP BY ppe.snapshot_id, ppe.route_pattern_id;

                INSERT INTO route_pattern_rail_matches (
                  snapshot_id, route_pattern_id, geometry, confidence, match_status,
                  failed_segments, total_segments, mean_snap_distance_meters,
                  max_snap_distance_meters, detour_factor, shape_deviation_meters, source
                )
                SELECT stats.snapshot_id,
                       stats.route_pattern_id,
                       CASE
                         WHEN geom.geometry IS NOT NULL AND NOT ST_IsEmpty(ST_CollectionExtract(geom.geometry, 2))
                           THEN ST_Multi(ST_CollectionExtract(geom.geometry, 2))::geometry(Geometry, 4326)
                         ELSE NULL
                       END,
                       GREATEST(
                         0,
                         LEAST(
                           1,
                           1
                           - COALESCE(stats.max_snap_distance_meters, 800) / 800.0 * 0.25
                           - CASE
                               WHEN stats.total_segments = 0 THEN 1
                               ELSE (stats.unsnapped_segments + stats.unrouted_segments)::numeric / stats.total_segments
                             END * 0.45
                           - GREATEST(0, COALESCE(geom.routed_length_meters / NULLIF(stats.straight_distance_meters, 0), 10) - 1.8) * 0.15
                           - CASE WHEN geom.uses_service_edges THEN 0.08 ELSE 0 END
                           - CASE
                               WHEN rp.geometry IS NOT NULL AND GeometryType(geom.geometry) IN ('LINESTRING', 'MULTILINESTRING')
                                 THEN LEAST(
                                   0.25,
                                   ST_HausdorffDistance(ST_Transform(geom.geometry, 3857), ST_Transform(rp.geometry, 3857)) / 5000.0
                                 )
                               ELSE 0
                             END
                         )
                       ) AS confidence,
                       CASE
                         WHEN geom.geometry IS NULL THEN 'fallback'
                         WHEN GREATEST(
                           0,
                           LEAST(
                             1,
                             1
                             - COALESCE(stats.max_snap_distance_meters, 800) / 800.0 * 0.25
                             - CASE
                                 WHEN stats.total_segments = 0 THEN 1
                                 ELSE (stats.unsnapped_segments + stats.unrouted_segments)::numeric / stats.total_segments
                               END * 0.45
                             - GREATEST(0, COALESCE(geom.routed_length_meters / NULLIF(stats.straight_distance_meters, 0), 10) - 1.8) * 0.15
                             - CASE WHEN geom.uses_service_edges THEN 0.08 ELSE 0 END
                             - CASE
                                 WHEN rp.geometry IS NOT NULL AND GeometryType(geom.geometry) IN ('LINESTRING', 'MULTILINESTRING')
                                   THEN LEAST(
                                     0.25,
                                     ST_HausdorffDistance(ST_Transform(geom.geometry, 3857), ST_Transform(rp.geometry, 3857)) / 5000.0
                                   )
                                 ELSE 0
                               END
                           )
                         ) >= 0.70 THEN 'osm_reconstructed'
                         WHEN GREATEST(
                           0,
                           LEAST(
                             1,
                             1
                             - COALESCE(stats.max_snap_distance_meters, 800) / 800.0 * 0.25
                             - CASE
                                 WHEN stats.total_segments = 0 THEN 1
                                 ELSE (stats.unsnapped_segments + stats.unrouted_segments)::numeric / stats.total_segments
                               END * 0.45
                             - GREATEST(0, COALESCE(geom.routed_length_meters / NULLIF(stats.straight_distance_meters, 0), 10) - 1.8) * 0.15
                             - CASE WHEN geom.uses_service_edges THEN 0.08 ELSE 0 END
                             - CASE
                                 WHEN rp.geometry IS NOT NULL AND GeometryType(geom.geometry) IN ('LINESTRING', 'MULTILINESTRING')
                                   THEN LEAST(
                                     0.25,
                                     ST_HausdorffDistance(ST_Transform(geom.geometry, 3857), ST_Transform(rp.geometry, 3857)) / 5000.0
                                   )
                                 ELSE 0
                               END
                           )
                         ) >= 0.45 THEN 'osm_reconstructed_low_confidence'
                         ELSE 'fallback'
                       END AS match_status,
                       (stats.unsnapped_segments + stats.unrouted_segments)::integer,
                       stats.total_segments::integer,
                       stats.mean_snap_distance_meters,
                       stats.max_snap_distance_meters,
                       geom.routed_length_meters / NULLIF(stats.straight_distance_meters, 0),
                       CASE
                         WHEN rp.geometry IS NOT NULL AND GeometryType(geom.geometry) IN ('LINESTRING', 'MULTILINESTRING')
                           THEN ST_HausdorffDistance(ST_Transform(geom.geometry, 3857), ST_Transform(rp.geometry, 3857))
                         ELSE NULL
                       END,
                       'osm_rail_network'
                FROM rail_pattern_stats stats
                JOIN route_patterns rp ON rp.snapshot_id = stats.snapshot_id AND rp.id = stats.route_pattern_id
                LEFT JOIN rail_pattern_geometries geom
                  ON geom.snapshot_id = stats.snapshot_id
                 AND geom.route_pattern_id = stats.route_pattern_id;
        """
    )


def summarize() -> dict[str, object]:
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  (SELECT count(*) FROM rail_vertices) AS rail_vertices,
                  (SELECT count(*) FROM rail_edges) AS rail_edges,
                  (SELECT count(*) FROM stop_rail_snaps WHERE candidate_rank = 1) AS snapped_stops,
                  (SELECT count(*) FROM route_pattern_rail_matches WHERE match_status = 'osm_reconstructed') AS reconstructed_patterns,
                  (SELECT count(*) FROM route_pattern_rail_matches WHERE match_status = 'osm_reconstructed_low_confidence') AS low_confidence_patterns,
                  (SELECT count(*) FROM route_pattern_rail_matches WHERE match_status = 'fallback') AS fallback_patterns
                """
            )
            row = cur.fetchone()
    keys = [
        "rail_vertices",
        "rail_edges",
        "snapped_stops",
        "reconstructed_patterns",
        "low_confidence_patterns",
        "fallback_patterns",
    ]
    return dict(zip(keys, row))


def main() -> None:
    parser = argparse.ArgumentParser(description="Import OSM rail corridors and reconstruct rail route-pattern geometries.")
    parser.add_argument("--snapshot", help="Snapshot public_id. Defaults to the active snapshot.")
    parser.add_argument("--pbf", default=str(OSM_PBF), help="OSM PBF path.")
    parser.add_argument("--skip-osm-filter", action="store_true", help="Import the provided PBF directly without rail-only filtering.")
    parser.add_argument("--skip-osm-import", action="store_true", help="Reuse existing staging_osm_rail_line table.")
    parser.add_argument("--limit-patterns", type=int, help="Limit pattern matching during local debugging.")
    parser.add_argument("--bbox", help="Limit route-pattern matching to min_lon,min_lat,max_lon,max_lat.")
    parser.add_argument("--corridor", choices=sorted(CORRIDOR_BBOXES), help="Named corridor bbox for route-pattern matching.")
    parser.add_argument("--modes", help="Comma-separated route modes to match. Defaults to all rail modes.")
    parser.add_argument("--routes", help="Comma-separated route labels, e.g. U1,S1,RE8,RB81.")
    parser.add_argument(
        "step",
        nargs="?",
        choices=["all", "import-osm", "build-edges", "snap-stops", "match-patterns"],
        default="all",
    )
    args = parser.parse_args()

    if args.step in {"all", "import-osm"} and not args.skip_osm_import:
        pbf_path = Path(args.pbf)
        if not args.skip_osm_filter:
            pbf_path = filter_osm_railways(pbf_path)
        import_osm_with_osm2pgsql(pbf_path)
    if args.step in {"all", "build-edges"}:
        build_rail_edges()
    if args.step in {"all", "snap-stops"}:
        snap_stops(args.snapshot)
    if args.step in {"all", "match-patterns"}:
        match_route_patterns(args.snapshot, args.limit_patterns, resolve_bbox(args.bbox, args.corridor), args.modes, args.routes)

    print(json.dumps(summarize(), ensure_ascii=False))


if __name__ == "__main__":
    main()
