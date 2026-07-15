import type { RegionfinderRepository, StopSearchFilters, ItineraryQuery } from './types'
import type {
  ApiItineraryResponse,
  ApiMetrics,
  ApiPlace,
  ApiPlaceCreateRequest,
  ApiPlaceUpdateRequest,
  ApiRoutePattern,
  ApiSnapshot,
  ApiStopDetails,
  ApiStopSearchResult,
  PlaceCategory,
} from '../../src/api/contracts'

const snapshot: ApiSnapshot = {
  publicId: 'fixture-synthetic-2026-07',
  source: {
    key: 'synthetic_gtfs',
    name: 'Synthetic Regionfinder GTFS Fixture',
    provider: 'Regionfinder tests',
    license: 'CC0 test data',
    attribution: 'Synthetic fixture generated for Regionfinder tests.',
  },
  validFrom: '2026-07-06',
  validUntil: '2026-07-15',
  importedAt: '2026-06-24T08:00:00.000Z',
  activatedAt: '2026-06-24T08:05:00.000Z',
  gtfsHash: 'fixture',
  osmHash: null,
  activeRoutingProfiles: [{ id: 'regular_tue_thu', version: 1, name: 'Regulärer Dienstag bis Donnerstag' }],
  qualityStatus: 'fixture_ready',
}

const stops: ApiStopDetails[] = [
  {
    publicId: 'de:02000:8002549',
    name: 'Hamburg Hbf',
    dhid: 'de:02000:8002549',
    coordinate: { lat: 53.552733, lon: 10.006909 },
    stateCode: 'DE-HH',
    municipalityName: 'Hamburg',
    modes: ['ICE', 'RE', 'S', 'U', 'BUS'],
    identityQuality: 'dhid',
    dataStand: { snapshotId: snapshot.publicId, qualityStatus: snapshot.qualityStatus },
    technicalStops: [
      {
        sourceStopId: 'hbf-rail-1',
        name: 'Hamburg Hbf Gleis 1',
        platformCode: '1',
        locationType: 0,
        quayType: 'rail_platform',
      },
      {
        sourceStopId: 'hbf-bus-a',
        name: 'Hamburg Hbf Bus A',
        platformCode: 'A',
        locationType: 0,
        quayType: 'bus_stop',
      },
    ],
    servedRoutes: [],
  },
  {
    publicId: 'de:01056:9001',
    name: 'Aumuehle Testbahnhof',
    dhid: 'de:01056:9001',
    coordinate: { lat: 53.529, lon: 10.314 },
    stateCode: 'DE-SH',
    municipalityName: 'Aumuehle',
    modes: ['RE', 'BUS'],
    identityQuality: 'dhid',
    dataStand: { snapshotId: snapshot.publicId, qualityStatus: snapshot.qualityStatus },
    technicalStops: [
      {
        sourceStopId: 'aum-rail-1',
        name: 'Aumuehle Gleis 1',
        platformCode: '1',
        locationType: 0,
        quayType: 'rail_platform',
      },
    ],
    servedRoutes: [
      {
        routePatternId: 'pattern-r1-direct',
        shortName: 'RE1',
        longName: 'Hamburg - Aumuehle',
        mode: 'RE',
        agencyName: 'Fixture Rail',
        directionId: 0,
        geometryQuality: 'official_gtfs',
      },
    ],
  },
  {
    publicId: 'de:02000:8002550',
    name: 'Bergedorf Fixture',
    dhid: 'de:02000:8002550',
    coordinate: { lat: 53.4897, lon: 10.2039 },
    stateCode: 'DE-HH',
    municipalityName: 'Hamburg',
    modes: ['RE', 'S', 'BUS'],
    identityQuality: 'dhid',
    dataStand: { snapshotId: snapshot.publicId, qualityStatus: snapshot.qualityStatus },
    technicalStops: [
      {
        sourceStopId: 'berg-rail-1',
        name: 'Bergedorf Fixture Gleis 1',
        platformCode: '1',
        locationType: 0,
        quayType: 'rail_platform',
      },
    ],
    servedRoutes: [
      {
        routePatternId: 'pattern-r1-short',
        shortName: 'RE1',
        longName: 'Hamburg - Bergedorf',
        mode: 'RE',
        agencyName: 'Fixture Rail',
        directionId: 0,
        geometryQuality: 'official_gtfs',
      },
    ],
  },
  {
    publicId: 'de:01056:9100',
    name: 'Busdorf Mitte',
    dhid: null,
    coordinate: { lat: 53.545, lon: 10.39 },
    stateCode: 'DE-SH',
    municipalityName: 'Busdorf',
    modes: ['BUS'],
    identityQuality: 'missing_dhid',
    dataStand: { snapshotId: snapshot.publicId, qualityStatus: snapshot.qualityStatus },
    technicalStops: [
      {
        sourceStopId: 'busdorf-a',
        name: 'Busdorf Mitte Mast A',
        platformCode: 'A',
        locationType: 0,
        quayType: 'bus_stop',
      },
    ],
    servedRoutes: [
      {
        routePatternId: 'pattern-b7-bus-only',
        shortName: 'B7',
        longName: 'Aumuehle - Busdorf',
        mode: 'BUS',
        agencyName: 'Fixture Bus',
        directionId: 0,
        geometryQuality: 'stop_sequence_approximation',
      },
    ],
  },
]

