import type { ApiItinerary, ApiItineraryResponse } from '../../src/api/contracts'

export type ItineraryRequest = {
  snapshotId: string
  originId: string
  destinationPublicId: string
  date: string
  time: string
  profileId: string
  alternatives: number
}

export type ItineraryProvider = {
  readonly providerName: string
  readonly engineVersion: string
  plan(request: ItineraryRequest): Promise<ApiItineraryResponse>
}

export function removeDominatedItineraries(itineraries: ApiItinerary[]): ApiItinerary[] {
  return itineraries.filter((candidate, candidateIndex) => {
    const candidateDeparture = candidate.actualFirstDepartureAt ?? candidate.requestedDepartureAt
    const candidateArrival = candidate.arrivalAt

    return !itineraries.some((other, otherIndex) => {
      if (candidateIndex === otherIndex || !candidateArrival || !other.arrivalAt) {
        return false
      }

      const otherDeparture = other.actualFirstDepartureAt ?? other.requestedDepartureAt

      return (
        otherDeparture <= candidateDeparture &&
        other.arrivalAt <= candidateArrival &&
        (other.transferCount ?? Number.POSITIVE_INFINITY) <= (candidate.transferCount ?? Number.POSITIVE_INFINITY) &&
        (other.walkingDistanceMeters ?? Number.POSITIVE_INFINITY) <=
          (candidate.walkingDistanceMeters ?? Number.POSITIVE_INFINITY)
      )
    })
  })
}
