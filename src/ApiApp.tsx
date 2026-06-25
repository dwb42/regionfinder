import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import maplibregl, { type ExpressionSpecification, type Map, type StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection, Polygon } from 'geojson'
import {
  Clock,
  Layers,
  MapPin,
  Route,
  Satellite,
  Search,
  SlidersHorizontal,
  X,
  TrainFront,
} from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import type {
  ApiItinerary,
  ApiItineraryLeg,
  ApiItineraryResponse,
  ApiMetrics,
  ApiSnapshot,
  ApiStopDetails,
  ApiStopSearchResult,
} from './api/contracts'
import {
  ApiError,
  apiBaseUrl,
  fetchCurrentSnapshot,
  fetchRealtimeItineraries,
  fetchStopDetails,
  fetchStopMetrics,
  searchStops,
} from './data/api'

const defaultProfile = import.meta.env.VITE_REGIONFINDER_ROUTING_PROFILE || 'regular_tue_thu'
const initialSearchQuery = 'Hamburg'

type ModeLayerId = 'regional' | 's-bahn' | 'u-bahn' | 'bus' | 'ferry'
type MapBaseLayer = 'street' | 'satellite'
type TravelTimeWindow = 30 | 45 | 60 | 75 | 90
type MapUpdateState = 'idle' | 'loading' | 'complete'
type RealtimeItineraryState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  response: ApiItineraryResponse | null
  error: string | null
}

const mapLibreBaseStyle: StyleSpecification = {
  version: 8,
  sources: {
    'street-base': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
    'satellite-base': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
    'place-labels': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
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
      id: 'place-labels',
      type: 'raster',
      source: 'place-labels',
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
const travelTimeWindowColors: Record<TravelTimeWindow, string> = {
  30: '#15803d',
  45: '#0f766e',
  60: '#ca8a04',
  75: '#ea580c',
  90: '#b91c1c',
}

const routeColorExpression: ExpressionSpecification = [
  'case',
  ['==', ['get', 'geometry_quality'], 'stop_sequence_approximation'],
  '#c2410c',
  ['==', ['get', 'mode'], 'BUS'],
  '#b45309',
  ['==', ['get', 'mode'], 'TRAM'],
  '#7c3aed',
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
    '#b45309',
    'TRAM',
    '#7c3aed',
    'FERRY',
    '#0891b2',
    '#64748b',
  ],
]

const stopTravelTimeColorExpression: ExpressionSpecification = [
  'case',
  ['!', ['has', 'fastest_seconds']],
  '#94a3b8',
  ['<=', ['get', 'fastest_seconds'], 30 * 60],
  travelTimeWindowColors[30],
  ['<=', ['get', 'fastest_seconds'], 45 * 60],
  travelTimeWindowColors[45],
  ['<=', ['get', 'fastest_seconds'], 60 * 60],
  travelTimeWindowColors[60],
  ['<=', ['get', 'fastest_seconds'], 75 * 60],
  travelTimeWindowColors[75],
  ['<=', ['get', 'fastest_seconds'], 90 * 60],
  travelTimeWindowColors[90],
  '#64748b',
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

function tileUrl(path: 'stops' | 'routes' | 'rail-network', modes: string[] = [], profile?: string): string {
  const params = new URLSearchParams()

  if (modes.length > 0) {
    params.set('modes', modes.join(','))
  }

  if (profile) {
    params.set('profile', profile)
  }

  const suffix = params.size > 0 ? `?${params}` : ''

  return `${apiBaseUrl}/api/v1/tiles/${path}/{z}/{x}/{y}.mvt${suffix}`
}

function routeGeometryFilter(): ExpressionSpecification {
  return [
    'all',
    ['!=', ['get', 'geometry_quality'], 'stop_sequence_approximation'],
    ['!=', ['get', 'geometry_quality'], 'osm_reconstructed_low_confidence'],
    [
      'any',
      ['!=', ['get', 'geometry_quality'], 'official_gtfs'],
      ['==', ['get', 'mode'], 'BUS'],
      ['==', ['get', 'mode'], 'TRAM'],
    ],
  ]
}

function applyRouteLayerState(map: Map) {
  map.setFilter('regionfinder-routes-line', routeGeometryFilter())
}

function addTransitTileLayers(map: Map, modes: string[], profile: string) {
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
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        ['case', ['any', ['==', ['get', 'mode'], 'BUS'], ['==', ['get', 'mode'], 'TRAM']], 0.25, 0.6],
        10,
        ['case', ['any', ['==', ['get', 'mode'], 'BUS'], ['==', ['get', 'mode'], 'TRAM']], 0.7, 2],
        12,
        ['case', ['any', ['==', ['get', 'mode'], 'BUS'], ['==', ['get', 'mode'], 'TRAM']], 1.15, 3],
      ],
      'line-opacity': [
        'case',
        ['any', ['==', ['get', 'mode'], 'BUS'], ['==', ['get', 'mode'], 'TRAM']],
        0.46,
        ['==', ['get', 'geometry_quality'], 'stop_sequence_approximation'],
        0.38,
        ['==', ['get', 'geometry_quality'], 'osm_reconstructed_low_confidence'],
        0.48,
        0.78,
      ],
      'line-dasharray': [
        'case',
        ['==', ['get', 'geometry_quality'], 'stop_sequence_approximation'],
        ['literal', [2, 2]],
        ['==', ['get', 'geometry_quality'], 'osm_reconstructed_low_confidence'],
        ['literal', [4, 2]],
        ['literal', [1, 0]],
      ],
    },
  })
  map.addSource('regionfinder-stops', {
    type: 'vector',
    tiles: [tileUrl('stops', modes, profile)],
    minzoom: 0,
    maxzoom: 14,
  })
  map.addLayer({
    id: 'regionfinder-stops-symbol',
    type: 'circle',
    source: 'regionfinder-stops',
    'source-layer': 'stops',
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        6,
        ['match', ['get', 'stop_priority'], 'regional', 4.5, 'urban_rail', 3.5, 'bus_only', 2.4, 3],
        10,
        ['match', ['get', 'stop_priority'], 'regional', 7.5, 'urban_rail', 6, 'bus_only', 4.2, 5],
        12,
        ['match', ['get', 'stop_priority'], 'regional', 10, 'urban_rail', 8, 'bus_only', 5.5, 6],
      ],
      'circle-color': stopTravelTimeColorExpression,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': [
        'match',
        ['get', 'stop_priority'],
        'regional',
        2,
        'urban_rail',
        1.4,
        'bus_only',
        0.8,
        1,
      ],
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

