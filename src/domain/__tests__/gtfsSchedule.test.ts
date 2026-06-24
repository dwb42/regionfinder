import { describe, expect, it } from 'vitest'
import {
  createRoutePatternKey,
  materializeServiceDates,
  parseGtfsTimeToSeconds,
  shapeDistanceMeters,
  sortShapePoints,
} from '../gtfsSchedule'

describe('GTFS schedule utilities', () => {
  it('parses GTFS times beyond midnight', () => {
    expect(parseGtfsTimeToSeconds('25:15:00')).toBe(90_900)
  })

  it('materializes service dates including additions and removals', () => {
    const dates = materializeServiceDates(
      [
        {
          service_id: 'weekday',
          monday: 1,
          tuesday: 1,
          wednesday: 1,
          thursday: 1,
          friday: 1,
          saturday: 0,
          sunday: 0,
          start_date: '20260706',
          end_date: '20260712',
        },
      ],
      [
        { service_id: 'weekday', date: '20260711', exception_type: 1 },
        { service_id: 'weekday', date: '20260707', exception_type: 2 },
      ],
    )

    expect(dates).toContainEqual({
      serviceId: 'weekday',
      serviceDate: '2026-07-11',
      source: 'calendar_dates',
      isActive: true,
    })
    expect(dates).toContainEqual({
      serviceId: 'weekday',
      serviceDate: '2026-07-07',
      source: 'calendar_dates',
      isActive: false,
    })
  })

  it('separates route patterns by direction, stop sequence and shape', () => {
    const base = createRoutePatternKey({
      trip: { route_id: 'R1', direction_id: 0, shape_id: 'shape-a' },
      stopTimes: [{ stop_id: 'A' }, { stop_id: 'B' }, { stop_id: 'C' }],
    })
    const reverse = createRoutePatternKey({
      trip: { route_id: 'R1', direction_id: 1, shape_id: 'shape-b' },
      stopTimes: [{ stop_id: 'C' }, { stop_id: 'B' }, { stop_id: 'A' }],
    })
    const shortRunner = createRoutePatternKey({
      trip: { route_id: 'R1', direction_id: 0, shape_id: 'shape-a' },
      stopTimes: [{ stop_id: 'A' }, { stop_id: 'B' }],
    })

    expect(base.patternHash).not.toBe(reverse.patternHash)
    expect(base.patternHash).not.toBe(shortRunner.patternHash)
  })

  it('sorts shapes and reads shape_dist_traveled without rounding', () => {
    const points = sortShapePoints([
      { shape_id: 's', shape_pt_lat: 53.2, shape_pt_lon: 10.2, shape_pt_sequence: 2, shape_dist_traveled: 1250.5 },
      { shape_id: 's', shape_pt_lat: 53.1, shape_pt_lon: 10.1, shape_pt_sequence: 1, shape_dist_traveled: 10.5 },
    ])

    expect(points.map((point) => point.shape_pt_sequence)).toEqual([1, 2])
    expect(shapeDistanceMeters(points)).toBe(1240)
  })
})
