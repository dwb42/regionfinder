import { buildApp } from './app'
import { FixtureRepository } from './db/fixtureRepository'
import { PostgresRepository } from './db/postgresRepository'

const host = process.env.REGIONFINDER_API_HOST ?? '127.0.0.1'
const port = Number(process.env.REGIONFINDER_API_PORT ?? 4000)
const databaseUrl = process.env.DATABASE_URL
const useFixture = process.env.REGIONFINDER_USE_FIXTURE_API === '1' || !databaseUrl
const repository = useFixture ? new FixtureRepository() : new PostgresRepository(databaseUrl)
const app = await buildApp({ repository })

await app.listen({ host, port })
