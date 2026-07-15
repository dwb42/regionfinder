import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeatureCollection, Polygon } from 'geojson'
import maplibregl, { type Map } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { ApiStopSelectionPreview, PlaceCategory } from '../api/contracts'
import type { MapBaseLayer, TravelTimeWindow } from './config'
import {
  addPlaceTileLayer,
  addRailRouteTileLayers,
  addRouteTileLayers,
  addSchoolTileLayer,
  addStopTileLayers,
  addTransitTileLayers,
  applyRouteLayerState,
  applyStopLayerState,
  circlePolygon,
  createPlaceHoverPopupContent,
  createSchoolHoverPopupContent,
  createStopHoverPopupContent,
  mapLibreBaseStyle,
  numericFeatureProperty,
  placeTileSourceKey,
  removePlaceTileLayer,
  removeSchoolTileLayer,
  removeRailRouteTileLayers,
  removeRouteTileLayers,
  removeStopTileLayers,
  schoolTileSourceKey,
  stringFeatureProperty,
  transitTileSourceKeys,
  type TransitTileSourceKeys,
} from './mapLayers'

type SelectedMapStop = Pick<ApiStopSelectionPreview, 'publicId' | 'name' | 'coordinate'>

function isResidentialRadiusStationFeature(feature: { properties?: Record<string, unknown> | null }): boolean {
  const stopPriority = stringFeatureProperty(feature.properties?.stop_priority)

  return stopPriority === 'regional' || stopPriority === 'urban_rail'
}

function transitTileSourcesChanged(previous: TransitTileSourceKeys, next: TransitTileSourceKeys): boolean {
  return previous.stops !== next.stops || previous.railRoutes !== next.railRoutes || previous.routes !== next.routes
}

function transitSourcesLoaded(map: Map): boolean {
  return ['regionfinder-stops', 'regionfinder-routes', 'regionfinder-rail-routes'].every((sourceId) => {
    if (!map.getSource(sourceId)) {
      return true
    }

    return map.isSourceLoaded(sourceId)
  })
}

