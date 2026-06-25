import type { ApiMetrics } from '../../../src/api/contracts'
import type { Queryable } from '../queryTypes'

export async function findStopMetrics(
  db: Queryable,
  publicId: string,
  profile: string,
  date?: string,
): Promise<ApiMetrics | null> {
  const result = await db.query<{
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
    ? await directConnectionCountForDate(
        db,
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
    averageInitialWaitSeconds: row.average_initial_wait_seconds === null ? null : Number(row.average_initial_wait_seconds),
    averageWalkSeconds: row.average_walk_seconds === null ? null : Number(row.average_walk_seconds),
    averageInVehicleSeconds: row.average_in_vehicle_seconds === null ? null : Number(row.average_in_vehicle_seconds),
    firstConnectionAt: row.first_connection_at,
    lastConnectionAt: row.last_connection_at,
    maxServiceGapSeconds: row.max_service_gap_seconds,
    quantileMethod: 'nearest-rank-p90',
  }
}

async function directConnectionCountForDate(
  db: Queryable,
  snapshotId: string,
  originStopPlaceId: string,
  destinationStopPlaceId: string,
  serviceDate: string,
): Promise<number> {
  const result = await db.query<{ direct_connection_count: number }>(
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
