export type Coordinates = {
  lat: number
  lon: number
}

export type StationType = 'hauptbahnhof' | 'regional' | 's-bahn' | 'u-bahn' | 'bus' | 'faehre' | 'halt'

export type TransitMode = 'RE' | 'RB' | 'S' | 'ICE' | 'TRAM' | 'U' | 'RAIL' | 'BUS' | 'FERRY' | 'AKN'

export type StopPlace = {
  id: string
  name: string
  coordinates: Coordinates
  modes: TransitMode[]
  stopIds: string[]
  city?: string
  state?: string
  region?: string
  layerIds?: HvvLayerId[]
}

export type Station = {
  id: string
  name: string
  city: string
  state: string
  region: string
  coordinates: Coordinates
  type: StationType
  sourceStopId?: string
  parentStationId?: string
  platformCode?: string
  locationType?: number
  wheelchairBoarding?: number
}

export type RouteService = {
  id: string
  name: string
  operator: string
  color: string
  mode: TransitMode
  stops: Array<{
    stationId: string
    offsetMinutes: number
  }>
  firstDepartureMinutes: number
  lastDepartureMinutes: number
  intervalMinutes: number
  activeDays: 'weekday'
  agencyId?: string
  routeShortName?: string
  routeLongName?: string
  routeType?: number
  routeColor?: string
  routeTextColor?: string
}

export type RailwayLine = {
  id: string
  name: string
  color: string
  stationIds: string[]
  mode?: TransitMode
  source?: 'seed' | 'hvv-gtfs'
  geometry?: Coordinates[]
  routeShortName?: string
  routeLongName?: string
  agencyId?: string
  routeType?: number
  textColor?: string
}

export type TimeWindow = 30 | 45 | 60 | 75 | 90

export type AutoRadiusOption = 10 | 15 | 20

export type ConnectionLeg = {
  routeId: string
  routeName: string
  operator: string
  color: string
  fromStationId: string
  toStationId: string
  departureMinutes: number
  arrivalMinutes: number
}

export type ReachabilityConnectionType = 'direct' | 'transfer'

export type ReachabilityResult = {
  originStopPlaceId: string
  targetStopPlaceId: string
  departureMinutes: number
  arrivalMinutes: number
  travelTimeMinutes: number
  transfers: number
  connectionType: ReachabilityConnectionType
  legs: ConnectionLeg[]
  weekdayConnectionCount: number
  weekendConnectionCount: number
}

export type ReachabilityWorkerStatus = 'idle' | 'loading index' | 'calculating' | 'ready' | 'error'

export type ReachableDestination = {
  station: Station
  travelTimeMinutes: number
  transfers: number
  distanceKm: number
  departureMinutes: number
  arrivalMinutes: number
  legs: ConnectionLeg[]
}

export type GtfsImportShape = {
  stops: Array<{
    stop_id: string
    stop_name: string
    stop_lat: number
    stop_lon: number
  }>
  routes: Array<{
    route_id: string
    route_short_name: string
    route_type: number
  }>
  trips: Array<{
    trip_id: string
    route_id: string
    service_id: string
    shape_id?: string
    direction_id?: string
  }>
  stopTimes: Array<{
    trip_id: string
    stop_id: string
    arrival_time: string
    departure_time: string
    stop_sequence: number
  }>
  calendar: Array<{
    service_id: string
    monday: 0 | 1
    tuesday: 0 | 1
    wednesday: 0 | 1
    thursday: 0 | 1
    friday: 0 | 1
    saturday: 0 | 1
    sunday: 0 | 1
    start_date: string
    end_date: string
  }>
  calendarDates?: Array<{
    service_id: string
    date: string
    exception_type: 1 | 2
  }>
  agency?: Array<{
    agency_id?: string
    agency_name: string
  }>
  shapes?: Array<{
    shape_id: string
    shape_pt_lat: number
    shape_pt_lon: number
    shape_pt_sequence: number
  }>
}

export type HvvLayerId = 'regional' | 's-bahn' | 'u-bahn' | 'bus' | 'faehre'

export type HvvStation = Station & {
  source: 'hvv-gtfs'
}

export type HvvRoute = RailwayLine & {
  source: 'hvv-gtfs'
  sourceRouteId?: string
  mode: TransitMode
  layer: HvvLayerId
  stopIds: string[]
}

export type HvvManifest = {
  schemaVersion?: number
  sourceName: string
  sourceUrl: string
  attribution: string
  license: string
  importedAt: string
  sourceGtfsDate?: string
  generatedFrom: string
  hasShapes: boolean
  counts: {
    agencies: number
    stops: number
    routes: number
    trips: number
    stopTimes: number
    shapes: number
    services: number
    calendarDates: number
  }
  serviceDateRange?: {
    start: string
    end: string
  }
}

export type HvvReachabilityRouteMeta = {
  id: string
  name: string
  operator: string
  color: string
  mode: TransitMode
  layer: HvvLayerId
}

export type HvvReachabilityTrip = [
  routeIndex: number,
  serviceMask: number,
  stopPlaceIndexes: number[],
  departureMinutes: number[],
  arrivalMinutes: number[],
]

export type HvvReachabilityTransferEdge = [
  fromStopPlaceIndex: number,
  toStopPlaceIndex: number,
  transferMinutes: number,
]

export type HvvReachabilityIndex = {
  schemaVersion: number
  sourceGtfsDate: string
  importedAt: string
  stopPlaceIds: string[]
  routes: HvvReachabilityRouteMeta[]
  trips: HvvReachabilityTrip[]
  transferEdges?: HvvReachabilityTransferEdge[]
  weekdayStopCounts: number[]
  weekendStopCounts: number[]
}
