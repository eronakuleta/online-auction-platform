import { authenticate, requireRole, type TokenVerifier } from '@auction/shared-auth';
import { Router } from 'express';
import { createAuctionController } from '../controllers/auction.controller';
import { optionalAuthenticate } from '../middleware/optional-authenticate';
import type { AuctionService } from '../services/auction.service';

export function createRoutes(auctionService: AuctionService, verifyToken: TokenVerifier): Router {
  const controller = createAuctionController(auctionService);
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

  return router;
}
