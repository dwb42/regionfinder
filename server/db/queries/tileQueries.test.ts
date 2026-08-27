import { describe, expect, it } from 'vitest'
import type { Queryable } from '../queryTypes'
import { administrativeAreaTile, municipalityListHighlightTile } from './tileQueries'

describe('administrativeAreaTile', () => {
  it('uses zoom-dependent municipality and label visibility with filtered parameters', async () => {
    let capturedSql = ''
    let capturedParameters: unknown[] = []
    const db: Queryable = {
      async query(sql: string, parameters?: unknown[]) {
        capturedSql = sql
        capturedParameters = parameters ?? []
        return { rows: [{ tile: Buffer.alloc(0) }], rowCount: 1 } as never
      },
    }

    await administrativeAreaTile(db, 9, 270, 166, ['county', 'municipality'], ['HH', 'SH'])

    expect(capturedParameters).toEqual([9, 270, 166, ['county', 'municipality'], ['HH', 'SH']])
    expect(capturedSql).toContain("area.level = 'county' OR $1 >= 9")
    expect(capturedSql).toContain("level = 'county' AND $1 >= 7 AND $1 < 10")
    expect(capturedSql).toContain("level = 'municipality' AND $1 >= 10")
    expect(capturedSql).toContain("ST_AsMVT(polygons, 'administrative_areas'")
    expect(capturedSql).toContain("ST_AsMVT(labels, 'administrative_area_labels'")
  })
})

describe('municipalityListHighlightTile', () => {
  it('renders only selected list memberships from zoom level six', async () => {
    let capturedSql = ''
    let capturedParameters: unknown[] = []
    const db: Queryable = {
      async query(sql: string, parameters?: unknown[]) {
        capturedSql = sql
        capturedParameters = parameters ?? []
        return { rows: [{ tile: Buffer.alloc(0) }], rowCount: 1 } as never
      },
    }
    const listIds = ['11111111-1111-4111-8111-111111111111']

    await municipalityListHighlightTile(db, 6, 33, 20, listIds)

    expect(capturedParameters).toEqual([6, 33, 20, listIds])
    expect(capturedSql).toContain("area.level = 'municipality'")
    expect(capturedSql).toContain('member.list_id = ANY($4::uuid[])')
    expect(capturedSql).toContain("ST_AsMVT(mvtgeom, 'municipality-list-highlights'")
  })
})
