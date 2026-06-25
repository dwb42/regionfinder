type Coordinates = {
  lat: number
  lon: number
}

const earthRadiusKm = 6371

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

export function distanceKm(from: Coordinates, to: Coordinates): number {
  const deltaLat = toRadians(to.lat - from.lat)
  const deltaLon = toRadians(to.lon - from.lon)
  const fromLat = toRadians(from.lat)
  const toLat = toRadians(to.lat)

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function roundDistance(value: number): number {
  return Math.round(value * 10) / 10
}