const metricsByStop = new Map<string, ApiMetrics>([
  [
    'de:01056:9001',
    {
      snapshotId: snapshot.publicId,
      profileId: 'regular_tue_thu',
      metricDefinitionVersion: '2026-06-25.fastest-day-exact-stop',
      fastestSeconds: 40 * 60,
      directConnectionCount: 18,
    },
  ],
  [
    'de:02000:8002550',
    {
      snapshotId: snapshot.publicId,
      profileId: 'regular_tue_thu',
      metricDefinitionVersion: '2026-06-25.fastest-day-exact-stop',
      fastestSeconds: 25 * 60,
      directConnectionCount: 24,
    },
  ],
  [
    'de:01056:9100',
    {
      snapshotId: snapshot.publicId,
      profileId: 'regular_tue_thu',
      metricDefinitionVersion: '2026-06-25.fastest-day-exact-stop',
      fastestSeconds: 58 * 60,
      directConnectionCount: 0,
    },
  ],
])

const fixturePlaces: ApiPlace[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    sourceId: 'fixture_places',
    sourcePlaceId: 'gut-1',
    origin: 'imported',
    category: 'gut',
    name: 'Gut Testfeld',
    stateCode: 'SH',
    address: 'Testweg 1, 22900 Testfeld',
    website: 'https://example.test/gut-testfeld',
    coordinate: { lat: 53.61, lon: 10.31 },
    rawProperties: {},
    importedAt: '2026-07-01T08:00:00.000Z',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
    deletedAt: null,
  },
]

function searchText(stop: ApiStopSearchResult): string {
  return [stop.publicId, stop.name, stop.dhid, stop.municipalityName].filter(Boolean).join(' ').toLocaleLowerCase('de-DE')
}

export class FixtureRepository implements RegionfinderRepository {
  async currentSnapshot(): Promise<ApiSnapshot> {
    return snapshot
  }

  async searchStops(filters: StopSearchFilters): Promise<ApiStopSearchResult[]> {
    const query = filters.query.toLocaleLowerCase('de-DE')

    return stops
      .filter((stop) => (query ? searchText(stop).includes(query) : true))
      .filter((stop) => (filters.states.length ? filters.states.includes(stop.stateCode ?? '') : true))
      .filter((stop) => (filters.modes.length ? stop.modes.some((mode) => filters.modes.includes(mode)) : true))
      .slice(0, filters.limit)
      .map((stop) => ({
        publicId: stop.publicId,
        name: stop.name,
        dhid: stop.dhid,
        coordinate: stop.coordinate,
        stateCode: stop.stateCode,
        municipalityName: stop.municipalityName,
        modes: stop.modes,
        identityQuality: stop.identityQuality,
      }))
  }

  async stopDetails(publicId: string): Promise<ApiStopDetails | null> {
    return stops.find((stop) => stop.publicId === publicId) ?? null
  }

