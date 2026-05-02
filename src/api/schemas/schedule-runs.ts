import { z } from 'zod';
import {
  cuidIdParamSchema,
  numericIdSchema,
  paginationQuerySchema,
  runStatusEnum,
} from './_shared';

export const scheduleRunIdParamsSchema = cuidIdParamSchema;

export const scheduleRunStreamParamsSchema = cuidIdParamSchema;

export const scheduleRunAssignmentParamsSchema = z.object({
  id: cuidIdParamSchema.shape.id,
  assignmentId: numericIdSchema,
});

export const listScheduleRunsQuerySchema = paginationQuerySchema.extend({
  status: runStatusEnum.optional(),
  semesterId: numericIdSchema.optional(),
});

export const gaConfigSchema = z
  .object({
    populationSize: z.number().int().positive().max(10_000),
    generations: z.number().int().positive().max(10_000),
    mutationRate: z.number().min(0).max(1),
    elitismCount: z.number().int().nonnegative().max(1024),
    tournamentSize: z.number().int().positive().max(1024),
    crossoverType: z.enum(['singlePoint', 'uniform', 'pmx']),
    noiseRate: z.number().min(0).max(1),
    hardPenaltyWeight: z.number().nonnegative().max(1_000_000).default(100),
    softPenaltyWeight: z.number().nonnegative().max(1_000_000).default(1),
  })
  .strict()
  .refine((cfg) => cfg.elitismCount < cfg.populationSize, {
    message: 'elitismCount must be < populationSize',
    path: ['elitismCount'],
  })
  .refine((cfg) => cfg.tournamentSize <= cfg.populationSize, {
    message: 'tournamentSize must be ≤ populationSize',
    path: ['tournamentSize'],
  });

export type GaConfigInput = z.infer<typeof gaConfigSchema>;

export const createScheduleRunBodySchema = z
  .object({
    semesterId: numericIdSchema,
    config: gaConfigSchema,
  })
  .strict();

export type CreateScheduleRunBody = z.infer<typeof createScheduleRunBodySchema>;

export const cancelScheduleRunBodySchema = z.object({}).strict().optional();

export const overrideAssignmentBodySchema = z
  .object({
    roomId: numericIdSchema.optional(),
    timeSlotIds: z.array(numericIdSchema).min(1).max(64).optional(),
    notes: z.string().trim().max(1024).optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
  });

export type OverrideAssignmentBody = z.infer<typeof overrideAssignmentBodySchema>;
