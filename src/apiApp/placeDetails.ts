import type { ApiPlace } from '../api/contracts'

export type PlaceDetailLink = {
  label: string
  url: string
}

export type PlaceDetailLinks = {
  placeWebsite: PlaceDetailLink | null
  sourceWebsite: PlaceDetailLink | null
}

const sourceDomains = new Set([
  'landreise.de',
  'www.landreise.de',
  'landsichten.de',
  'www.landsichten.de',
  'bauernhofurlaub.de',
  'www.bauernhofurlaub.de',
  'openstreetmap.org',
  'www.openstreetmap.org',
])

export function placeDetailLinks(place: ApiPlace): PlaceDetailLinks {
  const websiteUrl = normalizedHttpUrl(place.website)
  const detailUrl = normalizedHttpUrl(stringRawProperty(place.rawProperties, 'detail_url'))

  const placeWebsite = websiteUrl && !isSourceUrl(websiteUrl)
    ? { label: 'Website öffnen', url: websiteUrl }
    : null
  const sourceUrl = detailUrl ?? (websiteUrl && isSourceUrl(websiteUrl) ? websiteUrl : null)

  return {
    placeWebsite,
    sourceWebsite: sourceUrl ? { label: sourceLinkLabel(sourceUrl), url: sourceUrl } : null,
  }
}

function sourceLinkLabel(url: string): string {
  const hostname = hostnameFor(url)

  if (hostname?.endsWith('openstreetmap.org')) {
    return 'Quelle in OpenStreetMap öffnen'
  }

  if (hostname?.endsWith('landreise.de')) {
    return 'Eintrag bei Landreise öffnen'
  }

  if (hostname?.endsWith('landsichten.de')) {
    return 'Eintrag bei Landsichten öffnen'
  }

  if (hostname?.endsWith('bauernhofurlaub.de')) {
    return 'Eintrag bei Bauernhofurlaub.de öffnen'
  }

  return 'Quelle öffnen'
}

function isSourceUrl(url: string): boolean {
  const hostname = hostnameFor(url)

  return hostname ? sourceDomains.has(hostname) : false
}

function hostnameFor(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function normalizedHttpUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const url = value.trim()

  if (!/^https?:\/\//i.test(url)) {
    return null
  }

  return url
}

function stringRawProperty(rawProperties: Record<string, unknown>, key: string): string | null {
  const value = rawProperties[key]

  return typeof value === 'string' ? value : null
}
