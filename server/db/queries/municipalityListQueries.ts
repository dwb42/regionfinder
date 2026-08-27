import type {
  ApiMunicipalityList,
  ApiMunicipalityListCreateRequest,
  ApiMunicipalityListMemberships,
  ApiMunicipalityListUpdateRequest,
} from '../../../src/api/contracts'
import type { Queryable } from '../queryTypes'

type MunicipalityListRow = {
  id: string
  name: string
  color: string
  municipality_count: string | number
  created_at: Date | string
  updated_at: Date | string
}

export type MunicipalityListUpdateResult =
  | { status: 'ok'; list: ApiMunicipalityList }
  | { status: 'not_found' }
  | { status: 'conflict' }

export type MunicipalityMembershipMutationResult =
  | { status: 'ok'; changed: boolean }
  | { status: 'list_not_found' }
  | { status: 'municipality_not_found' }

const listSelect = `
  SELECT list.id::text,
         list.name,
         list.color,
         count(area.id)::int AS municipality_count,
         list.created_at,
         list.updated_at
  FROM municipality_lists list
  LEFT JOIN municipality_list_members member ON member.list_id = list.id
  LEFT JOIN administrative_areas area
    ON area.id = member.administrative_area_id
   AND area.level = 'municipality'
   AND area.is_active = true
`

export async function listMunicipalityLists(db: Queryable): Promise<ApiMunicipalityList[]> {
  const result = await db.query<MunicipalityListRow>(
    `${listSelect}
     GROUP BY list.id
     ORDER BY lower(list.name), list.id`,
  )

  return result.rows.map(municipalityListFromRow)
}

export async function createMunicipalityList(
  db: Queryable,
  input: ApiMunicipalityListCreateRequest,
): Promise<ApiMunicipalityList | null> {
  const result = await db.query<MunicipalityListRow>(
    `
    INSERT INTO municipality_lists (name, color)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    RETURNING id::text,
              name,
              color,
              0::int AS municipality_count,
              created_at,
              updated_at
    `,
    [input.name, input.color.toUpperCase()],
  )

  return result.rows[0] ? municipalityListFromRow(result.rows[0]) : null
}

export async function updateMunicipalityList(
  db: Queryable,
  id: string,
  input: ApiMunicipalityListUpdateRequest,
): Promise<MunicipalityListUpdateResult> {
  let result: { rows: MunicipalityListRow[] }

  try {
    result = await db.query<MunicipalityListRow>(
      `
      UPDATE municipality_lists list
      SET name = COALESCE($2, list.name),
          color = COALESCE($3, list.color),
          updated_at = now()
      WHERE list.id = $1::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM municipality_lists other
          WHERE other.id <> list.id
            AND lower(btrim(other.name)) = lower(btrim(COALESCE($2, list.name)))
        )
      RETURNING list.id::text,
                list.name,
                list.color,
                (
                  SELECT count(*)::int
                  FROM municipality_list_members member
                  JOIN administrative_areas area
                    ON area.id = member.administrative_area_id
                   AND area.level = 'municipality'
                   AND area.is_active = true
                  WHERE member.list_id = list.id
                ) AS municipality_count,
                list.created_at,
                list.updated_at
      `,
      [id, input.name ?? null, input.color?.toUpperCase() ?? null],
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { status: 'conflict' }
    }

    throw error
  }

  if (result.rows[0]) {
    return { status: 'ok', list: municipalityListFromRow(result.rows[0]) }
  }

  const exists = await municipalityListExists(db, id)
  return { status: exists ? 'conflict' : 'not_found' }
}

export async function deleteMunicipalityList(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query('DELETE FROM municipality_lists WHERE id = $1::uuid', [id])
  return (result.rowCount ?? 0) > 0
}

export async function municipalityListMemberships(
  db: Queryable,
  officialKey: string,
): Promise<ApiMunicipalityListMemberships | null> {
  const municipality = await activeMunicipalityId(db, officialKey)

  if (!municipality) {
    return null
  }

  const result = await db.query<{ list_id: string }>(
    `
    SELECT member.list_id::text
    FROM municipality_list_members member
    JOIN municipality_lists list ON list.id = member.list_id
    WHERE member.administrative_area_id = $1::uuid
    ORDER BY lower(list.name), list.id
    `,
    [municipality],
  )

  return { officialKey, listIds: result.rows.map((row) => row.list_id) }
}

export async function addMunicipalityListMember(
  db: Queryable,
  listId: string,
  officialKey: string,
): Promise<MunicipalityMembershipMutationResult> {
  if (!(await municipalityListExists(db, listId))) {
    return { status: 'list_not_found' }
  }

  const municipalityId = await activeMunicipalityId(db, officialKey)

  if (!municipalityId) {
    return { status: 'municipality_not_found' }
  }

  const result = await db.query(
    `
    INSERT INTO municipality_list_members (list_id, administrative_area_id)
    VALUES ($1::uuid, $2::uuid)
    ON CONFLICT DO NOTHING
    `,
    [listId, municipalityId],
  )
  const changed = (result.rowCount ?? 0) > 0

  if (changed) {
    await touchMunicipalityList(db, listId)
  }

  return { status: 'ok', changed }
}

export async function removeMunicipalityListMember(
  db: Queryable,
  listId: string,
  officialKey: string,
): Promise<MunicipalityMembershipMutationResult> {
  if (!(await municipalityListExists(db, listId))) {
    return { status: 'list_not_found' }
  }

  const municipalityId = await activeMunicipalityId(db, officialKey)

  if (!municipalityId) {
    return { status: 'municipality_not_found' }
  }

  const result = await db.query(
    `
    DELETE FROM municipality_list_members
    WHERE list_id = $1::uuid
      AND administrative_area_id = $2::uuid
    `,
    [listId, municipalityId],
  )
  const changed = (result.rowCount ?? 0) > 0

  if (changed) {
    await touchMunicipalityList(db, listId)
  }

  return { status: 'ok', changed }
}

async function municipalityListExists(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query('SELECT 1 FROM municipality_lists WHERE id = $1::uuid', [id])
  return (result.rowCount ?? result.rows.length) > 0
}

async function activeMunicipalityId(db: Queryable, officialKey: string): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `
    SELECT id::text
    FROM administrative_areas
    WHERE level = 'municipality'
      AND official_key = $1
      AND is_active = true
    `,
    [officialKey],
  )

  return result.rows[0]?.id ?? null
}

async function touchMunicipalityList(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE municipality_lists SET updated_at = clock_timestamp() WHERE id = $1::uuid', [id])
}

function municipalityListFromRow(row: MunicipalityListRow): ApiMunicipalityList {
  return {
    id: row.id,
    name: row.name,
    color: row.color.toUpperCase(),
    municipalityCount: Number(row.municipality_count),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  }
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}
