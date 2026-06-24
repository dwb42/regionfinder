import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import maplibregl, { type ExpressionSpecification, type Map, type StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection, Polygon } from 'geojson'
import {
  Clock,
  Info,
  Layers,
  MapPin,
  Route,
  Satellite,
  Search,
  SlidersHorizontal,
  TrainFront,
} from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import type {
  ApiItineraryResponse,
  ApiMetrics,
  ApiSnapshot,
  ApiStopDetails,
  ApiStopSearchResult,
} from './api/contracts'
import {
  apiBaseUrl,
  fetchCurrentSnapshot,
  fetchItineraries,
  fetchStopDetails,
  fetchStopMetrics,
  searchStops,
} from './data/api'

const defaultProfile = import.meta.env.VITE_REGIONFINDER_ROUTING_PROFILE || 'regular_tue_thu'
const initialSearchQuery = 'Hamburg'

type ModeLayerId = 'regional' | 's-bahn' | 'u-bahn' | 'bus' | 'ferry'
type MapBaseLayer = 'street' | 'satellite'
type TravelTimeWindow = 30 | 45 | 60 | 75 | 90

const mapLibreBaseStyle: StyleSpecification = {
  version: 8,
  sources: {
    'street-base': {
      type: 'raster',
      tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
    'satellite-base': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
    'satellite-labels': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Reference tiles &copy; Esri',
    },
  },
  layers: [
    {
      id: 'street-base',
      type: 'raster',
      source: 'street-base',
    },
    {
      id: 'satellite-base',
      type: 'raster',
      source: 'satellite-base',
      layout: { visibility: 'none' },
    },
    {
      id: 'satellite-labels',
      type: 'raster',
      source: 'satellite-labels',
      layout: { visibility: 'none' },
    },
  ],
}

const modeLayerDefinitions: Array<{
  id: ModeLayerId
  label: string
  modes: string[]
}> = [
  { id: 'regional', label: 'Regional/Fern', modes: ['ICE', 'IC', 'EC', 'RE', 'RB', 'RAIL'] },
  { id: 's-bahn', label: 'S-Bahn/AKN', modes: ['S', 'AKN'] },
  { id: 'u-bahn', label: 'U-Bahn', modes: ['U'] },
  { id: 'bus', label: 'Bus', modes: ['BUS', 'TRAM'] },
  { id: 'ferry', label: 'Fähre', modes: ['FERRY'] },
]

const travelTimeWindows: TravelTimeWindow[] = [30, 45, 60, 75, 90]
const residentialRadiusOptions = [10, 15, 20]

const routeColorExpression: ExpressionSpecification = [
  'case',
  ['==', ['get', 'geometry_quality'], 'stop_sequence_approximation'],
  '#c2410c',
  ['has', 'route_color'],
  ['get', 'route_color'],
  [
    'match',
    ['get', 'mode'],
    'ICE',
    '#dc2626',
    'IC',
    '#dc2626',
    'EC',
    '#dc2626',
    'RE',
    '#2563eb',
    'RB',
    '#1d4ed8',
    'RAIL',
    '#2563eb',
    'S',
    '#16a34a',
    'AKN',
    '#65a30d',
    'U',
    '#0ea5e9',
    'BUS',
    '#c2410c',
    'TRAM',
    '#9333ea',
    'FERRY',
    '#0891b2',
    '#64748b',
  ],
]

function modesForLayers(activeLayers: ModeLayerId[]): string[] {
  return Array.from(
    new Set(
      modeLayerDefinitions
        .filter((definition) => activeLayers.includes(definition.id))
        .flatMap((definition) => definition.modes),
    ),
  )
}

function stopMatchesModes(stop: ApiStopSearchResult, allowedModes: string[]): boolean {
  return allowedModes.length > 0 && stop.modes.some((mode) => allowedModes.includes(mode))
}

function tileUrl(path: 'stops' | 'routes', modes: string[]): string {
  const suffix = modes.length > 0 ? `?modes=${encodeURIComponent(modes.join(','))}` : ''

  return `${apiBaseUrl}/api/v1/tiles/${path}/{z}/{x}/{y}.mvt${suffix}`
}

