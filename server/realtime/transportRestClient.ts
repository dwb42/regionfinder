import { RealtimeProviderError } from './types'

export async function fetchTransportRestJson<T>(url: URL, fetchImpl: typeof fetch, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) {
      throw new RealtimeProviderError(
        502,
        'realtime_unavailable',
        `DB realtime upstream returned ${response.status}`,
      )
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof RealtimeProviderError) {
      throw error
    }

    throw new RealtimeProviderError(
      502,
      'realtime_unavailable',
      error instanceof Error ? error.message : 'DB realtime upstream is unavailable',
    )
  } finally {
    clearTimeout(timeout)
  }
}
