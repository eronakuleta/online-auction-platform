import type { AuthUser } from '@auction/shared-auth';
import { ConflictError, NotFoundError, type Logger } from '@auction/shared-common';
import type { Pool } from 'pg';
import {
  findCategoryById,
  insertCategory,
  listCategories,
  type Category,
} from '../repositories/category.repository';

export interface CategoryServiceDependencies {
  pool: Pool;
  logger: Logger;
}

/**
 * Categories (FR-05). Anyone lists them, for the catalog filter and the create-auction form; only an
 * admin adds one (the ADMIN role is checked by requireRole() in the routes). Renaming and deleting
 * are not in the roadmap: a category that auctions point to must stay.
 */
export function createCategoryService(deps: CategoryServiceDependencies) {
  const { pool, logger } = deps;

  return {
    async list(query: { page: number; size: number }) {
      const { categories, total } = await listCategories(pool, {
        limit: query.size,
        offset: (query.page - 1) * query.size,
      });
      return { categories, page: query.page, size: query.size, total };
    },

    async getById(id: string): Promise<Category> {
      const category = await findCategoryById(pool, id);
      if (!category) {
        throw new NotFoundError('Category not found');
      }
      return category;
    },

    async create(admin: AuthUser, name: string): Promise<Category> {
      const category = await insertCategory(pool, name);
      if (!category) {
        throw new ConflictError('CATEGORY_EXISTS', `A category named "${name}" already exists`);
      }
      logger.info({ categoryId: category.id, adminId: admin.id }, 'category created');
      return category;
    },
  };
}

export type CategoryService = ReturnType<typeof createCategoryService>;
