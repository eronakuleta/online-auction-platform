import { hasAnyRole, type AuthUser } from '@auction/shared-auth';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type EventPayload,
  type EventType,
  type Logger,
  type Publish,
} from '@auction/shared-common';
import type { Pool } from 'pg';
import type { BiddingClient } from '../clients/bidding.client';
import {
  categoryExists,
  deleteAuction,
  findAuctionById,
  findAuctionForUpdate,
  insertAuction,
  listAuctions,
  listSellerAuctions,
  markAuctionCancelled,
  markAuctionPublished,
  replaceAuctionImages,
  updateAuctionDetails,
  type Auction,
  type AuctionDetails,
  type AuctionListFilter,
  type AuctionSort,
} from '../repositories/auction.repository';
import { withTransaction, type Queryable } from '../repositories/database';

export interface AuctionServiceDependencies {
  pool: Pool;
  bidding: BiddingClient;
  /** The platform has one currency, so sellers do not choose it. */
  currency: string;
  /** Publishes an event. Called only after the transaction has committed. */
  publish: Publish;
  logger: Logger;
}

export type NewAuction = AuctionDetails & { imageUrls: string[] };
export type AuctionChanges = Partial<NewAuction>;

export type CatalogQuery = Omit<AuctionListFilter, 'sort' | 'limit' | 'offset'> & {
  sort?: AuctionSort;
  page: number;
  size: number;
};

function isAdmin(user: AuthUser): boolean {
  return hasAnyRole(user, ['ADMIN']);
}

/** The seller and admins can see everything about an auction, including its reserve price. */
export function canManage(auction: Auction, user: AuthUser | undefined): boolean {
  return user !== undefined && (user.id === auction.sellerId || isAdmin(user));
}

/**
 * Never-published auctions (drafts, and drafts that were cancelled) are visible only to their seller
 * and admins. Everyone else gets 404, not 403, so the answer does not reveal that they exist (Q4).
 */
function requireVisible(auction: Auction | null, user: AuthUser | undefined): Auction {
  if (!auction || (auction.publishedAt === null && !canManage(auction, user))) {
    throw new NotFoundError('Auction not found');
  }
  return auction;
}

/** Ownership needs the database, so it is checked here and not in requireRole() middleware. */
function requireSeller(auction: Auction | null, user: AuthUser): Auction {
  const visible = requireVisible(auction, user);
  if (visible.sellerId !== user.id) {
    throw new ForbiddenError('Only the seller of this auction can do this');
  }
  return visible;
}

function requireDraft(auction: Auction): void {
  if (auction.status !== 'DRAFT') {
    throw new ConflictError('AUCTION_NOT_DRAFT', `This auction is ${auction.status}, not a draft`);
  }
}

function requireEndAfterStart(details: Pick<AuctionDetails, 'startsAt' | 'endsAt'>): void {
  if (details.endsAt <= details.startsAt) {
    throw new ValidationError('Invalid input', [
      { path: 'endsAt', message: 'The end time must be after the start time' },
    ]);
  }
}

async function requireCategory(db: Queryable, categoryId: string): Promise<void> {
  if (!(await categoryExists(db, categoryId))) {
    throw new ValidationError('Invalid input', [
      { path: 'categoryId', message: 'This category does not exist' },
    ]);
  }
}

async function reload(db: Queryable, id: string): Promise<Auction> {
  const auction = await findAuctionById(db, id);
  if (!auction) {
    throw new Error(`Auction ${id} disappeared inside its own transaction`);
  }
  return auction;
}

