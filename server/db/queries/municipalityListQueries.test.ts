import { describe, expect, it } from 'vitest'
import type { Queryable } from '../queryTypes'
import { addMunicipalityListMember, createMunicipalityList } from './municipalityListQueries'

describe('municipality list queries', () => {
  it('normalizes stored colors when creating a list', async () => {
    const db: Queryable = {
      async query(_sql: string, parameters?: unknown[]) {
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: parameters?.[0],
              color: parameters?.[1],
              municipality_count: 0,
              created_at: '2026-08-26T10:00:00.000Z',
              updated_at: '2026-08-26T10:00:00.000Z',
            },
          ],
          rowCount: 1,
        } as never
      },
    }

    const created = await createMunicipalityList(db, { name: 'Favoriten', color: '#2563eb' })
    expect(created).toMatchObject({ name: 'Favoriten', color: '#2563EB', municipalityCount: 0 })
  })

  it('adds a municipality membership and touches the list revision', async () => {
    const calls: Array<{ sql: string; parameters: unknown[] }> = []
    const db: Queryable = {
      async query(sql: string, parameters?: unknown[]) {
        calls.push({ sql, parameters: parameters ?? [] })

        if (sql.includes('SELECT 1 FROM municipality_lists')) {
          return { rows: [{ '?column?': 1 }], rowCount: 1 } as never
        }
        if (sql.includes('FROM administrative_areas')) {
          return { rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }], rowCount: 1 } as never
        }
        return { rows: [], rowCount: 1 } as never
      },
    }

    const result = await addMunicipalityListMember(
      db,
      '11111111-1111-4111-8111-111111111111',
      '01053001',
    )

    expect(result).toEqual({ status: 'ok', changed: true })
    expect(calls.some((call) => call.sql.includes('INSERT INTO municipality_list_members'))).toBe(true)
    expect(calls.some((call) => call.sql.includes('SET updated_at = clock_timestamp()'))).toBe(true)
  })
})
