import { z } from 'zod';
import {
  competencyArraySchema,
  facilityArraySchema,
  idParamSchema,
  numericIdSchema,
  paginationQuerySchema,
} from './_shared';

export const courseIdParamsSchema = idParamSchema;

export const listCoursesQuerySchema = paginationQuerySchema.extend({
  semesterId: numericIdSchema.optional(),
});

const courseCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/u, 'course code must be alphanumeric / dash / underscore');

export const createCourseBodySchema = z
  .object({
    semesterId: numericIdSchema,
    code: courseCodeSchema,
    name: z.string().trim().min(1).max(255),
    sks: z.number().int().positive().max(20),
    requiredFacilities: facilityArraySchema.default([]),
    requiredCompetencies: competencyArraySchema.default([]),
  })
  .strict();

export type CreateCourseBody = z.infer<typeof createCourseBodySchema>;

export const updateCourseBodySchema = z
  .object({
    code: courseCodeSchema.optional(),
    name: z.string().trim().min(1).max(255).optional(),
    sks: z.number().int().positive().max(20).optional(),
    requiredFacilities: facilityArraySchema.optional(),
    requiredCompetencies: competencyArraySchema.optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type UpdateCourseBody = z.infer<typeof updateCourseBodySchema>;
