import { authenticate, requireRole, type TokenVerifier } from '@auction/shared-auth';
import { Router } from 'express';
import { createBidController } from '../controllers/bid.controller';
import type { BiddingService } from '../services/bidding.service';

/** Public API under /api/v1, reached through the gateway. */
export function createRoutes(biddingService: BiddingService, verifyToken: TokenVerifier): Router {
  const controller = createBidController(biddingService);
  const router = Router();

  // That the bidder is not the seller is checked in the service layer.
  router.post(
    '/auctions/:id/bids',
    authenticate(verifyToken),
    requireRole('BIDDER'),
    controller.placeBid,
  );

  return router;
}

/**
 * Calls from other services on the internal network. The gateway refuses every /internal path
 * (gateway/nginx.conf.template), so these are never reachable from outside.
 */
export function createInternalRoutes(biddingService: BiddingService): Router {
  const controller = createBidController(biddingService);
  const router = Router();
  router.post('/auctions/:id/cancel', controller.cancelAuction);
  return router;
}
