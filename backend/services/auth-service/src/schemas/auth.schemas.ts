// Request validation. Strict objects reject unknown fields, so `roles: ["ADMIN"]` in a body is a
// 400 and can never reach the database (mass assignment).
import { z } from 'zod';

// Stored lowercased, so "A@x.io" and "a@x.io" are one account.
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const displayName = z.string().trim().min(1).max(100);
// The upper limit stops very long inputs from wasting argon2 time.
const newPassword = z.string().min(8).max(128);
const refreshToken = z.string().min(1).max(256);

export const registerBodySchema = z.strictObject({ email, password: newPassword, displayName });

export const loginBodySchema = z.strictObject({
  email,
  // No length rule beyond the limit, so a login error says nothing about the password policy.
  password: z.string().min(1).max(128),
});

export const refreshTokenBodySchema = z.strictObject({ refreshToken });

export const updateProfileBodySchema = z.strictObject({ displayName });
