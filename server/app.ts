import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { RegionfinderRepository } from './db/types'
import {
  itineraryQuerySchema,
  metricsQuerySchema,
  publicIdParamsSchema,
  routePatternParamsSchema,
  splitCsv,
  stopSearchQuerySchema,
  tileQuerySchema,
  tileParamsSchema,
} from './schemas'

export type BuildAppOptions = {
  repository: RegionfinderRepository
}

function notFound(message: string) {
  return {
    error: 'not_found',
    message,
  }
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  })

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
    const details = await options.repository.stopDetails(params.publicId)

    if (!details) {
      return reply.code(404).send(notFound(`Unknown StopPlace ${params.publicId}`))
    }

    return details
  })

  app.get('/api/v1/stops/:publicId/metrics', async (request, reply) => {
    const params = publicIdParamsSchema.parse(request.params)
    const query = metricsQuerySchema.parse(request.query)
    const metrics = await options.repository.stopMetrics(params.publicId, query.profile, query.snapshot)

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
    const tile = await options.repository.stopTile(params.z, params.x, params.y, modes)

    reply.header('Content-Type', 'application/vnd.mapbox-vector-tile')
    reply.header('Cache-Control', 'public, max-age=300')
    reply.header('ETag', `"stops-${params.z}-${params.x}-${params.y}-${modes.join('-')}"`)

    return tile ?? Buffer.alloc(0)
  })

  app.get('/api/v1/tiles/routes/:z/:x/:y.mvt', async (request, reply) => {
    const params = tileParamsSchema.parse(request.params)
    const query = tileQuerySchema.parse(request.query)
    const modes = splitCsv(query.modes)
    const tile = await options.repository.routeTile(params.z, params.x, params.y, modes)

    reply.header('Content-Type', 'application/vnd.mapbox-vector-tile')
    reply.header('Cache-Control', 'public, max-age=300')
    reply.header('ETag', `"routes-${params.z}-${params.x}-${params.y}-${modes.join('-')}"`)

    return tile ?? Buffer.alloc(0)
  })

  return app
}
