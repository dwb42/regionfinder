import { describe, expect, it } from 'vitest'
import type { ApiPlace } from '../api/contracts'
import { placeDetailLinks } from './placeDetails'

const basePlace: ApiPlace = {
  id: 'place-1',
  sourceId: 'ferienhoefe_web_research',
  sourcePlaceId: 'source-place-1',
  origin: 'imported',
  category: 'ferienhof',
  name: 'Ferienhof Test',
  stateCode: 'SH',
  address: 'Testweg 1',
  website: null,
  coordinate: {
    lat: 54,
    lon: 10,
  },
  rawProperties: {},
  importedAt: null,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
  deletedAt: null,
}

describe('placeDetailLinks', () => {
  it('separates external place websites from source detail links', () => {
    const links = placeDetailLinks({
      ...basePlace,
      website: 'https://ferienhof.example',
      rawProperties: {
        detail_url: 'https://www.openstreetmap.org/way/123',
      },
    })

    expect(links.placeWebsite).toEqual({
      label: 'Website öffnen',
      url: 'https://ferienhof.example',
    })
    expect(links.sourceWebsite).toEqual({
      label: 'Quelle in OpenStreetMap öffnen',
      url: 'https://www.openstreetmap.org/way/123',
    })
  })

  it('treats portal websites as source links when no provider website is known', () => {
    const links = placeDetailLinks({
      ...basePlace,
      website: 'https://www.landreise.de/expose/ferienhof-test-123',
      rawProperties: {
        detail_url: 'https://www.landreise.de/expose/ferienhof-test-123',
      },
    })

    expect(links.placeWebsite).toBeNull()
    expect(links.sourceWebsite).toEqual({
      label: 'Eintrag bei Landreise öffnen',
      url: 'https://www.landreise.de/expose/ferienhof-test-123',
    })
  })
})
