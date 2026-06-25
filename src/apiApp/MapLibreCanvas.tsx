import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeatureCollection, Polygon } from 'geojson'
import maplibregl, { type Map } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { ApiStopDetails } from '../api/contracts'
import type { MapBaseLayer, TravelTimeWindow } from './config'
import {
  addTransitTileLayers,
  applyRouteLayerState,
  applyStopLayerState,
  circlePolygon,
  createStopHoverPopupContent,
  mapLibreBaseStyle,
  numericFeatureProperty,
  removeTransitTileLayers,
  stringFeatureProperty,
} from './mapLayers'

export function MapLibreCanvas({
  selectedStop,
  mapBaseLayer,
  tileModes,
  selectedTimeWindows,
  showResidentialRegions,
  residentialRadiusMeters,
  profile,
  onSelect,
  onTileLoadingChange,
}: {
  selectedStop: ApiStopDetails | null
  mapBaseLayer: MapBaseLayer
  tileModes: string[]
  selectedTimeWindows: TravelTimeWindow[]
  showResidentialRegions: boolean
  residentialRadiusMeters: number
  profile: string
  onSelect: (publicId: string) => void
  onTileLoadingChange: (isLoading: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const initialTileModesRef = useRef(tileModes)
  const selectedTimeWindowsRef = useRef(selectedTimeWindows)
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null)
  const currentHoverPublicIdRef = useRef<string | null>(null)
  const residentialSettingsRef = useRef({ showResidentialRegions, residentialRadiusMeters })
  const [mapReady, setMapReady] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(8.4)

  const updateResidentialRadiusSource = useCallback(() => {
    const map = mapRef.current
    const source = map?.getSource('regionfinder-residential-radius') as maplibregl.GeoJSONSource | undefined

    if (!map || !source) {
      return
    }

    const { showResidentialRegions, residentialRadiusMeters } = residentialSettingsRef.current
    const stops: Array<{ publicId: string; name: string; lon: number; lat: number }> = []

    if (showResidentialRegions && map.getLayer('regionfinder-stops-symbol')) {
      const seen = new Set<string>()
      const features = map.queryRenderedFeatures({ layers: ['regionfinder-stops-symbol'] })

      for (const feature of features) {
        if (feature.geometry.type !== 'Point') {
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
  }, [])

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
      updateResidentialRadiusSource()
    })
    map.on('load', () => {
      addTransitTileLayers(map, initialTileModesRef.current, profile)
      applyRouteLayerState(map)
      applyStopLayerState(map, selectedTimeWindowsRef.current)
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
        'regionfinder-routes-line',
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
      hoverPopupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [onSelect, onTileLoadingChange, profile, updateResidentialRadiusSource])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map) {
      return
    }

    onTileLoadingChange(true)
    removeTransitTileLayers(map)
    addTransitTileLayers(map, tileModes, profile)
    applyRouteLayerState(map)
    applyStopLayerState(map, selectedTimeWindowsRef.current)
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
    selectedTimeWindowsRef.current = selectedTimeWindows

    if (!mapReady || !map || !map.getLayer('regionfinder-stops-symbol')) {
      return
    }

    applyStopLayerState(map, selectedTimeWindows)
    updateResidentialRadiusSource()
    map.triggerRepaint()
  }, [mapReady, selectedTimeWindows, updateResidentialRadiusSource])

  useEffect(() => {
    const map = mapRef.current

    residentialSettingsRef.current = { showResidentialRegions, residentialRadiusMeters }

    if (!mapReady || !map || !map.getSource('regionfinder-residential-radius')) {
      return
    }

    updateResidentialRadiusSource()
  }, [mapReady, residentialRadiusMeters, showResidentialRegions, updateResidentialRadiusSource])

  return (
    <div className="maplibre-map-shell">
      <div ref={containerRef} className="maplibre-map" aria-label="API-basierte MapLibre-Karte" />
      <div className="map-zoom-level" aria-live="polite">
        Zoom {zoomLevel.toFixed(1)}
      </div>
    </div>
  )
}
