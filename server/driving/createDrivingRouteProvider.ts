import { GoogleRoutesDrivingRouteProvider } from './googleRoutesDrivingRouteProvider'
import { OsrmDrivingRouteProvider } from './osrmDrivingRouteProvider'
import type { DrivingRouteProvider } from './types'

export function createDrivingRouteProvider(): DrivingRouteProvider {
  const provider = process.env.REGIONFINDER_DRIVING_PROVIDER ?? 'google-routes'
  if (provider === 'google-routes') return new GoogleRoutesDrivingRouteProvider()
  if (provider === 'osrm') return new OsrmDrivingRouteProvider()
  throw new Error('REGIONFINDER_DRIVING_PROVIDER must be google-routes or osrm')
}
