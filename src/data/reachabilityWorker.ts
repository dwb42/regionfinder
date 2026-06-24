import { useEffect, useRef, useState } from 'react'
import type { ReachabilityResult, ReachabilityWorkerStatus } from '../domain/types'

type ReachabilityWorkerState = {
  status: ReachabilityWorkerStatus
  results: ReachabilityResult[]
  error: string | null
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

const initialWorkerState: ReachabilityWorkerState = {
  status: 'idle',
  results: [],
  error: null,
}

export function useReachabilityWorker(
  originStopPlaceId: string | null,
  departureMinutes: number,
): ReachabilityWorkerState {
  const workerRef = useRef<Worker | null>(null)
  const [state, setState] = useState<ReachabilityWorkerState>(initialWorkerState)

  useEffect(() => {
    const worker = new Worker(new URL('../workers/reachabilityWorker.ts', import.meta.url), {
      type: 'module',
    })

    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data

      if (message.type === 'status') {
        setState((current) => ({ ...current, status: message.status }))
      } else if (message.type === 'result') {
        setState({ status: 'ready', results: message.results, error: null })
      } else {
        setState({ status: 'error', results: [], error: message.error })
      }
    }

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!originStopPlaceId || !workerRef.current) {
      setState(initialWorkerState)
      return
    }

    setState((current) => ({ ...current, status: 'loading index', error: null }))
    workerRef.current.postMessage({
      type: 'calculate',
      originStopPlaceId,
      departureMinutes,
    })
  }, [departureMinutes, originStopPlaceId])

  return state
}
