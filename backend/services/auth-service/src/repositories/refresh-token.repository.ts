import type { Queryable } from './database';

export interface StoredRefreshToken {
  id: string;
  userId: string;
  familyId: string;
  revoked: boolean;
  expired: boolean;
}

interface StoredRefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  revoked: boolean;
  expired: boolean;
}

export async function insertRefreshToken(
  db: Queryable,
  token: { userId: string; familyId: string; tokenHash: string; ttlSeconds: number },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))
     RETURNING id`,
    [token.userId, token.familyId, token.tokenHash, token.ttlSeconds],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('INSERT into refresh_tokens returned no row');
  }
  return id;
}

/**
 * Finds a token and locks its row until the transaction ends, so two parallel refreshes with the
 * same token run one after the other. Expiry is decided by Postgres, the one clock all replicas
 * share.
 */
export async function findRefreshTokenForUpdate(
  db: Queryable,
  tokenHash: string,
): Promise<StoredRefreshToken | null> {
  const { rows } = await db.query<StoredRefreshTokenRow>(
    `SELECT id, user_id, family_id,
            revoked_at IS NOT NULL AS revoked,
            expires_at <= now() AS expired
     FROM refresh_tokens
     WHERE token_hash = $1
     FOR UPDATE`,
    [tokenHash],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        familyId: row.family_id,
        revoked: row.revoked,
        expired: row.expired,
      }
    : null;
}

export async function markRefreshTokenReplaced(
  db: Queryable,
  id: string,
  replacedBy: string,
): Promise<void> {
  await db.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [
    id,
    replacedBy,
  ]);
}

export async function revokeTokenFamily(db: Queryable, familyId: string): Promise<void> {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
    [familyId],
  );
}

/** Revokes the whole family of a token. Does nothing for an unknown token. */
export async function revokeFamilyOfToken(db: Queryable, tokenHash: string): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE revoked_at IS NULL
       AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
    [tokenHash],
  );
}
