import { useEffect, useRef, useState } from 'react'
import type { FeatureCollection, Polygon } from 'geojson'
import maplibregl, { type Map } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { ApiStopDetails, ApiStopSearchResult } from '../api/contracts'
import type { MapBaseLayer } from './config'
import {
  addTransitTileLayers,
  applyRouteLayerState,
  circlePolygon,
  createStopHoverPopupContent,
  mapLibreBaseStyle,
  numericFeatureProperty,
  removeTransitTileLayers,
  stringFeatureProperty,
} from './mapLayers'

export function MapLibreCanvas({
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
