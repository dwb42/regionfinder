import type { Polygon } from 'geojson'
import type { ExpressionSpecification, Map, StyleSpecification } from 'maplibre-gl'
import { apiBaseUrl } from '../data/api'
import { travelTimeWindowColors, type ModeLayerId } from './config'
import { minutes } from './formatters'

export const mapLibreBaseStyle: StyleSpecification = {
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

export function modesForLayers(activeLayers: ModeLayerId[], definitions: Array<{ id: ModeLayerId; modes: string[] }>): string[] {
  return Array.from(
    new Set(
      definitions
        .filter((definition) => activeLayers.includes(definition.id))
        .flatMap((definition) => definition.modes),
    ),
  )
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

export function applyRouteLayerState(map: Map) {
  map.setFilter('regionfinder-routes-line', routeGeometryFilter())
}

export function addTransitTileLayers(map: Map, modes: string[], profile: string) {
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
  }, 'regionfinder-stops-symbol')
}

export function removeTransitTileLayers(map: Map) {
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

export function circlePolygon(lon: number, lat: number, radiusMeters: number): Polygon {
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

export function numericFeatureProperty(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export function stringFeatureProperty(value: unknown): string | null {
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

export function createStopHoverPopupContent({
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
