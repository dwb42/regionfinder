import { describe, expect, it } from 'vitest'
import { FixtureRepository } from './db/fixtureRepository'
import { PostgresRepository } from './db/postgresRepository'
import { createRuntimeRepository } from './runtimeRepository'

describe('createRuntimeRepository', () => {
  it('requires DATABASE_URL unless fixture mode is explicit', () => {
    expect(() => createRuntimeRepository({})).toThrow(/DATABASE_URL is required/)
  })

  it('uses fixtures only when REGIONFINDER_USE_FIXTURE_API is set', () => {
    const repository = createRuntimeRepository({ REGIONFINDER_USE_FIXTURE_API: '1' })

    expect(repository).toBeInstanceOf(FixtureRepository)
  })

  it('uses Postgres when DATABASE_URL is configured', () => {
    const repository = createRuntimeRepository({ DATABASE_URL: 'postgres://example.local/regionfinder' })

    expect(repository).toBeInstanceOf(PostgresRepository)
  })
})
