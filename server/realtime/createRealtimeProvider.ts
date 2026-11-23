import { DbTransportRestProvider } from './dbTransportRestProvider'
import { TransitousProvider } from './transitous/provider'
import type { RealtimeItineraryProvider } from './types'

export function createRealtimeProvider(): RealtimeItineraryProvider {
  const provider = process.env.REGIONFINDER_REALTIME_PROVIDER ?? 'transitous'
  if (provider === 'transitous') return new TransitousProvider()
  if (provider === 'bahn-web' || provider === 'db-transport-rest') return new DbTransportRestProvider({ backend: provider })
  throw new Error('REGIONFINDER_REALTIME_PROVIDER must be transitous, bahn-web or db-transport-rest')
}
