import { z } from 'zod';
import {
  idParamSchema,
  isoDateSchema,
  paginationQuerySchema,
  semesterCodeSchema,
} from './_shared';

export const semesterIdParamsSchema = idParamSchema;

export const listSemestersQuerySchema = paginationQuerySchema.extend({
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
});

export const createSemesterBodySchema = z
  .object({
    code: semesterCodeSchema,
    label: z.string().trim().min(1).max(128),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
  })
  .strict()
  .refine((obj) => new Date(obj.startsOn).getTime() < new Date(obj.endsOn).getTime(), {
    message: 'startsOn must be before endsOn',
    path: ['endsOn'],
  });

export type CreateSemesterBody = z.infer<typeof createSemesterBodySchema>;

export const updateSemesterBodySchema = z
  .object({
    label: z.string().trim().min(1).max(128).optional(),
    startsOn: isoDateSchema.optional(),
    endsOn: isoDateSchema.optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type UpdateSemesterBody = z.infer<typeof updateSemesterBodySchema>;

export const activateSemesterBodySchema = z.object({}).strict().optional();
