/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSnapshot } from './api/contracts'

const mapMocks = vi.hoisted(() => ({
  renderedPoiLayers: [] as string[],
}))

const apiMocks = vi.hoisted(() => ({
  fetchCurrentSnapshot: vi.fn(),
  fetchDrivingRoute: vi.fn(),
  fetchRealtimeItineraries: vi.fn(),
  fetchStopDetails: vi.fn(),
  fetchStopMetrics: vi.fn(),
}))

vi.mock('./data/api', () => ({
  apiBaseUrl: '',
  ApiError: class ApiError extends Error {},
  ...apiMocks,
}))

vi.mock('./apiApp/MapLibreCanvas', () => ({
  MapLibreCanvas: ({ activePoiLayer }: { activePoiLayer: string }) => {
    mapMocks.renderedPoiLayers.push(activePoiLayer)
    return <div data-testid="maplibre-canvas" data-poi-layer={activePoiLayer} />
  },
}))

import ApiApp from './ApiApp'

const reactActGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

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

let root: Root | null = null
let container: HTMLDivElement | null = null

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1000

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for ApiApp render')
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('ApiApp POI layer controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mapMocks.renderedPoiLayers.length = 0
    apiMocks.fetchCurrentSnapshot.mockResolvedValue(snapshot)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
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

  it('passes the school POI selection to the map canvas', async () => {
    await act(async () => {
      root?.render(<ApiApp />)
    })
    await waitFor(() => Boolean(container?.querySelector('[data-testid="maplibre-canvas"]')))

    const checkbox = container?.querySelector<HTMLInputElement>('#poi-layer-schools')
    expect(checkbox?.checked).toBe(false)
    expect(mapMocks.renderedPoiLayers.at(-1)).toBe('none')

    await act(async () => {
      if (!checkbox) {
        throw new Error('Missing school POI layer checkbox')
      }

      checkbox.click()
    })

    expect(mapMocks.renderedPoiLayers.at(-1)).toBe('schools')
    expect(container?.querySelector('[data-poi-layer="schools"]')).not.toBeNull()
  })
})
