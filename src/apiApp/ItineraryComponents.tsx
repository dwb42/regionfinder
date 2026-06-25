import { Route } from 'lucide-react'
import type { ApiDrivingRouteResponse, ApiItinerary, ApiItineraryResponse } from '../api/contracts'
import { compactMinutes, delayLabel, durationBetweenSeconds, kilometers, legLabel, timeLabel } from './formatters'

export function MetricCard({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}) {
  return (
    <div className="api-metric" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function RealtimeItineraryBlock({
  title,
  response,
  loading,
  error,
  maxAlternatives,
  emptyText,
}: {
  title?: string
  response: ApiItineraryResponse | null
  loading?: boolean
  error?: string | null
  maxAlternatives: number
  emptyText: string
}) {
  const alternatives = response?.alternatives.slice(0, maxAlternatives) ?? []

  return (
    <div className="api-itinerary-block">
      {title ? <h3>{title}</h3> : null}
      {loading ? (
        <p className="api-inline-status api-loading-status" aria-live="polite">
          <span>Verbindung wird geladen</span>
        </p>
      ) : null}
      {!loading && error ? <p className="api-inline-error">{error}</p> : null}
      {!loading && !error && alternatives.length === 0 ? <p>{emptyText}</p> : null}
      {!loading && !error && alternatives.length > 0 ? (
        <ol className="api-itinerary-alternatives">
          {alternatives.map((itinerary, index) => (
            <li key={`${itinerary.provider}-${itinerary.actualFirstDepartureAt ?? index}`}>
              <ItineraryAlternative itinerary={itinerary} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

export function DrivingRouteBlock({
  response,
  loading,
  error,
}: {
  response: ApiDrivingRouteResponse | null
  loading?: boolean
  error?: string | null
}) {
  return (
    <div className="api-driving-route">
      {loading ? (
        <p className="api-inline-status api-loading-status" aria-live="polite">
          <span>Autofahrzeit wird geladen</span>
        </p>
      ) : null}
      {!loading && error ? <p className="api-inline-error">{error}</p> : null}
      {!loading && !error && response ? (
        <>
          <div className="api-driving-route-summary">
            <span>
              <small>Fahrzeit</small>
              <strong>{compactMinutes(response.durationSeconds)}</strong>
            </span>
            <span>
              <small>Distanz</small>
              <strong>{kilometers(response.distanceMeters)}</strong>
            </span>
          </div>
          <p>OSM-Schätzung ohne Live-Verkehr</p>
        </>
      ) : null}
      {!loading && !error && !response ? <p>Keine Autofahrzeit für diese Station vorhanden.</p> : null}
    </div>
  )
}

function ItineraryAlternative({
  itinerary,
}: {
  itinerary: ApiItinerary
}) {
  const connectionDurationSeconds = durationBetweenSeconds(itinerary.actualFirstDepartureAt, itinerary.arrivalAt)

  return (
    <>
      <div className="api-itinerary-summary">
        <span>ab {timeLabel(itinerary.actualFirstDepartureAt)}</span>
        <span>an {timeLabel(itinerary.arrivalAt)}</span>
        <span>Dauer: {compactMinutes(connectionDurationSeconds)}</span>
      </div>
      <ol className="api-leg-list">
        {itinerary.legs.map((leg) => (
          <li key={leg.sequence} className={leg.cancelled ? 'cancelled' : undefined}>
            <Route size={14} />
            <span>
              <strong>{legLabel(leg)}</strong>
              {leg.fromName} → {leg.toName} · {compactMinutes(leg.durationSeconds)}
              <small>
                {timeLabel(leg.departureAt)}-{timeLabel(leg.arrivalAt)}
                {leg.platformFrom ? ` · Gleis ${leg.platformFrom}` : ''}
                {leg.departureDelaySeconds !== undefined ? ` · ${delayLabel(leg.departureDelaySeconds)}` : ''}
                {leg.cancelled ? ' · fällt aus' : ''}
              </small>
              {leg.remarks?.length ? <em>{leg.remarks.slice(0, 3).join(' · ')}</em> : null}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}
