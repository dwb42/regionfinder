import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDrivingRoute, fetchRealtimeItineraries } from './api'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function abortingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }))
}

describe('detail request cancellation', () => {
  it('ends a stalled driving request with a friendly timeout', async () => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    vi.stubGlobal('fetch', abortingFetch())
    const request = fetchDrivingRoute('tonndorf')
    timeout.abort(new DOMException('Timed out', 'TimeoutError'))
    await expect(request).rejects.toMatchObject({ errorCode: 'request_timeout', status: 408 })
  })
  it('aborts an obsolete realtime request', async () => {
    vi.stubGlobal('fetch', abortingFetch())
    const controller = new AbortController()
    const request = fetchRealtimeItineraries('tonndorf', '2026-11-23', '08:00', 'regular_tue_thu', controller.signal)
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })
})