function addTransitTileLayers(map: Map, modes: string[]) {
  map.addSource('regionfinder-routes', {
    type: 'vector',
    tiles: [tileUrl('routes', modes)],
    minzoom: 0,
    maxzoom: 14,
  })
  map.addLayer({
    id: 'regionfinder-routes-line',
    type: 'line',
    source: 'regionfinder-routes',
    'source-layer': 'routes',
    paint: {
      'line-color': routeColorExpression,
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 3],
      'line-opacity': ['case', ['==', ['get', 'geometry_quality'], 'stop_sequence_approximation'], 0.38, 0.78],
      'line-dasharray': ['case', ['==', ['get', 'geometry_quality'], 'stop_sequence_approximation'], ['literal', [2, 2]], ['literal', [1, 0]]],
    },
  })
  map.addSource('regionfinder-stops', {
    type: 'vector',
    tiles: [tileUrl('stops', modes)],
    minzoom: 0,
    maxzoom: 14,
  })
  map.addLayer({
    id: 'regionfinder-stops-symbol',
    type: 'circle',
    source: 'regionfinder-stops',
    'source-layer': 'stops',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 7],
      'circle-color': '#0f766e',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    },
  })
}

function removeTransitTileLayers(map: Map) {
  for (const layerId of ['regionfinder-stops-symbol', 'regionfinder-routes-line']) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId)
    }
  }

  for (const sourceId of ['regionfinder-stops', 'regionfinder-routes']) {
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId)
    }
  }
}

function filterMetricSeconds(metric: ApiMetrics | null | undefined): number | null {
  return metric?.medianSeconds ?? metric?.fastestSeconds ?? null
}

function travelTimeBucket(seconds: number): TravelTimeWindow | null {
  const minutesValue = Math.ceil(seconds / 60)
  return travelTimeWindows.find((window) => minutesValue <= window) ?? null
}

function circlePolygon(lon: number, lat: number, radiusMeters: number): Polygon {
  const points: number[][] = []
  const earthRadiusMeters = 6_371_000
  const angularDistance = radiusMeters / earthRadiusMeters
  const latRad = (lat * Math.PI) / 180
  const lonRad = (lon * Math.PI) / 180

  for (let step = 0; step <= 64; step += 1) {
    const bearing = (step / 64) * 2 * Math.PI
    const pointLat = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
    )
    const pointLon =
      lonRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(pointLat),
      )

    points.push([(pointLon * 180) / Math.PI, (pointLat * 180) / Math.PI])
  }

  return {
    type: 'Polygon',
    coordinates: [points],
  }
}

function minutes(value: number | null): string {
  if (value === null) {
    return 'nicht veröffentlichbar'
  }

  return `${Math.round(value / 60)} min`
}

function percent(value: number | null): string {
  if (value === null) {
    return 'n/a'
  }

  return `${Math.round(value * 100)} %`
}

function displayDate(): string {
  return '2026-07-07'
}

function metricTooltip(label: string): string {
  const tooltips: Record<string, string> = {
    fastest: 'Schnellste Fahrzeit ist der beste planmäßige Fall über die untersuchten Abfahrtswünsche.',
    median: 'Typische Fahrzeit ist der Median gleichmäßig verteilter gewünschter Abfahrtszeitpunkte.',
    average: 'Durchschnitt ist das arithmetische Mittel aller erreichbaren untersuchten Abfahrtswünsche.',
    p90: 'P90 bedeutet: 90 Prozent der erreichbaren Abfahrtswünsche dauern planmäßig höchstens so lang. Keine Verspätungskennzahl.',
  }

  return tooltips[label] ?? ''
}

