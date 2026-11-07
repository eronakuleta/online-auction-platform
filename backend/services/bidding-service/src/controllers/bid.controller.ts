import { getAuthUser } from '@auction/shared-auth';
import type { RequestHandler } from 'express';
import type { AuctionState, Bid } from '../repositories/bidding.repository';
import {
  auctionIdParamsSchema,
  idempotencyKeySchema,
  internalCancelBodySchema,
  placeBidBodySchema,
} from '../schemas/bid.schemas';
import type { IdempotencyService } from '../services/idempotency.service';
import { minimumNextBid, type BiddingService } from '../services/bidding.service';

function toBidResponse(bid: Bid) {
  return {
    id: bid.id,
    auctionId: bid.auctionId,
    bidderId: bid.bidderId,
    amountCents: bid.amountCents,
    sequence: bid.sequence,
    placedAt: bid.placedAt.toISOString(),
  };
}

/** Public live data only. The reserve price stays secret. */
function toAuctionStateResponse(auction: AuctionState) {
  return {
    auctionId: auction.auctionId,
    status: auction.status,
    currency: auction.currency,
    highestBidCents: auction.highestBidCents,
    highestBidderId: auction.highestBidderId,
    bidCount: auction.bidCount,
    minimumNextBidCents: minimumNextBid(auction),
    endsAt: auction.endsAt?.toISOString() ?? null,
    extensionCount: auction.extensionCount,
    version: auction.version,
  };
}

export function createBidController(
  biddingService: BiddingService,
  idempotency: IdempotencyService,
) {
  const placeBid: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    const { id } = auctionIdParamsSchema.parse(req.params);
    const { amountCents } = placeBidBodySchema.parse(req.body);
    const key = idempotencyKeySchema.parse(req.header('Idempotency-Key'));

    const work = async () => {
      const { bid, auction } = await biddingService.placeBid(user.id, id, amountCents);
      return {
        status: 201,
        body: { bid: toBidResponse(bid), auction: toAuctionStateResponse(auction) },
      };
    };
    const result =
      key === undefined
        ? { ...(await work()), replayed: false }
        : await idempotency.run(user.id, key, { auctionId: id, amountCents }, work);
    if (result.replayed) {
      res.set('Idempotent-Replayed', 'true');
    }
    res.status(result.status).json(result.body);
  };

  const cancelAuction: RequestHandler = async (req, res) => {
    const { id } = auctionIdParamsSchema.parse(req.params);
    await biddingService.cancelAuction(id, internalCancelBodySchema.parse(req.body));
    res.status(204).end();
  };

  return { placeBid, cancelAuction };
}
