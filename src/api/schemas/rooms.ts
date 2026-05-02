import { z } from 'zod';
import {
  facilityArraySchema,
  idParamSchema,
  numericIdSchema,
  paginationQuerySchema,
} from './_shared';

export const roomIdParamsSchema = idParamSchema;

export const listRoomsQuerySchema = paginationQuerySchema.extend({
  semesterId: numericIdSchema.optional(),
});

export const createRoomBodySchema = z
  .object({
    semesterId: numericIdSchema,
    name: z.string().trim().min(1).max(128),
    capacity: z.number().int().positive().max(10000),
    facilities: facilityArraySchema.default([]),
  })
  .strict();

export type CreateRoomBody = z.infer<typeof createRoomBodySchema>;

export const updateRoomBodySchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    capacity: z.number().int().positive().max(10000).optional(),
    facilities: facilityArraySchema.optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type UpdateRoomBody = z.infer<typeof updateRoomBodySchema>;
