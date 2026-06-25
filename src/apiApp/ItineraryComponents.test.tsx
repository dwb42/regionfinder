import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DrivingRouteBlock } from './ItineraryComponents'

describe('DrivingRouteBlock', () => {
  it('renders driving minutes, distance, and traffic caveat', () => {
    const markup = renderToStaticMarkup(
      <DrivingRouteBlock
        response={{
          originName: 'Hamburg Hbf',
          destinationPublicId: 'de:01056:9001',
          provider: 'osrm',
          durationSeconds: 23 * 60,
          distanceMeters: 9_500,
          sourceAttribution: 'Route: OSRM; Kartendaten: OpenStreetMap-Mitwirkende',
        }}
      />,
    )

    expect(markup).toContain('23 min')
    expect(markup).toContain('9.5 km')
    expect(markup).toContain('OSM-Schätzung ohne Live-Verkehr')
  })

  it('renders loading and friendly error states', () => {
    expect(renderToStaticMarkup(<DrivingRouteBlock response={null} loading />)).toContain('Autofahrzeit wird geladen')
    expect(renderToStaticMarkup(<DrivingRouteBlock response={null} error="Autofahrzeit ist aktuell nicht verfügbar." />)).toContain(
      'Autofahrzeit ist aktuell nicht verfügbar.',
    )
  })
})
