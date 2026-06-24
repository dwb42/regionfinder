import type { ApiItineraryResponse } from '../../src/api/contracts'
import type { ItineraryProvider, ItineraryRequest } from './itineraryProvider'

export class R5FallbackProvider implements ItineraryProvider {
  readonly providerName = 'r5py-detailed-itineraries'
  readonly engineVersion: string

  constructor(engineVersion: string) {
    this.engineVersion = engineVersion
  }

  async plan(request: ItineraryRequest): Promise<ApiItineraryResponse> {
    void request

    throw new Error('r5py detailed itinerary fallback requires an installed local R5/r5py environment')
  }
}
