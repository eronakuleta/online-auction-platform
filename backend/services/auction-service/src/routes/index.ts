import { authenticate, requireRole, type TokenVerifier } from '@auction/shared-auth';
import { Router } from 'express';
import { createAuctionController } from '../controllers/auction.controller';
import { createCategoryController } from '../controllers/category.controller';
import { optionalAuthenticate } from '../middleware/optional-authenticate';
import type { AuctionService } from '../services/auction.service';
import type { CategoryService } from '../services/category.service';

export function createRoutes(
  auctionService: AuctionService,
  categoryService: CategoryService,
  verifyToken: TokenVerifier,
): Router {
  const controller = createAuctionController(auctionService);
  const categories = createCategoryController(categoryService);
  const requireLogin = authenticate(verifyToken);
  const requireSeller = [requireLogin, requireRole('SELLER')];
  const router = Router();

  const optionalLogin = optionalAuthenticate(verifyToken);
  router.post('/auctions', requireSeller, controller.create);
  // Public, like the catalog page. A logged-in seller also sees their own reserve prices.
  router.get('/auctions', optionalLogin, controller.list);
  router.get('/auctions/:id', optionalLogin, controller.getById);
  router.patch('/auctions/:id', requireSeller, controller.update);
  router.post('/auctions/:id/publish', requireSeller, controller.publish);
  // Admins can cancel too. That the seller owns the auction is checked in the service layer.
  router.post(
    '/auctions/:id/cancel',
    requireLogin,
    requireRole('SELLER', 'ADMIN'),
    controller.cancel,
  );
  router.delete('/auctions/:id', requireSeller, controller.remove);

  // Public, for the catalog filter and the create form. Only an admin adds one (ROADMAP §3).
  router.get('/categories', categories.list);
  router.get('/categories/:id', categories.getById);
  router.post('/categories', requireLogin, requireRole('ADMIN'), categories.create);

  return router;
}
