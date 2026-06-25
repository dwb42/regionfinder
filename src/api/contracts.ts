export type ApiMode = 'legacy' | 'api'

export type ApiLineString = {
  type: 'LineString'
  coordinates: number[][]
}

export type ApiSnapshot = {
  publicId: string
  source: {
    key: string
    name: string
    provider: string
    license: string | null
    attribution: string | null
  }
  validFrom: string | null
  validUntil: string | null
  importedAt: string | null
  activatedAt: string | null
  gtfsHash: string | null
  osmHash: string | null
  activeRoutingProfiles: Array<{
    id: string
    version: number
    name: string
  }>
  qualityStatus: string
}

export type ApiStopSearchResult = {
  publicId: string
  name: string
  dhid: string | null
  coordinate: {
    lat: number
    lon: number
  }
  stateCode: string | null
  municipalityName: string | null
  modes: string[]
  identityQuality: string
}

export type ApiStopDetails = ApiStopSearchResult & {
  dataStand: {
    snapshotId: string
    qualityStatus: string
  }
  technicalStops: Array<{
    sourceStopId: string
    name: string
    platformCode: string | null
    locationType: number | null
    quayType: string | null
  }>
  servedRoutes: Array<{
    routePatternId: string
    shortName: string | null
    longName: string | null
    mode: string
    agencyName: string | null
    directionId: number | null
    geometryQuality: string
  }>
}

export type ApiMetrics = {
  snapshotId: string
  profileId: string
  metricDefinitionVersion: string
  fastestSeconds: number | null
  averageSeconds: number | null
  medianSeconds: number | null
  p90Seconds: number | null
  p90Publishable: boolean
  medianPublishable: boolean
  totalSampleCount: number
  reachableSampleCount: number
  unreachableSampleCount: number
  reachabilityRatio: number
  directConnectionRatio: number | null
  minimumTransfers: number | null
  medianTransfers: number | null
  averageInitialWaitSeconds: number | null
  averageWalkSeconds: number | null
  averageInVehicleSeconds: number | null
  firstConnectionAt: string | null
  lastConnectionAt: string | null
  maxServiceGapSeconds: number | null
  quantileMethod: 'nearest-rank-p90'
}

export type ApiItineraryLeg = {
  sequence: number
  legType: 'walk' | 'transit' | 'transfer' | 'wait'
  mode: string | null
  routeName: string | null
  agencyName: string | null
  fromName: string | null
  toName: string | null
  departureAt: string | null
  arrivalAt: string | null
  durationSeconds: number | null
  distanceMeters: number | null
  geometry: ApiLineString | null
  headsign: string | null
  platformFrom: string | null
  platformTo: string | null
  plannedDepartureAt?: string | null
  plannedArrivalAt?: string | null
  departureDelaySeconds?: number | null
  arrivalDelaySeconds?: number | null
  cancelled?: boolean
  remarks?: string[]
}

export type ApiItinerary = {
  rankType: 'earliest_arrival' | 'fewest_transfers' | 'least_walking' | 'direct'
  provider: string
  requestedDepartureAt: string
  actualFirstDepartureAt: string | null
  arrivalAt: string | null
  totalDurationSeconds: number | null
  initialWalkSeconds: number | null
  initialWaitSeconds: number | null
  inVehicleSeconds: number | null
  transferWaitSeconds: number | null
  walkingSeconds: number | null
  walkingDistanceMeters: number | null
  transitDistanceMeters: number | null
  totalDistanceMeters: number | null
  transferCount: number | null
  legs: ApiItineraryLeg[]
  refreshToken?: string | null
  realtimeSource?: string | null
  realtimeFetchedAt?: string | null
}

export type ApiItineraryResponse = {
  snapshotId: string
  requestedDeparture: string
  originId: string
  destinationPublicId: string
  alternatives: ApiItinerary[]
}

export type ApiRoutePattern = {
  id: string
  route: {
    shortName: string | null
    longName: string | null
    mode: string
    agencyName: string | null
  }
  directionId: number | null
  headsign: string | null
  geometry: ApiLineString | null
  geometryQuality: string
  geometrySource: string
  lengthMeters: number | null
  stops: Array<{
    sequence: number
    publicId: string
    name: string
    platformCode: string | null
  }>
  tripCount: number
}
