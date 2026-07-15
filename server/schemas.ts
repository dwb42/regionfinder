import { z } from 'zod'

export const placeCategories = ['hof', 'ferienhof', 'gut', 'museum'] as const
export const placeCategorySchema = z.enum(placeCategories)

export const stopSearchQuerySchema = z.object({
  q: z.string().default(''),
  states: z.string().optional(),
  modes: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const publicIdParamsSchema = z.object({
  publicId: z.string().min(1),
})

export const metricsQuerySchema = z.object({
  profile: z.string().min(1).default('regular_tue_thu'),
  snapshot: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const itineraryQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  profile: z.string().min(1).default('regular_tue_thu'),
})

export const tileParamsSchema = z.object({
  z: z.coerce.number().int().min(0).max(22),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
})

export const tileQuerySchema = z.object({
  modes: z.string().optional(),
  profile: z.string().min(1).default('regular_tue_thu'),
})

export const schoolTileQuerySchema = z.object({
  categories: z.string().optional(),
  states: z.string().optional(),
})

export const placeTileQuerySchema = z.object({
  categories: z.string().optional(),
  states: z.string().optional(),
})

export const placeListQuerySchema = z.object({
  categories: z.string().optional(),
  states: z.string().optional(),
  q: z.string().default(''),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export const placeParamsSchema = z.object({
  id: z.string().uuid(),
})

const nullableTextSchema = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()

export const placeCreateSchema = z.object({
  sourceId: nullableTextSchema.optional(),
  sourcePlaceId: nullableTextSchema.optional(),
  category: placeCategorySchema,
  name: z.string().trim().min(1),
  stateCode: z.enum(['HH', 'SH', 'MV', 'NI']).nullable().optional(),
  address: nullableTextSchema.optional(),
  website: nullableTextSchema.optional(),
  coordinate: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
})

export const placeUpdateSchema = z.object({
  category: placeCategorySchema.optional(),
  name: z.string().trim().min(1).optional(),
  stateCode: z.enum(['HH', 'SH', 'MV', 'NI']).nullable().optional(),
  address: nullableTextSchema.optional(),
  website: nullableTextSchema.optional(),
  coordinate: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    })
    .optional(),
})

export const routePatternParamsSchema = z.object({
  id: z.string().min(1),
})

export function splitCsv(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}
