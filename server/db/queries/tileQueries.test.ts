import { describe, expect, it } from 'vitest'
import type { Queryable } from '../queryTypes'
import { administrativeAreaTile } from './tileQueries'

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
