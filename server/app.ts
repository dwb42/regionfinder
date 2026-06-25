import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { RegionfinderRepository } from './db/types'
import { OsrmDrivingRouteProvider } from './driving/osrmDrivingRouteProvider'
import { DrivingRouteProviderError, type DrivingRouteProvider } from './driving/types'
import { DbTransportRestProvider, RealtimeProviderError, type RealtimeItineraryProvider } from './realtime/dbTransportRestProvider'
import {
  itineraryQuerySchema,
  metricsQuerySchema,
  publicIdParamsSchema,
  routePatternParamsSchema,
  schoolTileQuerySchema,
  splitCsv,
  stopSearchQuerySchema,
  tileQuerySchema,
  tileParamsSchema,
} from './schemas'

export type BuildAppOptions = {
  repository: RegionfinderRepository
  realtimeItineraryProvider?: RealtimeItineraryProvider
  drivingRouteProvider?: DrivingRouteProvider
  logger?: boolean
}

function notFound(message: string) {
  return {
    error: 'not_found',
    message,
  }
}

function publicIdAliases(publicId: string): string[] {
  const aliases = [publicId]
  const compactEvaPublicIdMatch = publicId.match(/^(.*:)(1\d{7})$/)

  if (compactEvaPublicIdMatch) {
    aliases.push(`${compactEvaPublicIdMatch[1]}1:${compactEvaPublicIdMatch[2].slice(1)}`)
  }

  return Array.from(new Set(aliases))
}

