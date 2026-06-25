import type { ApiSnapshot } from '../../../src/api/contracts'
import type { Queryable } from '../queryTypes'

export async function findCurrentSnapshot(db: Queryable): Promise<ApiSnapshot | null> {
  const result = await db.query<{
    public_id: string
    source_key: string
    name: string
    provider: string
    license: string | null
    attribution: string | null
    valid_from: string | null
    valid_until: string | null
    imported_at: string | null
    activated_at: string | null
    source_sha256: string | null
    quality_report: Record<string, unknown>
  }>(
    `
    SELECT s.public_id,
           ds.source_key,
           ds.name,
           ds.provider,
           ds.license,
           ds.attribution,
           s.valid_from::text,
           s.valid_until::text,
           s.imported_at::text,
           s.activated_at::text,
           s.source_sha256,
           s.quality_report
    FROM data_snapshots s
    JOIN data_sources ds ON ds.id = s.source_id
    WHERE s.is_active = true
    LIMIT 1
    `,
  )
  const row = result.rows[0]

  if (!row) {
    return null
  }

  const profiles = await db.query<{ id: string; version: number; name: string }>(
    'SELECT id, version, name FROM routing_profiles ORDER BY id, version',
  )

  return {
    publicId: row.public_id,
    source: {
      key: row.source_key,
      name: row.name,
      provider: row.provider,
      license: row.license,
      attribution: row.attribution,
    },
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    importedAt: row.imported_at,
    activatedAt: row.activated_at,
    gtfsHash: row.source_sha256,
    osmHash: typeof row.quality_report.osm_sha256 === 'string' ? row.quality_report.osm_sha256 : null,
    activeRoutingProfiles: profiles.rows.map((profile) => ({
      id: profile.id,
      version: profile.version,
      name: profile.name,
    })),
    qualityStatus: typeof row.quality_report.status === 'string' ? row.quality_report.status : 'unknown',
  }
}