export function MapLibreCanvas({
  selectedStop,
  mapBaseLayer,
  schoolCategories,
  placeCategories,
  tileModes,
  selectedTimeWindows,
  showResidentialRegions,
  residentialRadiusMeters,
  profile,
  onSelect,
  onTileLoadingChange,
}: {
  selectedStop: SelectedMapStop | null
  mapBaseLayer: MapBaseLayer
  schoolCategories: string[]
  placeCategories: PlaceCategory[]
  tileModes: string[]
  selectedTimeWindows: TravelTimeWindow[]
  showResidentialRegions: boolean
  residentialRadiusMeters: number
  profile: string
  onSelect: (selection: ApiStopSelectionPreview) => void
  onTileLoadingChange: (isLoading: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const initialTileModesRef = useRef(tileModes)
  const initialProfileRef = useRef(profile)
  const activeTransitTileSourceKeysRef = useRef(transitTileSourceKeys(tileModes, profile))
  const selectedTimeWindowsRef = useRef(selectedTimeWindows)
  const activeSchoolTileSourceKeyRef = useRef(schoolTileSourceKey(schoolCategories))
  const activePlaceTileSourceKeyRef = useRef(placeTileSourceKey(placeCategories))
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null)
  const currentHoverFeatureRef = useRef<string | null>(null)
  const residentialSettingsRef = useRef({ showResidentialRegions, residentialRadiusMeters })
  const residentialUpdateFrameRef = useRef<number | null>(null)
  const residentialSourceDataKeyRef = useRef('empty')
  const [mapReady, setMapReady] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(8.4)

  const updateResidentialRadiusSource = useCallback(() => {
    const map = mapRef.current
    const source = map?.getSource('regionfinder-residential-radius') as maplibregl.GeoJSONSource | undefined

    if (!map || !source) {
      return
    }

    const { showResidentialRegions, residentialRadiusMeters } = residentialSettingsRef.current

    if (!showResidentialRegions || !map.getLayer('regionfinder-stops-symbol')) {
      if (residentialSourceDataKeyRef.current !== 'empty') {
        source.setData({ type: 'FeatureCollection', features: [] })
        residentialSourceDataKeyRef.current = 'empty'
      }

      return
    }

    const stops: Array<{ publicId: string; name: string; lon: number; lat: number }> = []
    const seen = new Set<string>()
    const features = map.queryRenderedFeatures({ layers: ['regionfinder-stops-symbol'] })

    for (const feature of features) {
      if (feature.geometry.type !== 'Point' || !isResidentialRadiusStationFeature(feature)) {
        continue
      }

      const publicId = feature.properties?.public_id
      const name = feature.properties?.name
      const [lon, lat] = feature.geometry.coordinates

      if (
        typeof publicId !== 'string' ||
        seen.has(publicId) ||
        typeof lon !== 'number' ||
        typeof lat !== 'number'
      ) {
        continue
      }

      seen.add(publicId)
      stops.push({
        publicId,
        name: typeof name === 'string' ? name : 'StopPlace',
        lon,
        lat,
      })
    }

    stops.sort((left, right) => left.publicId.localeCompare(right.publicId))
    const sourceDataKey = `${residentialRadiusMeters}|${stops.map((stop) => stop.publicId).join('|')}`

    if (residentialSourceDataKeyRef.current === sourceDataKey) {
      return
    }

    const collection: FeatureCollection<Polygon, { publicId: string; name: string }> = {
      type: 'FeatureCollection',
      features: stops.map((stop) => ({
        type: 'Feature',
        properties: {
          publicId: stop.publicId,
          name: stop.name,
        },
        geometry: circlePolygon(stop.lon, stop.lat, residentialRadiusMeters),
      })),
    }

    source.setData(collection)
    residentialSourceDataKeyRef.current = sourceDataKey
  }, [])

  const scheduleResidentialRadiusUpdate = useCallback(() => {
    if (residentialUpdateFrameRef.current !== null) {
      return
    }

    residentialUpdateFrameRef.current = window.requestAnimationFrame(() => {
      residentialUpdateFrameRef.current = null
      updateResidentialRadiusSource()
    })
  }, [updateResidentialRadiusSource])

  useEffect(() => {
    selectedTimeWindowsRef.current = selectedTimeWindows
  }, [selectedTimeWindows])

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
    map.addControl(
      new maplibregl.ScaleControl({
        maxWidth: 140,
        unit: 'metric',
      }),
      'bottom-right',
    )
    map.on('zoom', () => {
      setZoomLevel(Number(map.getZoom().toFixed(1)))
    })
    map.on('idle', () => {
      scheduleResidentialRadiusUpdate()
    })
    map.on('sourcedata', (event) => {
      if (
        event.sourceId !== 'regionfinder-stops' &&
        event.sourceId !== 'regionfinder-routes' &&
        event.sourceId !== 'regionfinder-rail-routes'
      ) {
        return
      }

      if (transitSourcesLoaded(map)) {
        onTileLoadingChange(false)
        scheduleResidentialRadiusUpdate()
      }
    })
    map.on('load', () => {
      addTransitTileLayers(map, initialTileModesRef.current, initialProfileRef.current)
      activeTransitTileSourceKeysRef.current = transitTileSourceKeys(initialTileModesRef.current, initialProfileRef.current)
      applyRouteLayerState(map, selectedTimeWindowsRef.current)
      applyStopLayerState(map, selectedTimeWindowsRef.current)
      map.on('click', 'regionfinder-stops-symbol', (event) => {
        const selection = stopSelectionPreview(event)

        if (selection) {
          onSelect(selection)
        }
      })
      const showStopHoverPopup = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0]
        const publicId = feature?.properties?.public_id
        const fallbackName = feature?.properties?.name

        if (typeof publicId !== 'string' || publicId.length === 0) {
          return
        }

        const hoverKey = `stop:${publicId}`

        if (currentHoverFeatureRef.current === hoverKey) {
          hoverPopupRef.current?.setLngLat(event.lngLat)
          return
        }

        currentHoverFeatureRef.current = hoverKey
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
        currentHoverFeatureRef.current = null
        hoverPopupRef.current?.remove()
      })
      map.addSource('regionfinder-residential-radius', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer(
        {
          id: 'regionfinder-residential-radius-fill',
          type: 'fill',
          source: 'regionfinder-residential-radius',
          paint: {
            'fill-color': '#fbbf24',
            'fill-opacity': 0.16,
          },
        },
        'regionfinder-rail-routes-casing',
      )
      map.addLayer(
        {
          id: 'regionfinder-residential-radius-line',
          type: 'line',
          source: 'regionfinder-residential-radius',
          paint: {
            'line-color': '#f59e0b',
            'line-width': 2,
            'line-dasharray': [4, 3],
          },
        },
        'regionfinder-stops-symbol',
      )
      setMapReady(true)
    })
    mapRef.current = map

    return () => {
      if (residentialUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(residentialUpdateFrameRef.current)
        residentialUpdateFrameRef.current = null
      }
      hoverPopupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [onSelect, onTileLoadingChange, profile, scheduleResidentialRadiusUpdate])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map) {
      return
    }

    const currentTileSourceKeys = activeTransitTileSourceKeysRef.current
    const nextTileSourceKeys = transitTileSourceKeys(tileModes, profile)

    if (!transitTileSourcesChanged(currentTileSourceKeys, nextTileSourceKeys)) {
      return
    }

    onTileLoadingChange(true)

    if (currentTileSourceKeys.railRoutes !== nextTileSourceKeys.railRoutes) {
      removeRailRouteTileLayers(map)
      addRailRouteTileLayers(map, tileModes, profile)
    }

    if (currentTileSourceKeys.routes !== nextTileSourceKeys.routes) {
      removeRouteTileLayers(map)
      addRouteTileLayers(map, tileModes, profile)
    }

    if (currentTileSourceKeys.stops !== nextTileSourceKeys.stops) {
      removeStopTileLayers(map)
      addStopTileLayers(map, tileModes, profile)
    }

    activeTransitTileSourceKeysRef.current = nextTileSourceKeys
    applyRouteLayerState(map, selectedTimeWindowsRef.current)
    applyStopLayerState(map, selectedTimeWindowsRef.current)
    residentialSourceDataKeyRef.current = 'stale'
    scheduleResidentialRadiusUpdate()
    map.triggerRepaint()
  }, [mapReady, onTileLoadingChange, profile, scheduleResidentialRadiusUpdate, tileModes])

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

    applyRouteLayerState(map, selectedTimeWindows)
    onTileLoadingChange(true)
  }, [mapReady, onTileLoadingChange, selectedTimeWindows])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map) {
      return
    }

    const nextSchoolTileSourceKey = schoolTileSourceKey(schoolCategories)

    if (schoolCategories.length === 0) {
      removeSchoolTileLayer(map)
      activeSchoolTileSourceKeyRef.current = nextSchoolTileSourceKey
      return
    }

    if (
      !map.getLayer('regionfinder-schools-symbol') ||
      activeSchoolTileSourceKeyRef.current !== nextSchoolTileSourceKey
    ) {
      removeSchoolTileLayer(map)
      addSchoolTileLayer(map, schoolCategories)
      activeSchoolTileSourceKeyRef.current = nextSchoolTileSourceKey
      onTileLoadingChange(true)
    }

    const showSchoolHoverPopup = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      const id = stringFeatureProperty(feature?.properties?.id)
      const fallbackName = stringFeatureProperty(feature?.properties?.name)
      const hoverKey = `school:${id ?? fallbackName ?? event.lngLat.toString()}`

      if (currentHoverFeatureRef.current === hoverKey) {
        hoverPopupRef.current?.setLngLat(event.lngLat)
        return
      }

      currentHoverFeatureRef.current = hoverKey
      const popup =
        hoverPopupRef.current ??
        new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 12,
          className: 'school-hover-map-popup',
        })
      hoverPopupRef.current = popup

      popup
        .setLngLat(event.lngLat)
        .setDOMContent(
          createSchoolHoverPopupContent({
            name: fallbackName ?? 'Weiterführende Schule',
            schoolTypeLabel: stringFeatureProperty(feature?.properties?.school_type_label),
            schoolCategory: stringFeatureProperty(feature?.properties?.school_category),
          }),
        )
        .addTo(map)
    }

    const handleMouseEnter = (event: maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer'
      showSchoolHoverPopup(event)
    }
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
      currentHoverFeatureRef.current = null
      hoverPopupRef.current?.remove()
    }
    const handleSourceData = (event: maplibregl.MapSourceDataEvent) => {
      if (event.sourceId === 'regionfinder-schools' && map.isSourceLoaded('regionfinder-schools')) {
        onTileLoadingChange(false)
      }
    }

    map.on('mouseenter', 'regionfinder-schools-symbol', handleMouseEnter)
    map.on('mousemove', 'regionfinder-schools-symbol', showSchoolHoverPopup)
    map.on('mouseleave', 'regionfinder-schools-symbol', handleMouseLeave)
    map.on('sourcedata', handleSourceData)

    return () => {
      map.off('mouseenter', 'regionfinder-schools-symbol', handleMouseEnter)
      map.off('mousemove', 'regionfinder-schools-symbol', showSchoolHoverPopup)
      map.off('mouseleave', 'regionfinder-schools-symbol', handleMouseLeave)
      map.off('sourcedata', handleSourceData)
      handleMouseLeave()
      removeSchoolTileLayer(map)
    }
  }, [mapReady, onTileLoadingChange, schoolCategories])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map) {
      return
    }

    const nextPlaceTileSourceKey = placeTileSourceKey(placeCategories)

    if (placeCategories.length === 0) {
      removePlaceTileLayer(map)
      activePlaceTileSourceKeyRef.current = nextPlaceTileSourceKey
      return
    }

    if (
      !map.getLayer('regionfinder-places-symbol') ||
      activePlaceTileSourceKeyRef.current !== nextPlaceTileSourceKey
    ) {
      removePlaceTileLayer(map)
      addPlaceTileLayer(map, placeCategories)
      activePlaceTileSourceKeyRef.current = nextPlaceTileSourceKey
      onTileLoadingChange(true)
    }

    const showPlaceHoverPopup = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      const id = stringFeatureProperty(feature?.properties?.id)
      const fallbackName = stringFeatureProperty(feature?.properties?.name)
      const hoverKey = `place:${id ?? fallbackName ?? event.lngLat.toString()}`

      if (currentHoverFeatureRef.current === hoverKey) {
        hoverPopupRef.current?.setLngLat(event.lngLat)
        return
      }

      currentHoverFeatureRef.current = hoverKey
      const popup =
        hoverPopupRef.current ??
        new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 12,
          className: 'place-hover-map-popup',
        })
      hoverPopupRef.current = popup

      popup
        .setLngLat(event.lngLat)
        .setDOMContent(
          createPlaceHoverPopupContent({
            name: fallbackName ?? 'Ort',
            category: stringFeatureProperty(feature?.properties?.category),
            stateCode: stringFeatureProperty(feature?.properties?.state_code),
          }),
        )
        .addTo(map)
    }

    const handleMouseEnter = (event: maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer'
      showPlaceHoverPopup(event)
    }
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
      currentHoverFeatureRef.current = null
      hoverPopupRef.current?.remove()
    }
    const handleSourceData = (event: maplibregl.MapSourceDataEvent) => {
      if (event.sourceId === 'regionfinder-places' && map.isSourceLoaded('regionfinder-places')) {
        onTileLoadingChange(false)
      }
    }

    map.on('mouseenter', 'regionfinder-places-symbol', handleMouseEnter)
    map.on('mousemove', 'regionfinder-places-symbol', showPlaceHoverPopup)
    map.on('mouseleave', 'regionfinder-places-symbol', handleMouseLeave)
    map.on('sourcedata', handleSourceData)

    return () => {
      map.off('mouseenter', 'regionfinder-places-symbol', handleMouseEnter)
      map.off('mousemove', 'regionfinder-places-symbol', showPlaceHoverPopup)
      map.off('mouseleave', 'regionfinder-places-symbol', handleMouseLeave)
      map.off('sourcedata', handleSourceData)
      handleMouseLeave()
      removePlaceTileLayer(map)
    }
  }, [mapReady, onTileLoadingChange, placeCategories])

  useEffect(() => {
    const map = mapRef.current
    selectedTimeWindowsRef.current = selectedTimeWindows

    if (!mapReady || !map || !map.getLayer('regionfinder-stops-symbol')) {
      return
    }

    applyStopLayerState(map, selectedTimeWindows)
    residentialSourceDataKeyRef.current = 'stale'
    scheduleResidentialRadiusUpdate()
    map.triggerRepaint()
  }, [mapReady, scheduleResidentialRadiusUpdate, selectedTimeWindows])

  useEffect(() => {
    const map = mapRef.current

    residentialSettingsRef.current = { showResidentialRegions, residentialRadiusMeters }

    if (!mapReady || !map || !map.getSource('regionfinder-residential-radius')) {
      return
    }

    residentialSourceDataKeyRef.current = 'stale'
    scheduleResidentialRadiusUpdate()
  }, [mapReady, residentialRadiusMeters, scheduleResidentialRadiusUpdate, showResidentialRegions])

  return (
    <div className="maplibre-map-shell">
      <div ref={containerRef} className="maplibre-map" aria-label="API-basierte MapLibre-Karte" />
      <div className="map-zoom-level" aria-live="polite">
        Zoom {zoomLevel.toFixed(1)}
      </div>
    </div>
  )
}

function stopSelectionPreview(event: maplibregl.MapLayerMouseEvent): ApiStopSelectionPreview | null {
  const feature = event.features?.[0]
  const publicId = stringFeatureProperty(feature?.properties?.public_id)

  if (!publicId) {
    return null
  }

  const name = stringFeatureProperty(feature?.properties?.name) ?? 'StopPlace'
  const fastestSeconds = numericFeatureProperty(feature?.properties?.fastest_seconds)
  const routeLabels = stringFeatureProperty(feature?.properties?.route_labels)
    ?.split(', ')
    .map((label) => label.trim())
    .filter(Boolean) ?? []
  const routeCount = numericFeatureProperty(feature?.properties?.route_count)
  const coordinates = feature?.geometry.type === 'Point' ? feature.geometry.coordinates : null
  const lon = typeof coordinates?.[0] === 'number' ? coordinates[0] : event.lngLat.lng
  const lat = typeof coordinates?.[1] === 'number' ? coordinates[1] : event.lngLat.lat

  return {
    publicId,
    name,
    coordinate: { lat, lon },
    fastestSeconds,
    routeLabels,
    routeCount,
  }
}
