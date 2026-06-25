import { describe, expect, it } from 'vitest'
import { mapBahnWebJourneyToApiItinerary, mapDbJourneyToApiItinerary } from './dbTransportRestProvider'

const context = {
  index: 0,
  requestedDeparture: '2026-07-07T08:00:00+02:00',
  fetchedAt: '2026-07-07T07:55:00.000Z',
}

describe('DbTransportRestProvider transformation', () => {
  it('maps a direct realtime journey with delays and remarks', () => {
    const itinerary = mapDbJourneyToApiItinerary(
      {
        refreshToken: 'refresh-direct',
        legs: [
          {
            origin: { name: 'Hamburg Hbf' },
            destination: { name: 'Aumuehle' },
            departure: '2026-07-07T08:06:00+02:00',
            plannedDeparture: '2026-07-07T08:04:00+02:00',
            arrival: '2026-07-07T08:36:00+02:00',
            plannedArrival: '2026-07-07T08:34:00+02:00',
            departureDelay: 120,
            arrivalDelay: 120,
            departurePlatform: '6',
            plannedDeparturePlatform: '5',
            arrivalPlatform: '1',
            line: { name: 'RE 1', mode: 'train', operator: { name: 'DB Regio' } },
            direction: 'Rostock Hbf',
            distance: 20_000,
            remarks: [{ text: 'Heute hohe Auslastung' }],
          },
        ],
      },
      context,
    )

    expect(itinerary).toMatchObject({
      provider: 'db-transport-rest',
      actualFirstDepartureAt: '2026-07-07T08:06:00+02:00',
      arrivalAt: '2026-07-07T08:36:00+02:00',
      totalDurationSeconds: 36 * 60,
      initialWaitSeconds: 6 * 60,
      inVehicleSeconds: 30 * 60,
      transferCount: 0,
      refreshToken: 'refresh-direct',
      realtimeSource: 'v6.db.transport.rest',
      realtimeFetchedAt: context.fetchedAt,
    })
    expect(itinerary.legs[0]).toMatchObject({
      routeName: 'RE 1',
      platformFrom: '6',
      plannedDepartureAt: '2026-07-07T08:04:00+02:00',
      departureDelaySeconds: 120,
      remarks: ['Heute hohe Auslastung'],
    })
  })

  it('maps transfers and counts transit changes', () => {
    const itinerary = mapDbJourneyToApiItinerary(
      {
        legs: [
          {
            origin: { name: 'Hamburg Hbf' },
            destination: { name: 'Bergedorf' },
            departure: '2026-07-07T08:05:00+02:00',
            arrival: '2026-07-07T08:25:00+02:00',
            line: { name: 'S2', mode: 'train' },
          },
          {
            origin: { name: 'Bergedorf' },
            destination: { name: 'Bergedorf' },
            departure: '2026-07-07T08:25:00+02:00',
            arrival: '2026-07-07T08:31:00+02:00',
          },
          {
            origin: { name: 'Bergedorf' },
            destination: { name: 'Aumuehle' },
            departure: '2026-07-07T08:31:00+02:00',
            arrival: '2026-07-07T08:41:00+02:00',
            line: { name: 'RB 81', mode: 'train' },
          },
        ],
      },
      { ...context, index: 1 },
    )

    expect(itinerary.rankType).toBe('fewest_transfers')
    expect(itinerary.transferCount).toBe(1)
    expect(itinerary.legs.map((leg) => leg.legType)).toEqual(['transit', 'transfer', 'transit'])
  })

  it('preserves cancellations and tolerates missing platform or actual times', () => {
    const itinerary = mapDbJourneyToApiItinerary(
      {
        legs: [
          {
            origin: { name: 'Hamburg Hbf' },
            destination: { name: 'Aumuehle' },
            plannedDeparture: '2026-07-07T08:04:00+02:00',
            plannedArrival: '2026-07-07T08:34:00+02:00',
            cancelled: true,
            line: { name: 'RE 1', mode: 'train' },
            remarks: [{ summary: 'Zug fällt aus' }],
          },
        ],
      },
      context,
    )

    expect(itinerary.actualFirstDepartureAt).toBe('2026-07-07T08:04:00+02:00')
    expect(itinerary.arrivalAt).toBe('2026-07-07T08:34:00+02:00')
    expect(itinerary.legs[0]).toMatchObject({
      departureAt: '2026-07-07T08:04:00+02:00',
      arrivalAt: '2026-07-07T08:34:00+02:00',
      platformFrom: null,
      cancelled: true,
      remarks: ['Zug fällt aus'],
    })
  })

  it('maps bahn.de web journey sections to realtime itineraries', () => {
    const itinerary = mapBahnWebJourneyToApiItinerary(
      {
        ctxRecon: 'web-refresh',
        verbindungsAbschnitte: [
          {
            startHalt: {
              name: 'Hamburg Hbf',
              abfahrt: {
                sollzeit: '2026-07-07T08:05:00',
                echtzeit: '2026-07-07T08:07:00',
              },
            },
            zielHalt: {
              name: 'Bad Oldesloe',
              ankunft: {
                sollzeit: '2026-07-07T08:31:00',
                echtzeit: '2026-07-07T08:33:00',
              },
            },
            abschnittsDauer: 1560,
            verkehrsmittel: {
              produktGattung: 'REGIONAL',
              kategorie: 'NRE',
              name: '11408',
              richtung: 'Luebeck-Travemuende Strand',
            },
            halte: [{ gleis: '6A-C' }, { gleis: '7' }],
            priorisierteMeldungen: [{ text: 'Aufzug nicht verfuegbar' }],
          },
        ],
      },
      context,
    )

    expect(itinerary).toMatchObject({
      provider: 'bahn-web',
      actualFirstDepartureAt: '2026-07-07T08:07:00+02:00',
      arrivalAt: '2026-07-07T08:33:00+02:00',
      totalDurationSeconds: 33 * 60,
      initialWaitSeconds: 7 * 60,
      refreshToken: 'web-refresh',
      realtimeSource: 'bahn.de web api',
    })
    expect(itinerary.legs[0]).toMatchObject({
      mode: 'REGIONAL',
      routeName: 'NRE 11408',
      platformFrom: '6A-C',
      platformTo: '7',
      departureDelaySeconds: 120,
      arrivalDelaySeconds: 120,
      remarks: ['Aufzug nicht verfuegbar'],
    })
  })
})
