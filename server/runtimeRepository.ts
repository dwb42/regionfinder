import { FixtureRepository } from './db/fixtureRepository'
import { PostgresRepository } from './db/postgresRepository'
import type { RegionfinderRepository } from './db/types'

export type RuntimeRepositoryEnv = {
  DATABASE_URL?: string
  REGIONFINDER_USE_FIXTURE_API?: string
}

export function createRuntimeRepository(env: RuntimeRepositoryEnv = process.env): RegionfinderRepository {
  if (env.REGIONFINDER_USE_FIXTURE_API === '1') {
    return new FixtureRepository()
  }

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required unless REGIONFINDER_USE_FIXTURE_API=1 is set')
  }

  return new PostgresRepository(env.DATABASE_URL)
}
