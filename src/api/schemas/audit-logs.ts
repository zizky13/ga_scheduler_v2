import { z } from 'zod';
import { numericIdSchema, paginationQuerySchema } from './_shared';

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  actorId: numericIdSchema.optional(),
  entityType: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(128).optional(),
});
