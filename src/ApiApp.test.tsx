/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSnapshot } from './api/contracts'

const mapMocks = vi.hoisted(() => ({
  renderedSchoolCategories: [] as string[][],
  renderedPlaceCategories: [] as string[][],
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
  MapLibreCanvas: ({ schoolCategories, placeCategories }: { schoolCategories: string[]; placeCategories: string[] }) => {
    mapMocks.renderedSchoolCategories.push(schoolCategories)
    mapMocks.renderedPlaceCategories.push(placeCategories)
    return (
      <div
        data-testid="maplibre-canvas"
        data-school-categories={schoolCategories.join(',')}
        data-place-categories={placeCategories.join(',')}
      />
    )
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
    mapMocks.renderedSchoolCategories.length = 0
    mapMocks.renderedPlaceCategories.length = 0
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

    const gymnasiumCheckbox = container?.querySelector<HTMLInputElement>('#school-poi-layer-gymnasium')
    const otherCheckbox = container?.querySelector<HTMLInputElement>('#school-poi-layer-other-secondary')
    expect(gymnasiumCheckbox?.checked).toBe(true)
    expect(otherCheckbox?.checked).toBe(true)
    expect(mapMocks.renderedSchoolCategories.at(-1)).toEqual([
      'gymnasium',
      'comprehensive',
      'waldorf',
      'vocational',
      'upper_secondary',
    ])

    await act(async () => {
      if (!otherCheckbox) {
        throw new Error('Missing other secondary school POI layer checkbox')
      }

      otherCheckbox.click()
    })

    expect(mapMocks.renderedSchoolCategories.at(-1)).toEqual(['gymnasium'])
    expect(container?.querySelector('[data-school-categories="gymnasium"]')).not.toBeNull()
  })

  it('passes the place category selection to the map canvas', async () => {
    await act(async () => {
      root?.render(<ApiApp />)
    })
    await waitFor(() => Boolean(container?.querySelector('[data-testid="maplibre-canvas"]')))

    expect(mapMocks.renderedPlaceCategories.at(-1)).toEqual([])
    expect(container?.querySelector('[data-place-categories=""]')).not.toBeNull()

    const hofCheckbox = container?.querySelector<HTMLInputElement>('#place-layer-hof')
    const gutCheckbox = container?.querySelector<HTMLInputElement>('#place-layer-gut')

    await act(async () => {
      if (!hofCheckbox || !gutCheckbox) {
        throw new Error('Missing place layer checkboxes')
      }

      hofCheckbox.click()
      gutCheckbox.click()
    })

    expect(mapMocks.renderedPlaceCategories.at(-1)).toEqual(['hof', 'gut'])
    expect(container?.querySelector('[data-place-categories="hof,gut"]')).not.toBeNull()
  })
})
