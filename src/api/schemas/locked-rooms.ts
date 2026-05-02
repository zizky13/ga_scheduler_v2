import { z } from 'zod';
import { idParamSchema, numericIdSchema, paginationQuerySchema } from './_shared';

export const lockedRoomIdParamsSchema = idParamSchema;

export const listLockedRoomsQuerySchema = paginationQuerySchema.extend({
  semesterId: numericIdSchema.optional(),
  offeringId: numericIdSchema.optional(),
  roomId: numericIdSchema.optional(),
});

export const createLockedRoomBodySchema = z
  .object({
    semesterId: numericIdSchema,
    offeringId: numericIdSchema,
    roomId: numericIdSchema,
    reason: z.string().trim().max(512).optional(),
  })
  .strict();

export type CreateLockedRoomBody = z.infer<typeof createLockedRoomBodySchema>;

export const updateLockedRoomBodySchema = z
  .object({
    roomId: numericIdSchema.optional(),
    reason: z.string().trim().max(512).nullable().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type UpdateLockedRoomBody = z.infer<typeof updateLockedRoomBodySchema>;
