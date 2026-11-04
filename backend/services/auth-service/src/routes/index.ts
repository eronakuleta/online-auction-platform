import { authenticate, type TokenVerifier } from '@auction/shared-auth';
import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller';
import type { AuthService } from '../services/auth.service';

export function createRoutes(authService: AuthService, verifyToken: TokenVerifier): Router {
  const controller = createAuthController(authService);
  const requireLogin = authenticate(verifyToken);
  const router = Router();

  // Public: these are how a caller gets a token in the first place.
  router.post('/auth/register', controller.register);
  router.post('/auth/login', controller.login);
  router.post('/auth/refresh', controller.refresh);
  router.post('/auth/logout', controller.logout);

  router.get('/users/me', requireLogin, controller.getMe);
  router.patch('/users/me', requireLogin, controller.updateMe);

  return router;
}