export function createAuctionService(deps: AuctionServiceDependencies) {
  const { pool, bidding, currency, publish, logger } = deps;

  /**
   * After the commit, as the contract requires (docs/events.md §1). The change is already saved, so
   * a broker failure must not turn the request into an error. An event lost this way is the known
   * limitation without an outbox (docs/events.md §7), so it is logged as an error to be noticed.
   */
  async function announce<T extends EventType>(type: T, payload: EventPayload<T>): Promise<void> {
    try {
      await publish(type, payload);
    } catch (err) {
      logger.error({ err, eventType: type }, 'could not publish event');
    }
  }

  return {
    async create(seller: AuthUser, input: NewAuction): Promise<Auction> {
      requireEndAfterStart(input);
      const auction = await withTransaction(pool, async (transaction) => {
        await requireCategory(transaction, input.categoryId);
        const id = await insertAuction(transaction, { ...input, sellerId: seller.id, currency });
        await replaceAuctionImages(transaction, id, input.imageUrls);
        return reload(transaction, id);
      });
      logger.info({ auctionId: auction.id, sellerId: seller.id }, 'auction created');
      return auction;
    },

    /** The public catalog. With a search term the best matches come first, otherwise the newest. */
    async list(query: CatalogQuery) {
      const { page, size, sort, ...filters } = query;
      const { auctions, total } = await listAuctions(pool, {
        ...filters,
        sort: sort ?? (filters.q === undefined ? 'newest' : 'relevance'),
        limit: size,
        offset: (page - 1) * size,
      });
      return { auctions, page, size, total };
    },

    /** The seller dashboard: the caller's own auctions in every state, drafts included. */
    async listMine(
      seller: AuthUser,
      query: { status?: Auction['status']; page: number; size: number },
    ) {
      const { auctions, total } = await listSellerAuctions(pool, seller.id, {
        status: query.status,
        limit: query.size,
        offset: (query.page - 1) * query.size,
      });
      return { auctions, page: query.page, size: query.size, total };
    },

    async getById(id: string, viewer: AuthUser | undefined): Promise<Auction> {
      return requireVisible(await findAuctionById(pool, id), viewer);
    },

    /** Editing is allowed only while DRAFT, so a published auction's terms can never change. */
    async update(user: AuthUser, id: string, changes: AuctionChanges): Promise<Auction> {
      return withTransaction(pool, async (transaction) => {
        const current = requireSeller(await findAuctionForUpdate(transaction, id), user);
        requireDraft(current);

        const { imageUrls, ...fields } = changes;
        const merged: AuctionDetails = {
          categoryId: fields.categoryId ?? current.categoryId,
          title: fields.title ?? current.title,
          description: fields.description ?? current.description,
          startingPriceCents: fields.startingPriceCents ?? current.startingPriceCents,
          minIncrementCents: fields.minIncrementCents ?? current.minIncrementCents,
          // null is a real value here: it removes the reserve price.
          reservePriceCents:
            fields.reservePriceCents === undefined
              ? current.reservePriceCents
              : fields.reservePriceCents,
          startsAt: fields.startsAt ?? current.startsAt,
          endsAt: fields.endsAt ?? current.endsAt,
        };
        requireEndAfterStart(merged);
        if (fields.categoryId !== undefined) {
          await requireCategory(transaction, fields.categoryId);
        }

        await updateAuctionDetails(transaction, id, merged);
        if (imageUrls !== undefined) {
          await replaceAuctionImages(transaction, id, imageUrls);
        }
        return reload(transaction, id);
      });
    },

    /** DRAFT to PUBLISHED. auction.published gives bidding-service what it needs to take bids. */
    async publish(user: AuthUser, id: string): Promise<Auction> {
      const auction = await withTransaction(pool, async (transaction) => {
        const current = requireSeller(await findAuctionForUpdate(transaction, id), user);
        requireDraft(current);
        if (current.ended) {
          throw new ConflictError('AUCTION_ALREADY_ENDED', 'The end time of this draft has passed');
        }
        await markAuctionPublished(transaction, id);
        return reload(transaction, id);
      });
      logger.info({ auctionId: id, sellerId: user.id }, 'auction published');
      await announce('auction.published', {
        auctionId: auction.id,
        sellerId: auction.sellerId,
        title: auction.title,
        startsAt: auction.startsAt.toISOString(),
        endsAt: auction.endsAt.toISOString(),
        startingPriceCents: auction.startingPriceCents,
        minIncrementCents: auction.minIncrementCents,
        reservePriceCents: auction.reservePriceCents,
        currency: auction.currency,
      });
      return auction;
    },

    /**
     * The seller can cancel before the first bid; an admin can cancel any auction that has not
     * closed. "Before the first bid" spans two databases, so bidding-service decides it for a
     * published auction (docs/events.md §8). That call happens before the transaction, so no row
     * lock is held during a network call. auction.cancelled is published only for an auction
     * that was published: nobody else ever saw a draft, so there is nobody to tell.
     */
    async cancel(user: AuthUser, id: string): Promise<Auction> {
      const before = requireVisible(await findAuctionById(pool, id), user);
      if (!canManage(before, user)) {
        throw new ForbiddenError('Only the seller of this auction or an admin can cancel it');
      }
      if (before.status !== 'DRAFT' && before.status !== 'PUBLISHED') {
        throw new ConflictError(
          'AUCTION_NOT_CANCELLABLE',
          `This auction is ${before.status} and can no longer be cancelled`,
        );
      }
      // A draft has never been seen by bidding-service, so there is nothing to ask.
      if (before.status === 'PUBLISHED') {
        await bidding.cancelAuction(id, { cancelledBy: user.id, isAdmin: isAdmin(user) });
      }

      const auction = await withTransaction(pool, async (transaction) => {
        const current = await findAuctionForUpdate(transaction, id);
        // Publishing, closing or another cancel may have happened since the check above. A draft
        // that was just published would otherwise be cancelled without asking bidding-service.
        if (current?.status !== before.status) {
          throw new ConflictError(
            'AUCTION_STATE_CHANGED',
            'This auction changed while cancelling it. Check it and try again',
          );
        }
        await markAuctionCancelled(transaction, id);
        return reload(transaction, id);
      });
      logger.info({ auctionId: id, cancelledBy: user.id }, 'auction cancelled');
      if (before.status === 'PUBLISHED') {
        await announce('auction.cancelled', {
          auctionId: auction.id,
          sellerId: auction.sellerId,
          title: auction.title,
          cancelledBy: user.id,
        });
      }
      return auction;
    },

    /** Only a draft can be deleted. A published auction is cancelled instead, and stays on record. */
    async remove(user: AuthUser, id: string): Promise<void> {
      await withTransaction(pool, async (transaction) => {
        requireDraft(requireSeller(await findAuctionForUpdate(transaction, id), user));
        await deleteAuction(transaction, id);
      });
      logger.info({ auctionId: id, sellerId: user.id }, 'auction deleted');
    },
  };
}

export type AuctionService = ReturnType<typeof createAuctionService>;
