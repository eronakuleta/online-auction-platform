import { getAuthUser } from '@auction/shared-auth';
import type { RequestHandler } from 'express';
import type { MyBid } from '../repositories/bidding.repository';
import { auctionIdParamsSchema, paginationQuerySchema } from '../schemas/bid.schemas';
import type { BidQueryService } from '../services/bid-query.service';
import { toAuctionStateResponse, toBidResponse } from './bid.controller';

function toMyBidResponse(bid: MyBid) {
  return {
    ...toBidResponse(bid),
    title: bid.title,
    currency: bid.currency,
    auctionStatus: bid.auctionStatus,
    endsAt: bid.endsAt.toISOString(),
    isHighest: bid.isHighest,
  };
}

export function createBidQueryController(queries: BidQueryService) {
  const getState: RequestHandler = async (req, res) => {
    const { id } = auctionIdParamsSchema.parse(req.params);
    res.status(200).json(toAuctionStateResponse(await queries.getState(id)));
  };

  const listBids: RequestHandler = async (req, res) => {
    const { id } = auctionIdParamsSchema.parse(req.params);
    const pagination = paginationQuerySchema.parse(req.query);
    const { items, total } = await queries.listBids(id, pagination);
    res.status(200).json({ data: items.map(toBidResponse), ...pagination, total });
  };

  const listMyBids: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    const pagination = paginationQuerySchema.parse(req.query);
    const { items, total } = await queries.listMyBids(user.id, pagination);
    res.status(200).json({ data: items.map(toMyBidResponse), ...pagination, total });
  };

  return { getState, listBids, listMyBids };
}
