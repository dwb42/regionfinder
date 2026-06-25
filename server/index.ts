import { buildApp } from './app'
import { createRuntimeRepository } from './runtimeRepository'

const host = process.env.REGIONFINDER_API_HOST ?? '127.0.0.1'
const port = Number(process.env.REGIONFINDER_API_PORT ?? 4000)
const repository = createRuntimeRepository()
const app = await buildApp({ repository })

await app.listen({ host, port })
