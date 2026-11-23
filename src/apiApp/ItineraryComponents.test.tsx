import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DrivingRouteBlock, RealtimeItineraryBlock } from './ItineraryComponents'
import { mapTransitousItinerary } from '../../server/realtime/transitous/journeyMapping'
import { timeLabel } from './formatters'

describe('Transitous connection display', () => {
  it('shows local times, schedule-only status, full notices, and data attribution', () => {
    const alternative = mapTransitousItinerary({
      startTime: '2026-11-23T07:03:00Z', endTime: '2026-11-23T07:14:00Z', duration: 660, transfers: 0,
      legs: [{ mode: 'REGIONAL_RAIL', startTime: '2026-11-23T07:03:00Z', endTime: '2026-11-23T07:14:00Z',
        scheduledStartTime: '2026-11-23T07:03:00Z', scheduledEndTime: '2026-11-23T07:14:00Z',
        realTime: false, scheduled: true, duration: 660, displayName: 'RB81',
        from: { name: 'Hamburg Hbf', lat: 53.55, lon: 10 }, to: { name: 'Tonndorf', lat: 53.58, lon: 10.12 },
        alerts: [1, 2, 3, 4].map((i) => ({ headerText: `Hinweis ${i}`, descriptionText: `Meldung ${i}` })),
      }],
    }, '2026-11-23T08:00:00+01:00', '2026-11-23T07:00:00Z')
    const markup = renderToStaticMarkup(<RealtimeItineraryBlock maxAlternatives={3} emptyText="Keine Verbindung" response={{
      snapshotId: 'test', requestedDeparture: '2026-11-23T08:00:00+01:00', originId: 'hbf', destinationPublicId: 'tonndorf',
      alternatives: [alternative], sourceAttribution: 'Transitous', sourceAttributionUrl: 'https://transitous.org/sources/',
    }} />)
    expect(markup).toContain('ab 08:03')
    expect(markup).toContain('an 08:14')
    expect(markup).toContain('Nur Fahrplandaten')
    expect(markup).not.toContain('pünktlich')
    expect(markup).toContain('Hinweis 4: Meldung 4')
    expect(markup).toContain('https://transitous.org/sources/')
    expect(markup).toContain('https://www.openstreetmap.org/copyright')
  })

  it('displays both winter and summer timestamps in Berlin time', () => {
    expect(timeLabel('2026-11-23T07:00:00Z')).toBe('08:00')
    expect(timeLabel('2026-07-07T06:00:00Z')).toBe('08:00')
    expect(timeLabel('2026-07-07T08:00:00+02:00')).toBe('08:00')
  })
})

describe('DrivingRouteBlock', () => {
  it('identifies Google live traffic and its observation time', () => {
    const markup = renderToStaticMarkup(
      <DrivingRouteBlock response={{
        originName: 'Hamburg Hbf',
        destinationPublicId: 'tonndorf',
        provider: 'google-routes',
        trafficAware: true,
        durationSeconds: 1620,
        distanceMeters: 11100,
        sourceAttribution: 'Google Maps',
        fetchedAt: '2026-11-23T08:00:00Z',
      }} />,
    )
    expect(markup).toContain('27 min')
    expect(markup).toContain('Abfahrt jetzt · aktuelle Verkehrslage')
    expect(markup).toContain('Google Maps')
    expect(markup).toContain('Stand 09:00')
    expect(markup).not.toContain('OSM-Schätzung')
  })

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
