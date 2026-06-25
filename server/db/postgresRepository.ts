import pg from 'pg'
import type {
  ApiItineraryResponse,
  ApiMetrics,
  ApiRoutePattern,
  ApiSnapshot,
  ApiStopDetails,
  ApiStopSearchResult,
} from '../../src/api/contracts'
import type { ItineraryQuery, RegionfinderRepository, StopSearchFilters } from './types'

const { Pool } = pg

type Queryable = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<T>>
}

export class PostgresRepository implements RegionfinderRepository {
  readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString })
  }

  async currentSnapshot(): Promise<ApiSnapshot | null> {
    const result = await this.pool.query<{
      public_id: string
      source_key: string
      name: string
      provider: string
      license: string | null
      attribution: string | null
      valid_from: string | null
      valid_until: string | null
      imported_at: string | null
      activated_at: string | null
      source_sha256: string | null
      quality_report: Record<string, unknown>
    }>(
      `
      SELECT s.public_id,
             ds.source_key,
             ds.name,
             ds.provider,
             ds.license,
             ds.attribution,
             s.valid_from::text,
             s.valid_until::text,
             s.imported_at::text,
             s.activated_at::text,
             s.source_sha256,
             s.quality_report
      FROM data_snapshots s
      JOIN data_sources ds ON ds.id = s.source_id
      WHERE s.is_active = true
      LIMIT 1
      `,
    )
    const row = result.rows[0]

    if (!row) {
      return null
    }

    const profiles = await this.pool.query<{ id: string; version: number; name: string }>(
      'SELECT id, version, name FROM routing_profiles ORDER BY id, version',
    )

    return {
      publicId: row.public_id,
      source: {
        key: row.source_key,
        name: row.name,
        provider: row.provider,
        license: row.license,
        attribution: row.attribution,
      },
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      importedAt: row.imported_at,
      activatedAt: row.activated_at,
      gtfsHash: row.source_sha256,
      osmHash: typeof row.quality_report.osm_sha256 === 'string' ? row.quality_report.osm_sha256 : null,
      activeRoutingProfiles: profiles.rows.map((profile) => ({
        id: profile.id,
        version: profile.version,
        name: profile.name,
      })),
      qualityStatus: typeof row.quality_report.status === 'string' ? row.quality_report.status : 'unknown',
    }
  }

  async searchStops(filters: StopSearchFilters): Promise<ApiStopSearchResult[]> {
    const result = await this.pool.query<{
      public_id: string
      name: string
      dhid: string | null
      lat: number
      lon: number
      state_code: string | null
      municipality_name: string | null
      modes: string[]
      identity_quality: string
    }>(
      `
      SELECT sp.public_id,
             sp.name,
             sp.dhid,
             ST_Y(sp.geometry)::float8 AS lat,
             ST_X(sp.geometry)::float8 AS lon,
             sp.state_code,
             sp.municipality_name,
             sp.modes,
             sp.identity_quality
      FROM stop_places sp
      JOIN data_snapshots snap ON snap.id = sp.snapshot_id AND snap.is_active = true
      WHERE ($1 = '' OR sp.normalized_name ILIKE '%' || $1 || '%' OR sp.public_id ILIKE '%' || $1 || '%' OR sp.dhid ILIKE '%' || $1 || '%')
        AND (cardinality($2::text[]) = 0 OR sp.state_code = ANY($2::text[]))
        AND (cardinality($3::text[]) = 0 OR sp.modes && $3::text[])
      ORDER BY sp.name
      LIMIT $4
      `,
      [filters.query, filters.states, filters.modes, filters.limit],
    )

    return result.rows.map((row) => ({
      publicId: row.public_id,
      name: row.name,
      dhid: row.dhid,
      coordinate: { lat: row.lat, lon: row.lon },
      stateCode: row.state_code,
      municipalityName: row.municipality_name,
      modes: row.modes,
      identityQuality: row.identity_quality,
    }))
  }

  async stopDetails(publicId: string): Promise<ApiStopDetails | null> {
    const stops = await this.searchStops({ query: publicId, states: [], modes: [], limit: 1 })
    const base = stops.find((stop) => stop.publicId === publicId)

    if (!base) {
      return null
    }

    const technicalStops = await this.pool.query<{
      source_stop_id: string
      name: string
      platform_code: string | null
      location_type: number | null
      quay_type: string | null
    }>(
      `
      SELECT st.source_stop_id, st.name, st.platform_code, st.location_type, st.quay_type
      FROM stops st
      JOIN stop_places sp ON sp.id = st.stop_place_id AND sp.snapshot_id = st.snapshot_id
      JOIN data_snapshots snap ON snap.id = sp.snapshot_id AND snap.is_active = true
      WHERE sp.public_id = $1
      ORDER BY st.name
      `,
      [publicId],
    )
    const routes = await this.pool.query<{
      route_pattern_id: string
      short_name: string | null
      long_name: string | null
      mode: string
      agency_name: string | null
      direction_id: number | null
      geometry_quality: string
    }>(
      `
      SELECT rp.id::text AS route_pattern_id,
             r.short_name,
             r.long_name,
             r.mode,
             a.name AS agency_name,
             rp.direction_id,
             rp.geometry_quality
      FROM route_pattern_stops rps
      JOIN route_patterns rp ON rp.id = rps.route_pattern_id AND rp.snapshot_id = rps.snapshot_id
      JOIN routes r ON r.id = rp.route_id AND r.snapshot_id = rp.snapshot_id
      LEFT JOIN agencies a ON a.id = r.agency_id AND a.snapshot_id = r.snapshot_id
      JOIN stop_places sp ON sp.id = rps.stop_place_id AND sp.snapshot_id = rps.snapshot_id
      JOIN data_snapshots snap ON snap.id = sp.snapshot_id AND snap.is_active = true
      WHERE sp.public_id = $1
      ORDER BY r.short_name NULLS LAST, r.long_name NULLS LAST
      LIMIT 100
      `,
      [publicId],
    )
    const snapshot = await this.currentSnapshot()

    return {
      ...base,
      dataStand: {
        snapshotId: snapshot?.publicId ?? 'unknown',
        qualityStatus: snapshot?.qualityStatus ?? 'unknown',
      },
      technicalStops: technicalStops.rows.map((row) => ({
        sourceStopId: row.source_stop_id,
        name: row.name,
        platformCode: row.platform_code,
        locationType: row.location_type,
        quayType: row.quay_type,
      })),
      servedRoutes: routes.rows.map((row) => ({
        routePatternId: row.route_pattern_id,
        shortName: row.short_name,
        longName: row.long_name,
        mode: row.mode,
        agencyName: row.agency_name,
        directionId: row.direction_id,
        geometryQuality: row.geometry_quality,
      })),
    }
  }

  async stopMetrics(publicId: string, profile: string, _snapshot?: string, date?: string): Promise<ApiMetrics | null> {
    const result = await this.pool.query<{
      snapshot_internal_id: string
      snapshot_id: string
      origin_stop_place_id: string
      destination_stop_place_id: string
      fastest_seconds: number | null
      average_seconds: string | null
      median_seconds: string | null
      p90_seconds: number | null
      p90_publishable: boolean
      median_publishable: boolean
      total_sample_count: number
      reachable_sample_count: number
      unreachable_sample_count: number
      reachability_ratio: string
      direct_connection_ratio: string | null
      minimum_transfers: number | null
      median_transfers: string | null
      average_initial_wait_seconds: string | null
      average_walk_seconds: string | null
      average_in_vehicle_seconds: string | null
      first_connection_at: string | null
      last_connection_at: string | null
      max_service_gap_seconds: number | null
    }>(
      `
      SELECT snap.id AS snapshot_internal_id,
             snap.public_id AS snapshot_id,
             odm.origin_stop_place_id,
             odm.destination_stop_place_id,
             odm.fastest_seconds,
             odm.average_seconds,
             odm.median_seconds,
             odm.p90_seconds,
             odm.p90_publishable,
             odm.median_publishable,
             odm.total_sample_count,
             odm.reachable_sample_count,
             odm.unreachable_sample_count,
             odm.reachability_ratio,
             odm.direct_connection_ratio,
             odm.minimum_transfers,
             odm.median_transfers,
             odm.average_initial_wait_seconds,
             odm.average_walk_seconds,
             odm.average_in_vehicle_seconds,
             odm.first_connection_at::text,
             odm.last_connection_at::text,
             odm.max_service_gap_seconds
      FROM od_metrics odm
      JOIN metric_runs mr ON mr.id = odm.metric_run_id
      JOIN data_snapshots snap ON snap.id = mr.snapshot_id AND snap.is_active = true
      JOIN stop_places dst ON dst.id = odm.destination_stop_place_id AND dst.snapshot_id = snap.id
      WHERE dst.public_id = $1 AND mr.routing_profile_id = $2
      ORDER BY odm.computed_at DESC
      LIMIT 1
      `,
      [publicId, profile],
    )
    const row = result.rows[0]

    if (!row) {
      return null
    }

    const directConnectionCount = date
      ? await this.directConnectionCountForDate(
          row.snapshot_internal_id,
          row.origin_stop_place_id,
          row.destination_stop_place_id,
          date,
        )
      : null

    return {
      snapshotId: row.snapshot_id,
      profileId: profile,
      metricDefinitionVersion: '2026-06-24.nearest-rank-p90',
      fastestSeconds: row.fastest_seconds,
      averageSeconds: row.average_seconds === null ? null : Number(row.average_seconds),
      medianSeconds: row.median_seconds === null ? null : Number(row.median_seconds),
      p90Seconds: row.p90_seconds,
      p90Publishable: row.p90_publishable,
      medianPublishable: row.median_publishable,
      totalSampleCount: row.total_sample_count,
      reachableSampleCount: row.reachable_sample_count,
      unreachableSampleCount: row.unreachable_sample_count,
      reachabilityRatio: Number(row.reachability_ratio),
      directConnectionRatio: row.direct_connection_ratio === null ? null : Number(row.direct_connection_ratio),
      directConnectionCount,
      minimumTransfers: row.minimum_transfers,
      medianTransfers: row.median_transfers === null ? null : Number(row.median_transfers),
      averageInitialWaitSeconds:
        row.average_initial_wait_seconds === null ? null : Number(row.average_initial_wait_seconds),
      averageWalkSeconds: row.average_walk_seconds === null ? null : Number(row.average_walk_seconds),
      averageInVehicleSeconds: row.average_in_vehicle_seconds === null ? null : Number(row.average_in_vehicle_seconds),
      firstConnectionAt: row.first_connection_at,
      lastConnectionAt: row.last_connection_at,
      maxServiceGapSeconds: row.max_service_gap_seconds,
      quantileMethod: 'nearest-rank-p90',
    }
  }

  private async directConnectionCountForDate(
    snapshotId: string,
    originStopPlaceId: string,
    destinationStopPlaceId: string,
    serviceDate: string,
  ): Promise<number> {
    const result = await this.pool.query<{ direct_connection_count: number }>(
      `
      SELECT count(DISTINCT tr.id)::int AS direct_connection_count
      FROM trips tr
      JOIN service_dates sd
        ON sd.snapshot_id = tr.snapshot_id
       AND sd.service_id = tr.service_id
       AND sd.service_date = $4::date
       AND sd.is_active = true
      JOIN stop_times origin_st
        ON origin_st.snapshot_id = tr.snapshot_id
       AND origin_st.trip_id = tr.id
      JOIN stops origin_stop
        ON origin_stop.snapshot_id = origin_st.snapshot_id
       AND origin_stop.id = origin_st.stop_id
      JOIN stop_times destination_st
        ON destination_st.snapshot_id = tr.snapshot_id
       AND destination_st.trip_id = tr.id
       AND destination_st.stop_sequence > origin_st.stop_sequence
      JOIN stops destination_stop
        ON destination_stop.snapshot_id = destination_st.snapshot_id
       AND destination_stop.id = destination_st.stop_id
      WHERE tr.snapshot_id = $1
        AND origin_stop.stop_place_id = $2
        AND destination_stop.stop_place_id = $3
        AND COALESCE(origin_st.pickup_type, 0) <> 1
        AND COALESCE(destination_st.drop_off_type, 0) <> 1
      `,
      [snapshotId, originStopPlaceId, destinationStopPlaceId, serviceDate],
    )

    return result.rows[0]?.direct_connection_count ?? 0
  }

  async itineraries(query: ItineraryQuery): Promise<ApiItineraryResponse | null> {
    const snapshot = await this.currentSnapshot()
    if (!snapshot) {
      return null
    }
    const stop = await this.searchStops({ query: query.publicId, states: [], modes: [], limit: 1 })
    const destination = stop.find((candidate) => candidate.publicId === query.publicId)
    if (!destination) {
      return null
    }

    const motisBaseUrl = process.env.MOTIS_BASE_URL ?? 'http://127.0.0.1:8080'
    const requestedDeparture = `${query.date}T${query.time}:00+02:00`
    const url = new URL('/api/v5/plan', motisBaseUrl)
    url.searchParams.set('fromPlace', process.env.REGIONFINDER_ORIGIN_MOTIS_ID ?? 'gtfs_de:02000:10950_G')
    url.searchParams.set('toPlace', `gtfs_${query.publicId}`)
    url.searchParams.set('time', requestedDeparture)
    url.searchParams.set('maxTravelTime', '240')
    url.searchParams.set('maxTransfers', '4')
    url.searchParams.set('numItineraries', '4')
    url.searchParams.set('directModes', '')
    url.searchParams.set('transitModes', 'TRANSIT')
    url.searchParams.set('detailedTransfers', 'false')
    url.searchParams.set('language', 'de')

    let payload: unknown
    try {
      const response = await fetch(url)
      if (!response.ok) {
        return null
      }
      payload = await response.json()
    } catch {
      return null
    }

    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { itineraries?: unknown }).itineraries)) {
      return null
    }

    const requestedMs = Date.parse(requestedDeparture)
    const alternatives = (payload as { itineraries: Array<Record<string, unknown>> }).itineraries
      .slice(0, 4)
      .map((itinerary, index) => {
        const legs = Array.isArray(itinerary.legs) ? (itinerary.legs as Array<Record<string, unknown>>) : []
        const transitLegs = legs.filter((leg) => leg.mode !== 'WALK')
        const firstTransit = transitLegs[0]
        const actualFirstDepartureAt = firstTransit ? stringOrNull(firstTransit.startTime) : null
        const arrivalAt = stringOrNull(itinerary.endTime)
        const initialWalkSeconds = sumLegDurations(legs.slice(0, firstTransit ? legs.indexOf(firstTransit) : 0), 'WALK')
        const firstDepartureMs = actualFirstDepartureAt ? Date.parse(actualFirstDepartureAt) : null
        const initialWaitSeconds =
          firstDepartureMs === null ? null : Math.max(0, Math.round((firstDepartureMs - requestedMs) / 1000) - initialWalkSeconds)
        const inVehicleSeconds = sumTransitDurations(legs)
        const walkingSeconds = sumLegDurations(legs, 'WALK')
        const walkingDistanceMeters = sumLegDistances(legs, 'WALK')
        const totalDurationSeconds = arrivalAt ? Math.max(0, Math.round((Date.parse(arrivalAt) - requestedMs) / 1000)) : null

        return {
          rankType: index === 0 ? 'earliest_arrival' : 'fewest_transfers',
          provider: 'motis',
          requestedDepartureAt: requestedDeparture,
          actualFirstDepartureAt,
          arrivalAt,
          totalDurationSeconds,
          initialWalkSeconds,
          initialWaitSeconds,
          inVehicleSeconds,
          transferWaitSeconds: null,
          walkingSeconds,
          walkingDistanceMeters,
          transitDistanceMeters: null,
          totalDistanceMeters: walkingDistanceMeters,
          transferCount:
            typeof itinerary.transfers === 'number' ? itinerary.transfers : Math.max(0, transitLegs.length - 1),
          legs: legs.map((leg, sequence) => ({
            sequence,
            legType: leg.mode === 'WALK' ? 'walk' : 'transit',
            mode: stringOrNull(leg.mode),
            routeName: stringOrNull(leg.displayName) ?? stringOrNull(leg.routeShortName),
            agencyName: stringOrNull(leg.agencyName),
            fromName: placeName(leg.from),
            toName: placeName(leg.to),
            departureAt: stringOrNull(leg.startTime),
            arrivalAt: stringOrNull(leg.endTime),
            durationSeconds: typeof leg.duration === 'number' ? leg.duration : null,
            distanceMeters: typeof leg.distance === 'number' ? leg.distance : null,
            geometry: null,
            headsign: stringOrNull(leg.headsign),
            platformFrom: trackName(leg.from),
            platformTo: trackName(leg.to),
          })),
        } satisfies ApiItineraryResponse['alternatives'][number]
      })

    return {
      snapshotId: snapshot.publicId,
      requestedDeparture,
      originId: process.env.REGIONFINDER_ORIGIN_PUBLIC_ID ?? 'de:02000:10950_G',
      destinationPublicId: query.publicId,
      alternatives,
    }
  }

  async routePattern(id: string): Promise<ApiRoutePattern | null> {
    const result = await this.pool.query<{
      id: string
      short_name: string | null
      long_name: string | null
      mode: string
      agency_name: string | null
      direction_id: number | null
      headsign: string | null
      geometry_json: string | null
      geometry_quality: string
      geometry_source: string
      length_meters: string | null
      trip_count: string
    }>(
      `
      SELECT rp.id::text,
             r.short_name,
             r.long_name,
             r.mode,
             a.name AS agency_name,
             rp.direction_id,
             rp.headsign,
             ST_AsGeoJSON(rpd.geometry) AS geometry_json,
             rpd.geometry_quality,
             rpd.geometry_source,
             rpd.length_meters,
             COALESCE(tc.trip_count, 0)::text AS trip_count
      FROM route_patterns rp
      JOIN route_pattern_display_geometries rpd ON rpd.snapshot_id = rp.snapshot_id AND rpd.route_pattern_id = rp.id
      JOIN routes r ON r.id = rp.route_id AND r.snapshot_id = rp.snapshot_id
      LEFT JOIN agencies a ON a.id = r.agency_id AND a.snapshot_id = r.snapshot_id
      JOIN data_snapshots snap ON snap.id = rp.snapshot_id AND snap.is_active = true
      LEFT JOIN (
        SELECT snapshot_id, route_pattern_id, count(*) AS trip_count
        FROM trips
        GROUP BY snapshot_id, route_pattern_id
      ) tc ON tc.route_pattern_id = rp.id AND tc.snapshot_id = rp.snapshot_id
      WHERE rp.id = $1::uuid
      `,
      [id],
    )
    const row = result.rows[0]
    if (!row) {
      return null
    }

    const stops = await this.pool.query<{
      stop_sequence: number
      public_id: string
      name: string
      platform_code: string | null
    }>(
      `
      SELECT rps.stop_sequence,
             sp.public_id,
             sp.name,
             st.platform_code
      FROM route_pattern_stops rps
      JOIN stop_places sp ON sp.id = rps.stop_place_id AND sp.snapshot_id = rps.snapshot_id
      LEFT JOIN stops st ON st.id = rps.stop_id AND st.snapshot_id = rps.snapshot_id
      WHERE rps.route_pattern_id = $1::uuid
      ORDER BY rps.stop_sequence
      `,
      [id],
    )

    return {
      id: row.id,
      route: {
        shortName: row.short_name,
        longName: row.long_name,
        mode: row.mode,
        agencyName: row.agency_name,
      },
      directionId: row.direction_id,
      headsign: row.headsign,
      geometry: row.geometry_json ? (JSON.parse(row.geometry_json) as ApiRoutePattern['geometry']) : null,
      geometryQuality: row.geometry_quality,
      geometrySource: row.geometry_source,
      lengthMeters: row.length_meters === null ? null : Number(row.length_meters),
      stops: stops.rows.map((stop) => ({
        sequence: stop.stop_sequence,
        publicId: stop.public_id,
        name: stop.name,
        platformCode: stop.platform_code,
      })),
      tripCount: Number(row.trip_count),
    }
  }

  async stopTile(z: number, x: number, y: number, modes: string[] = [], profile = 'regular_tue_thu'): Promise<Buffer | null> {
    return this.mvtTile(
      `
      WITH bounds AS (
        SELECT ST_TileEnvelope($1, $2, $3) AS geom
      ),
      active_snapshot AS (
        SELECT id
        FROM data_snapshots
        WHERE is_active = true
        LIMIT 1
      ),
      visible_stops AS (
        SELECT sp.public_id,
               sp.name,
               sp.state_code,
               sp.modes,
               sp.id,
               sp.snapshot_id,
               sp.geometry,
               (sp.modes && ARRAY['BUS', 'TRAM']::text[] AND sp.modes <@ ARRAY['BUS', 'TRAM']::text[]) AS is_bus_only,
               CASE
                 WHEN sp.modes && ARRAY['ICE', 'IC', 'EC', 'RE', 'RB', 'RAIL']::text[] THEN 'regional'
                 WHEN sp.modes && ARRAY['S', 'AKN', 'U']::text[] THEN 'urban_rail'
                 WHEN sp.modes && ARRAY['BUS', 'TRAM']::text[] AND sp.modes <@ ARRAY['BUS', 'TRAM']::text[] THEN 'bus_only'
                 ELSE 'other'
               END AS stop_priority
        FROM stop_places sp
        JOIN active_snapshot snap ON snap.id = sp.snapshot_id
        CROSS JOIN bounds
        WHERE ST_Intersects(ST_Transform(sp.geometry, 3857), bounds.geom)
          AND sp.is_display_stop = true
          AND (cardinality($4::text[]) = 0 OR sp.modes && $4::text[])
      ),
      latest_metric_run AS (
        SELECT mr.id
        FROM metric_runs mr
        JOIN active_snapshot snap ON snap.id = mr.snapshot_id
        WHERE mr.routing_profile_id = $5
        ORDER BY mr.completed_at DESC NULLS LAST, mr.started_at DESC
        LIMIT 1
      ),
      distinct_route_labels AS (
        SELECT DISTINCT
               rps.stop_place_id,
               COALESCE(NULLIF(r.short_name, ''), NULLIF(r.long_name, ''), r.source_route_id) || ' · ' || r.mode AS label
        FROM visible_stops vs
        JOIN route_pattern_stops rps ON rps.snapshot_id = vs.snapshot_id AND rps.stop_place_id = vs.id
        JOIN route_patterns rp ON rp.id = rps.route_pattern_id AND rp.snapshot_id = rps.snapshot_id
        JOIN routes r ON r.id = rp.route_id AND r.snapshot_id = rp.snapshot_id
        WHERE rp.is_active = true
      ),
      ranked_route_labels AS (
        SELECT stop_place_id,
               label,
               count(*) OVER (PARTITION BY stop_place_id) AS route_count,
               row_number() OVER (PARTITION BY stop_place_id ORDER BY label) AS route_rank
        FROM distinct_route_labels
      ),
      route_summary AS (
        SELECT stop_place_id,
               string_agg(label, ', ' ORDER BY label) FILTER (WHERE route_rank <= 5) AS route_labels,
               max(route_count) AS route_count
        FROM ranked_route_labels
        GROUP BY stop_place_id
      ),
      mvtgeom AS (
        SELECT vs.public_id,
               vs.name,
               vs.state_code,
               vs.modes,
               odm.fastest_seconds,
               route_summary.route_labels,
               COALESCE(route_summary.route_count, 0) AS route_count,
               vs.is_bus_only,
               vs.stop_priority,
               ST_AsMVTGeom(ST_Transform(vs.geometry, 3857), bounds.geom) AS geom
        FROM visible_stops vs
        CROSS JOIN bounds
        LEFT JOIN latest_metric_run lmr ON true
        LEFT JOIN od_metrics odm ON odm.metric_run_id = lmr.id AND odm.destination_stop_place_id = vs.id
        LEFT JOIN route_summary ON route_summary.stop_place_id = vs.id
      )
      SELECT ST_AsMVT(mvtgeom, 'stops', 4096, 'geom') AS tile FROM mvtgeom
      `,
      z,
      x,
      y,
      modes,
      profile,
    )
  }

  async routeTile(z: number, x: number, y: number, modes: string[] = []): Promise<Buffer | null> {
    return this.mvtTile(
      `
      WITH bounds AS (
        SELECT ST_TileEnvelope($1, $2, $3) AS geom
      ),
      mvtgeom AS (
        SELECT rp.id::text,
               r.short_name,
               r.mode,
               CASE
                 WHEN r.color ~ '^#[0-9A-Fa-f]{6}$' THEN r.color
                 WHEN r.color ~ '^[0-9A-Fa-f]{6}$' THEN '#' || r.color
                 ELSE NULL
               END AS route_color,
               rpd.geometry_quality,
               rpd.geometry_source,
               rpd.match_confidence::float8,
               rpd.match_status,
               ST_AsMVTGeom(
                 ST_Transform(
                   CASE
                     WHEN $1 < 8 THEN ST_SimplifyPreserveTopology(rpd.geometry, 0.01)
                     WHEN $1 < 10 THEN ST_SimplifyPreserveTopology(rpd.geometry, 0.003)
                     ELSE rpd.geometry
                   END,
                   3857
                 ),
                 bounds.geom
               ) AS geom
        FROM route_patterns rp
        JOIN route_pattern_display_geometries rpd ON rpd.snapshot_id = rp.snapshot_id AND rpd.route_pattern_id = rp.id
        JOIN routes r ON r.id = rp.route_id AND r.snapshot_id = rp.snapshot_id
        JOIN data_snapshots snap ON snap.id = rp.snapshot_id AND snap.is_active = true
        CROSS JOIN bounds
        WHERE rpd.geometry IS NOT NULL
          AND ST_Intersects(ST_Transform(rpd.geometry, 3857), bounds.geom)
          AND (cardinality($4::text[]) = 0 OR r.mode = ANY($4::text[]))
      )
      SELECT ST_AsMVT(mvtgeom, 'routes', 4096, 'geom') AS tile FROM mvtgeom
      `,
      z,
      x,
      y,
      modes,
    )
  }

  async railNetworkTile(z: number, x: number, y: number): Promise<Buffer | null> {
    return this.mvtTile(
      `
      WITH bounds AS (
        SELECT ST_TileEnvelope($1, $2, $3) AS geom
      ),
      mvtgeom AS (
        SELECT re.id::text,
               re.osm_id::text AS osm_id,
               re.railway,
               re.service,
               re.usage,
               re.is_service,
               ST_AsMVTGeom(
                 ST_Transform(
                   CASE
                     WHEN $1 < 10 THEN ST_SimplifyPreserveTopology(re.geom, 0.002)
                     ELSE re.geom
                   END,
                   3857
                 ),
                 bounds.geom
               ) AS geom
        FROM rail_edges re
        CROSS JOIN bounds
        WHERE re.is_active = true
          AND cardinality($4::text[]) = 0
          AND ST_Intersects(ST_Transform(re.geom, 3857), bounds.geom)
      )
      SELECT ST_AsMVT(mvtgeom, 'rail-network', 4096, 'geom') AS tile FROM mvtgeom
      `,
      z,
      x,
      y,
    )
  }

  private async mvtTile(
    sql: string,
    z: number,
    x: number,
    y: number,
    modes: string[] = [],
    ...extraParams: unknown[]
  ): Promise<Buffer | null> {
    const result = await this.pool.query<{ tile: Buffer | null }>(sql, [z, x, y, modes, ...extraParams])

    return result.rows[0]?.tile ?? null
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function placeName(value: unknown): string | null {
  return value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string'
    ? (value as { name: string }).name
    : null
}

function trackName(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const place = value as { track?: unknown; scheduledTrack?: unknown }
  return typeof place.track === 'string'
    ? place.track
    : typeof place.scheduledTrack === 'string'
      ? place.scheduledTrack
      : null
}

function sumLegDurations(legs: Array<Record<string, unknown>>, mode: string): number {
  return legs.reduce((sum, leg) => sum + (leg.mode === mode && typeof leg.duration === 'number' ? leg.duration : 0), 0)
}

function sumTransitDurations(legs: Array<Record<string, unknown>>): number {
  return legs.reduce((sum, leg) => sum + (leg.mode !== 'WALK' && typeof leg.duration === 'number' ? leg.duration : 0), 0)
}

function sumLegDistances(legs: Array<Record<string, unknown>>, mode: string): number {
  return legs.reduce((sum, leg) => sum + (leg.mode === mode && typeof leg.distance === 'number' ? leg.distance : 0), 0)
}

export async function runInTransaction<T>(client: Queryable, callback: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')

  try {
    const result = await callback()
    await client.query('COMMIT')

    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
