import { z } from 'zod';

export const weekdayEnum = z.enum([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);

export type Weekday = z.infer<typeof weekdayEnum>;

export const roleEnum = z.enum(['admin', 'user']);

export type RoleInput = z.infer<typeof roleEnum>;

export const runStatusEnum = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'STAGNATED',
  'SSA_INFEASIBLE',
  'PRE_GA_EMPTY',
  'CANCELLED',
  'FAILED',
]);

export type RunStatusInput = z.infer<typeof runStatusEnum>;

export const hhmmTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, 'time must be HH:MM (00:00–23:59)');

const numericIdString = z
  .string()
  .regex(/^[1-9]\d*$/u, 'id must be a positive integer');

export const numericIdSchema = z
  .union([z.number().int().positive(), numericIdString.transform((s) => Number.parseInt(s, 10))])
  .pipe(z.number().int().positive());

export const cuidSchema = z
  .string()
  .min(1, 'id is required')
  .max(64, 'id is too long')
  .regex(/^[A-Za-z0-9_-]+$/u, 'id must be a CUID-like token');

export const idParamSchema = z.object({ id: numericIdSchema });

export const cuidIdParamSchema = z.object({ id: cuidSchema });

const intCoerced = z
  .union([z.number().int(), z.string().regex(/^-?\d+$/u).transform((s) => Number.parseInt(s, 10))])
  .pipe(z.number().int());

const positiveIntCoerced = intCoerced.pipe(z.number().int().positive());

export const paginationQuerySchema = z
  .object({
    page: positiveIntCoerced.default(1),
    pageSize: positiveIntCoerced.pipe(z.number().int().max(5000, 'pageSize must be ≤ 5000')).default(50),
    sort: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

const competencyTagSchema = z.string().trim().min(1, 'empty competency tag');

export const competencyArraySchema = z
  .array(competencyTagSchema)
  .max(32, 'too many competency tags (max 32)')
  .transform((arr) => Array.from(new Set(arr)));

export const idArraySchema = z.array(numericIdSchema).max(256, 'too many ids');

export const facilityCodeSchema = z
  .string()
  .trim()
  .min(1, 'facility code is required')
  .max(64, 'facility code is too long');

export const facilityArraySchema = z
  .array(facilityCodeSchema)
  .max(32, 'too many facility codes')
  .transform((arr) => Array.from(new Set(arr)));

export const passwordSchema = z
  .string()
  .min(10, 'password must be at least 10 characters')
  .max(256, 'password is too long')
  .refine((v) => /[A-Za-z]/u.test(v), 'password must contain at least one letter')
  .refine((v) => /\d/u.test(v), 'password must contain at least one digit');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
export const emailSchema = z
  .string()
  .trim()
  .max(254, 'email is too long')
  .regex(emailRegex, 'invalid email');

export const fullNameSchema = z.string().trim().min(1).max(128);

export const isoDateSchema = z.iso.datetime({ offset: true, message: 'must be an ISO-8601 timestamp' });

export const semesterCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/u, 'semester code must be alphanumeric / dash / underscore');
