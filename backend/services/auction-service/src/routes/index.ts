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

  router.post('/auctions', requireSeller, controller.create);
  router.get('/auctions/:id', optionalAuthenticate(verifyToken), controller.getById);
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