function compactMinutes(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : `${Math.round(value / 60)} min`
}

function timeLabel(value: string | null | undefined): string {
  return value ? value.slice(11, 16) : 'n/a'
}

function delayLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return 'n/a'
  }

  if (value === 0) {
    return 'pünktlich'
  }

  const rounded = Math.round(value / 60)
  return rounded > 0 ? `+${rounded} min` : `${rounded} min`
}

function realtimeErrorMessage(error: unknown): string {
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

function directConnectionsPerWeekday(metric: ApiMetrics | null): string {
  if (metric?.directConnectionRatio === null || metric?.directConnectionRatio === undefined) {
    return 'n/a'
  }

  return String(Math.round(metric.directConnectionRatio * metric.reachableSampleCount))
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

function numericFeatureProperty(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function stringFeatureProperty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function routeSummaryText(routeLabels: string | null, routeCount: number | null): string {
  if (!routeLabels) {
    return 'keine Route hinterlegt'
  }

  const visibleCount = routeLabels.split(', ').filter(Boolean).length
  const hiddenCount = routeCount === null ? 0 : Math.max(0, routeCount - visibleCount)

  return hiddenCount > 0 ? `${routeLabels}, +${hiddenCount} weitere` : routeLabels
}

function stopRouteLabel(route: ApiStopDetails['servedRoutes'][number]): string {
  return `${route.shortName ?? route.longName ?? route.routePatternId} · ${route.mode}`
}

function createStopHoverPopupContent({
  name,
  fastestSeconds,
  routeLabels,
  routeCount,
}: {
  name: string
  fastestSeconds: number | null
  routeLabels: string | null
  routeCount: number | null
}): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'map-popup stop-hover-popup'

  const title = document.createElement('strong')
  title.textContent = name
  wrapper.append(title)

  const fastest = document.createElement('span')
  fastest.textContent = `Schnellste Verbindung: ${minutes(fastestSeconds)}`
  wrapper.append(fastest)

  const routeText = document.createElement('span')
  routeText.textContent = `Linie / Route: ${routeSummaryText(routeLabels, routeCount)}`
  wrapper.append(routeText)

  return wrapper
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

function RealtimeItineraryBlock({
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
      {loading ? <p className="api-inline-status">Verbindung wird geladen...</p> : null}
      {!loading && error ? <p className="api-inline-error">{error}</p> : null}
      {!loading && !error && alternatives.length === 0 ? <p>{emptyText}</p> : null}
      {!loading && !error && alternatives.length > 0 ? (
        <ol className="api-itinerary-alternatives">
          {alternatives.map((itinerary, index) => (
            <li key={`${itinerary.provider}-${itinerary.actualFirstDepartureAt ?? index}`}>
              <ItineraryAlternative itinerary={itinerary} showRank={alternatives.length > 1} index={index} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

function ItineraryAlternative({
  itinerary,
  showRank,
  index,
}: {
  itinerary: ApiItinerary
  showRank: boolean
  index: number
}) {
  return (
    <>
      {showRank ? <h4>Alternative {index + 1}</h4> : null}
      <div className="api-itinerary-summary">
        <span>Wunsch: {timeLabel(itinerary.requestedDepartureAt)}</span>
        <span>Erste Abfahrt: {timeLabel(itinerary.actualFirstDepartureAt)}</span>
        <span>Ankunft: {timeLabel(itinerary.arrivalAt)}</span>
        <span>Dauer: {compactMinutes(itinerary.totalDurationSeconds)}</span>
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

function legLabel(leg: ApiItineraryLeg): string {
  if (leg.legType === 'transit') {
    return [leg.routeName, leg.headsign ? `Richtung ${leg.headsign}` : null].filter(Boolean).join(' · ') || 'Transit'
  }

  return leg.legType
}

function MapLibreCanvas({
  selectedStop,
  visibleStops,
  mapBaseLayer,
  tileModes,
  showResidentialRegions,
  residentialRadiusMeters,
  profile,
  onSelect,
  onTileLoadingChange,
}: {
  selectedStop: ApiStopDetails | null
  visibleStops: ApiStopSearchResult[]
  mapBaseLayer: MapBaseLayer
  tileModes: string[]
  showResidentialRegions: boolean
  residentialRadiusMeters: number
  profile: string
  onSelect: (publicId: string) => void
  onTileLoadingChange: (isLoading: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const initialTileModesRef = useRef(tileModes)
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null)
  const currentHoverPublicIdRef = useRef<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(8.4)

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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    map.on('zoom', () => {
      setZoomLevel(Number(map.getZoom().toFixed(1)))
    })
    map.on('idle', () => {
      onTileLoadingChange(false)
    })
    map.on('load', () => {
      addTransitTileLayers(map, initialTileModesRef.current, profile)
      applyRouteLayerState(map)
      map.on('click', 'regionfinder-stops-symbol', (event) => {
        const publicId = event.features?.[0]?.properties?.public_id

        if (typeof publicId === 'string' && publicId.length > 0) {
          onSelect(publicId)
        }
      })
      const showStopHoverPopup = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0]
        const publicId = feature?.properties?.public_id
        const fallbackName = feature?.properties?.name

        if (typeof publicId !== 'string' || publicId.length === 0) {
          return
        }

        if (currentHoverPublicIdRef.current === publicId) {
          hoverPopupRef.current?.setLngLat(event.lngLat)
          return
        }

        currentHoverPublicIdRef.current = publicId
        const popup =
          hoverPopupRef.current ??
          new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 12,
            className: 'stop-hover-map-popup',
          })
        hoverPopupRef.current = popup
        const name = typeof fallbackName === 'string' ? fallbackName : 'StopPlace'
        const fastestSeconds = numericFeatureProperty(feature?.properties?.fastest_seconds)
        const routeLabels = stringFeatureProperty(feature?.properties?.route_labels)
        const routeCount = numericFeatureProperty(feature?.properties?.route_count)

        popup
          .setLngLat(event.lngLat)
          .setDOMContent(
            createStopHoverPopupContent({
              name,
              fastestSeconds,
              routeLabels,
              routeCount,
            }),
          )
          .addTo(map)
      }
      map.on('mouseenter', 'regionfinder-stops-symbol', (event) => {
        map.getCanvas().style.cursor = 'pointer'
        showStopHoverPopup(event)
      })
      map.on('mousemove', 'regionfinder-stops-symbol', (event) => {
        showStopHoverPopup(event)
      })
      map.on('mouseleave', 'regionfinder-stops-symbol', () => {
        map.getCanvas().style.cursor = ''
        currentHoverPublicIdRef.current = null
        hoverPopupRef.current?.remove()
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
      hoverPopupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [onSelect, onTileLoadingChange, profile])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map) {
      return
    }

    onTileLoadingChange(true)
    removeTransitTileLayers(map)
    addTransitTileLayers(map, tileModes, profile)
    applyRouteLayerState(map)
    map.triggerRepaint()
  }, [mapReady, onTileLoadingChange, profile, tileModes])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map) {
      return
    }

    map.setLayoutProperty('street-base', 'visibility', mapBaseLayer === 'street' ? 'visible' : 'none')
    map.setLayoutProperty('satellite-base', 'visibility', mapBaseLayer === 'satellite' ? 'visible' : 'none')
  }, [mapBaseLayer, mapReady])

  useEffect(() => {
    const map = mapRef.current

    if (!map || !selectedStop) {
      return
    }

    map.easeTo({
      center: [selectedStop.coordinate.lon, selectedStop.coordinate.lat],
      zoom: Math.max(map.getZoom(), 10),
    })
  }, [selectedStop])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map || !map.getLayer('regionfinder-routes-line')) {
      return
    }

    applyRouteLayerState(map)
    onTileLoadingChange(true)
  }, [mapReady, onTileLoadingChange])

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

  return (
    <div className="maplibre-map-shell">
      <div ref={containerRef} className="maplibre-map" aria-label="API-basierte MapLibre-Karte" />
      <div className="map-zoom-level" aria-live="polite">
        Zoom {zoomLevel.toFixed(1)}
      </div>
    </div>
  )
}

function ApiApp() {
  const [snapshot, setSnapshot] = useState<ApiSnapshot | null>(null)
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [searchResults, setSearchResults] = useState<ApiStopSearchResult[]>([])
  const [selectedPublicId, setSelectedPublicId] = useState<string | null>(null)
  const [selectedStop, setSelectedStop] = useState<ApiStopDetails | null>(null)
  const [metrics, setMetrics] = useState<ApiMetrics | null>(null)
  const [realtimeItineraries, setRealtimeItineraries] = useState<RealtimeItineraryState>({
    status: 'idle',
    response: null,
    error: null,
  })
  const [status, setStatus] = useState('API wird geladen')
  const [departureTime, setDepartureTime] = useState('08:00')
  const profile = defaultProfile
  const [activeModeLayers, setActiveModeLayers] = useState<ModeLayerId[]>(['regional', 's-bahn', 'u-bahn'])
  const [selectedTimeWindows, setSelectedTimeWindows] = useState<TravelTimeWindow[]>(travelTimeWindows)
  const [maxTransfers, setMaxTransfers] = useState(2)
  const [showUnreachable, setShowUnreachable] = useState(true)
  const [mapBaseLayer, setMapBaseLayer] = useState<MapBaseLayer>('street')
  const [showResidentialRegions, setShowResidentialRegions] = useState(false)
  const [residentialRadiusMinutes, setResidentialRadiusMinutes] = useState(15)
  const [resultMetrics, setResultMetrics] = useState<Record<string, ApiMetrics | null>>({})
  const [mapUpdateState, setMapUpdateState] = useState<MapUpdateState>('idle')
  const mapUpdateTimerRef = useRef<number | null>(null)

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

  const handleMapTileLoadingChange = useCallback((isLoading: boolean) => {
    if (mapUpdateTimerRef.current !== null) {
      window.clearTimeout(mapUpdateTimerRef.current)
      mapUpdateTimerRef.current = null
    }

    if (isLoading) {
      setMapUpdateState('loading')
      mapUpdateTimerRef.current = window.setTimeout(() => {
        setMapUpdateState('complete')
        mapUpdateTimerRef.current = window.setTimeout(() => {
          setMapUpdateState('idle')
          mapUpdateTimerRef.current = null
        }, 1400)
      }, 10_000)
      return
    }

    setMapUpdateState('complete')
    mapUpdateTimerRef.current = window.setTimeout(() => {
      setMapUpdateState('idle')
      mapUpdateTimerRef.current = null
    }, 1400)
  }, [])

  useEffect(() => () => {
    if (mapUpdateTimerRef.current !== null) {
      window.clearTimeout(mapUpdateTimerRef.current)
    }
  }, [])

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
      setRealtimeItineraries({ status: 'loading', response: null, error: null })
      const realtimeRequest = fetchRealtimeItineraries(publicId, displayDate(), departureTime, profile)
        .then((response) => ({ response, error: null }))
        .catch((error: unknown) => ({
          response: null,
          error: realtimeErrorMessage(error),
        }))

      try {
        const [details, currentMetrics] = await Promise.all([
          fetchStopDetails(publicId),
          fetchStopMetrics(publicId, profile).catch(() => null),
        ])

        if (!cancelled) {
          setSelectedStop(details)
          setMetrics(currentMetrics)
          setStatus('bereit')
        }

        const realtimeResult = await realtimeRequest

        if (!cancelled) {
          setRealtimeItineraries(
            realtimeResult.response
              ? { status: 'ready', response: realtimeResult.response, error: null }
              : { status: 'error', response: null, error: realtimeResult.error },
          )
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : String(error))
          setRealtimeItineraries({ status: 'idle', response: null, error: null })
        }
      }
    }

    void loadDetails()

    return () => {
      cancelled = true
    }
  }, [departureTime, profile, selectedPublicId])

  const selectedRouteLabels = useMemo(
    () => Array.from(new Set(selectedStop?.servedRoutes.map(stopRouteLabel) ?? [])).slice(0, 12),
    [selectedStop],
  )

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

  function closeDetailPanel() {
    setSelectedPublicId(null)
    setSelectedStop(null)
    setMetrics(null)
    setRealtimeItineraries({ status: 'idle', response: null, error: null })
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
                style={{ '--chip-color': travelTimeWindowColors[window] } as CSSProperties}
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
          showResidentialRegions={showResidentialRegions}
          residentialRadiusMeters={residentialRadiusMeters}
          profile={profile}
          onSelect={setSelectedPublicId}
          onTileLoadingChange={handleMapTileLoadingChange}
        />
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
                <MetricCard label="Direktverbindungen / Wochentag" value={directConnectionsPerWeekday(metrics)} />
              </div>
            </section>

            <section className="api-panel-section">
              <h2>DB Echtzeit</h2>
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

            <section className="api-panel-section">
              <h2>Datenstand</h2>
              {snapshot ? (
                <>
                  <p>{snapshot.source.name} · {snapshot.publicId}</p>
                  <p>{snapshot.validFrom ?? '?'} bis {snapshot.validUntil ?? '?'}</p>
                  <p>{snapshot.source.attribution ?? 'Attribution aus Snapshot-Metadaten erforderlich'}</p>
                </>
              ) : (
                <p>Datenstand wird geladen</p>
              )}
            </section>

            <section className="api-panel-section">
              <h2>StopPlace-Details</h2>
              <p>{selectedStop.municipalityName ?? 'Gemeinde unbekannt'} · {selectedStop.stateCode ?? 'Bundesland unbekannt'}</p>
              <p>DHID: {selectedStop.dhid ?? 'fehlt'} · Qualität: {selectedStop.identityQuality}</p>
              <p>{selectedStop.modes.join(', ')}</p>
            </section>
          </>
        </aside>
      ) : null}
    </main>
  )
}

export default ApiApp
