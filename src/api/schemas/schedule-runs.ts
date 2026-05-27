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

const isoDateTimeNullableSchema = z.string().datetime().nullable();

export const scheduleRunDetailResponseSchema = z.object({
  id: z.string(),
  status: runStatusEnum,
  semesterId: numericIdSchema,
  createdById: numericIdSchema,
  bestFitness: z.number(),
  hardViolations: z.number().int(),
  softPenalty: z.number().int(),
  competencyMismatch: z.number().int(),
  loadPenalty: z.number().int(),
  capacityShortfallPenalty: z.number().int(),
  generationsRun: z.number().int(),
  currentGeneration: z.number().int(),
  stagnatedEarly: z.boolean(),
  durationMs: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: isoDateTimeNullableSchema,
  completedAt: isoDateTimeNullableSchema,
  createdAt: z.string().datetime(),
  config: z.unknown(),
  preGASummary: z.unknown(),
  ssaResult: z.unknown(),
  history: z.unknown(),
  avgHistory: z.unknown(),
  idempotencyKey: z.string().nullable(),
  assignments: z.array(z.object({
    offeringId: numericIdSchema,
    offering: z.object({
      id: numericIdSchema,
      courseCode: z.string(),
      courseName: z.string(),
      lecturers: z.array(z.object({
        id: numericIdSchema,
        name: z.string(),
      })),
    }),
    sessions: z.array(z.object({
      assignmentId: numericIdSchema,
      sessionIndex: z.number().int().nonnegative(),
      roomId: numericIdSchema,
      isFixedRoom: z.boolean(),
      manualOverride: z.boolean(),
      lecturerIds: z.array(numericIdSchema),
      timeSlots: z.array(z.object({
        id: numericIdSchema,
        day: z.string(),
        startTime: z.string(),
        endTime: z.string(),
      })),
    })),
  })),
}).openapi('ScheduleRunDetailResponse');
