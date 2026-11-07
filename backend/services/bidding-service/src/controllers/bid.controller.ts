import { getAuthUser } from '@auction/shared-auth';
import type { RequestHandler } from 'express';
import type { AuctionState, Bid } from '../repositories/bidding.repository';
import {
  auctionIdParamsSchema,
  internalCancelBodySchema,
  placeBidBodySchema,
} from '../schemas/bid.schemas';
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

export function createBidController(biddingService: BiddingService) {
  const placeBid: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    const { id } = auctionIdParamsSchema.parse(req.params);
    const { amountCents } = placeBidBodySchema.parse(req.body);
    const { bid, auction } = await biddingService.placeBid(user.id, id, amountCents);
    res.status(201).json({ bid: toBidResponse(bid), auction: toAuctionStateResponse(auction) });
  };

  const cancelAuction: RequestHandler = async (req, res) => {
    const { id } = auctionIdParamsSchema.parse(req.params);
    await biddingService.cancelAuction(id, internalCancelBodySchema.parse(req.body));
    res.status(204).end();
  };

  return { placeBid, cancelAuction };
}
