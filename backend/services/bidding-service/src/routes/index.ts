import { authenticate, requireRole, type TokenVerifier } from '@auction/shared-auth';
import { Router } from 'express';
import { createBidQueryController } from '../controllers/bid-query.controller';
import { createBidController } from '../controllers/bid.controller';
import type { StreamHub } from '../controllers/stream-hub';
import type { BidQueryService } from '../services/bid-query.service';
import type { BiddingService } from '../services/bidding.service';
import type { IdempotencyService } from '../services/idempotency.service';

/** Public API under /api/v1, reached through the gateway. */
export function createRoutes(
  biddingService: BiddingService,
  idempotency: IdempotencyService,
  queries: BidQueryService,
  hub: StreamHub,
  verifyToken: TokenVerifier,
): Router {
  const controller = createBidController(biddingService, idempotency);
  const read = createBidQueryController(queries, hub);
  const router = Router();

  // Public and read-only (decision Q3), like the catalog.
  router.get('/auctions/:id/state', read.getState);
  router.get('/auctions/:id/bids', read.listBids);
  router.get('/auctions/:id/stream', read.stream);
  // Any logged-in user; someone who never bid simply gets an empty list.
  router.get('/bids/me', authenticate(verifyToken), read.listMyBids);

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
export function createInternalRoutes(
  biddingService: BiddingService,
  idempotency: IdempotencyService,
): Router {
  const controller = createBidController(biddingService, idempotency);
  const router = Router();
  router.post('/auctions/:id/cancel', controller.cancelAuction);
  return router;
}
