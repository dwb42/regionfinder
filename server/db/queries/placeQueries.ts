import type {
  ApiPlace,
  ApiPlaceCreateRequest,
  ApiPlaceUpdateRequest,
  PlaceCategory,
} from '../../../src/api/contracts'
import type { Queryable } from '../queryTypes'

type PlaceRow = {
  id: string
  source_id: string | null
  source_place_id: string | null
  origin: 'imported' | 'manual'
  category: PlaceCategory
  name: string
  state_code: string | null
  address: string | null
  website: string | null
  lat: string | number
  lon: string | number
  raw_properties: Record<string, unknown>
  imported_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

export async function listPlaces(
  db: Queryable,
  categories: PlaceCategory[] = [],
  states: string[] = [],
  query = '',
  limit = 100,
): Promise<ApiPlace[]> {
  const result = await db.query<PlaceRow>(
    `
    SELECT id::text,
           source_id,
           source_place_id,
           origin,
           category,
           name,
           state_code,
           address,
           website,
           ST_Y(geometry)::float AS lat,
           ST_X(geometry)::float AS lon,
           raw_properties,
           imported_at,
           created_at,
           updated_at,
           deleted_at
    FROM places
    WHERE deleted_at IS NULL
      AND (cardinality($1::text[]) = 0 OR category = ANY($1::text[]))
      AND (cardinality($2::text[]) = 0 OR state_code = ANY($2::text[]))
      AND ($3::text = '' OR name ILIKE '%' || $3::text || '%' OR coalesce(address, '') ILIKE '%' || $3::text || '%')
    ORDER BY name, id
    LIMIT $4
    `,
    [categories, states, query, limit],
  )

  return result.rows.map(placeFromRow)
}

export async function findPlace(db: Queryable, id: string): Promise<ApiPlace | null> {
  const result = await db.query<PlaceRow>(
    `
    SELECT id::text,
           source_id,
           source_place_id,
           origin,
           category,
           name,
           state_code,
           address,
           website,
           ST_Y(geometry)::float AS lat,
           ST_X(geometry)::float AS lon,
           raw_properties,
           imported_at,
           created_at,
           updated_at,
           deleted_at
    FROM places
    WHERE id = $1::uuid
      AND deleted_at IS NULL
    `,
    [id],
  )

  return result.rows[0] ? placeFromRow(result.rows[0]) : null
}

export async function createPlace(db: Queryable, input: ApiPlaceCreateRequest): Promise<ApiPlace> {
  const result = await db.query<PlaceRow>(
    `
    INSERT INTO places (
      source_id,
      source_place_id,
      origin,
      category,
      name,
      state_code,
      address,
      website,
      geometry,
      raw_properties,
      imported_at
    )
    VALUES (
      $1,
      $2,
      'manual',
      $3,
      $4,
      $5,
      $6,
      $7,
      ST_SetSRID(ST_MakePoint($8, $9), 4326),
      '{}'::jsonb,
      NULL
    )
    RETURNING id::text,
              source_id,
              source_place_id,
              origin,
              category,
              name,
              state_code,
              address,
              website,
              ST_Y(geometry)::float AS lat,
              ST_X(geometry)::float AS lon,
              raw_properties,
              imported_at,
              created_at,
              updated_at,
              deleted_at
    `,
    [
      input.sourceId ?? null,
      input.sourcePlaceId ?? null,
      input.category,
      input.name,
      input.stateCode ?? null,
      input.address ?? null,
      input.website ?? null,
      input.coordinate.lon,
      input.coordinate.lat,
    ],
  )

  return placeFromRow(result.rows[0])
}

export async function updatePlace(db: Queryable, id: string, input: ApiPlaceUpdateRequest): Promise<ApiPlace | null> {
  const current = await findPlace(db, id)

  if (!current) {
    return null
  }

  const next = {
    category: input.category ?? current.category,
    name: input.name ?? current.name,
    stateCode: input.stateCode === undefined ? current.stateCode : input.stateCode,
    address: input.address === undefined ? current.address : input.address,
    website: input.website === undefined ? current.website : input.website,
    coordinate: input.coordinate ?? current.coordinate,
  }

  const result = await db.query<PlaceRow>(
    `
    UPDATE places
    SET category = $2,
        name = $3,
        state_code = $4,
        address = $5,
        website = $6,
        geometry = ST_SetSRID(ST_MakePoint($7, $8), 4326),
        updated_at = now()
    WHERE id = $1::uuid
      AND deleted_at IS NULL
    RETURNING id::text,
              source_id,
              source_place_id,
              origin,
              category,
              name,
              state_code,
              address,
              website,
              ST_Y(geometry)::float AS lat,
              ST_X(geometry)::float AS lon,
              raw_properties,
              imported_at,
              created_at,
              updated_at,
              deleted_at
    `,
    [
      id,
      next.category,
      next.name,
      next.stateCode,
      next.address,
      next.website,
      next.coordinate.lon,
      next.coordinate.lat,
    ],
  )

  return result.rows[0] ? placeFromRow(result.rows[0]) : null
}

export async function deletePlace(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query(
    `
    UPDATE places
    SET deleted_at = now(),
        updated_at = now()
    WHERE id = $1::uuid
      AND deleted_at IS NULL
    `,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

function placeFromRow(row: PlaceRow): ApiPlace {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourcePlaceId: row.source_place_id,
    origin: row.origin,
    category: row.category,
    name: row.name,
    stateCode: row.state_code,
    address: row.address,
    website: row.website,
    coordinate: {
      lat: Number(row.lat),
      lon: Number(row.lon),
    },
    rawProperties: row.raw_properties,
    importedAt: timestamp(row.imported_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    deletedAt: timestamp(row.deleted_at),
  }
}

function timestamp(value: Date | string | null): string | null {
  if (!value) {
    return null
  }

  return value instanceof Date ? value.toISOString() : value
}
