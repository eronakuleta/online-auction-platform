// auction-service endpoints for the catalog (docs/requirements.md FR-05).
import { apiClient } from './client';
import type { Page } from './types';

export type AuctionStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'CANCELLED'
  | 'CLOSED_SOLD'
  | 'CLOSED_NO_SALE'
  | 'SETTLED'
  | 'PAYMENT_FAILED';

export type AuctionPhase = 'UPCOMING' | 'LIVE' | 'ENDED';

export interface Auction {
  id: string;
  sellerId: string;
  categoryId: string;
  title: string;
  description: string;
  currency: string;
  startingPriceCents: number;
  minIncrementCents: number;
  /** Only present for the seller and admins (decision Q8). */
  reservePriceCents?: number | null;
  startsAt: string;
  endsAt: string;
  status: AuctionStatus;
  /** Derived from the times while PUBLISHED, otherwise null. */
  phase: AuctionPhase | null;
  winnerId: string | null;
  finalPriceCents: number | null;
  imageUrls: string[];
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  createdAt: string;
}

export type AuctionSort = 'newest' | 'ending_soon' | 'price_asc' | 'price_desc' | 'relevance';

/** The catalog filters. Every field is optional; the server applies its own defaults. */
export interface AuctionQuery {
  q?: string;
  categoryId?: string;
  status?: Exclude<AuctionStatus, 'DRAFT'>;
  minPriceCents?: number;
  maxPriceCents?: number;
  sort?: AuctionSort;
  page?: number;
  size?: number;
}

function toQueryString(query: AuctionQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** What a seller sends to create an auction, or any part of it to edit a draft. */
export interface AuctionInput {
  categoryId: string;
  title: string;
  description: string;
  startingPriceCents: number;
  minIncrementCents: number;
  reservePriceCents: number | null;
  /** ISO-8601 with a time zone. */
  startsAt: string;
  endsAt: string;
  imageUrls: string[];
}

const auctionPath = (id: string) => `/auctions/${encodeURIComponent(id)}`;

export const auctionsApi = {
  list: (query: AuctionQuery, signal?: AbortSignal) =>
    apiClient.get<Page<Auction>>(`/auctions${toQueryString(query)}`, { signal }),
  /** The seller's own auctions in every state, drafts included. */
  listMine: (
    query: { status?: AuctionStatus; page?: number; size?: number },
    signal?: AbortSignal,
  ) =>
    apiClient.get<Page<Auction>>(`/auctions/mine${toQueryString(query as AuctionQuery)}`, {
      signal,
    }),
  create: (input: AuctionInput) => apiClient.post<Auction>('/auctions', input),
  update: (id: string, changes: Partial<AuctionInput>) =>
    apiClient.patch<Auction>(auctionPath(id), changes),
  publish: (id: string) => apiClient.post<Auction>(`${auctionPath(id)}/publish`),
  cancel: (id: string) => apiClient.post<Auction>(`${auctionPath(id)}/cancel`),
  remove: (id: string) => apiClient.delete<undefined>(auctionPath(id)),
  get: (id: string, signal?: AbortSignal) =>
    apiClient.get<Auction>(`/auctions/${encodeURIComponent(id)}`, { signal }),
  categories: (signal?: AbortSignal) => apiClient.get<Page<Category>>('/categories', { signal }),
};