async function firstResolved<T>(ids: string[], resolve: (publicId: string) => Promise<T | null>): Promise<T | null> {
  for (const publicId of ids) {
    const resolved = await resolve(publicId)

    if (resolved) {
      return resolved
    }
  }

  return null
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
  })
  const realtimeItineraryProvider = options.realtimeItineraryProvider ?? new DbTransportRestProvider()
  const drivingRouteProvider =
    options.drivingRouteProvider ?? new OsrmDrivingRouteProvider()

  await app.register(cors, {
    origin: true,
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Request validation failed',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      })
    }

    app.log.error(error)

    return reply.code(500).send({
      error: 'internal_error',
      message: error instanceof Error ? error.message : String(error),
    })
  })

  app.get('/health', async () => ({ status: 'ok' }))

  app.get('/ready', async (_request, reply) => {
    const snapshot = await options.repository.currentSnapshot()

    if (!snapshot) {
      return reply.code(503).send({ status: 'not_ready', reason: 'no_active_snapshot' })
    }

    return { status: 'ready', snapshotId: snapshot.publicId }
  })

  app.get('/api/v1/snapshots/current', async (_request, reply) => {
    const snapshot = await options.repository.currentSnapshot()

    if (!snapshot) {
      return reply.code(404).send(notFound('No active snapshot'))
    }

    reply.header('Cache-Control', 'public, max-age=60')
    reply.header('ETag', `"snapshot-${snapshot.publicId}"`)

    return snapshot
  })

  app.get('/api/v1/stops/search', async (request) => {
    const query = stopSearchQuerySchema.parse(request.query)

    return options.repository.searchStops({
      query: query.q,
      states: splitCsv(query.states),
      modes: splitCsv(query.modes),
      limit: query.limit,
    })
  })

  app.get('/api/v1/stops/:publicId', async (request, reply) => {
    const params = publicIdParamsSchema.parse(request.params)
    const details = await firstResolved(publicIdAliases(params.publicId), (publicId) => options.repository.stopDetails(publicId))

    if (!details) {
      return reply.code(404).send(notFound(`Unknown StopPlace ${params.publicId}`))
    }

    return details
  })

  app.get('/api/v1/stops/:publicId/metrics', async (request, reply) => {
    const params = publicIdParamsSchema.parse(request.params)
    const query = metricsQuerySchema.parse(request.query)
    const metrics = await firstResolved(publicIdAliases(params.publicId), (publicId) =>
      options.repository.stopMetrics(publicId, query.profile, query.snapshot, query.date),
    )

    if (!metrics) {
      return reply.code(404).send(notFound(`No metrics for ${params.publicId}`))
    }

    return metrics
  })

  app.get('/api/v1/stops/:publicId/itineraries', async (request, reply) => {
    const params = publicIdParamsSchema.parse(request.params)
    const query = itineraryQuerySchema.parse(request.query)
    const response = await options.repository.itineraries({
      publicId: params.publicId,
      date: query.date,
      time: query.time,
      profile: query.profile,
    })

    if (!response) {
      return reply.code(404).send(notFound(`No itinerary for ${params.publicId}`))
    }

    return response
  })

  app.get('/api/v1/stops/:publicId/realtime-itineraries', async (request, reply) => {
    const params = publicIdParamsSchema.parse(request.params)
    const query = itineraryQuerySchema.parse(request.query)
    const [stop, snapshot] = await Promise.all([
      firstResolved(publicIdAliases(params.publicId), (publicId) => options.repository.stopDetails(publicId)),
      options.repository.currentSnapshot(),
    ])

    if (!stop) {
      return reply.code(404).send(notFound(`Unknown StopPlace ${params.publicId}`))
    }

    if (!snapshot) {
      return reply.code(404).send(notFound('No active snapshot'))
    }

    try {
      return await realtimeItineraryProvider.plan({
        stop,
        date: query.date,
        time: query.time,
        profile: query.profile,
        snapshotId: snapshot.publicId,
      })
    } catch (error) {
      if (error instanceof RealtimeProviderError) {
        return reply.code(error.statusCode).send({
          error: error.reason,
          message: error.message,
        })
      }

      throw error
    }
  })

  app.get('/api/v1/stops/:publicId/driving-route', async (request, reply) => {
    const params = publicIdParamsSchema.parse(request.params)
    const stop = await firstResolved(publicIdAliases(params.publicId), (publicId) => options.repository.stopDetails(publicId))

    if (!stop) {
      return reply.code(404).send(notFound(`Unknown StopPlace ${params.publicId}`))
    }

    try {
      return await drivingRouteProvider.routeToStop({ stop })
    } catch (error) {
      if (error instanceof DrivingRouteProviderError) {
        return reply.code(error.statusCode).send({
          error: error.reason,
          message: error.message,
        })
      }

      throw error
    }
  })

  app.get('/api/v1/route-patterns/:id', async (request, reply) => {
    const params = routePatternParamsSchema.parse(request.params)
    const pattern = await options.repository.routePattern(params.id)

    if (!pattern) {
      return reply.code(404).send(notFound(`Unknown route pattern ${params.id}`))
    }

    return pattern
  })

  app.get('/api/v1/tiles/stops/:z/:x/:y.mvt', async (request, reply) => {
    const params = tileParamsSchema.parse(request.params)
    const query = tileQuerySchema.parse(request.query)
    const modes = splitCsv(query.modes)
    const tile = await options.repository.stopTile(params.z, params.x, params.y, modes, query.profile)

    reply.header('Content-Type', 'application/vnd.mapbox-vector-tile')
    reply.header('Cache-Control', 'public, max-age=300')
    reply.header('ETag', `"stops-${params.z}-${params.x}-${params.y}-${modes.join('-')}-${query.profile}"`)

    return tile ?? Buffer.alloc(0)
  })

  app.get('/api/v1/tiles/routes/:z/:x/:y.mvt', async (request, reply) => {
    const params = tileParamsSchema.parse(request.params)
    const query = tileQuerySchema.parse(request.query)
    const modes = splitCsv(query.modes)
    const tile = await options.repository.routeTile(params.z, params.x, params.y, modes, query.profile)

    reply.header('Content-Type', 'application/vnd.mapbox-vector-tile')
    reply.header('Cache-Control', 'public, max-age=300')
    reply.header('ETag', `"routes-${params.z}-${params.x}-${params.y}-${modes.join('-')}-${query.profile}"`)

    return tile ?? Buffer.alloc(0)
  })

  app.get('/api/v1/tiles/rail-network/:z/:x/:y.mvt', async (request, reply) => {
    const params = tileParamsSchema.parse(request.params)
    const tile = await options.repository.railNetworkTile(params.z, params.x, params.y)

    reply.header('Content-Type', 'application/vnd.mapbox-vector-tile')
    reply.header('Cache-Control', 'public, max-age=300')
    reply.header('ETag', `"rail-network-${params.z}-${params.x}-${params.y}"`)

    return tile ?? Buffer.alloc(0)
  })

  app.get('/api/v1/tiles/schools/:z/:x/:y.mvt', async (request, reply) => {
    const params = tileParamsSchema.parse(request.params)
    const query = schoolTileQuerySchema.parse(request.query)
    const categories = splitCsv(query.categories)
    const states = splitCsv(query.states)
    const tile = await options.repository.schoolTile(params.z, params.x, params.y, categories, states)

    reply.header('Content-Type', 'application/vnd.mapbox-vector-tile')
    reply.header('Cache-Control', 'public, max-age=300')
    reply.header('ETag', `"schools-${params.z}-${params.x}-${params.y}-${categories.join('-')}-${states.join('-')}"`)

    return tile ?? Buffer.alloc(0)
  })

  return app
}
