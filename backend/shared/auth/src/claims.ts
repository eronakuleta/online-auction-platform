// The shape of an access token issued by auth-service, and the user it describes.
import { z } from 'zod';

export const ROLES = ['BIDDER', 'SELLER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Claims every access token must carry. jsonwebtoken already checked exp, iss and aud. */
export const accessTokenClaimsSchema = z.object({
  sub: z.uuid(),
  roles: z.array(z.enum(ROLES)).min(1),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

/** The authenticated caller, as services see it (attached to the request by the middleware). */
export interface AuthUser {
  id: string;
  roles: Role[];
}
