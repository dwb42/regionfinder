import type { ApiItineraryResponse, ApiStopDetails } from '../../src/api/contracts'

export type RealtimeItineraryRequest = {
  stop: ApiStopDetails
  date: string
  time: string
  profile: string
  snapshotId: string
}

export type RealtimeItineraryProvider = {
  plan(request: RealtimeItineraryRequest): Promise<ApiItineraryResponse>
}

export class RealtimeProviderError extends Error {
  readonly statusCode: number
  readonly reason: string

  constructor(statusCode: number, reason: string, message: string) {
    super(message)
    this.name = 'RealtimeProviderError'
    this.statusCode = statusCode
    this.reason = reason
  }
}

export type DbJourneyPayload = {
  journeys?: unknown
}

export type BahnWebJourneyPayload = {
  verbindungen?: unknown
}
