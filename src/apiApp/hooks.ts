import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiMetrics, ApiSnapshot, ApiStopDetails } from '../api/contracts'
import { fetchCurrentSnapshot, fetchDrivingRoute, fetchRealtimeItineraries, fetchStopDetails, fetchStopMetrics } from '../data/api'
import { displayDate, drivingRouteErrorMessage, realtimeErrorMessage } from './formatters'
import { type DrivingRouteState, type MapUpdateState, type RealtimeItineraryState } from './config'

export function useMapUpdateStatus() {
  const [mapUpdateState, setMapUpdateState] = useState<MapUpdateState>('idle')
  const mapUpdateStateRef = useRef<MapUpdateState>('idle')
  const timerRef = useRef<number | null>(null)

  const setStatus = useCallback((state: MapUpdateState) => {
    mapUpdateStateRef.current = state
    setMapUpdateState(state)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleMapTileLoadingChange = useCallback(
    (isLoading: boolean) => {
      if (isLoading) {
        clearTimer()
        setStatus('loading')
        const completeTimer = window.setTimeout(() => {
          setStatus('complete')
          const idleTimer = window.setTimeout(() => {
            setStatus('idle')
            timerRef.current = null
          }, 1400)
          timerRef.current = idleTimer
        }, 10_000)
        timerRef.current = completeTimer
        return
      }

      if (mapUpdateStateRef.current !== 'loading') {
        return
      }

      clearTimer()
      setStatus('complete')
      const idleTimer = window.setTimeout(() => {
        setStatus('idle')
        timerRef.current = null
      }, 1400)
      timerRef.current = idleTimer
    },
    [clearTimer, setStatus],
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
  const [drivingRoute, setDrivingRoute] = useState<DrivingRouteState>({
    status: 'idle',
    response: null,
    error: null,
  })
  const previousPublicIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!selectedPublicId) {
      previousPublicIdRef.current = null
      return
    }

    let cancelled = false
    const publicId = selectedPublicId
    const isNewSelection = previousPublicIdRef.current !== publicId
    previousPublicIdRef.current = publicId

    async function loadDetails() {
      setStatus('Details werden geladen')
      if (isNewSelection) {
        setSelectedStop(null)
        setMetrics(null)
      }
      setRealtimeItineraries({ status: 'loading', response: null, error: null })
      if (isNewSelection) {
        setDrivingRoute({ status: 'loading', response: null, error: null })
      }
      const realtimeRequest = fetchRealtimeItineraries(publicId, displayDate(), departureTime, profile)
        .then((response) => ({ response, error: null }))
        .catch((error: unknown) => ({
          response: null,
          error: realtimeErrorMessage(error),
        }))
      const drivingRouteRequest = isNewSelection
        ? fetchDrivingRoute(publicId)
            .then((response) => ({ response, error: null }))
            .catch((error: unknown) => ({
              response: null,
              error: drivingRouteErrorMessage(error),
            }))
        : null

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
        const drivingRouteResult = await drivingRouteRequest

        if (!cancelled) {
          setRealtimeItineraries(
            realtimeResult.response
              ? { status: 'ready', response: realtimeResult.response, error: null }
              : { status: 'error', response: null, error: realtimeResult.error },
          )
          if (drivingRouteResult) {
            setDrivingRoute(
              drivingRouteResult.response
                ? { status: 'ready', response: drivingRouteResult.response, error: null }
                : { status: 'error', response: null, error: drivingRouteResult.error },
            )
          }
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : String(error))
          setRealtimeItineraries({ status: 'idle', response: null, error: null })
          setDrivingRoute({ status: 'idle', response: null, error: null })
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
    setDrivingRoute({ status: 'idle', response: null, error: null })
  }, [])

  return { selectedStop, metrics, realtimeItineraries, drivingRoute, clearDetails }
}
