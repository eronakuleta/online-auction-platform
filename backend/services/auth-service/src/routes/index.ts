import { authenticate, requireRole, type TokenVerifier } from '@auction/shared-auth';
import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller';
import { createUserAdminController } from '../controllers/user-admin.controller';
import type { AuthService } from '../services/auth.service';
import type { UserAdminService } from '../services/user-admin.service';

export interface RouteDependencies {
  authService: AuthService;
  userAdminService: UserAdminService;
  verifyToken: TokenVerifier;
}

export function createRoutes(deps: RouteDependencies): Router {
  const controller = createAuthController(deps.authService);
  const adminController = createUserAdminController(deps.userAdminService);
  const requireLogin = authenticate(deps.verifyToken);
  const requireAdmin = [requireLogin, requireRole('ADMIN')];
  const router = Router();

  // Public: these are how a caller gets a token in the first place.
  router.post('/auth/register', controller.register);
  router.post('/auth/login', controller.login);
  router.post('/auth/refresh', controller.refresh);
  router.post('/auth/logout', controller.logout);

  router.get('/users/me', requireLogin, controller.getMe);
  router.patch('/users/me', requireLogin, controller.updateMe);

  router.get('/users', requireAdmin, adminController.list);
  router.patch('/users/:id/status', requireAdmin, adminController.updateStatus);
  router.patch('/users/:id/roles', requireAdmin, adminController.updateRoles);

  return router;
}