function MetricCard({
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

function MapLibreCanvas({
  selectedStop,
  visibleStops,
  mapBaseLayer,
  tileModes,
  showRoutePatterns,
  showApproximateRoutes,
  showResidentialRegions,
  residentialRadiusMeters,
  onSelect,
}: {
  selectedStop: ApiStopDetails | null
  visibleStops: ApiStopSearchResult[]
  mapBaseLayer: MapBaseLayer
  tileModes: string[]
  showRoutePatterns: boolean
  showApproximateRoutes: boolean
  showResidentialRegions: boolean
  residentialRadiusMeters: number
  onSelect: (publicId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const initialTileModesRef = useRef(tileModes)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapLibreBaseStyle,
      center: [10.006909, 53.552733],
      zoom: 8.4,
      attributionControl: {},
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => {
      addTransitTileLayers(map, initialTileModesRef.current)
      map.on('click', 'regionfinder-stops-symbol', (event) => {
        const publicId = event.features?.[0]?.properties?.public_id

        if (typeof publicId === 'string' && publicId.length > 0) {
          onSelect(publicId)
        }
      })
      map.on('mouseenter', 'regionfinder-stops-symbol', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'regionfinder-stops-symbol', () => {
        map.getCanvas().style.cursor = ''
      })
      map.addSource('regionfinder-residential-radius', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'regionfinder-residential-radius-fill',
        type: 'fill',
        source: 'regionfinder-residential-radius',
        paint: {
          'fill-color': '#0f766e',
          'fill-opacity': 0.11,
        },
      })
      map.addLayer({
        id: 'regionfinder-residential-radius-line',
        type: 'line',
        source: 'regionfinder-residential-radius',
        paint: {
          'line-color': '#0f766e',
          'line-width': 1.5,
          'line-dasharray': [2, 2],
        },
      })
      setMapReady(true)
    })
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [onSelect])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map) {
      return
    }

    removeTransitTileLayers(map)
    addTransitTileLayers(map, tileModes)
    map.setLayoutProperty('regionfinder-routes-line', 'visibility', showRoutePatterns ? 'visible' : 'none')
    map.setFilter(
      'regionfinder-routes-line',
      showApproximateRoutes ? null : ['!=', ['get', 'geometry_quality'], 'stop_sequence_approximation'],
    )
    map.triggerRepaint()
  }, [mapReady, showApproximateRoutes, showRoutePatterns, tileModes])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map) {
      return
    }

    map.setLayoutProperty('street-base', 'visibility', mapBaseLayer === 'street' ? 'visible' : 'none')
    map.setLayoutProperty('satellite-base', 'visibility', mapBaseLayer === 'satellite' ? 'visible' : 'none')
    map.setLayoutProperty('satellite-labels', 'visibility', mapBaseLayer === 'satellite' ? 'visible' : 'none')
  }, [mapBaseLayer, mapReady])

  useEffect(() => {
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []
    const map = mapRef.current

    if (!map) {
      return
    }

    const markerStops = selectedStop ? [selectedStop] : Array.isArray(visibleStops) ? visibleStops : []
    for (const stop of markerStops) {
      const marker = new maplibregl.Marker({
        color: stop.modes.includes('BUS') && stop.modes.length === 1 ? '#c2410c' : '#0f766e',
      })
        .setLngLat([stop.coordinate.lon, stop.coordinate.lat])
        .setPopup(new maplibregl.Popup().setText(stop.name))
        .addTo(map)
      marker.getElement().addEventListener('click', () => onSelect(stop.publicId))
      markersRef.current.push(marker)
    }

    if (selectedStop) {
      map.easeTo({
        center: [selectedStop.coordinate.lon, selectedStop.coordinate.lat],
        zoom: Math.max(map.getZoom(), 10),
      })
    }
  }, [onSelect, selectedStop, visibleStops])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map || !map.getLayer('regionfinder-routes-line')) {
      return
    }

    map.setLayoutProperty('regionfinder-routes-line', 'visibility', showRoutePatterns ? 'visible' : 'none')
    map.setFilter(
      'regionfinder-routes-line',
      showApproximateRoutes ? null : ['!=', ['get', 'geometry_quality'], 'stop_sequence_approximation'],
    )
  }, [mapReady, showApproximateRoutes, showRoutePatterns])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map || !map.getSource('regionfinder-residential-radius')) {
      return
    }

    const source = map.getSource('regionfinder-residential-radius') as maplibregl.GeoJSONSource
    const stops = selectedStop ? [selectedStop] : Array.isArray(visibleStops) ? visibleStops : []
    const collection: FeatureCollection<Polygon, { publicId: string; name: string }> = {
      type: 'FeatureCollection',
      features: showResidentialRegions
        ? stops.map((stop) => ({
            type: 'Feature',
            properties: {
              publicId: stop.publicId,
              name: stop.name,
            },
            geometry: circlePolygon(stop.coordinate.lon, stop.coordinate.lat, residentialRadiusMeters),
          }))
        : [],
    }

    source.setData(collection)
  }, [mapReady, residentialRadiusMeters, selectedStop, showResidentialRegions, visibleStops])

  return <div ref={containerRef} className="maplibre-map" aria-label="API-basierte MapLibre-Karte" />
}

