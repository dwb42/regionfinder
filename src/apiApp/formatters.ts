import type { ApiItineraryLeg, ApiItineraryResponse, ApiMetrics, ApiStopDetails, ApiStopSearchResult } from '../api/contracts'
import { ApiError } from '../data/api'
import { defaultDepartureTime, travelTimeWindows, type TravelTimeWindow } from './config'

export function filterMetricSeconds(metric: ApiMetrics | null | undefined): number | null {
  return metric?.medianSeconds ?? metric?.fastestSeconds ?? null
}

export function travelTimeBucket(seconds: number): TravelTimeWindow | null {
  const minutesValue = Math.ceil(seconds / 60)
  return travelTimeWindows.find((window) => minutesValue <= window) ?? null
}

export function minutes(value: number | null): string {
  if (value === null) {
    return 'nicht veröffentlichbar'
  }

  return `${Math.round(value / 60)} min`
}

export function compactMinutes(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : `${Math.round(value / 60)} min`
}

export function clockTimeToMinutes(value: string | null | undefined): number | null {
  const match = value?.match(/^(\d{2}):(\d{2})$/)

  if (!match) {
    return null
  }

  const hours = Number(match[1])
  const minutesValue = Number(match[2])

  if (!Number.isInteger(hours) || !Number.isInteger(minutesValue) || hours > 23 || minutesValue > 59) {
    return null
  }

  return hours * 60 + minutesValue
}

export function minutesToClockTime(value: number): string {
  const normalized = ((value % 1440) + 1440) % 1440
  const hours = Math.floor(normalized / 60)
  const minutesValue = normalized % 60

  return `${String(hours).padStart(2, '0')}:${String(minutesValue).padStart(2, '0')}`
}

export function shiftClockTime(value: string, deltaMinutes: number): string {
  return minutesToClockTime((clockTimeToMinutes(value) ?? clockTimeToMinutes(defaultDepartureTime) ?? 0) + deltaMinutes)
}

export function durationBetweenSeconds(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) {
    return null
  }

  const startMs = Date.parse(start)
  const endMs = Date.parse(end)

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null
  }

  return Math.round((endMs - startMs) / 1000)
}

export function timeLabel(value: string | null | undefined): string {
  return value ? value.slice(11, 16) : 'n/a'
}

export function earliestAlternativeDepartureMinutes(response: ApiItineraryResponse | null): number | null {
  const values = response?.alternatives
    .map((itinerary) => clockTimeToMinutes(timeLabel(itinerary.actualFirstDepartureAt)))
    .filter((value) => value !== null) ?? []

  return values.length === 0 ? null : Math.min(...values)
}

export function latestAlternativeDepartureMinutes(response: ApiItineraryResponse | null): number | null {
  const values = response?.alternatives
    .map((itinerary) => clockTimeToMinutes(timeLabel(itinerary.actualFirstDepartureAt)))
    .filter((value) => value !== null) ?? []

  return values.length === 0 ? null : Math.max(...values)
}

export function delayLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return 'n/a'
  }

  if (value === 0) {
    return 'pünktlich'
  }

  const rounded = Math.round(value / 60)
  return rounded > 0 ? `+${rounded} min` : `${rounded} min`
}

export function realtimeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.errorCode === 'db_stop_unmapped') {
      return 'Keine passende DB-Haltestelle für diese Station gefunden.'
    }

    if (error.errorCode === 'realtime_unavailable') {
      return 'DB-Echtzeit ist aktuell nicht verfügbar.'
    }

    if (error.status === 404) {
      return 'DB-Echtzeit-Endpunkt nicht erreichbar. Bitte den API-Prozess neu starten.'
    }
  }

  return error instanceof Error ? error.message : String(error)
}

export function directConnectionCount(metric: ApiMetrics | null): string {
  if (metric?.directConnectionCount === null || metric?.directConnectionCount === undefined) {
    return 'n/a'
  }

  return String(metric.directConnectionCount)
}

export function displayDate(): string {
  return '2026-07-07'
}

export function metricTooltip(label: string): string {
  const tooltips: Record<string, string> = {
    fastest: 'Schnellste Fahrzeit ist der beste planmäßige Fall über die untersuchten Abfahrtswünsche.',
    median: 'Typische Fahrzeit ist der Median gleichmäßig verteilter gewünschter Abfahrtszeitpunkte.',
    average: 'Durchschnitt ist das arithmetische Mittel aller erreichbaren untersuchten Abfahrtswünsche.',
    p90: 'P90 bedeutet: 90 Prozent der erreichbaren Abfahrtswünsche dauern planmäßig höchstens so lang. Keine Verspätungskennzahl.',
  }

  return tooltips[label] ?? ''
}

export function stopRouteLabel(route: ApiStopDetails['servedRoutes'][number]): string {
  return `${route.shortName ?? route.longName ?? route.routePatternId} · ${route.mode}`
}

export function legLabel(leg: ApiItineraryLeg): string {
  if (leg.legType === 'transit') {
    return [leg.routeName, leg.headsign ? `Richtung ${leg.headsign}` : null].filter(Boolean).join(' · ') || 'Transit'
  }

  return leg.legType
}

export function stopMatchesModes(stop: ApiStopSearchResult, allowedModes: string[]): boolean {
  return allowedModes.length > 0 && stop.modes.some((mode) => allowedModes.includes(mode))
}
