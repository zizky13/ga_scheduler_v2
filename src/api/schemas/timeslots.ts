import { z } from 'zod';
import {
  hhmmTimeSchema,
  idParamSchema,
  numericIdSchema,
  paginationQuerySchema,
  weekdayEnum,
} from './_shared';

export const timeslotIdParamsSchema = idParamSchema;

export const listTimeslotsQuerySchema = paginationQuerySchema.extend({
  semesterId: numericIdSchema.optional(),
  day: weekdayEnum.optional(),
});

export const createTimeslotBodySchema = z
  .object({
    semesterId: numericIdSchema,
    day: weekdayEnum,
    startTime: hhmmTimeSchema,
    endTime: hhmmTimeSchema,
  })
  .strict()
  .refine((obj) => obj.startTime < obj.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  });

export type CreateTimeslotBody = z.infer<typeof createTimeslotBodySchema>;

export const updateTimeslotBodySchema = z
  .object({
    day: weekdayEnum.optional(),
    startTime: hhmmTimeSchema.optional(),
    endTime: hhmmTimeSchema.optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type UpdateTimeslotBody = z.infer<typeof updateTimeslotBodySchema>;
