export const P90_QUANTILE_METHOD = 'nearest-rank-p90'

export type TravelSample = {
  requestedDepartureSeconds: number
  actualFirstDepartureSeconds: number | null
  arrivalSeconds: number | null
  transferCount?: number | null
  direct?: boolean | null
  initialWaitSeconds?: number | null
  walkSeconds?: number | null
  inVehicleSeconds?: number | null
}

export type TravelTimeMetrics = {
  totalSampleCount: number
  reachableSampleCount: number
  unreachableSampleCount: number
  reachabilityRatio: number
  fastestSeconds: number | null
  averageSeconds: number | null
  medianSeconds: number | null
  p90Seconds: number | null
  p90Publishable: boolean
  medianPublishable: boolean
  minimumTransfers: number | null
  medianTransfers: number | null
  directConnectionRatio: number | null
  averageInitialWaitSeconds: number | null
  averageWalkSeconds: number | null
  averageInVehicleSeconds: number | null
  quantileMethod: typeof P90_QUANTILE_METHOD
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function nearestRank(values: number[], quantile: number): number | null {
  if (values.length === 0) {
    return null
  }

  if (quantile <= 0 || quantile > 1) {
    throw new Error(`Invalid nearest-rank quantile: ${quantile}`)
  }

  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil(quantile * sorted.length)

  return sorted[rank - 1]
}

export function calculateTotalDurationSeconds(sample: TravelSample): number | null {
  if (sample.arrivalSeconds === null) {
    return null
  }

  return sample.arrivalSeconds - sample.requestedDepartureSeconds
}

export function aggregateTravelTimeMetrics(samples: TravelSample[]): TravelTimeMetrics {
  const totalDurations = samples
    .map(calculateTotalDurationSeconds)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0)
  const reachableSamples = samples.filter((sample) => calculateTotalDurationSeconds(sample) !== null)
  const transferCounts = reachableSamples
    .map((sample) => sample.transferCount)
    .filter((value): value is number => typeof value === 'number')
  const directFlags = reachableSamples
    .map((sample) => sample.direct)
    .filter((value): value is boolean => typeof value === 'boolean')
  const initialWaits = reachableSamples
    .map((sample) => sample.initialWaitSeconds)
    .filter((value): value is number => typeof value === 'number')
  const walkTimes = reachableSamples
    .map((sample) => sample.walkSeconds)
    .filter((value): value is number => typeof value === 'number')
  const inVehicleTimes = reachableSamples
    .map((sample) => sample.inVehicleSeconds)
    .filter((value): value is number => typeof value === 'number')
  const reachableSampleCount = totalDurations.length
  const reachabilityRatio = samples.length === 0 ? 0 : reachableSampleCount / samples.length

  return {
    totalSampleCount: samples.length,
    reachableSampleCount,
    unreachableSampleCount: samples.length - reachableSampleCount,
    reachabilityRatio,
    fastestSeconds: totalDurations.length ? Math.min(...totalDurations) : null,
    averageSeconds: mean(totalDurations),
    medianSeconds: reachabilityRatio >= 0.5 ? median(totalDurations) : null,
    p90Seconds: reachabilityRatio >= 0.9 ? nearestRank(totalDurations, 0.9) : null,
    p90Publishable: reachabilityRatio >= 0.9,
    medianPublishable: reachabilityRatio >= 0.5,
    minimumTransfers: transferCounts.length ? Math.min(...transferCounts) : null,
    medianTransfers: median(transferCounts),
    directConnectionRatio:
      directFlags.length === 0 ? null : directFlags.filter((isDirect) => isDirect).length / directFlags.length,
    averageInitialWaitSeconds: mean(initialWaits),
    averageWalkSeconds: mean(walkTimes),
    averageInVehicleSeconds: mean(inVehicleTimes),
    quantileMethod: P90_QUANTILE_METHOD,
  }
}
