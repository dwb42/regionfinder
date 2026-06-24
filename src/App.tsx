import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import {
  Car,
  Clock,
  MapPin,
  Search,
  Satellite,
  SlidersHorizontal,
  TrainFront,
  TrainTrack,
  X,
} from 'lucide-react'
import { useHvvData } from './data/hvv'
import { useReachabilityWorker } from './data/reachabilityWorker'
import { findDefaultStartStopPlace, stopPlaceLabel } from './domain/stopPlaces'
import type { AutoRadiusOption, HvvLayerId, HvvRoute, ReachabilityResult, StopPlace, TimeWindow } from './domain/types'
import { distanceKm, roundDistance } from './utils/geo'
import { formatClockTime, formatDuration } from './utils/time'
import ApiApp from './ApiApp'
import './App.css'

type MapBaseLayer = 'street' | 'satellite'
type TravelTimeBucket = TimeWindow | 'over-90'

const timeWindows: TravelTimeBucket[] = [30, 45, 60, 75, 90, 'over-90']
const autoRadiusOptions: AutoRadiusOption[] = [10, 15, 20]
const estimatedCarRadiusKmPerMinute = 0.75
const defaultHvvLayers: HvvLayerId[] = ['regional', 's-bahn', 'u-bahn']
const overviewMapZoom = 9
const fixedDepartureMinutes = 8 * 60
const fallbackStationColor = '#64748b'

