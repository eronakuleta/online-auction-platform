import { getAuthUser } from '@auction/shared-auth';
import type { RequestHandler } from 'express';
import type { Category } from '../repositories/category.repository';
import {
  categoryIdParamsSchema,
  createCategoryBodySchema,
  listCategoriesQuerySchema,
} from '../schemas/category.schemas';
import type { CategoryService } from '../services/category.service';

function toCategoryResponse(category: Category) {
  return { id: category.id, name: category.name, createdAt: category.createdAt.toISOString() };
}

export function createCategoryController(categoryService: CategoryService) {
  const list: RequestHandler = async (req, res) => {
    const { categories, ...pagination } = await categoryService.list(
      listCategoriesQuerySchema.parse(req.query),
    );
    res.status(200).json({ data: categories.map(toCategoryResponse), ...pagination });
  };

  const getById: RequestHandler = async (req, res) => {
    const { id } = categoryIdParamsSchema.parse(req.params);
    res.status(200).json(toCategoryResponse(await categoryService.getById(id)));
  };

  const create: RequestHandler = async (req, res) => {
    const { name } = createCategoryBodySchema.parse(req.body);
    const category = await categoryService.create(getAuthUser(req), name);
    res
      .status(201)
      .location(`/api/v1/categories/${category.id}`)
      .json(toCategoryResponse(category));
  };

  return { list, getById, create };
}
