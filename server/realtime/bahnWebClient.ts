import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { RealtimeProviderError, type BahnWebJourneyPayload } from './types'

const BAHN_WEB_BASE_URL = 'https://www.bahn.de'
const BAHN_WEB_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const execFile = promisify(execFileCallback)

export function bahnWebLocationSearchUrl(query: string, limit = '8'): URL {
  const url = new URL('/web/api/reiseloesung/orte', BAHN_WEB_BASE_URL)
  url.searchParams.set('suchbegriff', query)
  url.searchParams.set('typ', 'ALL')
  url.searchParams.set('limit', limit)

  return url
}

export async function fetchBahnWebJson<T>({
  url,
  fetchImpl,
  timeoutMs,
  enableCurlFallback,
}: {
  url: URL
  fetchImpl: typeof fetch
  timeoutMs: number
  enableCurlFallback: boolean
}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      headers: bahnWebHeaders(),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new RealtimeProviderError(502, 'realtime_unavailable', `Bahn web upstream returned ${response.status}`)
    }

    return (await response.json()) as T
  } catch (error) {
    if (enableCurlFallback) {
      return fetchBahnWebJsonWithCurl<T>(url, timeoutMs)
    }

    if (error instanceof RealtimeProviderError) {
      throw error
    }

    throw new RealtimeProviderError(
      502,
      'realtime_unavailable',
      error instanceof Error ? error.message : 'Bahn web upstream is unavailable',
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchBahnWebJourneys({
  originDbStopId,
  destinationDbStopId,
  date,
  time,
  fetchImpl,
  timeoutMs,
  enableCurlFallback,
}: {
  originDbStopId: string
  destinationDbStopId: string
  date: string
  time: string
  fetchImpl: typeof fetch
  timeoutMs: number
  enableCurlFallback: boolean
}): Promise<BahnWebJourneyPayload> {
  const requestBody = bahnWebJourneyRequest(originDbStopId, destinationDbStopId, `${date}T${time}:00`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const warmupUrl = bahnWebLocationSearchUrl('Hamburg Hbf', '1')
    const warmupResponse = await fetchImpl(warmupUrl, {
      headers: bahnWebHeaders(),
      signal: controller.signal,
    })
    if (!warmupResponse.ok) {
      throw new Error(`Bahn web warmup returned ${warmupResponse.status}`)
    }
    const cookie = responseCookies(warmupResponse)
    const response = await fetchImpl(new URL('/web/api/angebote/fahrplan', BAHN_WEB_BASE_URL), {
      method: 'POST',
      headers: {
        ...bahnWebHeaders(),
        'content-type': 'application/json',
        origin: BAHN_WEB_BASE_URL,
        referer: `${BAHN_WEB_BASE_URL}/`,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new RealtimeProviderError(502, 'realtime_unavailable', `Bahn web upstream returned ${response.status}`)
    }

    return (await response.json()) as BahnWebJourneyPayload
  } catch (error) {
    if (enableCurlFallback) {
      return fetchBahnWebJourneysWithCurl(requestBody, timeoutMs)
    }

    if (error instanceof RealtimeProviderError) {
      throw error
    }

    throw new RealtimeProviderError(
      502,
      'realtime_unavailable',
      error instanceof Error ? error.message : 'Bahn web upstream is unavailable',
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchBahnWebJsonWithCurl<T>(url: URL, timeoutMs: number): Promise<T> {
  try {
    const { stdout } = await execFile(
      'curl',
      [
        '--compressed',
        '-sS',
        '-H',
        `accept: ${bahnWebHeaders().accept}`,
        '-H',
        `user-agent: ${BAHN_WEB_USER_AGENT}`,
        url.toString(),
      ],
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
    )

    return JSON.parse(stdout) as T
  } catch (error) {
    throw new RealtimeProviderError(
      502,
      'realtime_unavailable',
      error instanceof Error ? error.message : 'Bahn web curl fallback is unavailable',
    )
  }
}

async function fetchBahnWebJourneysWithCurl(
  requestBody: ReturnType<typeof bahnWebJourneyRequest>,
  timeoutMs: number,
): Promise<BahnWebJourneyPayload> {
  const directory = await mkdtemp(join(tmpdir(), 'regionfinder-bahn-web-'))
  const cookieJar = join(directory, 'cookies.txt')

  try {
    await execFile(
      'curl',
      [
        '-sS',
        '-c',
        cookieJar,
        '-H',
        `accept: ${bahnWebHeaders().accept}`,
        '-H',
        `user-agent: ${BAHN_WEB_USER_AGENT}`,
        `${BAHN_WEB_BASE_URL}/web/api/reiseloesung/orte?suchbegriff=Hamburg%20Hbf&typ=ALL&limit=1`,
      ],
      { timeout: timeoutMs },
    )
    const { stdout } = await execFile(
      'curl',
      [
        '--compressed',
        '-sS',
        '-b',
        cookieJar,
        '-c',
        cookieJar,
        `${BAHN_WEB_BASE_URL}/web/api/angebote/fahrplan`,
        '-H',
        'accept: application/json',
        '-H',
        'content-type: application/json',
        '-H',
        `origin: ${BAHN_WEB_BASE_URL}`,
        '-H',
        `referer: ${BAHN_WEB_BASE_URL}/`,
        '-H',
        `user-agent: ${BAHN_WEB_USER_AGENT}`,
        '--data',
        JSON.stringify(requestBody),
      ],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
    )

    return JSON.parse(stdout) as BahnWebJourneyPayload
  } catch (error) {
    throw new RealtimeProviderError(
      502,
      'realtime_unavailable',
      error instanceof Error ? error.message : 'Bahn web curl fallback is unavailable',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function bahnWebHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    'user-agent': BAHN_WEB_USER_AGENT,
  }
}

function responseCookies(response: Response): string {
  const headersWithGetSetCookie = response.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = headersWithGetSetCookie.getSetCookie?.() ?? splitCombinedSetCookie(response.headers.get('set-cookie'))

  return setCookies
    .map((cookie) => cookie.split(';')[0])
    .filter(Boolean)
    .join('; ')
}

function splitCombinedSetCookie(value: string | null): string[] {
  if (!value) {
    return []
  }

  return value.split(/,\s*(?=[^;,]+=)/)
}

function bahnWebJourneyRequest(originDbStopId: string, destinationDbStopId: string, requestedLocalDateTime: string) {
  return {
    minUmstiegszeit: 0,
    deutschlandTicketVorhanden: false,
    nurDeutschlandTicketVerbindungen: false,
    reservierungsKontingenteVorhanden: false,
    schnelleVerbindungen: true,
    sitzplatzOnly: false,
    abfahrtsHalt: bahnWebLocationReference(originDbStopId),
    ankunftsHalt: bahnWebLocationReference(destinationDbStopId),
    produktgattungen: ['ICE', 'EC_IC', 'IR', 'REGIONAL', 'SBAHN', 'BUS', 'SCHIFF', 'UBAHN', 'TRAM', 'ANRUFPFLICHTIG'],
    bikeCarriage: false,
    anfrageZeitpunkt: requestedLocalDateTime,
    ankunftSuche: 'ABFAHRT',
    klasse: 'KLASSE_2',
    reisende: [
      {
        typ: 'ERWACHSENER',
        anzahl: 1,
        alter: [],
        ermaessigungen: [{ art: 'KEINE_ERMAESSIGUNG', klasse: 'KLASSENLOS' }],
      },
    ],
  }
}

function bahnWebLocationReference(value: string): string {
  return value.startsWith('A=') ? value : `A=1@L=${value}@`
}
