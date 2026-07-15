import type { CSSProperties } from 'react'
import type { ApiDrivingRouteResponse, ApiItineraryResponse, PlaceCategory } from '../api/contracts'

export const defaultProfile = import.meta.env.VITE_REGIONFINDER_ROUTING_PROFILE || 'regular_tue_thu'
export const defaultDepartureTime = '08:00'

export type ModeLayerId = 'regional' | 's-bahn' | 'u-bahn' | 'bus'
export type MapBaseLayer = 'street' | 'satellite'
export type SchoolPoiLayerId = 'gymnasium' | 'other-secondary'
export type PlaceLayerId = PlaceCategory
export type TravelTimeWindow = 30 | 45 | 60 | 75 | 90
export type MapUpdateState = 'idle' | 'loading' | 'complete'
export type RealtimeItineraryState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  response: ApiItineraryResponse | null
  error: string | null
}
export type DrivingRouteState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  response: ApiDrivingRouteResponse | null
  error: string | null
}

export const modeLayerDefinitions: Array<{
  id: ModeLayerId
  label: string
  modes: string[]
}> = [
  { id: 'regional', label: 'Regional/Fern', modes: ['ICE', 'IC', 'EC', 'RE', 'RB', 'RAIL'] },
  { id: 's-bahn', label: 'S-Bahn/AKN', modes: ['S', 'AKN'] },
  { id: 'u-bahn', label: 'U-Bahn', modes: ['U'] },
  { id: 'bus', label: 'Bus', modes: ['BUS', 'TRAM'] },
]

export const schoolPoiLayerDefinitions: Array<{
  id: SchoolPoiLayerId
  label: string
  categories: string[]
}> = [
  { id: 'gymnasium', label: 'Gymnasium', categories: ['gymnasium'] },
  {
    id: 'other-secondary',
    label: 'andere weiterf. Schulen',
    categories: ['comprehensive', 'waldorf', 'vocational', 'upper_secondary'],
  },
]

export const placeLayerDefinitions: Array<{
  id: PlaceLayerId
  label: string
  categories: PlaceCategory[]
}> = [
  { id: 'hof', label: 'Höfe', categories: ['hof'] },
  { id: 'ferienhof', label: 'Ferienhöfe', categories: ['ferienhof'] },
  { id: 'gut', label: 'Güter', categories: ['gut'] },
  { id: 'museum', label: 'Museen', categories: ['museum'] },
]

export const travelTimeWindows: TravelTimeWindow[] = [30, 45, 60, 75, 90]
export const residentialRadiusOptions = [5, 10, 15, 20]
export const estimatedResidentialRadiusKmPerMinute = 0.75
export const travelTimeWindowColors: Record<TravelTimeWindow, string> = {
  30: '#15803d',
  45: '#0f766e',
  60: '#ca8a04',
  75: '#ea580c',
  90: '#b91c1c',
}

export function travelTimeChipStyle(window: TravelTimeWindow): CSSProperties {
  return { '--chip-color': travelTimeWindowColors[window] } as CSSProperties
}
