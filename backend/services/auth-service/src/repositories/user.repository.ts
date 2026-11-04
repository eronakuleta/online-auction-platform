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
