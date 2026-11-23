import { describe, expect, it, vi } from 'vitest'
import { fetchBahnWebJourneys, fetchBahnWebJson } from './bahnWebClient'

describe('Bahn upstream errors', () => {
  it('reports a blocked warmup without calling journey search or curl fallback', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"code":"OPS_BLOCKED"}', { status: 403 }))
    await expect(fetchBahnWebJourneys({
      originDbStopId: '8002549', destinationDbStopId: '8006197', date: '2026-11-23', time: '08:00',
      fetchImpl, timeoutMs: 1000, enableCurlFallback: true,
    })).rejects.toMatchObject({ statusCode: 502, reason: 'realtime_blocked' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('reports a blocked location lookup', async () => {
    await expect(fetchBahnWebJson({
      url: new URL('https://www.bahn.de/web/api/reiseloesung/orte'),
      fetchImpl: vi.fn(async () => new Response(null, { status: 403 })),
      timeoutMs: 1000, enableCurlFallback: true,
    })).rejects.toMatchObject({ reason: 'realtime_blocked' })
  })
  it('reports a blocked journey search after successful warmup', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(fetchBahnWebJourneys({
      originDbStopId: '8002549', destinationDbStopId: '8006197', date: '2026-11-23', time: '08:00',
      fetchImpl, timeoutMs: 1000, enableCurlFallback: true,
    })).rejects.toMatchObject({ reason: 'realtime_blocked' })
  })
})
