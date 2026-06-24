#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const DEFAULT_HVV_GTFS_URL =
  'https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/f0073555-962c-4d55-870e-b94bb676ad9d/Upload__hvv_Rohdaten_GTFS_Fpl_20260408.ZIP'

const requiredFiles = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
]

const rawDir = resolve('data/raw/hvv')
const outputDir = resolve('public/data/hvv')
const hamburgBounds = {
  minLat: 52.85,
  maxLat: 54.35,
  minLon: 8.75,
  maxLon: 11.35,
}
const schemaVersion = 1
const weekdayServiceMask = 1
const weekendServiceMask = 2

function parseArgs(argv) {
  const options = {
    input: null,
    url: process.env.HVV_GTFS_URL ?? null,
    download: false,
    output: outputDir,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--input') {
      options.input = resolve(argv[index + 1])
      index += 1
    } else if (arg === '--url') {
      options.url = argv[index + 1]
      index += 1
    } else if (arg === '--download') {
      options.download = true
    } else if (arg === '--output') {
      options.output = resolve(argv[index + 1])
      index += 1
    } else if (arg === '--help') {
      printHelp()
      process.exit(0)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage:
  npm run import:hvv -- --input data/raw/hvv/hvv.zip
  npm run import:hvv -- --download
  HVV_GTFS_URL=https://... npm run import:hvv -- --download

The importer reads HVV GTFS Static and writes browser artifacts to public/data/hvv/.`)
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findLocalZip() {
  if (!(await pathExists(rawDir))) {
    return null
  }

  const entries = await readdir(rawDir)
  const zip = entries.find((entry) => entry.toLocaleLowerCase('en-US').endsWith('.zip'))
  return zip ? join(rawDir, zip) : null
}

async function downloadZip(url) {
  await mkdir(rawDir, { recursive: true })
  const target = join(rawDir, `hvv-gtfs-${new Date().toISOString().slice(0, 10)}.zip`)
  const response = await fetch(url)

  if (!response.ok || !response.body) {
    throw new Error(`Could not download GTFS ZIP from ${url}: ${response.status} ${response.statusText}`)
  }

  await pipeline(response.body, createWriteStream(target))
  return target
}

function listZipEntries(zipPath) {
  const output = execFileSync('unzip', ['-Z1', zipPath], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

  return output.split(/\r?\n/).filter(Boolean)
}

function readZipText(zipPath, fileName) {
  return execFileSync('unzip', ['-p', zipPath, fileName], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  })
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      row.push(cell)
      if (row.some((value) => value.length > 0)) {
        rows.push(row)
      }
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  if (rows.length === 0) {
    return []
  }

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, ''))

  return rows.slice(1).map((values) => {
    const record = {}
    headers.forEach((header, index) => {
      record[header] = values[index] ?? ''
    })
    return record
  })
}

function parseNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function inBounds(stop) {
  return (
    stop.coordinates.lat >= hamburgBounds.minLat &&
    stop.coordinates.lat <= hamburgBounds.maxLat &&
    stop.coordinates.lon >= hamburgBounds.minLon &&
    stop.coordinates.lon <= hamburgBounds.maxLon
  )
}

function normalizeId(prefix, id) {
  return `${prefix}-${String(id).trim().toLocaleLowerCase('de-DE').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

function normalizePlaceKey(name) {
  const normalized = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/^bf\.\s*/, '')
    .replace(/^[asu]\s+/, '')
    .replace(/,\s*bf\.?$/, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+zob$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (/^(hbf|hauptbahnhof)(\s|$|\/)/.test(normalized)) {
    return 'hamburg hbf'
  }

  return normalized
}

function slugify(value) {
  return normalizePlaceKey(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stop-place'
}

function distanceKmBetween(a, b) {
  const radiusKm = 6371
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180
  const deltaLon = ((b.lon - a.lon) * Math.PI) / 180
  const h =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2)

  return 2 * radiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function modeRank(mode) {
  const order = ['ICE', 'RE', 'RB', 'RAIL', 'S', 'AKN', 'U', 'FERRY', 'TRAM', 'BUS']
  const index = order.indexOf(mode)
  return index === -1 ? order.length : index
}

function isRailMode(mode) {
  return mode === 'ICE' || mode === 'RE' || mode === 'RB' || mode === 'RAIL' || mode === 'S' || mode === 'AKN' || mode === 'U'
}

function stationModePriority(modes) {
  if (!modes || modes.length === 0) {
    return 99
  }

  return Math.min(...Array.from(modes).map(modeRank))
}

function cleanStopPlaceName(name) {
  return String(name)
    .replace(/^Bf\.\s*/, '')
    .replace(/^[ASU]\s+/, '')
    .replace(/\s*\((ZOB|Lauenb)\)\s*$/i, '')
    .replace(/\s*\/ZOB\s*$/i, '')
    .trim()
}

function splitCity(name) {
  if (name.startsWith('Hamburg ')) {
    return { city: 'Hamburg', region: name.replace(/^Hamburg\s+/, '') || 'Hamburg' }
  }

  const parts = name.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length > 1) {
    return { city: parts[0], region: parts.slice(1).join(', ') }
  }

  const paren = name.match(/^(.+?)\s+\((.+)\)$/)
  if (paren) {
    return { city: paren[1], region: paren[2] }
  }

  return { city: name, region: 'HVV-Verbundgebiet' }
}

function classifyRoute(route) {
  const routeType = Number(route.route_type)
  const shortName = route.route_short_name || route.route_id
  const upperShortName = shortName.toLocaleUpperCase('de-DE')

  if (
    upperShortName.startsWith('X') ||
    upperShortName.startsWith('M') ||
    /^\d{2,5}$/.test(upperShortName)
  ) {
    return { mode: 'BUS', layer: 'bus' }
  }

  if (upperShortName.startsWith('U')) {
    return { mode: 'U', layer: 'u-bahn' }
  }

  if (upperShortName.startsWith('S')) {
    return { mode: 'S', layer: 's-bahn' }
  }

  if (upperShortName.startsWith('A')) {
    return { mode: 'AKN', layer: 's-bahn' }
  }

  if (upperShortName.startsWith('RE')) {
    return { mode: 'RE', layer: 'regional' }
  }

  if (upperShortName.startsWith('RB')) {
    return { mode: 'RB', layer: 'regional' }
  }

  if (upperShortName.startsWith('ICE') || upperShortName.startsWith('IC')) {
    return { mode: 'ICE', layer: 'regional' }
  }

  if (routeType === 1 || upperShortName.startsWith('U')) {
    return { mode: 'U', layer: 'u-bahn' }
  }

  if (routeType === 2) {
    if (upperShortName.startsWith('S')) {
      return { mode: 'S', layer: 's-bahn' }
    }
    if (upperShortName.startsWith('A')) {
      return { mode: 'AKN', layer: 's-bahn' }
    }
    if (upperShortName.startsWith('RE')) {
      return { mode: 'RE', layer: 'regional' }
    }
    if (upperShortName.startsWith('RB')) {
      return { mode: 'RB', layer: 'regional' }
    }
    if (upperShortName.startsWith('ICE') || upperShortName.startsWith('IC')) {
      return { mode: 'ICE', layer: 'regional' }
    }
    return { mode: 'RAIL', layer: 'regional' }
  }

  if (routeType === 3) {
    return { mode: 'BUS', layer: 'bus' }
  }

  if (routeType === 4) {
    return { mode: 'FERRY', layer: 'faehre' }
  }

  if (routeType === 0) {
    return { mode: 'TRAM', layer: 'bus' }
  }

  return { mode: 'RAIL', layer: 'regional' }
}

function stationTypeForLayers(layers, locationType) {
  if (locationType === 1) {
    return 'halt'
  }
  if (layers.has('u-bahn')) {
    return 'u-bahn'
  }
  if (layers.has('s-bahn')) {
    return 's-bahn'
  }
  if (layers.has('regional')) {
    return 'regional'
  }
  if (layers.has('faehre')) {
    return 'faehre'
  }
  if (layers.has('bus')) {
    return 'bus'
  }
  return 'halt'
}

function modeForLayer(layer) {
  switch (layer) {
    case 'regional':
      return 'RAIL'
    case 's-bahn':
      return 'S'
    case 'u-bahn':
      return 'U'
    case 'faehre':
      return 'FERRY'
    case 'bus':
    default:
      return 'BUS'
  }
}

function serviceDateRange(calendar) {
  const dates = calendar.flatMap((service) => [service.start_date, service.end_date]).filter(Boolean)

  if (dates.length === 0) {
    return undefined
  }

  return {
    start: dates.reduce((min, date) => (date < min ? date : min), dates[0]),
    end: dates.reduce((max, date) => (date > max ? date : max), dates[0]),
  }
}

function buildShapeMap(shapes) {
  const groups = new Map()

  for (const point of shapes) {
    const shapeId = point.shape_id
    const list = groups.get(shapeId) ?? []
    list.push({
      lat: parseNumber(point.shape_pt_lat),
      lon: parseNumber(point.shape_pt_lon),
      sequence: parseNumber(point.shape_pt_sequence),
    })
    groups.set(shapeId, list)
  }

  const shapeMap = new Map()
  for (const [shapeId, points] of groups) {
    shapeMap.set(
      shapeId,
      points
        .sort((a, b) => a.sequence - b.sequence)
        .map(({ lat, lon }) => ({ lat, lon }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)),
    )
  }

  return shapeMap
}

function buildStopPlaces(stations, routes) {
  const stopLayerByStationId = new Map()
  const stopModeByStationId = new Map()

  for (const route of routes) {
    for (const stationId of route.stopIds) {
      const layers = stopLayerByStationId.get(stationId) ?? new Set()
      const modes = stopModeByStationId.get(stationId) ?? new Set()
      layers.add(route.layer)
      modes.add(route.mode)
      stopLayerByStationId.set(stationId, layers)
      stopModeByStationId.set(stationId, modes)
    }
  }

  const groupsByKey = new Map()

  for (const station of stations) {
    const key = normalizePlaceKey(station.name)
    const groups = groupsByKey.get(key) ?? []
    const maxDistanceKm = key === 'hamburg hbf' ? 0.75 : 0.45
    const nearbyGroup = groups.find((group) => distanceKmBetween(group.coordinates, station.coordinates) <= maxDistanceKm)
    const group =
      nearbyGroup ??
      {
        key,
        name: station.name.replace(/^Bf\.\s*/, ''),
        stations: [],
        coordinates: { ...station.coordinates },
      }

    group.stations.push(station)
    group.coordinates = {
      lat: group.stations.reduce((sum, item) => sum + item.coordinates.lat, 0) / group.stations.length,
      lon: group.stations.reduce((sum, item) => sum + item.coordinates.lon, 0) / group.stations.length,
    }

    if (!nearbyGroup) {
      groups.push(group)
      groupsByKey.set(key, groups)
    }
  }

  const stopPlaces = []
  const stopIdToStopPlaceId = new Map()

  for (const groups of groupsByKey.values()) {
    groups.forEach((group, groupIndex) => {
      const stopIds = group.stations.map((station) => station.id).sort()
      const allModes = new Set()
      const allLayers = new Set()

      for (const station of group.stations) {
        const stationModes = stopModeByStationId.get(station.id)
        const stationLayers = stopLayerByStationId.get(station.id)

        if (stationModes) {
          for (const mode of stationModes) {
            allModes.add(mode)
          }
        } else if (stationLayers) {
          for (const layer of stationLayers) {
            allModes.add(modeForLayer(layer))
          }
        }

        if (stationLayers) {
          for (const layer of stationLayers) {
            allLayers.add(layer)
          }
        }
      }

      const representative =
        [...group.stations].sort((a, b) => {
          const modeDifference = stationModePriority(stopModeByStationId.get(a.id)) - stationModePriority(stopModeByStationId.get(b.id))
          return modeDifference || a.name.length - b.name.length
        })[0]
      const modes = Array.from(allModes).sort((a, b) => modeRank(a) - modeRank(b))
      const name = group.key === 'hamburg hbf' ? 'Hamburg Hbf' : cleanStopPlaceName(representative.name)
      const idSuffix = groups.length > 1 ? `-${groupIndex + 1}` : ''
      const id = `stop-place-${slugify(name)}${idSuffix}`

      stopPlaces.push({
        id,
        name,
        coordinates: group.coordinates,
        modes: modes.length > 0 ? modes : [modeForLayer(representative.type === 'faehre' ? 'faehre' : representative.type === 'bus' ? 'bus' : 'regional')],
        stopIds,
        city: representative.city,
        state: representative.state,
        region: representative.region,
        layerIds: Array.from(allLayers).sort(),
      })

      for (const stopId of stopIds) {
        const station = group.stations.find((item) => item.id === stopId)
        stopIdToStopPlaceId.set(stopId, id)
        if (station?.sourceStopId) {
          stopIdToStopPlaceId.set(station.sourceStopId, id)
        }
      }
    })
  }

  stopPlaces.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))

  return { stopPlaces, stopIdToStopPlaceId }
}

function buildTransferEdges(stopPlaces) {
  const edges = []
  const seen = new Set()

  for (let fromIndex = 0; fromIndex < stopPlaces.length; fromIndex += 1) {
    const from = stopPlaces[fromIndex]
    const fromHasRail = from.modes.some(isRailMode)

    for (let toIndex = fromIndex + 1; toIndex < stopPlaces.length; toIndex += 1) {
      const to = stopPlaces[toIndex]
      const toHasRail = to.modes.some(isRailMode)

      if (!fromHasRail && !toHasRail) {
        continue
      }

      const distance = distanceKmBetween(from.coordinates, to.coordinates)

      if (distance > 0.35) {
        continue
      }

      const transferMinutes = Math.max(3, Math.min(8, Math.ceil((distance * 1000) / 80)))

      for (const [sourceIndex, targetIndex] of [[fromIndex, toIndex], [toIndex, fromIndex]]) {
        const key = `${sourceIndex}-${targetIndex}`

        if (seen.has(key)) {
          continue
        }

        seen.add(key)
        edges.push([sourceIndex, targetIndex, transferMinutes])
      }
    }
  }

  return edges
}

function reverseRailTrip(trip) {
  const [routeIndex, serviceMask, stopPlaceIndexes, departureMinutes, arrivalMinutes] = trip
  const firstDeparture = departureMinutes[0]
  const lastArrival = arrivalMinutes.at(-1)

  if (lastArrival === undefined) {
    return null
  }

  const reversedStopPlaceIndexes = [...stopPlaceIndexes].reverse()
  const reversedMinutes = departureMinutes
    .map((departure) => firstDeparture + (lastArrival - departure))
    .reverse()

  return [routeIndex, serviceMask, reversedStopPlaceIndexes, reversedMinutes, reversedMinutes]
}

function parseGtfsTimeToMinutes(value) {
  const [hours = '0', minutes = '0'] = String(value).split(':')
  return parseNumber(hours) * 60 + parseNumber(minutes)
}

function serviceMaskForCalendar(service) {
  let mask = 0

  if (service.monday || service.tuesday || service.wednesday || service.thursday || service.friday) {
    mask |= weekdayServiceMask
  }

  if (service.saturday || service.sunday) {
    mask |= weekendServiceMask
  }

  return mask
}

function buildReachabilityIndex({ routes, tripsIndex, stopTimesByTripId, calendar, stopPlaces, stopIdToStopPlaceId, importedAt, sourceGtfsDate }) {
  const routeBySourceId = new Map(routes.map((route) => [route.sourceRouteId, route]))
  const routeIndexById = new Map()
  const routeMeta = []

  for (const route of routes) {
    routeIndexById.set(route.id, routeMeta.length)
    routeMeta.push({
      id: route.id,
      name: route.name,
      operator: route.agencyId ?? 'HVV',
      color: route.color,
      mode: route.mode,
      layer: route.layer,
    })
  }

  const serviceMaskById = new Map(calendar.map((service) => [service.serviceId, serviceMaskForCalendar(service)]))
  const stopPlaceIndexById = new Map(stopPlaces.map((stopPlace, index) => [stopPlace.id, index]))
  const transferEdges = buildTransferEdges(stopPlaces)
  const weekdayStopCounts = stopPlaces.map(() => 0)
  const weekendStopCounts = stopPlaces.map(() => 0)
  const trips = []

  for (const trip of tripsIndex) {
    const route = routeBySourceId.get(trip.routeId)
    const routeIndex = route ? routeIndexById.get(route.id) : undefined
    const serviceMask = serviceMaskById.get(trip.serviceId) ?? 0
    const stopTimes = stopTimesByTripId.get(trip.tripId)

    if (!route || routeIndex === undefined || serviceMask === 0 || !stopTimes || stopTimes.length < 2) {
      continue
    }

    const stopPlaceIndexes = []
    const departureMinutes = []
    const arrivalMinutes = []

    for (const stopTime of stopTimes) {
      const stopPlaceId = stopIdToStopPlaceId.get(stopTime.stopId)
      const stopPlaceIndex = stopPlaceId ? stopPlaceIndexById.get(stopPlaceId) : undefined

      if (stopPlaceIndex === undefined) {
        continue
      }

      const previousStopPlaceIndex = stopPlaceIndexes.at(-1)
      const departure = parseGtfsTimeToMinutes(stopTime.departureTime)
      const arrival = parseGtfsTimeToMinutes(stopTime.arrivalTime)

      if (previousStopPlaceIndex === stopPlaceIndex) {
        departureMinutes[departureMinutes.length - 1] = Math.max(departureMinutes.at(-1) ?? departure, departure)
        arrivalMinutes[arrivalMinutes.length - 1] = Math.min(arrivalMinutes.at(-1) ?? arrival, arrival)
        continue
      }

      stopPlaceIndexes.push(stopPlaceIndex)
      departureMinutes.push(departure)
      arrivalMinutes.push(arrival)
    }

    if (stopPlaceIndexes.length < 2) {
      continue
    }

    const compactTrip = [routeIndex, serviceMask, stopPlaceIndexes, departureMinutes, arrivalMinutes]
    trips.push(compactTrip)

    if (route.layer !== 'bus' && route.layer !== 'faehre') {
      const reversedTrip = reverseRailTrip(compactTrip)

      if (reversedTrip) {
        trips.push(reversedTrip)
      }
    }

    for (const stopPlaceIndex of new Set(stopPlaceIndexes)) {
      if (serviceMask & weekdayServiceMask) {
        weekdayStopCounts[stopPlaceIndex] += 1
      }
      if (serviceMask & weekendServiceMask) {
        weekendStopCounts[stopPlaceIndex] += 1
      }
    }
  }

  return {
    schemaVersion,
    sourceGtfsDate,
    importedAt,
    stopPlaceIds: stopPlaces.map((stopPlace) => stopPlace.id),
    routes: routeMeta,
    trips,
    transferEdges,
    weekdayStopCounts,
    weekendStopCounts,
  }
}

function buildArtifacts(gtfs, zipPath, sourceUrl) {
  const agenciesById = new Map()
  for (const agency of gtfs.agency) {
    agenciesById.set(agency.agency_id || agency.agency_name, agency.agency_name)
  }

  const routesById = new Map()
  for (const route of gtfs.routes) {
    routesById.set(route.route_id, route)
  }

  const stopsBySourceId = new Map()
  for (const stop of gtfs.stops) {
    const name = stop.stop_name || stop.stop_id
    const coordinates = {
      lat: parseNumber(stop.stop_lat),
      lon: parseNumber(stop.stop_lon),
    }
    const { city, region } = splitCity(name)

    stopsBySourceId.set(stop.stop_id, {
      id: normalizeId('hvv-stop', stop.stop_id),
      sourceStopId: stop.stop_id,
      parentStationId: stop.parent_station ? normalizeId('hvv-stop', stop.parent_station) : undefined,
      platformCode: stop.platform_code || undefined,
      locationType: parseNumber(stop.location_type, 0),
      wheelchairBoarding: stop.wheelchair_boarding === '' ? undefined : parseNumber(stop.wheelchair_boarding),
      name,
      city,
      state: city === 'Hamburg' ? 'Hamburg' : 'HVV',
      region,
      coordinates,
      type: 'halt',
      source: 'hvv-gtfs',
    })
  }

  const tripsByRouteId = new Map()
  const tripsIndex = []
  for (const trip of gtfs.trips) {
    const route = routesById.get(trip.route_id)
    if (!route) {
      continue
    }
    const list = tripsByRouteId.get(trip.route_id) ?? []
    list.push(trip)
    tripsByRouteId.set(trip.route_id, list)
    tripsIndex.push({
      tripId: trip.trip_id,
      routeId: trip.route_id,
      serviceId: trip.service_id,
      shapeId: trip.shape_id || undefined,
      directionId: trip.direction_id || undefined,
    })
  }

  const stopTimesByTripId = new Map()
  const stopTimesIndex = []
  for (const stopTime of gtfs.stopTimes) {
    const tripId = stopTime.trip_id
    const list = stopTimesByTripId.get(tripId) ?? []
    const normalized = {
      tripId,
      stopId: stopTime.stop_id,
      arrivalTime: stopTime.arrival_time,
      departureTime: stopTime.departure_time,
      stopSequence: parseNumber(stopTime.stop_sequence),
    }
    list.push(normalized)
    stopTimesByTripId.set(tripId, list)
    stopTimesIndex.push(normalized)
  }

  for (const stopTimes of stopTimesByTripId.values()) {
    stopTimes.sort((a, b) => a.stopSequence - b.stopSequence)
  }

  const shapeMap = buildShapeMap(gtfs.shapes)
  const routeUsageByStopId = new Map()
  const routes = []

  for (const route of gtfs.routes) {
    const classification = classifyRoute(route)
    const routeTrips = tripsByRouteId.get(route.route_id) ?? []
    const representativeTrip = routeTrips.find((trip) => {
      const stopTimes = stopTimesByTripId.get(trip.trip_id)
      return stopTimes?.some((stopTime) => {
        const stop = stopsBySourceId.get(stopTime.stopId)
        return stop && inBounds(stop)
      })
    })

    if (!representativeTrip) {
      continue
    }

    const representativeStopTimes = stopTimesByTripId.get(representativeTrip.trip_id) ?? []
    const stopIds = representativeStopTimes
      .map((stopTime) => stopsBySourceId.get(stopTime.stopId)?.id)
      .filter(Boolean)
    const shapeGeometry = representativeTrip.shape_id ? shapeMap.get(representativeTrip.shape_id) : undefined
    const stopGeometry = representativeStopTimes
      .map((stopTime) => stopsBySourceId.get(stopTime.stopId)?.coordinates)
      .filter(Boolean)
    const geometry = shapeGeometry && shapeGeometry.length >= 2 ? shapeGeometry : stopGeometry

    if (geometry.length < 2 || !geometry.some((point) => inBounds({ coordinates: point }))) {
      continue
    }

    for (const stopId of stopIds) {
      const layers = routeUsageByStopId.get(stopId) ?? new Set()
      layers.add(classification.layer)
      routeUsageByStopId.set(stopId, layers)
    }

    routes.push({
      id: normalizeId('hvv-route', route.route_id),
      sourceRouteId: route.route_id,
      name: route.route_short_name || route.route_long_name || route.route_id,
      routeShortName: route.route_short_name || undefined,
      routeLongName: route.route_long_name || undefined,
      agencyId: route.agency_id || undefined,
      routeType: parseNumber(route.route_type),
      color: route.route_color ? `#${route.route_color.replace(/^#/, '')}` : fallbackColor(classification.mode),
      textColor: route.route_text_color ? `#${route.route_text_color.replace(/^#/, '')}` : undefined,
      mode: classification.mode,
      layer: classification.layer,
      source: 'hvv-gtfs',
      stationIds: stopIds,
      stopIds,
      geometry,
    })
  }

  const stations = Array.from(stopsBySourceId.values())
    .filter((station) => {
      if (!inBounds(station)) {
        return false
      }
      return routeUsageByStopId.has(station.id) || station.locationType === 1
    })
    .map((station) => ({
      ...station,
      type: stationTypeForLayers(routeUsageByStopId.get(station.id) ?? new Set(), station.locationType),
    }))

  const calendar = gtfs.calendar.map((service) => ({
    serviceId: service.service_id,
    monday: parseNumber(service.monday),
    tuesday: parseNumber(service.tuesday),
    wednesday: parseNumber(service.wednesday),
    thursday: parseNumber(service.thursday),
    friday: parseNumber(service.friday),
    saturday: parseNumber(service.saturday),
    sunday: parseNumber(service.sunday),
    startDate: service.start_date,
    endDate: service.end_date,
  }))

  const calendarDates = gtfs.calendarDates.map((date) => ({
    serviceId: date.service_id,
    date: date.date,
    exceptionType: parseNumber(date.exception_type),
  }))
  const { stopPlaces, stopIdToStopPlaceId } = buildStopPlaces(stations, routes)
  const importedAt = new Date().toISOString()
  const sourceGtfsDate = serviceDateRange(gtfs.calendar)?.start ?? ''
  const reachabilityIndex = buildReachabilityIndex({
    routes,
    tripsIndex,
    stopTimesByTripId,
    calendar,
    stopPlaces,
    stopIdToStopPlaceId,
    importedAt,
    sourceGtfsDate,
  })

  const manifest = {
    schemaVersion,
    sourceName: 'hvv Fahrplandaten (GTFS)',
    sourceUrl,
    attribution: 'Hamburger Verkehrsverbund GmbH',
    license: 'Datenlizenz Deutschland Namensnennung 2.0',
    importedAt,
    sourceGtfsDate,
    generatedFrom: basename(zipPath),
    hasShapes: gtfs.shapes.length > 0,
    counts: {
      agencies: gtfs.agency.length,
      stops: stations.length,
      routes: routes.length,
      trips: gtfs.trips.length,
      stopTimes: gtfs.stopTimes.length,
      shapes: gtfs.shapes.length,
      services: gtfs.calendar.length,
      calendarDates: gtfs.calendarDates.length,
    },
    serviceDateRange: serviceDateRange(gtfs.calendar),
  }

  return {
    manifest,
    stopPlaces,
    stations,
    routes,
    tripsIndex,
    stopTimesIndex,
    reachabilityIndex,
    calendar,
    calendarDates,
  }
}

function fallbackColor(mode) {
  switch (mode) {
    case 'U':
      return '#2563eb'
    case 'S':
    case 'AKN':
      return '#0f766e'
    case 'BUS':
      return '#c2410c'
    case 'FERRY':
      return '#0891b2'
    case 'RE':
    case 'RB':
    case 'RAIL':
    default:
      return '#334155'
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value)}\n`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  let zipPath = options.input
  let sourceUrl = options.url || DEFAULT_HVV_GTFS_URL

  if (!zipPath && options.download) {
    zipPath = await downloadZip(sourceUrl)
  }

  if (!zipPath) {
    zipPath = await findLocalZip()
  }

  if (!zipPath) {
    throw new Error('No GTFS ZIP found. Place a ZIP in data/raw/hvv/, pass --input, or run with --download.')
  }

  if (!(await pathExists(zipPath))) {
    throw new Error(`GTFS ZIP does not exist: ${zipPath}`)
  }

  const entryByBaseName = new Map(listZipEntries(zipPath).map((entry) => [entry.replace(/^.*\//, ''), entry]))
  const missing = requiredFiles.filter((file) => !entryByBaseName.has(file))

  if (missing.length > 0) {
    throw new Error(`GTFS ZIP is missing required file(s): ${missing.join(', ')}`)
  }

  const read = (fileName) => parseCsv(readZipText(zipPath, entryByBaseName.get(fileName) ?? fileName))
  const gtfs = {
    agency: read('agency.txt'),
    stops: read('stops.txt'),
    routes: read('routes.txt'),
    trips: read('trips.txt'),
    stopTimes: read('stop_times.txt'),
    calendar: read('calendar.txt'),
    calendarDates: entryByBaseName.has('calendar_dates.txt') ? read('calendar_dates.txt') : [],
    shapes: entryByBaseName.has('shapes.txt') ? read('shapes.txt') : [],
  }

  const artifacts = buildArtifacts(gtfs, zipPath, sourceUrl)
  const out = options.output

  await mkdir(out, { recursive: true })
  await writeJson(join(out, 'manifest.json'), artifacts.manifest)
  await writeJson(join(out, 'stop-places.json'), artifacts.stopPlaces)
  await writeJson(join(out, 'stations.json'), artifacts.stations)
  await writeJson(join(out, 'routes.json'), artifacts.routes)
  await writeJson(join(out, 'trips-index.json'), artifacts.tripsIndex)
  await writeJson(join(out, 'stop-times.json'), artifacts.stopTimesIndex)
  await writeJson(join(out, 'reachability-index.json'), artifacts.reachabilityIndex)
  await writeJson(join(out, 'calendar.json'), artifacts.calendar)
  await writeJson(join(out, 'calendar-dates.json'), artifacts.calendarDates)

  console.log(`Imported ${artifacts.manifest.counts.routes} HVV routes and ${artifacts.manifest.counts.stops} stops.`)
  console.log(`Wrote artifacts to ${out}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
