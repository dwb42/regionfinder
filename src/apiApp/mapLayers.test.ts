/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import type { Map, StyleSpecification } from 'maplibre-gl'
import {
  addAdministrativeAreaTileLayers,
  addMunicipalityListHighlightLayers,
  administrativeAreaHigherPriorityClickLayerIds,
  administrativeAreaSelectionFromProperties,
  administrativeAreaTileSourceKey,
  applyAdministrativeAreaSelection,
  mapLibreBaseStyle,
  municipalityListHighlightSourceKey,
  preferredAdministrativeAreaSelection,
} from './mapLayers'

describe('base map layers', () => {
  it('uses keyless street and satellite reference tiles', () => {
    const streetSource = mapLibreBaseStyle.sources?.['street-base'] as { tiles?: string[] }
    const referenceSource = mapLibreBaseStyle.sources?.['satellite-reference'] as { tiles?: string[] }

    expect(streetSource.tiles).toEqual([
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    ])
    expect(streetSource.tiles).not.toEqual(expect.arrayContaining(['https://tile.openstreetmap.org/{z}/{x}/{y}.png']))
    expect(JSON.stringify(streetSource.tiles)).not.toContain('cartocdn.com')
    expect(referenceSource.tiles?.[0]).toContain('/Reference/World_Boundaries_and_Places/')
    expect(mapLibreBaseStyle.layers?.find((layer) => layer.id === 'satellite-reference')).toMatchObject({
      layout: { visibility: 'none' },
    })
  })
})

describe('administrative area map layers', () => {
  it('creates zoom-dependent county and municipality layers below thematic layers', () => {
    const styleLayers: Array<{ layer: Record<string, unknown>; before?: string }> = []
    let source: Record<string, unknown> | null = null
    const map = {
      addSource: vi.fn((_id: string, nextSource: Record<string, unknown>) => {
        source = nextSource
      }),
      addLayer: vi.fn((layer: Record<string, unknown>, before?: string) => {
        styleLayers.push({ layer, before })
      }),
      getLayer: vi.fn((id: string) => (id === 'regionfinder-rail-routes-casing' ? { id } : undefined)),
    } as unknown as Map

    addAdministrativeAreaTileLayers(map, ['county', 'municipality'])

    expect(source).toMatchObject({ minzoom: 6, maxzoom: 14 })
    expect(String((source as { tiles: string[] }).tiles[0])).toContain('levels=county%2Cmunicipality')
    expect(styleLayers.every((entry) => entry.before === 'regionfinder-rail-routes-casing')).toBe(true)
    expect(styleLayers.find((entry) => entry.layer.id === 'regionfinder-administrative-counties-label')?.layer)
      .toMatchObject({ minzoom: 7, maxzoom: 10 })
    expect(styleLayers.find((entry) => entry.layer.id === 'regionfinder-administrative-municipalities-line')?.layer)
      .toMatchObject({ minzoom: 9 })
    expect(styleLayers.find((entry) => entry.layer.id === 'regionfinder-administrative-municipalities-label')?.layer)
      .toMatchObject({ minzoom: 10 })
    expect(administrativeAreaTileSourceKey(['county', 'municipality'])).toBe('county,municipality')
  })

  it('maps MVT properties into a stable administrative area selection', () => {
    expect(
      administrativeAreaSelectionFromProperties({
        id: 'area-id',
        level: 'municipality',
        name: 'Testgemeinde',
        area_type: 'Gemeinde',
        official_key: '01053001',
        state_code: 'SH',
        parent_id: 'county-id',
        parent_name: 'Herzogtum Lauenburg',
      }),
    ).toEqual({
      id: 'area-id',
      level: 'municipality',
      name: 'Testgemeinde',
      areaType: 'Gemeinde',
      officialKey: '01053001',
      stateCode: 'SH',
      parentId: 'county-id',
      parentName: 'Herzogtum Lauenburg',
    })
  })

  it('prefers municipalities on overlapping areas and yields to stop and place markers', () => {
    const county = {
      properties: {
        id: 'county-id',
        level: 'county',
        name: 'Testkreis',
        area_type: 'Kreis',
        official_key: '01053',
        state_code: 'SH',
      },
    }
    const municipality = {
      properties: {
        id: 'municipality-id',
        level: 'municipality',
        name: 'Testgemeinde',
        area_type: 'Gemeinde',
        official_key: '01053001',
        state_code: 'SH',
        parent_id: 'county-id',
        parent_name: 'Testkreis',
      },
    }

    expect(preferredAdministrativeAreaSelection([county, municipality])?.id).toBe('municipality-id')
    expect(preferredAdministrativeAreaSelection([county, municipality], true)).toBeNull()
    expect(administrativeAreaHigherPriorityClickLayerIds).toEqual([
      'regionfinder-stops-symbol',
      'regionfinder-places-symbol',
    ])
  })

  it('applies the selected id to both highlight layers', () => {
    const setFilter = vi.fn()
    const map = {
      getLayer: vi.fn(() => ({})),
      setFilter,
      getStyle: vi.fn(() => ({ version: 8, sources: {}, layers: [] }) as StyleSpecification),
    } as unknown as Map

    applyAdministrativeAreaSelection(map, 'area-id')

    expect(setFilter).toHaveBeenCalledTimes(2)
    expect(setFilter).toHaveBeenCalledWith(
      'regionfinder-administrative-selection-fill',
      ['==', ['get', 'id'], 'area-id'],
    )
  })
})

describe('municipality list highlight layers', () => {
  it('creates independent low-zoom layers with stable list colors and revision keys', () => {
    const styleLayers: Array<Record<string, unknown>> = []
    let source: Record<string, unknown> | null = null
    const map = {
      addSource: vi.fn((_id: string, nextSource: Record<string, unknown>) => {
        source = nextSource
      }),
      addLayer: vi.fn((layer: Record<string, unknown>) => styleLayers.push(layer)),
      getLayer: vi.fn((id: string) => (id === 'regionfinder-rail-routes-casing' ? { id } : undefined)),
    } as unknown as Map
    const lists = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Favoriten',
        color: '#2563EB',
        municipalityCount: 2,
        createdAt: '2026-08-26T10:00:00.000Z',
        updatedAt: '2026-08-26T10:01:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Besichtigung',
        color: '#DC2626',
        municipalityCount: 1,
        createdAt: '2026-08-26T10:02:00.000Z',
        updatedAt: '2026-08-26T10:03:00.000Z',
      },
    ]

    addMunicipalityListHighlightLayers(map, lists)

    expect(source).toMatchObject({ minzoom: 6, maxzoom: 14 })
    expect(String((source as { tiles: string[] }).tiles[0])).toContain('listIds=11111111-1111-4111-8111-111111111111%2C22222222-2222-4222-8222-222222222222')
    expect(styleLayers).toHaveLength(4)
    expect(styleLayers[0]).toMatchObject({ minzoom: 6, filter: ['==', ['get', 'list_id'], lists[0].id] })
    expect(styleLayers[0].paint).toMatchObject({ 'fill-color': '#2563EB', 'fill-opacity': 0.22 })
    expect(styleLayers[2].paint).toMatchObject({ 'fill-color': '#DC2626', 'fill-opacity': 0.22 })
    expect(municipalityListHighlightSourceKey(lists)).toContain(`${lists[0].id}:${lists[0].updatedAt}`)
  })
})
