import { z } from 'zod';
import {
  fullNameSchema,
  idParamSchema,
  paginationQuerySchema,
  roleEnum,
} from './_shared';

export const userIdParamsSchema = idParamSchema;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: roleEnum.optional(),
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
});

export const updateUserBodySchema = z
  .object({
    role: roleEnum.optional(),
    fullName: fullNameSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
