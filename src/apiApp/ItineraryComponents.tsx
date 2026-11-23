import { Route } from 'lucide-react'
import type { ApiDrivingRouteResponse, ApiItinerary, ApiItineraryResponse } from '../api/contracts'
import { berlinTimeLabel, compactMinutes, delayLabel, durationBetweenSeconds, kilometers, legLabel, timeLabel } from './formatters'

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
      {!loading && error ? (
        <div>
          <p className="api-inline-error">{error}</p>
          <a href="https://www.bahn.de/" target="_blank" rel="noreferrer">Verbindung bei bahn.de suchen ↗</a>
        </div>
      ) : null}
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
      {!loading && !error && response?.sourceAttribution && response.sourceAttributionUrl ? (
        <p className="api-transit-attribution">
          <a href={response.sourceAttributionUrl} target="_blank" rel="noreferrer">{response.sourceAttribution}</a>
          {' · '}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap-Mitwirkende</a>
        </p>
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
          {response.provider === 'google-routes' ? (
            <>
              <p>Abfahrt jetzt · aktuelle Verkehrslage</p>
              <p className="api-driving-attribution">
                <span className="google-maps-attribution" translate="no">Google Maps</span>
                {response.fetchedAt ? ` · Stand ${berlinTimeLabel(response.fetchedAt)}` : ''}
              </p>
            </>
          ) : <p>OSM-Schätzung ohne Live-Verkehr</p>}
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
        {itinerary.realtimeStatus ? <span>{
          itinerary.realtimeStatus === 'realtime' ? 'Echtzeitdaten' :
            itinerary.realtimeStatus === 'partial' ? 'Teilweise Echtzeitdaten' : 'Nur Fahrplandaten'
        }</span> : null}
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
                {leg.departureDelaySeconds != null ? ` · ${delayLabel(leg.departureDelaySeconds)}` : ''}
                {leg.realtime === false ? ' · nur Fahrplan' : ''}
                {leg.arrivalDelaySeconds != null && leg.arrivalDelaySeconds !== leg.departureDelaySeconds ? ` · Ankunft ${delayLabel(leg.arrivalDelaySeconds)}` : ''}
                {leg.platformTo ? ` · Ankunftsgleis ${leg.platformTo}` : ''}
                {leg.cancelled ? ' · fällt aus' : ''}
              </small>
              {leg.remarks?.length ? <em>{leg.remarks.join(' · ')}</em> : null}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}
