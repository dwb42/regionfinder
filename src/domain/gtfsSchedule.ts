export type GtfsCalendarRow = {
  service_id: string
  monday: 0 | 1
  tuesday: 0 | 1
  wednesday: 0 | 1
  thursday: 0 | 1
  friday: 0 | 1
  saturday: 0 | 1
  sunday: 0 | 1
  start_date: string
  end_date: string
}

export type GtfsCalendarDateRow = {
  service_id: string
  date: string
  exception_type: 1 | 2
}

export type ServiceDate = {
  serviceId: string
  serviceDate: string
  source: 'calendar' | 'calendar_dates'
  isActive: boolean
}

export type GtfsStopTimeForPattern = {
  stop_id: string
  pickup_type?: number | null
  drop_off_type?: number | null
}

export type GtfsTripForPattern = {
  route_id: string
  direction_id?: string | number | null
  shape_id?: string | null
  trip_headsign?: string | null
}

export type RoutePatternInput = {
  trip: GtfsTripForPattern
  stopTimes: GtfsStopTimeForPattern[]
}

export type RoutePatternKey = {
  patternHash: string
  orderedStopHash: string
  signature: string
}

export type ShapePoint = {
  shape_id: string
  shape_pt_lat: number
  shape_pt_lon: number
  shape_pt_sequence: number
  shape_dist_traveled?: number | null
}

export function parseGtfsTimeToSeconds(value: string): number {
  const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(value)

  if (!match) {
    throw new Error(`Invalid GTFS time: ${value}`)
  }

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

export function formatGtfsDate(value: string): string {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`Invalid GTFS date: ${value}`)
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function toGtfsDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function fromGtfsDate(value: string): Date {
  const formatted = formatGtfsDate(value)

  return new Date(`${formatted}T00:00:00.000Z`)
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)

  return next
}

function weekdayKey(date: Date): keyof Pick<
  GtfsCalendarRow,
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
> {
  const day = date.getUTCDay()

  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][day] as ReturnType<
    typeof weekdayKey
  >
}

export function materializeServiceDates(
  calendarRows: GtfsCalendarRow[],
  calendarDateRows: GtfsCalendarDateRow[] = [],
): ServiceDate[] {
  const activeByServiceDate = new Map<string, ServiceDate>()

  for (const row of calendarRows) {
    for (
      let current = fromGtfsDate(row.start_date), end = fromGtfsDate(row.end_date);
      current <= end;
      current = addDays(current, 1)
    ) {
      const serviceDate = toGtfsDate(current)
      const key = `${row.service_id}:${serviceDate}`

      if (row[weekdayKey(current)] === 1) {
        activeByServiceDate.set(key, {
          serviceId: row.service_id,
          serviceDate,
          source: 'calendar',
          isActive: true,
        })
      }
    }
  }

  for (const row of calendarDateRows) {
    const serviceDate = formatGtfsDate(row.date)
    const key = `${row.service_id}:${serviceDate}`

    if (row.exception_type === 1) {
      activeByServiceDate.set(key, {
        serviceId: row.service_id,
        serviceDate,
        source: 'calendar_dates',
        isActive: true,
      })
    } else {
      activeByServiceDate.set(key, {
        serviceId: row.service_id,
        serviceDate,
        source: 'calendar_dates',
        isActive: false,
      })
    }
  }

  return [...activeByServiceDate.values()].sort(
    (a, b) => a.serviceId.localeCompare(b.serviceId) || a.serviceDate.localeCompare(b.serviceDate),
  )
}

function stableHash(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9

  for (let index = 0; index < value.length; index += 1) {
    const char = value.charCodeAt(index)
    first ^= char
    first = Math.imul(first, 0x01000193)
    second ^= char + index
    second = Math.imul(second, 0x85ebca6b)
  }

  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

export function createRoutePatternKey(input: RoutePatternInput): RoutePatternKey {
  const orderedStopSignature = input.stopTimes
    .map((stopTime) => `${stopTime.stop_id}:${stopTime.pickup_type ?? ''}:${stopTime.drop_off_type ?? ''}`)
    .join('>')
  const signature = [
    input.trip.route_id,
    input.trip.direction_id ?? '',
    input.trip.shape_id ?? '',
    orderedStopSignature,
  ].join('|')

  return {
    patternHash: stableHash(signature),
    orderedStopHash: stableHash(orderedStopSignature),
    signature,
  }
}

export function sortShapePoints(points: ShapePoint[]): ShapePoint[] {
  return [...points].sort(
    (a, b) => a.shape_id.localeCompare(b.shape_id) || a.shape_pt_sequence - b.shape_pt_sequence,
  )
}

export function shapeDistanceMeters(points: ShapePoint[]): number | null {
  const sorted = sortShapePoints(points)
  const distances = sorted
    .map((point) => point.shape_dist_traveled)
    .filter((value): value is number => typeof value === 'number')

  if (distances.length >= 2) {
    const first = distances[0]
    const last = distances[distances.length - 1]

    return last >= first ? last - first : null
  }

  return null
}
