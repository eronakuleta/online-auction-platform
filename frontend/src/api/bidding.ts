// bidding-service endpoints (docs/requirements.md FR-07 to FR-09, docs/events.md §10).
import { apiBaseUrl } from './config';
import { apiClient } from './client';
import type { Page } from './types';

export type LiveStatus = 'OPEN' | 'CANCELLED' | 'CLOSED_SOLD' | 'CLOSED_NO_SALE';

/** The live state of one auction. Public, and the same shape the SSE stream pushes. */
export interface AuctionLiveState {
  auctionId: string;
  title: string;
  sellerId: string;
  status: LiveStatus;
  currency: string | null;
  highestBidCents: number | null;
  highestBidderId: string | null;
  bidCount: number;
  /** The lowest amount the next bid may have. The server checks every bid again. */
  minimumNextBidCents: number;
  startsAt: string | null;
  endsAt: string | null;
  extensionCount: number;
  /** Rises with every change, so an older update can be told from a newer one. */
  version: number;
}

export interface Bid {
  id: string;
  auctionId: string;
  bidderId: string;
  amountCents: number;
  sequence: number;
  placedAt: string;
}

export interface MyBid extends Bid {
  title: string;
  currency: string;
  auctionStatus: LiveStatus;
  endsAt: string;
  /** This bid is the auction's current highest, or the winning one once it is closed. */
  isHighest: boolean;
}

export interface PlaceBidResult {
  bid: Bid;
  auction: AuctionLiveState;
}

export const biddingApi = {
  state: (auctionId: string, signal?: AbortSignal) =>
    apiClient.get<AuctionLiveState>(`/auctions/${encodeURIComponent(auctionId)}/state`, { signal }),

  history: (auctionId: string, page: number, size: number, signal?: AbortSignal) =>
    apiClient.get<Page<Bid>>(
      `/auctions/${encodeURIComponent(auctionId)}/bids?page=${page}&size=${size}`,
      { signal },
    ),

  /**
   * The Idempotency-Key makes a retry safe: the same key with the same request returns the first
   * answer instead of placing a second bid.
   */
  placeBid: (auctionId: string, amountCents: number, idempotencyKey: string) =>
    apiClient.post<PlaceBidResult>(
      `/auctions/${encodeURIComponent(auctionId)}/bids`,
      { amountCents },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    ),

  mine: (page: number, size: number, signal?: AbortSignal) =>
    apiClient.get<Page<MyBid>>(`/bids/me?page=${page}&size=${size}`, { signal }),

  /** Server-Sent Events, public and read-only. EventSource cannot send a token (decision Q3). */
  streamUrl: (auctionId: string) =>
    `${apiBaseUrl}/auctions/${encodeURIComponent(auctionId)}/stream`,
};
