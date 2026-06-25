/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiDrivingRouteResponse, ApiStopDetails } from '../api/contracts'

const apiMocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    readonly status: number
    readonly statusText: string
    readonly errorCode: string | null

    constructor(path: string, status: number, statusText: string, errorCode: string | null, message: string) {
      super(message || `${path}: ${status} ${statusText}`)
      this.name = 'ApiError'
      this.status = status
      this.statusText = statusText
      this.errorCode = errorCode
    }
  },
  fetchCurrentSnapshot: vi.fn(),
  fetchDrivingRoute: vi.fn(),
  fetchRealtimeItineraries: vi.fn(),
  fetchStopDetails: vi.fn(),
  fetchStopMetrics: vi.fn(),
}))

vi.mock('../data/api', () => apiMocks)

import { useSelectedStopDetails } from './hooks'

const reactActGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

const stopDetails: ApiStopDetails = {
  publicId: 'de:01056:9001',
  name: 'Aumuehle Testbahnhof',
  dhid: 'de:01056:9001',
  coordinate: { lat: 53.529, lon: 10.314 },
  stateCode: 'DE-SH',
  municipalityName: 'Aumuehle',
  modes: ['RE'],
  identityQuality: 'dhid',
  dataStand: { snapshotId: 'fixture-synthetic-2026-07', qualityStatus: 'fixture_ready' },
  technicalStops: [],
  servedRoutes: [],
}

const drivingRoute: ApiDrivingRouteResponse = {
  originName: 'Hamburg Hbf',
  destinationPublicId: stopDetails.publicId,
  provider: 'osrm',
  durationSeconds: 1800,
  distanceMeters: 28_000,
  sourceAttribution: 'Route: OSRM; Kartendaten: OpenStreetMap-Mitwirkende',
}

let latestState: ReturnType<typeof useSelectedStopDetails> | null = null
let root: Root | null = null
let container: HTMLDivElement | null = null
const setStatusMock = vi.fn()

function Probe() {
  const state = useSelectedStopDetails({
    selectedPublicId: stopDetails.publicId,
    departureTime: '08:00',
    profile: 'regular_tue_thu',
    setStatus: setStatusMock,
  })

  useEffect(() => {
    latestState = state
  }, [state])

  return null
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1000

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for hook state')
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('useSelectedStopDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestState = null
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    apiMocks.fetchStopDetails.mockResolvedValue(stopDetails)
    apiMocks.fetchStopMetrics.mockResolvedValue(null)
    apiMocks.fetchRealtimeItineraries.mockRejectedValue(new Error('DB unavailable'))
    apiMocks.fetchDrivingRoute.mockResolvedValue(drivingRoute)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
    }

    container?.remove()
    root = null
    container = null
  })

  it('keeps driving route state independent from realtime failures', async () => {
    await act(async () => {
      root?.render(<Probe />)
    })

    await waitFor(() => latestState?.drivingRoute.status === 'ready')

    expect(latestState?.selectedStop?.publicId).toBe(stopDetails.publicId)
    expect(latestState?.drivingRoute.response).toMatchObject({
      destinationPublicId: stopDetails.publicId,
      durationSeconds: 1800,
    })
    expect(latestState?.realtimeItineraries).toMatchObject({
      status: 'error',
      error: 'DB unavailable',
    })
  })
})