function ApiApp() {
  const [snapshot, setSnapshot] = useState<ApiSnapshot | null>(null)
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [searchResults, setSearchResults] = useState<ApiStopSearchResult[]>([])
  const [selectedPublicId, setSelectedPublicId] = useState<string | null>(null)
  const [selectedStop, setSelectedStop] = useState<ApiStopDetails | null>(null)
  const [metrics, setMetrics] = useState<ApiMetrics | null>(null)
  const [itineraries, setItineraries] = useState<ApiItineraryResponse | null>(null)
  const [status, setStatus] = useState('API wird geladen')
  const [departureTime, setDepartureTime] = useState('08:00')
  const profile = defaultProfile
  const [activeModeLayers, setActiveModeLayers] = useState<ModeLayerId[]>(['regional', 's-bahn', 'u-bahn'])
  const [selectedTimeWindows, setSelectedTimeWindows] = useState<TravelTimeWindow[]>(travelTimeWindows)
  const [maxTransfers, setMaxTransfers] = useState(2)
  const [showUnreachable, setShowUnreachable] = useState(true)
  const [mapBaseLayer, setMapBaseLayer] = useState<MapBaseLayer>('street')
  const [showRoutePatterns, setShowRoutePatterns] = useState(true)
  const [showApproximateRoutes, setShowApproximateRoutes] = useState(false)
  const [showResidentialRegions, setShowResidentialRegions] = useState(false)
  const [residentialRadiusMinutes, setResidentialRadiusMinutes] = useState(15)
  const [resultMetrics, setResultMetrics] = useState<Record<string, ApiMetrics | null>>({})

  const allowedModes = useMemo(() => modesForLayers(activeModeLayers), [activeModeLayers])
  const tileModes = useMemo(() => (activeModeLayers.length === 0 ? ['__none__'] : allowedModes), [activeModeLayers.length, allowedModes])
  const residentialRadiusMeters = residentialRadiusMinutes * 60 * 80
  const visibleSearchResults = useMemo(
    () =>
      searchResults.filter((stop) => {
        if (!stopMatchesModes(stop, allowedModes)) {
          return false
        }

        const stopMetrics = resultMetrics[stop.publicId]

        if (!showUnreachable && (!stopMetrics || stopMetrics.reachableSampleCount === 0)) {
          return false
        }

        const transfers = stopMetrics?.medianTransfers ?? stopMetrics?.minimumTransfers

        if (transfers !== null && transfers !== undefined && transfers > maxTransfers) {
          return false
        }

        const seconds = filterMetricSeconds(stopMetrics)
        const bucket = seconds === null ? null : travelTimeBucket(seconds)

        return bucket === null || selectedTimeWindows.includes(bucket)
      }),
    [allowedModes, maxTransfers, resultMetrics, searchResults, selectedTimeWindows, showUnreachable],
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const current = await fetchCurrentSnapshot()
        const results = await searchStops(initialSearchQuery, { limit: 24 })

        if (!cancelled) {
          setSnapshot(current)
          setSearchResults(results)
          setStatus('bereit')
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : String(error))
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadMetrics() {
      const entries = await Promise.all(
        searchResults.map(async (stop) => {
          const stopMetrics = await fetchStopMetrics(stop.publicId, profile).catch(() => null)

          return [stop.publicId, stopMetrics] as const
        }),
      )

      if (!cancelled) {
        setResultMetrics(Object.fromEntries(entries))
      }
    }

    if (searchResults.length === 0) {
      return undefined
    }

    void loadMetrics()

    return () => {
      cancelled = true
    }
  }, [profile, searchResults])

  useEffect(() => {
    if (!selectedPublicId) {
      return
    }

    let cancelled = false
    const publicId = selectedPublicId

    async function loadDetails() {
      setStatus('Details werden geladen')
      try {
        const [details, currentMetrics, currentItineraries] = await Promise.all([
          fetchStopDetails(publicId),
          fetchStopMetrics(publicId, profile).catch(() => null),
          fetchItineraries(publicId, displayDate(), departureTime, profile).catch(() => null),
        ])

        if (!cancelled) {
          setSelectedStop(details)
          setMetrics(currentMetrics)
          setItineraries(currentItineraries)
          setStatus('bereit')
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : String(error))
        }
      }
    }

    void loadDetails()

    return () => {
      cancelled = true
    }
  }, [departureTime, profile, selectedPublicId])

  const activeItinerary = itineraries?.alternatives[0] ?? null
  const selectedRoutes = useMemo(() => selectedStop?.servedRoutes.slice(0, 12) ?? [], [selectedStop])

  async function submitSearch() {
    setStatus('Suche läuft')
    try {
      const results = await searchStops(searchQuery, { modes: allowedModes, limit: 24 })
      setSearchResults(results)
      setStatus('bereit')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

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

  return (
    <main className="api-shell">
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
          <label htmlFor="api-search">
            <Search size={16} />
            StopPlace-Suche
          </label>
          <div className="api-search-row">
            <input
              id="api-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void submitSearch()
                }
              }}
            />
            <button type="button" onClick={() => void submitSearch()}>
              <Search size={16} />
            </button>
          </div>
          <div className="station-meta">{status}</div>
        </div>

        <div className="api-result-list">
          {visibleSearchResults.map((stop) => (
            <button
              key={stop.publicId}
              type="button"
              className={stop.publicId === selectedPublicId ? 'api-stop-result active' : 'api-stop-result'}
              onClick={() => setSelectedPublicId(stop.publicId)}
            >
              <MapPin size={15} />
              <span>
                <strong>{stop.name}</strong>
                <small>
                  {stop.stateCode ?? 'ohne Bundesland'} · {stop.modes.join(', ')}
                  {resultMetrics[stop.publicId]
                    ? ` · ${minutes(filterMetricSeconds(resultMetrics[stop.publicId]))}`
                    : ''}
                </small>
              </span>
            </button>
          ))}
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
            <label className="layer-toggle">
              <input
                type="checkbox"
                checked={showRoutePatterns}
                onChange={(event) => setShowRoutePatterns(event.target.checked)}
              />
              <span>Bahninfrastruktur / Route Patterns</span>
            </label>
            <label className="layer-toggle">
              <input
                type="checkbox"
                checked={showApproximateRoutes}
                onChange={(event) => setShowApproximateRoutes(event.target.checked)}
              />
              <span>approximierte Geometrien</span>
            </label>
          </div>
        </div>

        <div className="control-group">
          <label htmlFor="api-max-transfers">
            <SlidersHorizontal size={16} />
            Filter
          </label>
          <div className="control-row">
            <select
              id="api-max-transfers"
              value={maxTransfers}
              onChange={(event) => setMaxTransfers(Number(event.target.value))}
            >
              <option value={0}>0 Umstiege</option>
              <option value={1}>max. 1 Umstieg</option>
              <option value={2}>max. 2 Umstiege</option>
              <option value={3}>max. 3 Umstiege</option>
            </select>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={showUnreachable}
                onChange={(event) => setShowUnreachable(event.target.checked)}
              />
              Unerreichbare anzeigen
            </label>
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
                style={{ '--chip-color': window <= 45 ? '#0f766e' : window <= 75 ? '#c2410c' : '#7c2d12' } as CSSProperties}
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

        <div className="control-group">
          <label htmlFor="api-departure">
            <Clock size={16} />
            Gewünschte Abfahrt
          </label>
          <input
            id="api-departure"
            type="time"
            value={departureTime}
            onChange={(event) => setDepartureTime(event.target.value)}
          />
          <div className="station-meta">Profil: {profile}</div>
        </div>

        <div className="summary-strip">
          <div>
            <strong>{visibleSearchResults.length}</strong>
            <span>sichtbare StopPlaces</span>
          </div>
          <div>
            <strong>{searchResults.length}</strong>
            <span>Suchtreffer geladen</span>
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
        <MapLibreCanvas
          selectedStop={selectedStop}
          visibleStops={visibleSearchResults}
          mapBaseLayer={mapBaseLayer}
          tileModes={tileModes}
          showRoutePatterns={showRoutePatterns}
          showApproximateRoutes={showApproximateRoutes}
          showResidentialRegions={showResidentialRegions}
          residentialRadiusMeters={residentialRadiusMeters}
          onSelect={setSelectedPublicId}
        />
        <div className="api-legend">
          <span><i className="legend-rail" /> Bahn/Umstieg</span>
          <span><i className="legend-bus" /> Bus-only</span>
          <span><i className="legend-approx" /> approximierte Geometrie</span>
        </div>
      </section>

      <aside className="api-detail-panel" aria-label="StopPlace-Details">
        {snapshot ? (
          <section className="api-panel-section">
            <h2>Datenstand</h2>
            <p>{snapshot.source.name} · {snapshot.publicId}</p>
            <p>{snapshot.validFrom ?? '?'} bis {snapshot.validUntil ?? '?'}</p>
            <p>{snapshot.source.attribution ?? 'Attribution aus Snapshot-Metadaten erforderlich'}</p>
          </section>
        ) : null}

        {selectedStop ? (
          <>
            <section className="api-panel-section">
              <h2>{selectedStop.name}</h2>
              <p>{selectedStop.municipalityName ?? 'Gemeinde unbekannt'} · {selectedStop.stateCode ?? 'Bundesland unbekannt'}</p>
              <p>DHID: {selectedStop.dhid ?? 'fehlt'} · Qualität: {selectedStop.identityQuality}</p>
              <p>{selectedStop.modes.join(', ')}</p>
            </section>

            <section className="api-panel-section">
              <h2>Fahrzeit nach Hamburg Hbf</h2>
              <div className="api-metric-grid">
                <MetricCard label="Schnellste Gesamtreisezeit" value={minutes(metrics?.fastestSeconds ?? null)} title={metricTooltip('fastest')} />
                <MetricCard label="Typische Fahrzeit, Median" value={minutes(metrics?.medianSeconds ?? null)} title={metricTooltip('median')} />
                <MetricCard label="Durchschnittliche Gesamtreisezeit" value={minutes(metrics?.averageSeconds ?? null)} title={metricTooltip('average')} />
                <MetricCard label="P90" value={minutes(metrics?.p90Seconds ?? null)} title={metricTooltip('p90')} />
                <MetricCard label="Erreichbarkeitsquote" value={percent(metrics?.reachabilityRatio ?? null)} />
                <MetricCard label="Direktverbindungen" value={percent(metrics?.directConnectionRatio ?? null)} />
                <MetricCard label="Typische Umstiege" value={metrics?.medianTransfers === null || metrics?.medianTransfers === undefined ? 'n/a' : String(metrics.medianTransfers)} />
                <MetricCard label="Längste Bedienungslücke" value={minutes(metrics?.maxServiceGapSeconds ?? null)} />
              </div>
            </section>

            <section className="api-panel-section">
              <h2>Konkrete Verbindung</h2>
              {activeItinerary ? (
                <>
                  <div className="api-itinerary-summary">
                    <span>Wunsch: {activeItinerary.requestedDepartureAt.slice(11, 16)}</span>
                    <span>Erste Abfahrt: {activeItinerary.actualFirstDepartureAt?.slice(11, 16) ?? 'n/a'}</span>
                    <span>Ankunft: {activeItinerary.arrivalAt?.slice(11, 16) ?? 'n/a'}</span>
                    <span>Dauer: {minutes(activeItinerary.totalDurationSeconds)}</span>
                  </div>
                  <ol className="api-leg-list">
                    {activeItinerary.legs.map((leg) => (
                      <li key={leg.sequence}>
                        <Route size={14} />
                        <span>
                          <strong>{leg.legType === 'transit' ? leg.routeName : leg.legType}</strong>
                          {leg.fromName} → {leg.toName} · {minutes(leg.durationSeconds)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p>Keine lokale Verbindung für diese Auswahl vorhanden.</p>
              )}
            </section>

            <section className="api-panel-section">
              <h2>Linien</h2>
              <div className="api-route-list">
                {selectedRoutes.map((route) => (
                  <span key={route.routePatternId} title={route.geometryQuality}>
                    {route.shortName ?? route.longName ?? route.routePatternId} · {route.mode}
                  </span>
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className="empty-state">
            <Info size={18} />
            StopPlace suchen oder Marker auswählen.
          </div>
        )}
      </aside>
    </main>
  )
}

export default ApiApp
