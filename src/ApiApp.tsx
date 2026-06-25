import { lazy, Suspense, useMemo, useState } from 'react'
import { Clock, Layers, Satellite, X, TrainFront } from 'lucide-react'
import { MetricCard, RealtimeItineraryBlock } from './apiApp/ItineraryComponents'
import {
  defaultDepartureTime,
  defaultProfile,
  estimatedResidentialRadiusKmPerMinute,
  modeLayerDefinitions,
  residentialRadiusOptions,
  travelTimeChipStyle,
  travelTimeWindows,
  type MapBaseLayer,
  type ModeLayerId,
  type TravelTimeWindow,
} from './apiApp/config'
import {
  directConnectionCount,
  earliestAlternativeDepartureMinutes,
  latestAlternativeDepartureMinutes,
  metricTooltip,
  minutes,
  minutesToClockTime,
  shiftClockTime,
  stopRouteLabel,
} from './apiApp/formatters'
import { useApiStartup, useMapUpdateStatus, useSelectedStopDetails } from './apiApp/hooks'
import { modesForLayers } from './apiApp/mapLayers'

const MapLibreCanvas = lazy(() =>
  import('./apiApp/MapLibreCanvas').then((module) => ({ default: module.MapLibreCanvas })),
)

function ApiApp() {
  const { snapshot, setStatus } = useApiStartup()
  const [selectedPublicId, setSelectedPublicId] = useState<string | null>(null)
  const [departureTime, setDepartureTime] = useState(defaultDepartureTime)
  const profile = defaultProfile
  const [activeModeLayers, setActiveModeLayers] = useState<ModeLayerId[]>(['regional', 's-bahn', 'u-bahn'])
  const [selectedTimeWindows, setSelectedTimeWindows] = useState<TravelTimeWindow[]>(travelTimeWindows)
  const [mapBaseLayer, setMapBaseLayer] = useState<MapBaseLayer>('street')
  const [showResidentialRegions, setShowResidentialRegions] = useState(false)
  const [residentialRadiusMinutes, setResidentialRadiusMinutes] = useState(15)
  const { mapUpdateState, handleMapTileLoadingChange } = useMapUpdateStatus()
  const { selectedStop, metrics, realtimeItineraries, clearDetails } = useSelectedStopDetails({
    selectedPublicId,
    departureTime,
    profile,
    setStatus,
  })

  const allowedModes = useMemo(() => modesForLayers(activeModeLayers, modeLayerDefinitions), [activeModeLayers])
  const tileModes = useMemo(() => (activeModeLayers.length === 0 ? ['__none__'] : allowedModes), [activeModeLayers.length, allowedModes])
  const residentialRadiusMeters = residentialRadiusMinutes * estimatedResidentialRadiusKmPerMinute * 1000

  const selectedRouteLabels = useMemo(
    () => Array.from(new Set(selectedStop?.servedRoutes.map(stopRouteLabel) ?? [])).slice(0, 12),
    [selectedStop],
  )

  function toggleModeLayer(id: ModeLayerId) {
    setActiveModeLayers((current) =>
      current.includes(id) ? current.filter((layer) => layer !== id) : [...current, id],
    )
  }

  function toggleTravelTimeWindow(window: TravelTimeWindow) {
    setSelectedTimeWindows((current) =>
      current.includes(window) ? current.filter((entry) => entry !== window) : [...current, window],
    )
  }

  function closeDetailPanel() {
    setSelectedPublicId(null)
    clearDetails()
  }

  function showEarlierRealtimeConnections() {
    const earliestDeparture = earliestAlternativeDepartureMinutes(realtimeItineraries.response)
    setDepartureTime(earliestDeparture === null ? shiftClockTime(departureTime, -30) : minutesToClockTime(earliestDeparture - 60))
  }

  function showLaterRealtimeConnections() {
    const latestDeparture = latestAlternativeDepartureMinutes(realtimeItineraries.response)
    setDepartureTime(latestDeparture === null ? shiftClockTime(departureTime, 30) : minutesToClockTime(latestDeparture + 1))
  }

  return (
    <main className={selectedStop ? 'api-shell detail-open' : 'api-shell'}>
      <aside className="api-sidebar" aria-label="API-Einstellungen">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <TrainFront size={22} />
          </div>
          <div>
            <h1>Regionfinder</h1>
            <p>API-Modus · MapLibre</p>
          </div>
        </div>

        <div className="control-group">
          <div className="label-like">
            <Layers size={16} />
            ÖPNV-Layer
          </div>
          <div className="layer-grid">
            {modeLayerDefinitions.map((definition) => (
              <label key={definition.id} className="layer-toggle">
                <input
                  type="checkbox"
                  checked={activeModeLayers.includes(definition.id)}
                  onChange={() => toggleModeLayer(definition.id)}
                />
                <span>{definition.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="control-group">
          <div className="label-like">
            <Clock size={16} />
            Reisezeitfenster
          </div>
          <div className="window-grid">
            {travelTimeWindows.map((window) => (
              <button
                key={window}
                type="button"
                className={selectedTimeWindows.includes(window) ? 'window-chip active' : 'window-chip'}
                style={travelTimeChipStyle(window)}
                onClick={() => toggleTravelTimeWindow(window)}
              >
                {window}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showResidentialRegions}
              onChange={(event) => setShowResidentialRegions(event.target.checked)}
            />
            Wohnregionen anzeigen
          </label>
          <div className="radius-buttons">
            {residentialRadiusOptions.map((minutesValue) => (
              <button
                key={minutesValue}
                type="button"
                className={residentialRadiusMinutes === minutesValue ? 'radius-button active' : 'radius-button'}
                onClick={() => setResidentialRadiusMinutes(minutesValue)}
              >
                {minutesValue} min
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="api-map-section" aria-label="Karte">
        <button
          type="button"
          className={`map-base-toggle ${mapBaseLayer === 'satellite' ? 'active' : ''}`}
          aria-pressed={mapBaseLayer === 'satellite'}
          title={mapBaseLayer === 'satellite' ? 'Karte anzeigen' : 'Satellitenbild anzeigen'}
          onClick={() => setMapBaseLayer((current) => (current === 'street' ? 'satellite' : 'street'))}
        >
          <Satellite size={17} />
          <span>{mapBaseLayer === 'satellite' ? 'Karte' : 'Satellit'}</span>
        </button>
        <Suspense fallback={<div className="maplibre-map-shell"><div className="maplibre-map" /></div>}>
          <MapLibreCanvas
            selectedStop={selectedStop}
            mapBaseLayer={mapBaseLayer}
            tileModes={tileModes}
            selectedTimeWindows={selectedTimeWindows}
            showResidentialRegions={showResidentialRegions}
            residentialRadiusMeters={residentialRadiusMeters}
            profile={profile}
            onSelect={setSelectedPublicId}
            onTileLoadingChange={handleMapTileLoadingChange}
          />
        </Suspense>
        <div className={`map-update-status ${mapUpdateState}`} role="status" aria-live="polite">
          {mapUpdateState === 'loading' ? 'Karte wird aktualisiert...' : 'Karte aktualisiert'}
        </div>
        <div className="api-legend">
          <span><i className="legend-stop-regional" /> Regional/Fern</span>
          <span><i className="legend-stop-urban" /> S/U/AKN</span>
          <span><i className="legend-stop-bus" /> Bus-only</span>
          <span><i className="legend-route-bus" /> Busroute</span>
        </div>
      </section>

      {selectedStop ? (
        <aside className="api-detail-panel" aria-label="StopPlace-Details">
          <div className="api-detail-header">
            <h2 className="api-detail-title">{selectedStop.name}</h2>
            <button type="button" className="api-detail-close" onClick={closeDetailPanel} aria-label="Detailpanel schließen">
              <X size={16} />
            </button>
          </div>

          <>
            <section className="api-panel-section">
              <h2>Fahrzeit nach Hamburg Hbf</h2>
              <div className="api-metric-grid">
                <MetricCard label="Schnellste Gesamtreisezeit" value={minutes(metrics?.fastestSeconds ?? null)} title={metricTooltip('fastest')} />
                <MetricCard
                  label="Direktverbindungen / Wochentag"
                  value={directConnectionCount(metrics)}
                  title="Fahrplanmäßige direkte Trips ohne Umstieg am repräsentativen Wochentag."
                />
              </div>
            </section>

            <section className="api-panel-section">
              <h2>DB Echtzeit</h2>
              <div className="api-realtime-controls">
                <label htmlFor="api-detail-departure">Startzeit</label>
                <div className="api-realtime-time-row">
                  <button type="button" className="api-time-step-button" onClick={showEarlierRealtimeConnections}>
                    Frühere
                  </button>
                  <input
                    id="api-detail-departure"
                    type="time"
                    value={departureTime}
                    onChange={(event) => setDepartureTime(event.target.value || defaultDepartureTime)}
                  />
                  <button type="button" className="api-time-step-button" onClick={showLaterRealtimeConnections}>
                    Spätere
                  </button>
                </div>
              </div>
              <RealtimeItineraryBlock
                response={realtimeItineraries.response}
                loading={realtimeItineraries.status === 'loading'}
                error={realtimeItineraries.error}
                maxAlternatives={3}
                emptyText="Keine DB-Echtzeitverbindung für diese Auswahl vorhanden."
              />
            </section>

            <section className="api-panel-section">
              <h2>Linien</h2>
              <div className="api-route-list">
                {selectedRouteLabels.map((label) => (
                  <span key={label}>
                    {label}
                  </span>
                ))}
              </div>
            </section>

            <details className="api-panel-section api-disclosure">
              <summary>Datenstand</summary>
              <div className="api-disclosure-content">
                {snapshot ? (
                  <>
                    <p>{snapshot.source.name} · {snapshot.publicId}</p>
                    <p>{snapshot.validFrom ?? '?'} bis {snapshot.validUntil ?? '?'}</p>
                    <p>{snapshot.source.attribution ?? 'Attribution aus Snapshot-Metadaten erforderlich'}</p>
                  </>
                ) : (
                  <p>Datenstand wird geladen</p>
                )}
              </div>
            </details>

            <details className="api-panel-section api-disclosure">
              <summary>StopPlace-Details</summary>
              <div className="api-disclosure-content">
                <p>{selectedStop.municipalityName ?? 'Gemeinde unbekannt'} · {selectedStop.stateCode ?? 'Bundesland unbekannt'}</p>
                <p>DHID: {selectedStop.dhid ?? 'fehlt'} · Qualität: {selectedStop.identityQuality}</p>
                <p>{selectedStop.modes.join(', ')}</p>
              </div>
            </details>
          </>
        </aside>
      ) : null}
    </main>
  )
}

export default ApiApp
