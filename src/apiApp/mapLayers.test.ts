/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import type { Map, StyleSpecification } from 'maplibre-gl'
import {
  addAdministrativeAreaTileLayers,
  administrativeAreaHigherPriorityClickLayerIds,
  administrativeAreaSelectionFromProperties,
  administrativeAreaTileSourceKey,
  applyAdministrativeAreaSelection,
  mapLibreBaseStyle,
  preferredAdministrativeAreaSelection,
} from './mapLayers'

describe('base map layers', () => {
  it('uses keyless street and satellite reference tiles', () => {
    const style = JSON.stringify(mapLibreBaseStyle)
    const streetSource = mapLibreBaseStyle.sources?.['street-base'] as { tiles?: string[] }
    const referenceSource = mapLibreBaseStyle.sources?.['satellite-reference'] as { tiles?: string[] }

    expect(streetSource.tiles).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'])
    expect(referenceSource.tiles?.[0]).toContain('/Reference/World_Boundaries_and_Places/')
    expect(style).not.toContain('cartocdn.com')
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
