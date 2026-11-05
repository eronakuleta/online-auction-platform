import { getAuthUser } from '@auction/shared-auth';
import type { RequestHandler } from 'express';
import {
  listUsersQuerySchema,
  updateRolesBodySchema,
  updateStatusBodySchema,
  userIdParamsSchema,
} from '../schemas/admin.schemas';
import type { UserAdminService } from '../services/user-admin.service';
import { toUserResponse } from './user-response';

export function createUserAdminController(userAdminService: UserAdminService) {
  const list: RequestHandler = async (req, res) => {
    const { users, ...pagination } = await userAdminService.list(
      listUsersQuerySchema.parse(req.query),
    );
    res.status(200).json({ data: users.map(toUserResponse), ...pagination });
  };

  const updateStatus: RequestHandler = async (req, res) => {
    const { id } = userIdParamsSchema.parse(req.params);
    const { status } = updateStatusBodySchema.parse(req.body);
    const user = await userAdminService.setStatus(getAuthUser(req).id, id, status);
    res.status(200).json(toUserResponse(user));
  };

  const updateRoles: RequestHandler = async (req, res) => {
    const { id } = userIdParamsSchema.parse(req.params);
    const { roles } = updateRolesBodySchema.parse(req.body);
    const user = await userAdminService.setRoles(getAuthUser(req).id, id, roles);
    res.status(200).json(toUserResponse(user));
  };

  return { list, updateStatus, updateRoles };
}
