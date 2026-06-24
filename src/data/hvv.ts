import { useEffect, useState } from 'react'
import type { HvvManifest, HvvRoute, HvvStation, StopPlace } from '../domain/types'

export type HvvDataState = {
  manifest: HvvManifest | null
  stopPlaces: StopPlace[]
  stations: HvvStation[]
  routes: HvvRoute[]
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
  error: string | null
}

const initialState: HvvDataState = {
  manifest: null,
  stopPlaces: [],
  stations: [],
  routes: [],
  status: 'idle',
  error: null,
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)

  if (response.status === 404) {
    throw new Error('missing')
  }

  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as T
}

export function useHvvData(): HvvDataState {
  const [state, setState] = useState<HvvDataState>(() => ({ ...initialState, status: 'loading' }))

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [manifest, stopPlaces, stations, routes] = await Promise.all([
          fetchJson<HvvManifest>('/data/hvv/manifest.json'),
          fetchJson<StopPlace[]>('/data/hvv/stop-places.json'),
          fetchJson<HvvStation[]>('/data/hvv/stations.json'),
          fetchJson<HvvRoute[]>('/data/hvv/routes.json'),
        ])

        if (!cancelled) {
          setState({ manifest, stopPlaces, stations, routes, status: 'ready', error: null })
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)

        if (message === 'missing') {
          setState({ ...initialState, status: 'missing' })
        } else {
          setState({ ...initialState, status: 'error', error: message })
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
