import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiMetrics, ApiSnapshot, ApiStopDetails } from '../api/contracts'
import { fetchCurrentSnapshot, fetchRealtimeItineraries, fetchStopDetails, fetchStopMetrics } from '../data/api'
import { displayDate, realtimeErrorMessage } from './formatters'
import { type MapUpdateState, type RealtimeItineraryState } from './config'

export function useMapUpdateStatus() {
  const [mapUpdateState, setMapUpdateState] = useState<MapUpdateState>('idle')
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleMapTileLoadingChange = useCallback(
    (isLoading: boolean) => {
      clearTimer()

      if (isLoading) {
        setMapUpdateState('loading')
        const completeTimer = window.setTimeout(() => {
          setMapUpdateState('complete')
          const idleTimer = window.setTimeout(() => {
            setMapUpdateState('idle')
            timerRef.current = null
          }, 1400)
          timerRef.current = idleTimer
        }, 10_000)
        timerRef.current = completeTimer
        return
      }

      setMapUpdateState('complete')
      const idleTimer = window.setTimeout(() => {
        setMapUpdateState('idle')
        timerRef.current = null
      }, 1400)
      timerRef.current = idleTimer
    },
    [clearTimer],
  )

  useEffect(() => clearTimer, [clearTimer])

  return { mapUpdateState, handleMapTileLoadingChange }
}

export function useApiStartup() {
  const [snapshot, setSnapshot] = useState<ApiSnapshot | null>(null)
  const [status, setStatus] = useState('API wird geladen')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const current = await fetchCurrentSnapshot()

        if (!cancelled) {
          setSnapshot(current)
          setStatus('bereit')
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : String(error))
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  return { snapshot, status, setStatus }
}

export function useSelectedStopDetails({
  selectedPublicId,
  departureTime,
  profile,
  setStatus,
}: {
  selectedPublicId: string | null
  departureTime: string
  profile: string
  setStatus: (status: string) => void
}) {
  const [selectedStop, setSelectedStop] = useState<ApiStopDetails | null>(null)
  const [metrics, setMetrics] = useState<ApiMetrics | null>(null)
  const [realtimeItineraries, setRealtimeItineraries] = useState<RealtimeItineraryState>({
    status: 'idle',
    response: null,
    error: null,
  })

  useEffect(() => {
    if (!selectedPublicId) {
      return
    }

    let cancelled = false
    const publicId = selectedPublicId

    async function loadDetails() {
      setStatus('Details werden geladen')
      setRealtimeItineraries({ status: 'loading', response: null, error: null })
      const realtimeRequest = fetchRealtimeItineraries(publicId, displayDate(), departureTime, profile)
        .then((response) => ({ response, error: null }))
        .catch((error: unknown) => ({
          response: null,
          error: realtimeErrorMessage(error),
        }))

      try {
        const [details, currentMetrics] = await Promise.all([
          fetchStopDetails(publicId),
          fetchStopMetrics(publicId, profile, displayDate()).catch(() => null),
        ])

        if (!cancelled) {
          setSelectedStop(details)
          setMetrics(currentMetrics)
          setStatus('bereit')
        }

        const realtimeResult = await realtimeRequest

        if (!cancelled) {
          setRealtimeItineraries(
            realtimeResult.response
              ? { status: 'ready', response: realtimeResult.response, error: null }
              : { status: 'error', response: null, error: realtimeResult.error },
          )
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : String(error))
          setRealtimeItineraries({ status: 'idle', response: null, error: null })
        }
      }
    }

    void loadDetails()

    return () => {
      cancelled = true
    }
  }, [departureTime, profile, selectedPublicId, setStatus])

  const clearDetails = useCallback(() => {
    setSelectedStop(null)
    setMetrics(null)
    setRealtimeItineraries({ status: 'idle', response: null, error: null })
  }, [])

  return { selectedStop, metrics, realtimeItineraries, clearDetails }
}
