import { describe, expect, it } from 'vitest'
import {
  aggregateTravelTimeMetrics,
  calculateTotalDurationSeconds,
  nearestRank,
  P90_QUANTILE_METHOD,
} from '../travelTimeStatistics'

describe('travel time semantics', () => {
  it('measures total journey time from requested departure, not first vehicle departure', () => {
    const sample = {
      requestedDepartureSeconds: 8 * 3600,
      actualFirstDepartureSeconds: 8 * 3600 + 10 * 60,
      arrivalSeconds: 8 * 3600 + 40 * 60,
      initialWaitSeconds: 10 * 60,
      inVehicleSeconds: 30 * 60,
    }

    expect(calculateTotalDurationSeconds(sample)).toBe(40 * 60)
    expect(sample.actualFirstDepartureSeconds - sample.requestedDepartureSeconds).toBe(10 * 60)
    expect(sample.arrivalSeconds - sample.actualFirstDepartureSeconds).toBe(30 * 60)
  })

  it('calculates minimum, average, median and nearest-rank p90 on seconds', () => {
    const metrics = aggregateTravelTimeMetrics([30, 35, 40, 45, 50].map((minutes) => ({
      requestedDepartureSeconds: 0,
      actualFirstDepartureSeconds: 0,
      arrivalSeconds: minutes * 60,
    })))

    expect(metrics.fastestSeconds).toBe(30 * 60)
    expect(metrics.averageSeconds).toBe(40 * 60)
    expect(metrics.medianSeconds).toBe(40 * 60)
    expect(metrics.p90Seconds).toBe(50 * 60)
    expect(metrics.quantileMethod).toBe(P90_QUANTILE_METHOD)
  })

  it('calculates median for an even sample count', () => {
    const metrics = aggregateTravelTimeMetrics([30, 40, 50, 60].map((minutes) => ({
      requestedDepartureSeconds: 0,
      actualFirstDepartureSeconds: 0,
      arrivalSeconds: minutes * 60,
    })))

    expect(metrics.medianSeconds).toBe(45 * 60)
  })

  it('uses nearest-rank p90 for edge cases', () => {
    expect(nearestRank([60], 0.9)).toBe(60)
    expect(nearestRank([60, 120], 0.9)).toBe(120)
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9)
  })

  it('tracks unreachable samples and publication thresholds', () => {
    const metrics = aggregateTravelTimeMetrics([
      { requestedDepartureSeconds: 0, actualFirstDepartureSeconds: 0, arrivalSeconds: 30 },
      { requestedDepartureSeconds: 0, actualFirstDepartureSeconds: null, arrivalSeconds: null },
      { requestedDepartureSeconds: 0, actualFirstDepartureSeconds: null, arrivalSeconds: null },
    ])

    expect(metrics.totalSampleCount).toBe(3)
    expect(metrics.reachableSampleCount).toBe(1)
    expect(metrics.unreachableSampleCount).toBe(2)
    expect(metrics.reachabilityRatio).toBeCloseTo(1 / 3)
    expect(metrics.medianPublishable).toBe(false)
    expect(metrics.p90Publishable).toBe(false)
    expect(metrics.medianSeconds).toBeNull()
    expect(metrics.p90Seconds).toBeNull()
  })
})
