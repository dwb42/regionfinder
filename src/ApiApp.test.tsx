/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiPlace, ApiSnapshot } from './api/contracts'

const mapMocks = vi.hoisted(() => ({
  renderedAdministrativeAreaLevels: [] as string[][],
  renderedSchoolCategories: [] as string[][],
  renderedPlaceCategories: [] as string[][],
}))

const apiMocks = vi.hoisted(() => ({
  fetchCurrentSnapshot: vi.fn(),
  fetchDrivingRoute: vi.fn(),
  fetchPlace: vi.fn(),
  fetchPlaces: vi.fn(),
  fetchRealtimeItineraries: vi.fn(),
  fetchStopDetails: vi.fn(),
  fetchStopMetrics: vi.fn(),
  createPlace: vi.fn(),
  deletePlace: vi.fn(),
  updatePlace: vi.fn(),
}))

vi.mock('./data/api', () => ({
  apiBaseUrl: '',
  ApiError: class ApiError extends Error {},
  ...apiMocks,
}))

vi.mock('./apiApp/MapLibreCanvas', () => ({
  MapLibreCanvas: ({
    schoolCategories,
    placeCategories,
    administrativeAreaLevels,
    onSelectPlace,
    onSelectAdministrativeArea,
  }: {
    schoolCategories: string[]
    placeCategories: string[]
    administrativeAreaLevels: Array<'county' | 'municipality'>
    onSelectPlace: (placeId: string) => void
    onSelectAdministrativeArea: (selection: {
      id: string
      level: 'county' | 'municipality'
      name: string
      areaType: string
      officialKey: string
      stateCode: string
      parentId: string | null
      parentName: string | null
    }) => void
  }) => {
    mapMocks.renderedAdministrativeAreaLevels.push(administrativeAreaLevels)
    mapMocks.renderedSchoolCategories.push(schoolCategories)
    mapMocks.renderedPlaceCategories.push(placeCategories)
    return (
      <div data-testid="maplibre-canvas" data-school-categories={schoolCategories.join(',')} data-place-categories={placeCategories.join(',')}>
        <button type="button" data-testid="select-place" onClick={() => onSelectPlace('place-1')}>
          Ort wählen
        </button>
        <button
          type="button"
          data-testid="select-administrative-area"
          onClick={() =>
            onSelectAdministrativeArea({
              id: 'municipality-1',
              level: 'municipality',
              name: 'Testgemeinde',
              areaType: 'Gemeinde',
              officialKey: '01053001',
              stateCode: 'SH',
              parentId: 'county-1',
              parentName: 'Herzogtum Lauenburg',
            })
          }
        >
          Gemeinde wählen
        </button>
      </div>
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

const place: ApiPlace = {
  id: 'place-1',
  sourceId: 'ferienhoefe_web_research',
  sourcePlaceId: 'source-place-1',
  origin: 'imported',
  category: 'ferienhof',
  name: 'Ferienhof Test',
  stateCode: 'MV',
  address: 'Testweg 1, 23999 Testort',
  website: 'https://ferienhof.example',
  coordinate: {
    lat: 53.8,
    lon: 10.7,
  },
  rawProperties: {
    detail_url: 'https://www.openstreetmap.org/way/123',
  },
  importedAt: '2026-07-01T10:00:00.000Z',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
  deletedAt: null,
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
    mapMocks.renderedAdministrativeAreaLevels.length = 0
    apiMocks.fetchCurrentSnapshot.mockResolvedValue(snapshot)
    apiMocks.fetchPlace.mockResolvedValue(place)
    apiMocks.fetchPlaces.mockResolvedValue([])
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

  it('starts administrative areas disabled and toggles counties and municipalities independently', async () => {
    await act(async () => {
      root?.render(<ApiApp />)
    })
    await waitFor(() => Boolean(container?.querySelector('[data-testid="maplibre-canvas"]')))

    const countyCheckbox = container?.querySelector<HTMLInputElement>('#administrative-area-layer-county')
    const municipalityCheckbox = container?.querySelector<HTMLInputElement>('#administrative-area-layer-municipality')

    expect(countyCheckbox?.checked).toBe(false)
    expect(municipalityCheckbox?.checked).toBe(false)
    expect(mapMocks.renderedAdministrativeAreaLevels.at(-1)).toEqual([])

    await act(async () => {
      countyCheckbox?.click()
      municipalityCheckbox?.click()
    })

    expect(mapMocks.renderedAdministrativeAreaLevels.at(-1)).toEqual(['county', 'municipality'])
  })

  it('opens administrative area details with municipality hierarchy data', async () => {
    await act(async () => {
      root?.render(<ApiApp />)
    })
    await waitFor(() => Boolean(container?.querySelector('[data-testid="maplibre-canvas"]')))

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="select-administrative-area"]')?.click()
    })

    const panel = container?.querySelector<HTMLElement>('[aria-label="Verwaltungsgebiets-Details"]')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('Testgemeinde')
    expect(panel?.textContent).toContain('Gemeinde')
    expect(panel?.textContent).toContain('Amtlicher Schlüssel: 01053001')
    expect(panel?.textContent).toContain('Landkreis: Herzogtum Lauenburg')
  })

  it('opens place details in the right panel with place and source websites', async () => {
    await act(async () => {
      root?.render(<ApiApp />)
    })
    await waitFor(() => Boolean(container?.querySelector('[data-testid="maplibre-canvas"]')))

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="select-place"]')?.click()
    })

    await waitFor(() => container?.textContent?.includes('Ferienhof Test') ?? false)

    expect(apiMocks.fetchPlace).toHaveBeenCalledWith('place-1')
    expect(container?.querySelector<HTMLElement>('[aria-label="Ort-Details"]')).not.toBeNull()
    expect(container?.textContent).toContain('Ferienhof Test')
    expect(container?.textContent).toContain('Ferienhof')
    expect(container?.textContent).toContain('Testweg 1, 23999 Testort')
    expect(container?.textContent).toContain('Website öffnen')
    expect(container?.textContent).toContain('Quelle in OpenStreetMap öffnen')
    expect(container?.textContent).not.toContain('MV')
    expect(container?.querySelector<HTMLAnchorElement>('a[href="https://ferienhof.example"]')).not.toBeNull()
    expect(container?.querySelector<HTMLAnchorElement>('a[href="https://www.openstreetmap.org/way/123"]')).not.toBeNull()
  })
})
