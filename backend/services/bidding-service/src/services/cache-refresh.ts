// After a change committed outside place-bid (cancel, close, new snapshot), the cache gets the new
// state with its higher version instead of a plain delete: a late write of an older state from
// another replica is then refused, so a closed auction can never look open again (B-09).
import type { Pool } from 'pg';
import { findAuctionState } from '../repositories/bidding.repository';
import type { StateCache } from '../repositories/state-cache';

export async function refreshCachedState(
  pool: Pool,
  cache: StateCache,
  auctionId: string,
): Promise<void> {
  const state = await findAuctionState(pool, auctionId);
  if (state !== null) {
    await cache.put(state);
  }
}
