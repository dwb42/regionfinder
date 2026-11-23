/**
 * @vitest-environment jsdom
 */
import { act, StrictMode, useEffect } from 'react'
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

function Probe({ publicId = stopDetails.publicId, departureTime = '08:00' }: { publicId?: string | null; departureTime?: string }) {
  const state = useSelectedStopDetails({
    selectedPublicId: publicId,
    departureTime,
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
  it('shows routes without waiting for metrics or stop details', async () => {
    apiMocks.fetchStopMetrics.mockReturnValue(new Promise(() => {}))
    apiMocks.fetchStopDetails.mockReturnValue(new Promise(() => {}))
    await act(async () => { root?.render(<Probe />) })
    expect(latestState?.drivingRoute.status).toBe('ready')
    expect(latestState?.realtimeItineraries.status).toBe('error')
    expect(latestState?.selectedStop).toBeNull()
  })

  it('shows driving results while realtime is pending, including after a time change', async () => {
    apiMocks.fetchRealtimeItineraries.mockReturnValue(new Promise(() => {}))
    let resolveDriving!: (value: ApiDrivingRouteResponse) => void
    apiMocks.fetchDrivingRoute.mockReturnValue(new Promise((resolve) => { resolveDriving = resolve }))
    await act(async () => { root?.render(<Probe />) })
    await act(async () => { root?.render(<Probe departureTime="09:00" />) })
    await act(async () => { resolveDriving(drivingRoute) })
    expect(latestState?.drivingRoute.status).toBe('ready')
    expect(latestState?.realtimeItineraries.status).toBe('loading')
    expect(apiMocks.fetchDrivingRoute).toHaveBeenCalledTimes(1)
  })

  it('shows realtime results while driving is pending and requests today', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T23:30:00Z'))
    try {
      apiMocks.fetchDrivingRoute.mockReturnValue(new Promise(() => {}))
      apiMocks.fetchRealtimeItineraries.mockResolvedValue({ alternatives: [] })
      await act(async () => { root?.render(<Probe />) })
      expect(latestState?.realtimeItineraries.status).toBe('ready')
      expect(latestState?.drivingRoute.status).toBe('loading')
      expect(apiMocks.fetchRealtimeItineraries).toHaveBeenCalledWith(stopDetails.publicId, '2026-11-23', '08:00', 'regular_tue_thu', expect.any(AbortSignal))
      expect(apiMocks.fetchStopMetrics).toHaveBeenCalledWith(stopDetails.publicId, 'regular_tue_thu', '2026-09-15', expect.any(AbortSignal))
    } finally { vi.useRealTimers() }
  })

  it('does not strand the driving request on StrictMode effect replay', async () => {
    await act(async () => { root?.render(<StrictMode><Probe /></StrictMode>) })
    expect(latestState?.drivingRoute.status).toBe('ready')
  })

  it('ignores stale responses after selecting another stop and aborts the old request', async () => {
    let resolveOld!: (value: ApiDrivingRouteResponse) => void
    apiMocks.fetchDrivingRoute.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
    await act(async () => { root?.render(<Probe />) })
    const oldSignal = apiMocks.fetchDrivingRoute.mock.calls[0][1] as AbortSignal
    const next = { ...drivingRoute, destinationPublicId: 'another-stop', durationSeconds: 123 }
    apiMocks.fetchDrivingRoute.mockResolvedValue(next)
    await act(async () => { root?.render(<Probe publicId="another-stop" />) })
    await act(async () => { resolveOld(drivingRoute) })
    expect(oldSignal.aborted).toBe(true)
    expect(latestState?.drivingRoute.response).toEqual(next)
  })

})
