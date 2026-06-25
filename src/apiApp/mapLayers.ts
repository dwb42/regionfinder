import type { Polygon } from 'geojson'
import type { ExpressionSpecification, FilterSpecification, Map, StyleSpecification } from 'maplibre-gl'
import { apiBaseUrl } from '../data/api'
import { travelTimeWindowColors, travelTimeWindows, type ModeLayerId, type TravelTimeWindow } from './config'
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

const railRouteModes = new Set(['ICE', 'IC', 'EC', 'RE', 'RB', 'RAIL', 'S', 'AKN', 'U'])
const defaultSchoolStates = ['HH', 'SH', 'MV', 'NI']

export type TransitTileSourceKeys = {
  stops: string
  railRoutes: string
  routes: string
}

function routeTileModeGroups(modes: string[]): { railModes: string[]; nonRailModes: string[] } {
  return {
    railModes: modes.filter((mode) => railRouteModes.has(mode)),
    nonRailModes: modes.filter((mode) => !railRouteModes.has(mode)),
  }
}

export function transitTileSourceKeys(modes: string[], profile: string): TransitTileSourceKeys {
  const { railModes, nonRailModes } = routeTileModeGroups(modes)

  return {
    stops: `${profile}|stops|${modes.join(',')}`,
    railRoutes: `${profile}|rail-routes|${railModes.join(',')}`,
    routes: `${profile}|routes|${nonRailModes.join(',')}`,
  }
}

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

function tileUrl(
  path: 'stops' | 'routes' | 'rail-network' | 'schools',
  modes: string[] = [],
  profile?: string,
): string {
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

function schoolTileUrl(categories: string[]): string {
  const params = new URLSearchParams({
    categories: categories.join(','),
    states: defaultSchoolStates.join(','),
  })

  return `${apiBaseUrl}/api/v1/tiles/schools/{z}/{x}/{y}.mvt?${params}`
}

export function schoolTileSourceKey(categories: string[]): string {
  return categories.join(',')
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

function nonRailRouteFilter(): FilterSpecification {
  return ['all', routeGeometryFilter(), ['!=', ['get', 'geometry_quality'], 'stop_pair_segment']] as FilterSpecification
}

function travelTimePropertyFilter(propertyName: string, selectedWindows: TravelTimeWindow[]): FilterSpecification | null {
  if (selectedWindows.length === travelTimeWindows.length) {
    return null
  }

  const selectedWindowSet = new Set(selectedWindows)
  const windowFilters = travelTimeWindows
    .map((window, index) => {
      if (!selectedWindowSet.has(window)) {
        return null
      }

      const previousWindow = index === 0 ? null : travelTimeWindows[index - 1]

      return previousWindow === null
        ? (['<=', ['get', propertyName], window * 60] as FilterSpecification)
        : ([
            'all',
            ['>', ['get', propertyName], previousWindow * 60],
            ['<=', ['get', propertyName], window * 60],
          ] as FilterSpecification)
    })
    .filter((filter): filter is FilterSpecification => filter !== null)

  return ['any', ['!', ['has', propertyName]], ...windowFilters] as FilterSpecification
}

function stopTravelTimeFilter(selectedWindows: TravelTimeWindow[]): FilterSpecification | null {
  return travelTimePropertyFilter('fastest_seconds', selectedWindows)
}

function railRouteFilter(selectedWindows: TravelTimeWindow[]): FilterSpecification {
  const fromStopFilter = travelTimePropertyFilter('from_fastest_seconds', selectedWindows)
  const toStopFilter = travelTimePropertyFilter('to_fastest_seconds', selectedWindows)
  const baseFilter: FilterSpecification = [
    'all',
    routeGeometryFilter(),
    ['==', ['get', 'geometry_quality'], 'stop_pair_segment'],
  ] as FilterSpecification

  if (!fromStopFilter || !toStopFilter) {
    return baseFilter
  }

  return [
    'all',
    baseFilter,
    fromStopFilter,
    toStopFilter,
  ] as FilterSpecification
}

export function applyRouteLayerState(map: Map, selectedWindows: TravelTimeWindow[] = travelTimeWindows) {
  map.setFilter('regionfinder-routes-line', nonRailRouteFilter())
  map.setFilter('regionfinder-rail-routes-casing', railRouteFilter(selectedWindows))
  map.setFilter('regionfinder-rail-routes-line', railRouteFilter(selectedWindows))
}

export function applyStopLayerState(map: Map, selectedWindows: TravelTimeWindow[]) {
  map.setFilter('regionfinder-stops-symbol', stopTravelTimeFilter(selectedWindows))
}

function firstExistingLayer(map: Map, layerIds: string[]): string | undefined {
  return layerIds.find((layerId) => map.getLayer(layerId))
}

export function addRailRouteTileLayers(map: Map, modes: string[], profile: string) {
  const { railModes } = routeTileModeGroups(modes)

  map.addSource('regionfinder-rail-routes', {
    type: 'vector',
    tiles: [tileUrl('routes', railModes.length > 0 ? railModes : ['__none__'], profile)],
    minzoom: 6,
    maxzoom: 14,
  })
  map.addLayer({
    id: 'regionfinder-rail-routes-casing',
    type: 'line',
    source: 'regionfinder-rail-routes',
    'source-layer': 'routes',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#ffffff',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        2,
        10,
        3.2,
        12,
        4.4,
      ],
      'line-opacity': 0.46,
    },
  }, firstExistingLayer(map, ['regionfinder-routes-line', 'regionfinder-stops-symbol']))
  map.addLayer({
    id: 'regionfinder-rail-routes-line',
    type: 'line',
    source: 'regionfinder-rail-routes',
    'source-layer': 'routes',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': routeColorExpression,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        1,
        10,
        1.8,
        12,
        2.6,
      ],
      'line-opacity': 0.62,
    },
  }, firstExistingLayer(map, ['regionfinder-routes-line', 'regionfinder-stops-symbol']))
}