const mapBaseLayers: Record<MapBaseLayer, { attribution: string; url: string }> = {
  street: {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
  satellite: {
    attribution:
      'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
}

const satelliteLabelLayer = {
  attribution: 'Reference tiles &copy; Esri',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
}

const hvvLayerOptions: Array<{
  id: HvvLayerId
  label: string
  description: string
}> = [
  { id: 'regional', label: 'Regional/Fern', description: 'RE, RB, IC/ICE und sonstige Schiene' },
  { id: 's-bahn', label: 'S-Bahn/AKN', description: 'S-Bahn und AKN-nahe Linien' },
  { id: 'u-bahn', label: 'U-Bahn', description: 'HVV-U-Bahn-Linien' },
  { id: 'bus', label: 'Bus', description: 'Buslinien im importierten GTFS' },
  { id: 'faehre', label: 'Fähre', description: 'Fährlinien im importierten GTFS' },
]

const bucketColors: Record<TravelTimeBucket, string> = {
  30: '#0f766e',
  45: '#2563eb',
  60: '#7c3aed',
  75: '#c2410c',
  90: '#be123c',
  'over-90': '#475569',
}

function getWindowForTravelTime(minutes: number): TravelTimeBucket {
  return (timeWindows.find((window) => typeof window === 'number' && minutes <= window) ?? 'over-90') as TravelTimeBucket
}

function bucketLabel(bucket: TravelTimeBucket): string {
  return bucket === 'over-90' ? '> 90' : `≤ ${bucket}`
}

function bucketOrder(bucket: TravelTimeBucket): number {
  return bucket === 'over-90' ? 91 : bucket
}

function routePositions(route: HvvRoute): Array<[number, number]> {
  const geometry = route.geometry?.length ? route.geometry : []
  return geometry.map((point) => [point.lat, point.lon])
}

function modeLabel(stopPlace: StopPlace): string {
  return stopPlace.modes.join(', ')
}

function stopPlaceLayerIds(stopPlace: StopPlace): HvvLayerId[] {
  if (stopPlace.layerIds?.length) {
    return stopPlace.layerIds
  }

  return stopPlace.modes.map((mode) => {
    if (mode === 'U') {
      return 'u-bahn'
    }
    if (mode === 'S' || mode === 'AKN') {
      return 's-bahn'
    }
    if (mode === 'BUS' || mode === 'TRAM') {
      return 'bus'
    }
    if (mode === 'FERRY') {
      return 'faehre'
    }
    return 'regional'
  })
}

function primaryLayer(stopPlace: StopPlace): HvvLayerId {
  const layers = stopPlaceLayerIds(stopPlace)
  return layers.includes('regional')
    ? 'regional'
    : layers.includes('s-bahn')
      ? 's-bahn'
      : layers.includes('u-bahn')
        ? 'u-bahn'
        : layers[0] ?? 'regional'
}

function stopPlaceColor(stopPlace: StopPlace, result: ReachabilityResult | null, isStart: boolean): string {
  if (isStart) {
    return '#111827'
  }

  if (result) {
    const bucket = getWindowForTravelTime(result.travelTimeMinutes)
    if (bucket) {
      return bucketColors[bucket]
    }
  }

  const layer = primaryLayer(stopPlace)

  if (layer === 'u-bahn') {
    return '#2563eb'
  }
  if (layer === 'bus') {
    return '#c2410c'
  }
  if (layer === 'faehre') {
    return '#0891b2'
  }

  return fallbackStationColor
}

function connectionSummary(result: ReachabilityResult): string {
  return result.legs.map((leg) => leg.routeName).join(' / ')
}

function StartStopPlaceFocus({
  stopPlace,
}: {
  stopPlace: StopPlace | null
}) {
  const map = useMap()

  useEffect(() => {
    if (!stopPlace) {
      return
    }

    map.setView([stopPlace.coordinates.lat, stopPlace.coordinates.lon], overviewMapZoom)
  }, [map, stopPlace])

  return null
}

function ResetMapView({
  stopPlace,
  resetKey,
}: {
  stopPlace: StopPlace | null
  resetKey: number
}) {
  const map = useMap()

  useEffect(() => {
    if (!stopPlace || resetKey === 0) {
      return
    }

    map.setView([stopPlace.coordinates.lat, stopPlace.coordinates.lon], overviewMapZoom)
  }, [map, resetKey, stopPlace])

  return null
}

function ClearSelectionOnMapClick({ onClear }: { onClear: () => void }) {
  useMapEvents({
    click: onClear,
  })

  return null
}

function LegacyApp() {
  const hvvData = useHvvData()
  const [startStopPlaceId, setStartStopPlaceId] = useState<string | null>(null)
  const [stationInput, setStationInput] = useState<string | null>(null)
  const [selectedWindows, setSelectedWindows] = useState<TravelTimeBucket[]>(timeWindows)
  const [maxTransfers, setMaxTransfers] = useState(2)
  const [selectedStopPlaceId, setSelectedStopPlaceId] = useState<string | null>(null)
  const [showUnreachable, setShowUnreachable] = useState(true)
  const [showAutoRadius, setShowAutoRadius] = useState(false)
  const [autoRadiusMinutes, setAutoRadiusMinutes] = useState<AutoRadiusOption>(10)
  const [visibleHvvLayers, setVisibleHvvLayers] = useState<HvvLayerId[]>(defaultHvvLayers)
  const [showOpenRailwayMap, setShowOpenRailwayMap] = useState(false)
  const [mapBaseLayer, setMapBaseLayer] = useState<MapBaseLayer>('street')
  const [mapResetKey, setMapResetKey] = useState(0)

  const defaultStopPlace = useMemo(
    () => findDefaultStartStopPlace(hvvData.stopPlaces) ?? hvvData.stopPlaces[0] ?? null,
    [hvvData.stopPlaces],
  )
  const effectiveStartStopPlaceId = startStopPlaceId ?? defaultStopPlace?.id ?? null
  const reachability = useReachabilityWorker(effectiveStartStopPlaceId, fixedDepartureMinutes)
  const stopPlaceById = useMemo(
    () => new Map(hvvData.stopPlaces.map((stopPlace) => [stopPlace.id, stopPlace])),
    [hvvData.stopPlaces],
  )
  const startStopPlace = effectiveStartStopPlaceId ? stopPlaceById.get(effectiveStartStopPlaceId) ?? null : null
  const resultByStopPlaceId = useMemo(
    () => new Map(reachability.results.map((result) => [result.targetStopPlaceId, result])),
    [reachability.results],
  )
  const selectedStopPlace = selectedStopPlaceId ? stopPlaceById.get(selectedStopPlaceId) ?? null : null
  const selectedResult = selectedStopPlaceId ? resultByStopPlaceId.get(selectedStopPlaceId) ?? null : null
  const selectedWindowSet = useMemo(() => new Set(selectedWindows), [selectedWindows])
  const visibleHvvLayerSet = useMemo(() => new Set(visibleHvvLayers), [visibleHvvLayers])
  const activeMapBaseLayer = mapBaseLayers[mapBaseLayer]

  const stopIdsForSelectedStopPlace = useMemo(
    () => new Set(selectedStopPlace?.stopIds ?? []),
    [selectedStopPlace],
  )
  const selectedHvvRoutes = useMemo(
    () =>
      selectedStopPlace
        ? hvvData.routes
            .filter((route) => route.stopIds.some((stopId) => stopIdsForSelectedStopPlace.has(stopId)))
            .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))
        : [],
    [hvvData.routes, selectedStopPlace, stopIdsForSelectedStopPlace],
  )
  const selectedHvvRouteIds = useMemo(
    () => new Set(selectedHvvRoutes.map((route) => route.id)),
    [selectedHvvRoutes],
  )
  const selectedTravelRouteIds = useMemo(
    () => new Set((selectedResult?.legs ?? []).map((leg) => leg.routeId)),
    [selectedResult],
  )
  const selectedTravelHvvRoutes = useMemo(
    () =>
      hvvData.routes
        .filter((route) => selectedTravelRouteIds.has(route.id) && !selectedHvvRouteIds.has(route.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })),
    [hvvData.routes, selectedHvvRouteIds, selectedTravelRouteIds],
  )
  const visibleHvvRoutes = useMemo(
    () => hvvData.routes.filter((route) => visibleHvvLayerSet.has(route.layer)),
    [hvvData.routes, visibleHvvLayerSet],
  )
  const visibleStopPlaces = useMemo(
    () =>
      hvvData.stopPlaces.filter((stopPlace) => {
        const isStart = stopPlace.id === effectiveStartStopPlaceId
        const layers = stopPlaceLayerIds(stopPlace)
        const layerVisible = layers.some((layer) => visibleHvvLayerSet.has(layer))
        const result = resultByStopPlaceId.get(stopPlace.id)
        const bucket = result ? getWindowForTravelTime(result.travelTimeMinutes) : null
        const passesReachability =
          isStart ||
          (result ? bucket !== null && selectedWindowSet.has(bucket) && result.transfers <= maxTransfers : showUnreachable)

        return layerVisible && passesReachability
      }),
    [
      hvvData.stopPlaces,
      maxTransfers,
      resultByStopPlaceId,
      selectedWindowSet,
      showUnreachable,
      effectiveStartStopPlaceId,
      visibleHvvLayerSet,
    ],
  )
  const visibleReachableResults = useMemo(
    () =>
      visibleStopPlaces
        .map((stopPlace) => resultByStopPlaceId.get(stopPlace.id))
        .filter((result): result is ReachabilityResult => Boolean(result)),
    [resultByStopPlaceId, visibleStopPlaces],
  )
  const stopPlaceDistanceKm =
    startStopPlace && selectedStopPlace
      ? roundDistance(distanceKm(startStopPlace.coordinates, selectedStopPlace.coordinates))
      : null
  const autoRadiusMeters = autoRadiusMinutes * estimatedCarRadiusKmPerMinute * 1000

  function toggleWindow(window: TravelTimeBucket) {
    setSelectedWindows((current) => {
      if (current.includes(window)) {
        return current.length === 1 ? current : current.filter((item) => item !== window)
      }

      return [...current, window].sort((a, b) => bucketOrder(a) - bucketOrder(b))
    })
  }

  function toggleHvvLayer(layer: HvvLayerId) {
    setVisibleHvvLayers((current) => {
      if (current.includes(layer)) {
        return current.filter((item) => item !== layer)
      }

      return [...current, layer]
    })
  }

  function clearSelection(options: { resetMap?: boolean } = {}) {
    setSelectedStopPlaceId(null)

    if (options.resetMap) {
      setMapResetKey((current) => current + 1)
    }
  }

  function commitStationInput(value: string) {
    const normalized = value.trim().toLocaleLowerCase('de-DE')
    const stopPlace = hvvData.stopPlaces.find(
      (item) =>
        stopPlaceLabel(item).toLocaleLowerCase('de-DE') === normalized ||
        item.name.toLocaleLowerCase('de-DE') === normalized,
    )

    if (!stopPlace) {
      return
    }

    setStartStopPlaceId(stopPlace.id)
    setStationInput(stopPlaceLabel(stopPlace))
    setSelectedStopPlaceId(null)
  }

  function displayStopPlaceName(stopPlaceId: string): string {
    return stopPlaceById.get(stopPlaceId)?.name ?? stopPlaceId
  }

  return (
    <main className="app-shell">
      <section className="workspace" aria-label="Bahn-Erreichbarkeit">
        <aside className="control-panel" aria-label="Einstellungen">
          <div className="brand-row">
            <div className="brand-mark" aria-hidden="true">
              <TrainFront size={22} />
            </div>
            <div>
              <h1>Regionfinder Bahn</h1>
              <p>Hamburg und Umland</p>
            </div>
          </div>

          <div className="control-group">
            <label htmlFor="station-search">
              <Search size={16} />
              Startstation
            </label>
            <input
              id="station-search"
              list="station-options"
              value={stationInput ?? (startStopPlace ? stopPlaceLabel(startStopPlace) : '')}
              onBlur={(event) => commitStationInput(event.target.value)}
              onChange={(event) => setStationInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitStationInput(event.currentTarget.value)
                }
              }}
            />
            <datalist id="station-options">
              {hvvData.stopPlaces.map((stopPlace) => (
                <option key={stopPlace.id} value={stopPlaceLabel(stopPlace)} />
              ))}
            </datalist>
            <div className="station-meta">
              {startStopPlace
                ? `${startStopPlace.city ?? startStopPlace.name} · ${startStopPlace.coordinates.lat.toFixed(4)}, ${startStopPlace.coordinates.lon.toFixed(4)}`
                : 'StopPlaces werden geladen'}
            </div>
          </div>

          <div className="control-row">
            <div className="control-group compact">
              <div className="label-like">
                <Clock size={16} />
                Abfahrt
              </div>
              <div className="fixed-time">Ab {formatClockTime(fixedDepartureMinutes)}</div>
            </div>
            <div className="control-group compact">
              <label htmlFor="transfer-filter">
                <SlidersHorizontal size={16} />
                Umstiege
              </label>
              <select
                id="transfer-filter"
                value={maxTransfers}
                onChange={(event) => setMaxTransfers(Number(event.target.value))}
              >
                <option value={0}>0 max.</option>
                <option value={1}>1 max.</option>
                <option value={2}>2 max.</option>
              </select>
            </div>
          </div>

          <div className="control-group">
            <div className="label-like">
              <TrainTrack size={16} />
              HVV-/ÖPNV-Layer
            </div>
            <div className="layer-grid" role="group" aria-label="HVV-Layer">
              {hvvLayerOptions.map((layer) => (
                <label key={layer.id} className="layer-toggle" title={layer.description}>
                  <input
                    type="checkbox"
                    checked={visibleHvvLayers.includes(layer.id)}
                    onChange={() => toggleHvvLayer(layer.id)}
                  />
                  <span>{layer.label}</span>
                </label>
              ))}
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={showUnreachable}
                onChange={(event) => setShowUnreachable(event.target.checked)}
              />
              <span>Unerreichbare anzeigen</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={showOpenRailwayMap}
                onChange={(event) => setShowOpenRailwayMap(event.target.checked)}
              />
              <span>Bahninfrastruktur</span>
            </label>
            <div className="station-meta">
              {hvvData.status === 'ready'
                ? `${hvvData.routes.length} HVV-Linien · ${hvvData.stopPlaces.length} StopPlaces · ${reachability.status}`
                : hvvData.status === 'missing'
                  ? 'Noch kein HVV-Import vorhanden'
                  : hvvData.status === 'error'
                    ? `HVV-Import nicht lesbar: ${hvvData.error}`
                    : 'HVV-Daten werden geprüft'}
            </div>
          </div>

          <div className="control-group">
            <div className="label-like">
              <TrainTrack size={16} />
              Reisezeitfenster
            </div>
            <div className="window-grid" role="group" aria-label="Reisezeitfenster">
              {timeWindows.map((window) => (
                <button
                  key={window}
                  type="button"
                  className={selectedWindows.includes(window) ? 'window-chip active' : 'window-chip'}
                  style={{ '--chip-color': bucketColors[window] } as CSSProperties}
                  onClick={() => toggleWindow(window)}
                >
                  {bucketLabel(window)}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <div className="label-like">
              <Car size={16} />
              Wohnregion-Radius
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={showAutoRadius}
                onChange={(event) => setShowAutoRadius(event.target.checked)}
              />
              <span>Wohnregionen anzeigen</span>
            </label>
            <div className="radius-buttons" aria-label="Wohnregion-Radius">
              {autoRadiusOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === autoRadiusMinutes ? 'radius-button active' : 'radius-button'}
                  onClick={() => setAutoRadiusMinutes(option)}
                >
                  {option} min
                </button>
              ))}
            </div>
          </div>

          <div className="summary-strip">
            <div>
              <strong>{visibleStopPlaces.length}</strong>
              <span>StopPlaces sichtbar</span>
            </div>
            <div>
              <strong>{reachability.results.length}</strong>
              <span>erreichbar</span>
            </div>
          </div>
        </aside>

        <section className="map-section" aria-label="Karte">
          <button
            className={`map-base-toggle ${mapBaseLayer === 'satellite' ? 'active' : ''}`}
            type="button"
            aria-pressed={mapBaseLayer === 'satellite'}
            onClick={() => setMapBaseLayer((current) => (current === 'street' ? 'satellite' : 'street'))}
            title={mapBaseLayer === 'satellite' ? 'Karte anzeigen' : 'Satellitenbild anzeigen'}
          >
            <Satellite size={17} />
            <span>{mapBaseLayer === 'satellite' ? 'Karte' : 'Satellit'}</span>
          </button>
          {startStopPlace ? (
            <MapContainer
              center={[startStopPlace.coordinates.lat, startStopPlace.coordinates.lon]}
              zoom={overviewMapZoom}
              scrollWheelZoom
              className="reachability-map"
            >
              <StartStopPlaceFocus stopPlace={startStopPlace} />
              <ResetMapView stopPlace={startStopPlace} resetKey={mapResetKey} />
              <ClearSelectionOnMapClick onClear={() => clearSelection()} />
              <TileLayer
                key={mapBaseLayer}
                attribution={activeMapBaseLayer.attribution}
                url={activeMapBaseLayer.url}
              />
              {mapBaseLayer === 'satellite' ? (
                <TileLayer
                  attribution={satelliteLabelLayer.attribution}
                  url={satelliteLabelLayer.url}
                />
              ) : null}
              {showOpenRailwayMap ? (
                <TileLayer
                  attribution='Data <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>, Style: <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA 2.0</a> <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>'
                  opacity={0.68}
                  url="https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"
                />
              ) : null}

              {showAutoRadius
                ? visibleReachableResults.map((result) => {
                    const stopPlace = stopPlaceById.get(result.targetStopPlaceId)
                    const isSelected = result.targetStopPlaceId === selectedStopPlaceId

                    return stopPlace ? (
                      <Circle
                        key={`residential-radius-${stopPlace.id}`}
                        center={[stopPlace.coordinates.lat, stopPlace.coordinates.lon]}
                        interactive={false}
                        radius={autoRadiusMeters}
                        pathOptions={{
                          className: 'residential-radius',
                          color: isSelected ? '#e11d48' : '#f59e0b',
                          fillColor: isSelected ? '#fb7185' : '#fbbf24',
                          fillOpacity: isSelected ? 0.18 : 0.13,
                          dashArray: '8 7',
                          opacity: isSelected ? 0.95 : 0.82,
                          weight: isSelected ? 3 : 2,
                        }}
                      />
                    ) : null
                  })
                : null}

              {visibleHvvRoutes.map((route) => {
                const positions = routePositions(route)

                if (positions.length < 2) {
                  return null
                }

                return (
                  <Polyline
                    key={route.id}
                    pathOptions={{
                      color: route.color,
                      weight: route.layer === 'bus' ? 2 : 3,
                      opacity: route.layer === 'bus' ? 0.28 : 0.5,
                    }}
                    positions={positions}
                  >
                    <Tooltip sticky>
                      {route.name} · {route.layer}
                    </Tooltip>
                  </Polyline>
                )
              })}

              {selectedHvvRoutes.map((route) => {
                const positions = routePositions(route)

                if (positions.length < 2) {
                  return null
                }

                return (
                  <Polyline
                    key={`selected-${route.id}`}
                    pathOptions={{
                      color: route.color,
                      weight: route.layer === 'bus' ? 5 : 7,
                      opacity: 0.86,
                    }}
                    positions={positions}
                  >
                    <Tooltip sticky>{route.name}</Tooltip>
                  </Polyline>
                )
              })}

              {selectedTravelHvvRoutes.map((route) => {
                const positions = routePositions(route)

                if (positions.length < 2) {
                  return null
                }

                return (
                  <Polyline
                    key={`travel-${route.id}`}
                    pathOptions={{
                      color: route.color,
                      dashArray: '10 6',
                      weight: route.layer === 'bus' ? 5 : 7,
                      opacity: 0.92,
                    }}
                    positions={positions}
                  >
                    <Tooltip sticky>{route.name} · berechnete Verbindung</Tooltip>
                  </Polyline>
                )
              })}

              {visibleStopPlaces.map((stopPlace) => {
                const result = resultByStopPlaceId.get(stopPlace.id) ?? null
                const isStart = stopPlace.id === effectiveStartStopPlaceId
                const isSelected = stopPlace.id === selectedStopPlaceId
                const color = stopPlaceColor(stopPlace, result, isStart)
                const reachable = Boolean(result)

                return (
                  <CircleMarker
                    key={stopPlace.id}
                    center={[stopPlace.coordinates.lat, stopPlace.coordinates.lon]}
                    radius={isSelected ? 9 : isStart ? 8 : reachable ? 6 : 4}
                    pathOptions={{
                      color,
                      fillColor: color,
                      fillOpacity: isSelected || isStart || reachable ? 0.9 : 0.28,
                      opacity: isSelected || isStart || reachable ? 1 : 0.38,
                      weight: isSelected ? 4 : isStart ? 3 : 1.8,
                    }}
                    eventHandlers={{
                      click: (event) => {
                        event.originalEvent.stopPropagation()
                        setSelectedStopPlaceId((current) => (current === stopPlace.id ? null : stopPlace.id))
                      },
                    }}
                  >
                    <Tooltip>
                      {stopPlace.name}
                      {result ? ` · ${formatDuration(result.travelTimeMinutes)}` : ''}
                    </Tooltip>
                  </CircleMarker>
                )
              })}
            </MapContainer>
          ) : (
            <div className="map-loading">StopPlaces werden geladen.</div>
          )}
        </section>

        <aside className="results-panel" aria-label="Ergebnisse">
          <div className="panel-header">
            <div>
              <h2>Details</h2>
              <p>
                {formatClockTime(fixedDepartureMinutes)} ab {startStopPlace?.name ?? 'Startstation'}
              </p>
            </div>
          </div>

          {selectedStopPlace ? (
            <section className="detail-box" aria-label="StopPlace-Details">
              <div className="detail-header">
                <div className="detail-title">
                  <MapPin size={18} />
                  <div>
                    <h3>{selectedStopPlace.name}</h3>
                    <p>
                      {selectedStopPlace.region ?? selectedStopPlace.city ?? 'HVV'} · {modeLabel(selectedStopPlace)}
                    </p>
                  </div>
                </div>
                <button
                  className="detail-close"
                  type="button"
                  aria-label="Auswahl aufheben"
                  title="Auswahl aufheben"
                  onClick={() => clearSelection({ resetMap: true })}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="detail-metrics">
                {selectedResult ? (
                  <>
                    <span>{formatDuration(selectedResult.travelTimeMinutes)}</span>
                    <span>{selectedResult.connectionType === 'direct' ? 'Direkt' : `${selectedResult.transfers} Umstieg(e)`}</span>
                    <span>{stopPlaceDistanceKm} km Luftlinie</span>
                  </>
                ) : selectedStopPlace.id === effectiveStartStopPlaceId ? (
                  <>
                    <span>Start</span>
                    <span>{formatClockTime(fixedDepartureMinutes)}</span>
                    <span>0 km</span>
                  </>
                ) : (
                  <>
                    <span>Nicht erreichbar</span>
                    <span>{modeLabel(selectedStopPlace)}</span>
                    <span>{stopPlaceDistanceKm} km Luftlinie</span>
                  </>
                )}
              </div>

              {selectedResult ? (
                <>
                  <div className="detail-metrics secondary">
                    <span>Ab {formatClockTime(selectedResult.departureMinutes)}</span>
                    <span>An {formatClockTime(selectedResult.arrivalMinutes)}</span>
                    <span>{connectionSummary(selectedResult)}</span>
                  </div>
                  <ol className="leg-list">
                    {selectedResult.legs.map((leg) => (
                      <li key={`${leg.routeId}-${leg.toStationId}-${leg.arrivalMinutes}`}>
                        <span className="route-pill" style={{ '--route-color': leg.color } as CSSProperties}>
                          {leg.routeName}
                        </span>
                        <span>
                          {displayStopPlaceName(leg.fromStationId)} {formatClockTime(leg.departureMinutes)} →{' '}
                          {displayStopPlaceName(leg.toStationId)} {formatClockTime(leg.arrivalMinutes)}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="detail-metrics secondary">
                    <span>{selectedResult.weekdayConnectionCount} werktags</span>
                    <span>{selectedResult.weekendConnectionCount} Wochenende</span>
                    <span>{selectedStopPlace.stopIds.length} GTFS-Stops</span>
                  </div>
                </>
              ) : null}

              {selectedHvvRoutes.length > 0 ? (
                <div className="hvv-route-list" aria-label="Linien an diesem StopPlace">
                  {selectedHvvRoutes.slice(0, 12).map((route) => (
                    <span
                      key={route.id}
                      className="route-pill"
                      style={
                        {
                          '--route-color': route.color,
                          color: route.textColor ?? '#fff',
                        } as CSSProperties
                      }
                    >
                      {route.name}
                    </span>
                  ))}
                  {selectedHvvRoutes.length > 12 ? <span className="route-more">+{selectedHvvRoutes.length - 12}</span> : null}
                </div>
              ) : null}

              <p className="detail-note">
                StopPlace enthält {selectedStopPlace.stopIds.length} GTFS-Stop-ID(s).
              </p>
            </section>
          ) : (
            <div className="empty-state">StopPlace auf der Karte auswählen.</div>
          )}
        </aside>
      </section>
    </main>
  )
}

function App() {
  return import.meta.env.VITE_REGIONFINDER_DATA_MODE === 'api' ? <ApiApp /> : <LegacyApp />
}

export default App
