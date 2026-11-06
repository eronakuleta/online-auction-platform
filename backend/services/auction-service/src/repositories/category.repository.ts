import type { Queryable } from './database';

export interface Category {
  id: string;
  name: string;
  createdAt: Date;
}

interface CategoryRow {
  id: string;
  name: string;
  created_at: Date;
}

function toCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

/** Alphabetical, ignoring case; the id breaks ties, so paging is stable. */
export async function listCategories(
  db: Queryable,
  page: { limit: number; offset: number },
): Promise<{ categories: Category[]; total: number }> {
  const [list, count] = await Promise.all([
    db.query<CategoryRow>(
      `SELECT id, name, created_at FROM categories
       ORDER BY lower(name), id
       LIMIT $1 OFFSET $2`,
      [page.limit, page.offset],
    ),
    db.query<{ total: string }>('SELECT count(*) AS total FROM categories'),
  ]);
  return { categories: list.rows.map(toCategory), total: Number(count.rows[0]?.total ?? 0) };
}

export async function findCategoryById(db: Queryable, id: string): Promise<Category | null> {
  const { rows } = await db.query<CategoryRow>(
    'SELECT id, name, created_at FROM categories WHERE id = $1',
    [id],
  );
  return rows[0] ? toCategory(rows[0]) : null;
}

/**
 * Inserts a category, or returns null if one with the same name exists, ignoring case. The unique
 * index on lower(name) decides, so two admins creating "Art" and "art" at once cannot both succeed.
 */
export async function insertCategory(db: Queryable, name: string): Promise<Category | null> {
  const { rows } = await db.query<CategoryRow>(
    `INSERT INTO categories (name) VALUES ($1)
     ON CONFLICT ((lower(name))) DO NOTHING
     RETURNING id, name, created_at`,
    [name],
  );
  return rows[0] ? toCategory(rows[0]) : null;
}
