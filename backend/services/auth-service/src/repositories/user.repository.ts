import type { Role } from '@auction/shared-auth';
import type { Queryable } from './database';

export type UserStatus = 'ACTIVE' | 'BANNED';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  status: UserStatus;
  roles: Role[];
  createdAt: Date;
  updatedAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: UserStatus;
  roles: Role[];
  created_at: Date;
  updated_at: Date;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    status: row.status,
    roles: row.roles,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// array_agg gives text[]; pg returns it as a string array, in a stable order.
const SELECT_USER = `
  SELECT u.id, u.email, u.password_hash, u.display_name, u.status, u.created_at, u.updated_at,
         COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
  FROM users u
  LEFT JOIN user_roles r ON r.user_id = u.id`;

export async function findUserByEmail(db: Queryable, email: string): Promise<User | null> {
  const { rows } = await db.query<UserRow>(`${SELECT_USER} WHERE u.email = $1 GROUP BY u.id`, [
    email,
  ]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findUserById(db: Queryable, id: string): Promise<User | null> {
  const { rows } = await db.query<UserRow>(`${SELECT_USER} WHERE u.id = $1 GROUP BY u.id`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

/** Creates the user with one role. Returns null if the email is taken, also under concurrency. */
export async function insertUserWithRole(
  db: Queryable,
  user: { email: string; passwordHash: string; displayName: string; role: Role },
): Promise<User | null> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [user.email, user.passwordHash, user.displayName],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    return null;
  }
  await db.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, user.role]);
  return findUserById(db, id);
}

export async function updateDisplayName(
  db: Queryable,
  id: string,
  displayName: string,
): Promise<User | null> {
  const { rowCount } = await db.query(
    'UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1',
    [id, displayName],
  );
  return rowCount ? findUserById(db, id) : null;
}

/** A page of users, newest first, with the total for pagination. */
export async function listUsers(
  db: Queryable,
  options: { status?: UserStatus; limit: number; offset: number },
): Promise<{ users: User[]; total: number }> {
  const status = options.status ?? null;
  const { rows } = await db.query<UserRow>(
    `${SELECT_USER}
     WHERE ($1::text IS NULL OR u.status = $1)
     GROUP BY u.id
     ORDER BY u.created_at DESC, u.id
     LIMIT $2 OFFSET $3`,
    [status, options.limit, options.offset],
  );
  const count = await db.query<{ total: string }>(
    'SELECT count(*) AS total FROM users WHERE ($1::text IS NULL OR status = $1)',
    [status],
  );
  return { users: rows.map(toUser), total: Number(count.rows[0]?.total ?? 0) };
}

/** Locks the user's row until the transaction ends, so parallel admin changes run in turn. */
export async function findUserForUpdate(db: Queryable, id: string): Promise<User | null> {
  const { rowCount } = await db.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [id]);
  return rowCount ? findUserById(db, id) : null;
}

export async function updateUserStatus(
  db: Queryable,
  id: string,
  status: UserStatus,
): Promise<void> {
  await db.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
}

/** Makes the user's roles exactly this list. */
export async function replaceUserRoles(db: Queryable, id: string, roles: Role[]): Promise<void> {
  await db.query('DELETE FROM user_roles WHERE user_id = $1 AND role <> ALL($2::text[])', [
    id,
    roles,
  ]);
  await db.query(
    `INSERT INTO user_roles (user_id, role)
     SELECT $1, unnest($2::text[])
     ON CONFLICT (user_id, role) DO NOTHING`,
    [id, roles],
  );
  await db.query('UPDATE users SET updated_at = now() WHERE id = $1', [id]);
}
