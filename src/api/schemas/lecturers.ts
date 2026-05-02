import { z } from 'zod';
import {
  competencyArraySchema,
  idArraySchema,
  idParamSchema,
  numericIdSchema,
  paginationQuerySchema,
} from './_shared';

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
    preferredTimeSlotIds: idArraySchema.default([]),
    competencies: competencyArraySchema.default([]),
  })
  .strict();

export type CreateLecturerBody = z.infer<typeof createLecturerBodySchema>;

export const updateLecturerBodySchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    isStructural: z.boolean().optional(),
    preferredTimeSlotIds: idArraySchema.optional(),
    competencies: competencyArraySchema.optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type UpdateLecturerBody = z.infer<typeof updateLecturerBodySchema>;
