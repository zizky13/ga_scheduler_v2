import { z } from 'zod';
import { facilityCodeSchema, idParamSchema, paginationQuerySchema } from './_shared';

export const facilityIdParamsSchema = idParamSchema;

export const listFacilitiesQuerySchema = paginationQuerySchema;

export const createFacilityBodySchema = z
  .object({
    code: facilityCodeSchema,
    label: z.string().trim().min(1).max(128),
  })
  .strict();

export type CreateFacilityBody = z.infer<typeof createFacilityBodySchema>;

export const updateFacilityBodySchema = z
  .object({
    code: facilityCodeSchema.optional(),
    label: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type UpdateFacilityBody = z.infer<typeof updateFacilityBodySchema>;
