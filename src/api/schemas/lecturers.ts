// Ensures `.openapi(...)` is available on zod schemas regardless of which
// import path reaches this module (e.g. direct schema tests vs `paths.ts`).
import '../openapi/zod-init';

import { z } from 'zod';
import {
  competencyArraySchema,
  idArraySchema,
  idParamSchema,
  numericIdSchema,
  paginationQuerySchema,
} from './_shared';

const MAX_SKS_DESCRIPTION =
  'Maximum teaching load in SKS for this semester (soft constraint).';

export const lecturerIdParamsSchema = idParamSchema;

export const listLecturersQuerySchema = paginationQuerySchema.extend({
  semesterId: numericIdSchema.optional(),
  isStructural: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
});

export const createLecturerBodySchema = z
  .object({
    semesterId: numericIdSchema,
    name: z.string().trim().min(1).max(128),
    isStructural: z.boolean().optional(),
    maxSks: z
      .number()
      .int()
      .min(0)
      .optional()
      .openapi({ description: MAX_SKS_DESCRIPTION }),
    preferredTimeSlotIds: idArraySchema.default([]),
    competencies: competencyArraySchema.default([]),
  })
  .strict();

export type CreateLecturerBody = z.infer<typeof createLecturerBodySchema>;

export const updateLecturerBodySchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    isStructural: z.boolean().optional(),
    maxSks: z
      .number()
      .int()
      .min(0)
      .optional()
      .openapi({ description: MAX_SKS_DESCRIPTION }),
    preferredTimeSlotIds: idArraySchema.optional(),
    competencies: competencyArraySchema.optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type UpdateLecturerBody = z.infer<typeof updateLecturerBodySchema>;
