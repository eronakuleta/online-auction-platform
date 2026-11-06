import { authenticate, requireRole, type TokenVerifier } from '@auction/shared-auth';
import { Router } from 'express';
import { createWalletController } from '../controllers/wallet.controller';
import type { WalletService } from '../services/wallet.service';

/** The public API under /api/v1, reached through the gateway. */
export function createRoutes(walletService: WalletService, verifyToken: TokenVerifier): Router {
  const controller = createWalletController(walletService);
  // Decision Q13: bidders and sellers have wallets. Admins see money through GET /payments (A-18).
  const walletOwner = [authenticate(verifyToken), requireRole('BIDDER', 'SELLER')];
  const router = Router();

  // Each user reaches only their own wallet: the user ID always comes from the token, never from
  // the request, so there is no other wallet to ask for.
  router.get('/wallet/me', walletOwner, controller.getMine);
  router.post('/wallet/deposit', walletOwner, controller.deposit);
  router.get('/wallet/transactions', walletOwner, controller.listTransactions);

  return router;
}

/**
 * Service-to-service calls. Mounted at /internal, outside /api/v1, and never routed by the gateway
 * (gateway/README.md), so only containers on the Docker network can reach them. Like bidding's
 * internal cancel call, it needs no token: the network is the boundary.
 */
export function createInternalRoutes(walletService: WalletService): Router {
  const controller = createWalletController(walletService);
  const router = Router();
  router.get('/funds-check', controller.checkFunds);
  return router;
}
