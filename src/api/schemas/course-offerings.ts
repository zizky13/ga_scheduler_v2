import { z } from 'zod';
import {
  idArraySchema,
  idParamSchema,
  numericIdSchema,
  paginationQuerySchema,
} from './_shared';

export const courseOfferingIdParamsSchema = idParamSchema;

export const listCourseOfferingsQuerySchema = paginationQuerySchema.extend({
  semesterId: numericIdSchema.optional(),
  courseId: numericIdSchema.optional(),
  roomId: numericIdSchema.optional(),
  lecturerId: numericIdSchema.optional(),
  parentOfferingId: numericIdSchema.optional(),
});

export const createCourseOfferingBodySchema = z
  .object({
    semesterId: numericIdSchema,
    courseId: numericIdSchema,
    roomId: numericIdSchema.optional().nullable(),
    effectiveStudentCount: z.number().int().nonnegative().max(10000),
    lecturerIds: z.array(numericIdSchema).min(1, 'at least one lecturer is required').max(16),
    isFixed: z.boolean().optional(),
    fixedTimeSlotIds: idArraySchema.optional(),
    parentOfferingId: numericIdSchema.optional(),
  })
  .strict();

export type CreateCourseOfferingBody = z.infer<typeof createCourseOfferingBodySchema>;

export const updateCourseOfferingBodySchema = z
  .object({
    courseId: numericIdSchema.optional(),
    roomId: numericIdSchema.optional().nullable(),
    effectiveStudentCount: z.number().int().nonnegative().max(10000).optional(),
    lecturerIds: z.array(numericIdSchema).min(1).max(16).optional(),
    isFixed: z.boolean().optional(),
    fixedTimeSlotIds: idArraySchema.optional(),
    parentOfferingId: numericIdSchema.nullable().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type UpdateCourseOfferingBody = z.infer<typeof updateCourseOfferingBodySchema>;

export const updateStudentCountBodySchema = z
  .object({
    effectiveStudentCount: z.number().int().nonnegative().max(10000),
  })
  .strict();

export type UpdateStudentCountBody = z.infer<typeof updateStudentCountBodySchema>;