export function addRouteTileLayers(map: Map, modes: string[], profile: string) {
  const { nonRailModes } = routeTileModeGroups(modes)

  map.addSource('regionfinder-routes', {
    type: 'vector',
    tiles: [tileUrl('routes', nonRailModes.length > 0 ? nonRailModes : ['__none__'], profile)],
    minzoom: 9,
    maxzoom: 14,
  })
  map.addLayer({
    id: 'regionfinder-routes-line',
    type: 'line',
    source: 'regionfinder-routes',
    'source-layer': 'routes',
    minzoom: 9,
    paint: {
      'line-color': routeColorExpression,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        0.45,
        10,
        0.7,
        12,
        1.15,
      ],
      'line-opacity': 0.46,
      'line-dasharray': [
        'case',
        ['==', ['get', 'geometry_quality'], 'stop_sequence_approximation'],
        ['literal', [2, 2]],
        ['==', ['get', 'geometry_quality'], 'osm_reconstructed_low_confidence'],
        ['literal', [4, 2]],
        ['literal', [1, 0]],
      ],
    },
  }, firstExistingLayer(map, ['regionfinder-stops-symbol']))
}

export function addStopTileLayers(map: Map, modes: string[], profile: string) {
  map.addSource('regionfinder-stops', {
    type: 'vector',
    tiles: [tileUrl('stops', modes, profile)],
    minzoom: 6,
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

export function addTransitTileLayers(map: Map, modes: string[], profile: string) {
  addRailRouteTileLayers(map, modes, profile)
  addRouteTileLayers(map, modes, profile)
  addStopTileLayers(map, modes, profile)
}

function ensureSchoolIcon(map: Map) {
  if (map.hasImage('regionfinder-school-icon')) {
    return
  }

  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (!context) {
    return
  }

  context.clearRect(0, 0, size, size)
  context.fillStyle = '#0f172a'
  context.strokeStyle = '#ffffff'
  context.lineWidth = 1.8
  context.beginPath()
  context.roundRect(4, 5, 24, 22, 6)
  context.fill()
  context.stroke()
  context.fillStyle = '#ffffff'
  context.strokeStyle = '#ffffff'
  context.lineWidth = 1.8
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(8, 14)
  context.lineTo(16, 10)
  context.lineTo(24, 14)
  context.lineTo(16, 18)
  context.closePath()
  context.fill()
  context.beginPath()
  context.moveTo(11, 18)
  context.lineTo(11, 21)
  context.quadraticCurveTo(16, 24, 21, 21)
  context.lineTo(21, 18)
  context.stroke()
  context.beginPath()
  context.moveTo(24, 15)
  context.lineTo(24, 21)
  context.stroke()
  context.fillStyle = '#fbbf24'
  context.beginPath()
  context.arc(24, 22.5, 2, 0, Math.PI * 2)
  context.fill()

  map.addImage('regionfinder-school-icon', context.getImageData(0, 0, size, size), { pixelRatio: 2 })
}

export function addSchoolTileLayer(map: Map, categories: string[]) {
  ensureSchoolIcon(map)
  map.addSource('regionfinder-schools', {
    type: 'vector',
    tiles: [schoolTileUrl(categories)],
    minzoom: 8,
    maxzoom: 14,
  })
  map.addLayer({
    id: 'regionfinder-schools-halo',
    type: 'circle',
    source: 'regionfinder-schools',
    'source-layer': 'schools',
    minzoom: 8,
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        7,
        11,
        9,
        14,
        11,
      ],
      'circle-color': [
        'match',
        ['get', 'school_category'],
        'gymnasium',
        '#2563eb',
        '#0f172a',
      ],
      'circle-opacity': [
        'match',
        ['get', 'school_category'],
        'gymnasium',
        0.48,
        0.22,
      ],
      'circle-stroke-color': [
        'match',
        ['get', 'school_category'],
        'gymnasium',
        '#bfdbfe',
        '#ffffff',
      ],
      'circle-stroke-width': 1,
      'circle-stroke-opacity': 0.78,
    },
  })
  map.addLayer({
    id: 'regionfinder-schools-symbol',
    type: 'symbol',
    source: 'regionfinder-schools',
    'source-layer': 'schools',
    minzoom: 8,
    layout: {
      'icon-image': 'regionfinder-school-icon',
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        0.72,
        11,
        0.9,
        14,
        1.05,
      ],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })
}

export function removeRailRouteTileLayers(map: Map) {
  for (const layerId of ['regionfinder-rail-routes-line', 'regionfinder-rail-routes-casing']) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId)
    }
  }

  if (map.getSource('regionfinder-rail-routes')) {
    map.removeSource('regionfinder-rail-routes')
  }
}

