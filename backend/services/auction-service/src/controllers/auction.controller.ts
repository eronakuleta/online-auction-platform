import { getAuthUser, type AuthUser } from '@auction/shared-auth';
import type { RequestHandler } from 'express';
import type { Auction } from '../repositories/auction.repository';
import {
  auctionIdParamsSchema,
  createAuctionBodySchema,
  listAuctionsQuerySchema,
  listMyAuctionsQuerySchema,
  updateAuctionBodySchema,
} from '../schemas/auction.schemas';
import { canManage, type AuctionService } from '../services/auction.service';

/** What clients may see of an auction. Only the seller and admins see the reserve price. */
function toAuctionResponse(auction: Auction, viewer: AuthUser | undefined) {
  return {
    id: auction.id,
    sellerId: auction.sellerId,
    categoryId: auction.categoryId,
    title: auction.title,
    description: auction.description,
    currency: auction.currency,
    startingPriceCents: auction.startingPriceCents,
    minIncrementCents: auction.minIncrementCents,
    ...(canManage(auction, viewer) ? { reservePriceCents: auction.reservePriceCents } : {}),
    startsAt: auction.startsAt.toISOString(),
    endsAt: auction.endsAt.toISOString(),
    status: auction.status,
    phase: auction.phase,
    winnerId: auction.winnerId,
    finalPriceCents: auction.finalPriceCents,
    imageUrls: auction.imageUrls,
    publishedAt: auction.publishedAt?.toISOString() ?? null,
    closedAt: auction.closedAt?.toISOString() ?? null,
    createdAt: auction.createdAt.toISOString(),
    updatedAt: auction.updatedAt.toISOString(),
  };
}

export function createAuctionController(auctionService: AuctionService) {
  const create: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    const auction = await auctionService.create(user, createAuctionBodySchema.parse(req.body));
    res
      .status(201)
      .location(`/api/v1/auctions/${auction.id}`)
      .json(toAuctionResponse(auction, user));
  };

  const list: RequestHandler = async (req, res) => {
    const { auctions, ...pagination } = await auctionService.list(
      listAuctionsQuerySchema.parse(req.query),
    );
    res.status(200).json({
      data: auctions.map((auction) => toAuctionResponse(auction, req.user)),
      ...pagination,
    });
  };

  const listMine: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    const { auctions, ...pagination } = await auctionService.listMine(
      user,
      listMyAuctionsQuerySchema.parse(req.query),
    );
    res.status(200).json({
      data: auctions.map((auction) => toAuctionResponse(auction, user)),
      ...pagination,
    });
  };

  const getById: RequestHandler = async (req, res) => {
    const { id } = auctionIdParamsSchema.parse(req.params);
    const auction = await auctionService.getById(id, req.user);
    res.status(200).json(toAuctionResponse(auction, req.user));
  };

  const update: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    const { id } = auctionIdParamsSchema.parse(req.params);
    const auction = await auctionService.update(user, id, updateAuctionBodySchema.parse(req.body));
    res.status(200).json(toAuctionResponse(auction, user));
  };

  const publish: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    const { id } = auctionIdParamsSchema.parse(req.params);
    res.status(200).json(toAuctionResponse(await auctionService.publish(user, id), user));
  };

  const cancel: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    const { id } = auctionIdParamsSchema.parse(req.params);
    res.status(200).json(toAuctionResponse(await auctionService.cancel(user, id), user));
  };

  const remove: RequestHandler = async (req, res) => {
    const { id } = auctionIdParamsSchema.parse(req.params);
    await auctionService.remove(getAuthUser(req), id);
    res.status(204).end();
  };

  return { create, list, listMine, getById, update, publish, cancel, remove };
}
