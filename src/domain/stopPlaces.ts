import type { StopPlace } from './types'

export const defaultStartStopPlaceName = 'Hamburg Hbf'

export function findDefaultStartStopPlace(stopPlaces: StopPlace[]): StopPlace | null {
  return (
    stopPlaces.find((stopPlace) => stopPlace.name === defaultStartStopPlaceName) ??
    stopPlaces.find((stopPlace) => stopPlace.name.toLocaleLowerCase('de-DE').includes('hamburg hbf')) ??
    null
  )
}

export function stopPlaceLabel(stopPlace: StopPlace): string {
  const place = stopPlace.city && stopPlace.city !== stopPlace.name ? ` - ${stopPlace.city}` : ''
  return `${stopPlace.name}${place} (${stopPlace.coordinates.lat.toFixed(4)}, ${stopPlace.coordinates.lon.toFixed(4)})`
}