  async stopMetrics(publicId: string, profile: string, _snapshot?: string, _date?: string): Promise<ApiMetrics | null> {
    void _snapshot
    void _date

    const metrics = metricsByStop.get(publicId)

    return metrics && metrics.profileId === profile ? metrics : null
  }

  async itineraries(query: ItineraryQuery): Promise<ApiItineraryResponse | null> {
    if (!stops.some((stop) => stop.publicId === query.publicId)) {
      return null
    }

    const requestedDeparture = `${query.date}T${query.time}:00+02:00`

    return {
      snapshotId: snapshot.publicId,
      requestedDeparture,
      originId: 'hamburg-hbf',
      destinationPublicId: query.publicId,
      alternatives: [
        {
          rankType: 'earliest_arrival',
          provider: 'fixture-local',
          requestedDepartureAt: requestedDeparture,
          actualFirstDepartureAt: `${query.date}T08:10:00+02:00`,
          arrivalAt: `${query.date}T08:40:00+02:00`,
          totalDurationSeconds: 40 * 60,
          initialWalkSeconds: 4 * 60,
          initialWaitSeconds: 6 * 60,
          inVehicleSeconds: 30 * 60,
          transferWaitSeconds: 0,
          walkingSeconds: 4 * 60,
          walkingDistanceMeters: 260,
          transitDistanceMeters: 19_800,
          totalDistanceMeters: 20_060,
          transferCount: query.publicId === 'de:01056:9100' ? 1 : 0,
          legs: [
            {
              sequence: 1,
              legType: 'walk',
              mode: 'WALK',
              routeName: null,
              agencyName: null,
              fromName: 'Hamburg Hbf Origin',
              toName: 'Hamburg Hbf Gleis 1',
              departureAt: requestedDeparture,
              arrivalAt: `${query.date}T08:04:00+02:00`,
              durationSeconds: 4 * 60,
              distanceMeters: 260,
              geometry: null,
              headsign: null,
              platformFrom: null,
              platformTo: '1',
            },
            {
              sequence: 2,
              legType: 'wait',
              mode: null,
              routeName: null,
              agencyName: null,
              fromName: 'Hamburg Hbf Gleis 1',
              toName: 'Hamburg Hbf Gleis 1',
              departureAt: `${query.date}T08:04:00+02:00`,
              arrivalAt: `${query.date}T08:10:00+02:00`,
              durationSeconds: 6 * 60,
              distanceMeters: 0,
              geometry: null,
              headsign: null,
              platformFrom: '1',
              platformTo: '1',
            },
            {
              sequence: 3,
              legType: 'transit',
              mode: 'RE',
              routeName: 'RE1',
              agencyName: 'Fixture Rail',
              fromName: 'Hamburg Hbf',
              toName: query.publicId === 'de:01056:9100' ? 'Aumuehle Testbahnhof' : 'Aumuehle Testbahnhof',
              departureAt: `${query.date}T08:10:00+02:00`,
              arrivalAt: `${query.date}T08:40:00+02:00`,
              durationSeconds: 30 * 60,
              distanceMeters: 19_800,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [10.006909, 53.552733],
                  [10.314, 53.529],
                ],
              },
              headsign: 'Aumuehle',
              platformFrom: '1',
              platformTo: '1',
            },
          ],
        },
      ],
    }
  }

  async routePattern(id: string): Promise<ApiRoutePattern | null> {
    if (id !== 'pattern-r1-direct' && id !== 'pattern-b7-bus-only') {
      return null
    }

    return {
      id,
      route: {
        shortName: id === 'pattern-r1-direct' ? 'RE1' : 'B7',
        longName: id === 'pattern-r1-direct' ? 'Hamburg - Aumuehle' : 'Aumuehle - Busdorf',
        mode: id === 'pattern-r1-direct' ? 'RE' : 'BUS',
        agencyName: id === 'pattern-r1-direct' ? 'Fixture Rail' : 'Fixture Bus',
      },
      directionId: 0,
      headsign: id === 'pattern-r1-direct' ? 'Aumuehle' : 'Busdorf',
      geometry:
        id === 'pattern-r1-direct'
          ? {
              type: 'LineString',
              coordinates: [
                [10.006909, 53.552733],
                [10.314, 53.529],
              ],
            }
          : null,
      geometryQuality: id === 'pattern-r1-direct' ? 'official_gtfs' : 'stop_sequence_approximation',
      geometrySource: id === 'pattern-r1-direct' ? 'synthetic_gtfs' : 'missing_shape_fallback',
      lengthMeters: id === 'pattern-r1-direct' ? 19_800 : null,
      stops: [
        { sequence: 1, publicId: 'de:02000:8002549', name: 'Hamburg Hbf', platformCode: '1' },
        { sequence: 2, publicId: 'de:01056:9001', name: 'Aumuehle Testbahnhof', platformCode: '1' },
      ],
      tripCount: 12,
    }
  }

  async listPlaces(
    categories: PlaceCategory[] = [],
    states: string[] = [],
    query = '',
    limit = 100,
  ): Promise<ApiPlace[]> {
    const normalizedQuery = query.toLocaleLowerCase('de-DE')

    return fixturePlaces
      .filter((place) => !place.deletedAt)
      .filter((place) => (categories.length ? categories.includes(place.category) : true))
      .filter((place) => (states.length ? states.includes(place.stateCode ?? '') : true))
      .filter((place) => {
        if (!normalizedQuery) {
          return true
        }

        return [place.name, place.address].filter(Boolean).join(' ').toLocaleLowerCase('de-DE').includes(normalizedQuery)
      })
      .slice(0, limit)
  }

  async place(id: string): Promise<ApiPlace | null> {
    return fixturePlaces.find((place) => place.id === id && !place.deletedAt) ?? null
  }

  async createPlace(input: ApiPlaceCreateRequest): Promise<ApiPlace> {
    const now = new Date().toISOString()
    const place: ApiPlace = {
      id: crypto.randomUUID(),
      sourceId: input.sourceId ?? null,
      sourcePlaceId: input.sourcePlaceId ?? null,
      origin: 'manual',
      category: input.category,
      name: input.name,
      stateCode: input.stateCode ?? null,
      address: input.address ?? null,
      website: input.website ?? null,
      coordinate: input.coordinate,
      rawProperties: {},
      importedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }

    fixturePlaces.push(place)

    return place
  }

  async updatePlace(id: string, input: ApiPlaceUpdateRequest): Promise<ApiPlace | null> {
    const place = fixturePlaces.find((entry) => entry.id === id && !entry.deletedAt)

    if (!place) {
      return null
    }

    Object.assign(place, {
      category: input.category ?? place.category,
      name: input.name ?? place.name,
      stateCode: input.stateCode === undefined ? place.stateCode : input.stateCode,
      address: input.address === undefined ? place.address : input.address,
      website: input.website === undefined ? place.website : input.website,
      coordinate: input.coordinate ?? place.coordinate,
      updatedAt: new Date().toISOString(),
    })

    return place
  }

  async deletePlace(id: string): Promise<boolean> {
    const place = fixturePlaces.find((entry) => entry.id === id && !entry.deletedAt)

    if (!place) {
      return false
    }

    const now = new Date().toISOString()
    place.deletedAt = now
    place.updatedAt = now

    return true
  }

  async stopTile(): Promise<Buffer | null> {
    return Buffer.alloc(0)
  }

  async routeTile(_z?: number, _x?: number, _y?: number, _modes?: string[], _profile?: string): Promise<Buffer | null> {
    void _z
    void _x
    void _y
    void _modes
    void _profile

    return Buffer.alloc(0)
  }

  async railNetworkTile(): Promise<Buffer | null> {
    return Buffer.alloc(0)
  }

  async schoolTile(
    _z?: number,
    _x?: number,
    _y?: number,
    _categories?: string[],
    _states?: string[],
  ): Promise<Buffer | null> {
    void _z
    void _x
    void _y
    void _categories
    void _states

    return Buffer.alloc(0)
  }

  async placeTile(
    _z?: number,
    _x?: number,
    _y?: number,
    _categories?: PlaceCategory[],
    _states?: string[],
  ): Promise<Buffer | null> {
    void _z
    void _x
    void _y
    void _categories
    void _states

    return Buffer.alloc(0)
  }
}
