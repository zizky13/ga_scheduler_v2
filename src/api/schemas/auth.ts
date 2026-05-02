import { z } from 'zod';
import { emailSchema, fullNameSchema, passwordSchema, roleEnum } from './_shared';

export const registerBodySchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    fullName: fullNameSchema,
    role: roleEnum,
  })
  .strict();

export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'password is required').max(256),
  })
  .strict();

export type LoginBody = z.infer<typeof loginBodySchema>;

export const refreshBodySchema = z.object({}).strict().optional();

export const logoutBodySchema = z.object({}).strict().optional();