export function removeRouteTileLayers(map: Map) {
  if (map.getLayer('regionfinder-routes-line')) {
    map.removeLayer('regionfinder-routes-line')
  }

  if (map.getSource('regionfinder-routes')) {
    map.removeSource('regionfinder-routes')
  }
}

export function removeStopTileLayers(map: Map) {
  if (map.getLayer('regionfinder-stops-symbol')) {
    map.removeLayer('regionfinder-stops-symbol')
  }

  if (map.getSource('regionfinder-stops')) {
    map.removeSource('regionfinder-stops')
  }
}

export function removeTransitTileLayers(map: Map) {
  removeStopTileLayers(map)
  removeRouteTileLayers(map)
  removeRailRouteTileLayers(map)
}

export function removeSchoolTileLayer(map: Map) {
  for (const layerId of ['regionfinder-schools-symbol', 'regionfinder-schools-halo']) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId)
    }
  }

  if (map.getSource('regionfinder-schools')) {
    map.removeSource('regionfinder-schools')
  }
}

export function circlePolygon(lon: number, lat: number, radiusMeters: number, segments = 32): Polygon {
  const points: number[][] = []
  const earthRadiusMeters = 6_371_000
  const angularDistance = radiusMeters / earthRadiusMeters
  const latRad = (lat * Math.PI) / 180
  const lonRad = (lon * Math.PI) / 180

  for (let step = 0; step <= segments; step += 1) {
    const bearing = (step / segments) * 2 * Math.PI
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

export function schoolCategoryLabel(category: string | null): string {
  switch (category) {
    case 'gymnasium':
      return 'Gymnasium'
    case 'comprehensive':
      return 'Gesamtschule'
    case 'waldorf':
      return 'Waldorfschule'
    case 'vocational':
      return 'Berufsschule'
    case 'upper_secondary':
      return 'Oberstufe'
    default:
      return 'Weiterführende Schule'
  }
}

export function createSchoolHoverPopupContent({
  name,
  schoolTypeLabel,
  schoolCategory,
}: {
  name: string
  schoolTypeLabel: string | null
  schoolCategory: string | null
}): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'map-popup school-hover-popup'

  const title = document.createElement('strong')
  title.textContent = name
  wrapper.append(title)

  const type = document.createElement('span')
  type.textContent = `Schulart: ${schoolTypeLabel ?? schoolCategoryLabel(schoolCategory)}`
  wrapper.append(type)

  return wrapper
}
