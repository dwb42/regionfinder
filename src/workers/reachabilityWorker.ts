import {
  calculateGtfsReachability,
  prepareReachabilityIndex,
} from '../domain/gtfsReachability'
import type { HvvReachabilityIndex, ReachabilityResult, ReachabilityWorkerStatus } from '../domain/types'

type WorkerRequest = {
  type: 'calculate'
  originStopPlaceId: string
  departureMinutes: number
}

type WorkerResponse =
  | {
      type: 'status'
      status: ReachabilityWorkerStatus
    }
  | {
      type: 'result'
      originStopPlaceId: string
      results: ReachabilityResult[]
    }
  | {
      type: 'error'
      error: string
    }

let preparedIndex: ReturnType<typeof prepareReachabilityIndex> | null = null
let indexPromise: Promise<ReturnType<typeof prepareReachabilityIndex>> | null = null

function post(response: WorkerResponse) {
  self.postMessage(response)
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)

  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as T
}

async function loadIndex() {
  if (preparedIndex) {
    return preparedIndex
  }

  if (!indexPromise) {
    post({ type: 'status', status: 'loading index' })
    indexPromise = fetchJson<HvvReachabilityIndex>('/data/hvv/reachability-index.json').then((index) => {
      preparedIndex = prepareReachabilityIndex(index)
      return preparedIndex
    })
  }

  return indexPromise
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== 'calculate') {
    return
  }

  const { originStopPlaceId, departureMinutes } = event.data

  void loadIndex()
    .then((index) => {
      post({ type: 'status', status: 'calculating' })
      const results = calculateGtfsReachability(index, originStopPlaceId, departureMinutes)
      post({ type: 'result', originStopPlaceId, results })
      post({ type: 'status', status: 'ready' })
    })
    .catch((error: unknown) => {
      post({ type: 'error', error: error instanceof Error ? error.message : String(error) })
    })
}
