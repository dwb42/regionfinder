import type { ApiDrivingRouteResponse, ApiStopDetails } from '../../src/api/contracts'

export type DrivingRouteRequest = {
  stop: ApiStopDetails
}

export type DrivingRouteProvider = {
  routeToStop(request: DrivingRouteRequest): Promise<ApiDrivingRouteResponse>
}

export class DrivingRouteProviderError extends Error {
  readonly statusCode: number
  readonly reason: string

  constructor(statusCode: number, reason: string, message: string) {
    super(message)
    this.name = 'DrivingRouteProviderError'
    this.statusCode = statusCode
    this.reason = reason
  }
}
