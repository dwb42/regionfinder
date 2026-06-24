import { z } from 'zod'

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
