import { z } from 'zod'

const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid timestamp')
const alert = z.object({ headerText: z.string(), descriptionText: z.string() })
export const placeSchema = z.object({
  name: z.string(), stopId: z.string().optional(), lat: z.number(), lon: z.number(),
  track: z.string().optional(), scheduledTrack: z.string().optional(), cancelled: z.boolean().optional(),
  arrivalTimestampReason: z.string().optional(), departureTimestampReason: z.string().optional(),
  alerts: z.array(alert).optional(),
})
const legSchema = z.object({
  mode: z.string(), startTime: timestamp, endTime: timestamp,
  scheduledStartTime: timestamp, scheduledEndTime: timestamp,
  realTime: z.boolean(), scheduled: z.boolean(), duration: z.number().nonnegative(),
  from: placeSchema, to: placeSchema,
  distance: z.number().nonnegative().optional(),
  displayName: z.string().optional(), routeShortName: z.string().optional(),
  agencyName: z.string().optional(), headsign: z.string().optional(),
  cancelled: z.boolean().optional(), interlineWithPreviousLeg: z.boolean().optional(),
  alerts: z.array(alert).optional(),
})
const itinerarySchema = z.object({
  duration: z.number().nonnegative(), startTime: timestamp, endTime: timestamp,
  transfers: z.number().int().nonnegative(), legs: z.array(legSchema).min(1),
})
export const planSchema = z.object({ itineraries: z.array(itinerarySchema) })
export const matchesSchema = z.array(z.object({
  id: z.string(), name: z.string(), type: z.string(), lat: z.number(), lon: z.number(),
}))
export type TransitousLeg = z.infer<typeof legSchema>
export type TransitousItinerary = z.infer<typeof itinerarySchema>
export type TransitousStop = { publicId: string; name: string; coordinate: { lat: number; lon: number }; dhid?: string | null }
