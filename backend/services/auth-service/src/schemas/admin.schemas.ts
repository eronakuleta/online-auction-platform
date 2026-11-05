import { z } from 'zod';

const userStatus = z.enum(['ACTIVE', 'BANNED']);

export const userIdParamsSchema = z.strictObject({ id: z.uuid() });

// Values outside the limits are a 400 (docs/events.md section 9). The upper page limit only stops
// absurd numbers from reaching the database.
export const listUsersQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  status: userStatus.optional(),
});

export const updateStatusBodySchema = z.strictObject({ status: userStatus });

// The full new list of roles. ADMIN is not allowed: it is only seeded (decision Q6). A token must
// carry at least one role, so an empty list is refused.
export const updateRolesBodySchema = z.strictObject({
  roles: z
    .array(z.enum(['BIDDER', 'SELLER']))
    .min(1)
    .refine((roles) => new Set(roles).size === roles.length, 'Roles must not repeat'),
});
