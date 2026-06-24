import type { ApiItineraryResponse } from '../../src/api/contracts'
import type { ItineraryProvider, ItineraryRequest } from './itineraryProvider'

export class MotisProvider implements ItineraryProvider {
  readonly providerName = 'motis'
  readonly engineVersion: string
  private readonly baseUrl: string

  constructor(baseUrl: string, engineVersion: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.engineVersion = engineVersion
  }

  async plan(request: ItineraryRequest): Promise<ApiItineraryResponse> {
    void request

    throw new Error(
      `MOTIS provider at ${this.baseUrl} is configured but not wired to a snapshot graph in this environment`,
    )
  }
}
